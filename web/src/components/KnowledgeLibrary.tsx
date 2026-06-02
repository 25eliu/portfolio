import { useState } from "react";
import { toast } from "sonner";
import { FileText, Globe, StickyNote, Upload, Trash2, RefreshCw, Sparkles } from "lucide-react";
import type { KnowledgeSource, SourceStatus, TrustClass } from "../api/types.ts";
import {
  useAddNote,
  useAddUrl,
  useArchiveSource,
  useKnowledgeSources,
  useRefreshSource,
  useUpdateSource,
  useUploadKnowledge,
} from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

const STATUS_TONE: Record<SourceStatus, "pos" | "neg" | "warn" | "neutral"> = {
  active: "pos",
  quarantined: "warn",
  archived: "neutral",
};
const TRUST_LABEL: Record<TrustClass, string> = {
  public_url: "public url",
  public_upload: "upload",
  private_note: "private note",
  system_lesson: "system",
  self_curated: "ai-curated",
};
const KIND_ICON = { upload: Upload, url: Globe, note: StickyNote, fact: Sparkles } as const;

type Tab = "note" | "url" | "upload";

/** Region 5 — the research knowledge library. Add notes / URLs / files; manage scope, trust, opt-in. */
export function KnowledgeLibrary() {
  const sources = useKnowledgeSources();
  const [tab, setTab] = useState<Tab>("note");

  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center gap-2">
        <FileText className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Knowledge library</p>
        {sources.data && <Badge tone="neutral">{sources.data.sources.length}</Badge>}
        <span className="ml-auto text-[11px] text-text-muted">cited, untrusted evidence for analysis</span>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-hairline bg-surface-2/40 p-1">
        {(["note", "url", "upload"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition-colors",
              tab === t ? "bg-surface-3 text-text" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "note" && <NoteForm />}
      {tab === "url" && <UrlForm />}
      {tab === "upload" && <UploadForm />}

      <div className="mt-5">
        {sources.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !sources.data || sources.data.sources.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
            No sources yet — add a note, URL, or file above. Excerpts are retrieved into the LLM's research
            stage as cited, untrusted evidence.
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {sources.data.sources.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeFields({
  scope,
  setScope,
  ticker,
  setTicker,
}: {
  scope: "global" | "ticker";
  setScope: (s: "global" | "ticker") => void;
  ticker: string;
  setTicker: (t: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value as "global" | "ticker")}
        className="rounded-lg border border-hairline bg-surface-2 px-2 py-1.5 text-[12px] text-text"
      >
        <option value="global">Global</option>
        <option value="ticker">Ticker</option>
      </select>
      {scope === "ticker" && (
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="w-24 rounded-lg border border-hairline bg-surface-2 px-2 py-1.5 text-[12px] text-text"
        />
      )}
    </div>
  );
}

function NoteForm() {
  const add = useAddNote();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"global" | "ticker">("ticker");
  const [ticker, setTicker] = useState("");
  const [optIn, setOptIn] = useState(true);

  const submit = async () => {
    try {
      const { source } = await add.mutateAsync({ title, text, scope, scopeTicker: ticker || undefined, useInAnalysis: optIn });
      if (source.status === "quarantined") toast.warning("Note quarantined", { description: "Content was flagged and not indexed." });
      else toast.success("Note added");
      setTitle(""); setText("");
    } catch (e) {
      toast.error("Couldn't add note", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
        className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] text-text" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a private note or thesis…" rows={3}
        className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-text" />
      <div className="flex flex-wrap items-center gap-2">
        <ScopeFields scope={scope} setScope={setScope} ticker={ticker} setTicker={setTicker} />
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> use in analysis
        </label>
        <button onClick={submit} disabled={!title || !text || add.isPending}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          Add note
        </button>
      </div>
    </div>
  );
}

function UrlForm() {
  const add = useAddUrl();
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<"global" | "ticker">("global");
  const [ticker, setTicker] = useState("");

  const submit = async () => {
    try {
      const { source } = await add.mutateAsync({ url, scope, scopeTicker: ticker || undefined });
      if (source.status === "quarantined") toast.warning("URL quarantined", { description: "Fetch blocked or content flagged." });
      else toast.success("URL snapshot added");
      setUrl("");
    } catch (e) {
      toast.error("Couldn't add URL", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
        className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] text-text" />
      <div className="flex flex-wrap items-center gap-2">
        <ScopeFields scope={scope} setScope={setScope} ticker={ticker} setTicker={setTicker} />
        <button onClick={submit} disabled={!url || add.isPending}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          Snapshot URL
        </button>
      </div>
    </div>
  );
}

function UploadForm() {
  const upload = useUploadKnowledge();
  const [scope, setScope] = useState<"global" | "ticker">("global");
  const [ticker, setTicker] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!file) return;
    try {
      const { source } = await upload.mutateAsync({ file, scope, scopeTicker: ticker || undefined });
      if (source.status === "quarantined") toast.warning("File quarantined", { description: "Content flagged or unparseable." });
      else toast.success("File ingested");
      setFile(null);
    } catch (e) {
      toast.error("Upload failed", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-2">
      <input type="file" accept=".pdf,.md,.markdown,.txt,.text,.html,.htm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-[12px] text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-text" />
      <div className="flex flex-wrap items-center gap-2">
        <ScopeFields scope={scope} setScope={setScope} ticker={ticker} setTicker={setTicker} />
        <button onClick={submit} disabled={!file || upload.isPending}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          Upload (PDF / MD / TXT / HTML)
        </button>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: KnowledgeSource }) {
  const update = useUpdateSource();
  const archive = useArchiveSource();
  const refresh = useRefreshSource();
  const Icon = KIND_ICON[source.kind];

  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-text">{source.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
          <span>{TRUST_LABEL[source.trustClass]}</span>
          <span>·</span>
          <span>{source.scope === "ticker" ? source.scopeTicker : "global"}</span>
        </div>
      </div>
      <Badge tone={STATUS_TONE[source.status]} dot>
        {source.status}
      </Badge>
      {source.status !== "archived" && (
        <label className="flex items-center gap-1 text-[10px] text-text-muted" title="Use this source as evidence in analysis">
          <input
            type="checkbox"
            checked={source.useInAnalysis}
            onChange={(e) => update.mutate({ id: source.id, patch: { useInAnalysis: e.target.checked } })}
          />
          analysis
        </label>
      )}
      {source.kind === "url" && source.status !== "archived" && (
        <button onClick={() => refresh.mutate(source.id)} title="Refresh snapshot"
          className="text-text-muted hover:text-accent">
          <RefreshCw className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")} />
        </button>
      )}
      {source.status !== "archived" && (
        <button onClick={() => archive.mutate(source.id)} title="Archive (preserves provenance)"
          className="text-text-muted hover:text-neg">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
