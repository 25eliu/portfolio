import { describe, expect, test } from "bun:test";
import { SsrfError, validateUrlSyntax } from "./ssrf.ts";

describe("validateUrlSyntax", () => {
  test("allows ordinary public http(s) URLs", () => {
    expect(validateUrlSyntax("https://example.com/article").hostname).toBe("example.com");
    expect(validateUrlSyntax("http://news.site.org/x?y=1").protocol).toBe("http:");
  });

  test("rejects non-http(s) schemes", () => {
    for (const u of ["ftp://example.com", "file:///etc/passwd", "gopher://x", "data:text/plain,hi"]) {
      expect(() => validateUrlSyntax(u)).toThrow(SsrfError);
    }
  });

  test("rejects credentials embedded in the URL", () => {
    expect(() => validateUrlSyntax("http://user:pass@example.com")).toThrow(SsrfError);
  });

  test("rejects localhost and internal-looking hostnames", () => {
    for (const u of ["http://localhost", "http://foo.localhost", "http://db.internal", "http://x.local"]) {
      expect(() => validateUrlSyntax(u)).toThrow(SsrfError);
    }
  });

  test("rejects private, loopback, link-local and CGNAT IP literals", () => {
    for (const u of [
      "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.10", "http://172.16.5.5",
      "http://169.254.169.254", "http://100.64.0.1", "http://[::1]", "http://[fd00::1]",
    ]) {
      expect(() => validateUrlSyntax(u)).toThrow(SsrfError);
    }
  });

  test("allows public IP literals", () => {
    expect(validateUrlSyntax("http://8.8.8.8/").hostname).toBe("8.8.8.8");
  });
});
