import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MentionSource, MentionTicker } from "../api/types.ts";
import { cn } from "../lib/cn.ts";

/** The `@`-token immediately left of the caret, if the user is mid-mention (drives the autocomplete). */
type ActiveMention = { start: number; query: string };

const SOURCE_LABEL: Record<MentionSource, string> = { holding: "My book", ai: "AI book", watchlist: "Watchlist" };
const SOURCE_TONE: Record<MentionSource, string> = { holding: "text-pos", ai: "text-accent", watchlist: "text-text-muted" };

/** Find the `@TICKER` fragment being typed at the caret — start-of-text or after whitespace, no spaces. */
function activeMentionAt(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([A-Za-z][A-Za-z.]*)?$/);
  if (!m) return null;
  return { start: caret - (m[2]?.length ?? 0) - 1, query: (m[2] ?? "").toUpperCase() };
}

/**
 * A textarea with `@`-ticker autocomplete. Mentions are limited to the owner's mentionable universe
 * (holdings ∪ AI book ∪ watchlist), grouped by source. Selecting one inserts `@SYMBOL ` at the caret;
 * Enter submits (Shift+Enter for a newline), and the dropdown owns Enter/arrows/Esc while it's open.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  tickers,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  tickers: MentionTicker[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const caretToRestore = useRef<number | null>(null);

  const mention = useMemo(() => (open ? activeMentionAt(value, caret) : null), [open, value, caret]);
  const matches = useMemo(() => {
    if (!mention) return [];
    return tickers.filter((t) => t.symbol.startsWith(mention.query)).slice(0, 8);
  }, [mention, tickers]);

  // Keep our caret mirror in sync; reopen the menu whenever the caret sits inside an @-fragment.
  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const c = el.selectionStart ?? value.length;
    setCaret(c);
    setOpen(activeMentionAt(value, c) !== null);
    setHighlight(0);
  };

  // Restore the caret after a programmatic insert (controlled value updates lose the native position).
  useLayoutEffect(() => {
    if (caretToRestore.current != null && ref.current) {
      ref.current.selectionStart = ref.current.selectionEnd = caretToRestore.current;
      caretToRestore.current = null;
    }
  });

  useEffect(() => {
    if (highlight >= matches.length) setHighlight(0);
  }, [matches.length, highlight]);

  const choose = (symbol: string) => {
    const m = activeMentionAt(value, caret);
    if (!m) return;
    const next = `${value.slice(0, m.start)}@${symbol} ${value.slice(caret)}`;
    const newCaret = m.start + symbol.length + 2; // past "@SYMBOL "
    caretToRestore.current = newCaret;
    onChange(next);
    setCaret(newCaret);
    setOpen(false);
    ref.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setHighlight((h) => (h + 1) % matches.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setHighlight((h) => (h - 1 + matches.length) % matches.length));
      if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), choose(matches[highlight]!.symbol));
      if (e.key === "Escape") return (e.preventDefault(), setOpen(false));
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <div className="relative flex-1">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => {
          onChange(e.target.value);
          // selectionStart is already updated for the new value on the event target.
          const c = e.target.selectionStart ?? e.target.value.length;
          setCaret(c);
          setOpen(activeMentionAt(e.target.value, c) !== null);
          setHighlight(0);
        }}
        onKeyUp={sync}
        onClick={sync}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let a click on a suggestion land first
        placeholder={placeholder}
        className="w-full resize-none rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-text"
      />

      {open && matches.length > 0 && (
        <ul className="absolute bottom-full z-20 mb-1 w-full overflow-hidden rounded-lg border border-hairline bg-surface-1 shadow-lg">
          {matches.map((t, i) => (
            <li key={t.symbol}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the textarea's blur closes the menu.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(t.symbol);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                  i === highlight ? "bg-surface-2 text-text" : "text-text-secondary",
                )}
              >
                <span className="tnum font-medium">{t.symbol}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {t.sources.map((s) => (
                    <span key={s} className={cn("text-[10px]", SOURCE_TONE[s])}>
                      {SOURCE_LABEL[s]}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
