import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn.ts";

/**
 * Markdown renderer for grounded-query answers (and lesson/journal prose in the detail dialog). Maps
 * every element to the app's dark-theme tokens instead of pulling in @tailwindcss/typography, so the
 * output matches the rest of the UI. Safe by construction — react-markdown never uses innerHTML, and we
 * don't enable raw-HTML plugins. Renders gracefully on partial markdown while an answer streams.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-[15px] font-semibold text-text first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-[14px] font-semibold text-text first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-[13px] font-semibold text-text first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-hairline-strong pl-3 text-text-muted">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const inline = !className?.includes("language-");
    return inline ? (
      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-text">{children}</code>
    ) : (
      <code className={cn("font-mono text-[12px]", className)}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-hairline bg-surface-2 p-3 text-[12px]">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-hairline bg-surface-2 px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-hairline px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-hairline" />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[13px] text-text-secondary", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
