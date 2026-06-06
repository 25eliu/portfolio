import { lookup } from "node:dns/promises";

/**
 * SSRF defenses for URL ingestion (roadmap §8, OWASP). A hard security boundary: reject non-http(s)
 * schemes, credentials-in-URL, and any host that resolves to loopback / private / link-local space —
 * and re-validate every redirect hop, since a public URL can 30x into the metadata service.
 */
export class SsrfError extends Error {}

/** IPv4 ranges that must never be fetched: loopback, private, link-local, CGNAT, broadcast. */
function isBlockedIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true; // private / loopback / "this host"
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (x === "::1" || x === "::") return true; // loopback / unspecified
  if (x.startsWith("fe80")) return true; // link-local
  if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique local
  if (x.startsWith("::ffff:")) return isBlockedIpv4(x.slice(7)); // IPv4-mapped
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal");
}

/** Pure syntactic validation (no DNS): scheme, credentials, literal-IP and hostname blocklists. */
export function validateUrlSyntax(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`blocked scheme: ${url.protocol}`);
  }
  if (url.username || url.password) throw new SsrfError("credentials in URL are not allowed");
  const host = url.hostname;
  if (isBlockedHostname(host)) throw new SsrfError(`blocked host: ${host}`);
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) throw new SsrfError(`blocked IP: ${host}`);
  return url;
}

/** Resolve the host and reject if any resolved address is in blocked space (DNS-rebinding defense). */
export async function assertResolvableSafe(url: URL): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    throw new SsrfError(`cannot resolve host: ${url.hostname}`);
  }
  for (const { address } of addrs) {
    if (isBlockedIpv4(address) || isBlockedIpv6(address)) {
      throw new SsrfError(`host ${url.hostname} resolves to blocked address ${address}`);
    }
  }
}

export type FetchResult = { finalUrl: string; contentType: string; bytes: Uint8Array };

/**
 * Fetch a URL with SSRF protection: validates syntax + DNS for every hop, follows up to `maxRedirects`
 * redirects manually (re-validating each Location), caps the body at `maxBytes`, and times out.
 */
export async function safeFetch(
  raw: string,
  opts: { maxBytes?: number; maxRedirects?: number; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const maxRedirects = opts.maxRedirects ?? 4;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = validateUrlSyntax(current);
    await assertResolvableSafe(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "PortfolioIntel/1.0" } });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new SsrfError(`redirect without Location from ${current}`);
      current = new URL(loc, url).toString(); // re-validated at the top of the next iteration
      continue;
    }
    if (!res.ok) throw new SsrfError(`fetch ${current} → ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    if (!reader) return { finalUrl: current, contentType, bytes: new Uint8Array() };
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new SsrfError(`response exceeds ${maxBytes} bytes`);
        }
        parts.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      bytes.set(p, off);
      off += p.byteLength;
    }
    return { finalUrl: current, contentType, bytes };
  }
  throw new SsrfError(`too many redirects from ${raw}`);
}
