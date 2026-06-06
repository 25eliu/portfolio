import { useState } from "react";
import { motion } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  useInvalidateAll,
  usePortfolios,
  useRecommendations,
  useSnapshots,
  useStartRun,
} from "./api/hooks.ts";
import { AnalysisStream } from "./components/AnalysisStream.tsx";
import { Atmosphere } from "./components/Atmosphere.tsx";
import { EquityCurve } from "./components/EquityCurve.tsx";
import { Header } from "./components/Header.tsx";
import { AiTrades } from "./components/AiTrades.tsx";
import { Journal } from "./components/Journal.tsx";
import { KnowledgeLibrary } from "./components/KnowledgeLibrary.tsx";
import { KnowledgeGraph } from "./components/KnowledgeGraph.tsx";
import { AiLibrary } from "./components/AiLibrary.tsx";
import { MarketView } from "./components/MarketView.tsx";
import { Wiki } from "./components/Wiki.tsx";
import { PortfolioQuery } from "./components/PortfolioQuery.tsx";
import { MarketContextBanner } from "./components/MarketContextBanner.tsx";
import { PortfolioPanel } from "./components/PortfolioPanel.tsx";
import { Recommendations } from "./components/Recommendations.tsx";
import { ScheduleDialog } from "./components/ScheduleDialog.tsx";
import { SummaryBand } from "./components/SummaryBand.tsx";
import { TickerManager } from "./components/TickerManager.tsx";
import { Card, CardHeader } from "./components/ui/Card.tsx";
import { SegmentedControl } from "./components/ui/SegmentedControl.tsx";
import { Skeleton } from "./components/ui/Skeleton.tsx";
import type { HorizonKey } from "./lib/horizon.ts";
import type { PnlMode } from "./lib/format.ts";

function Section({
  title,
  index,
  children,
  action,
}: {
  title: string;
  index: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

export default function App() {
  const [showManager, setShowManager] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<HorizonKey>("3M");
  const [pnlMode, setPnlMode] = useState<PnlMode>("usd");
  const [journalTicker, setJournalTicker] = useState<string | undefined>(undefined);
  const [graphFocus, setGraphFocus] = useState<string | undefined>(undefined);

  // Deep link into the knowledge graph: set the focal node id and scroll the section into view.
  const viewInGraph = (id: string) => {
    setGraphFocus(id);
    document.getElementById("graph")?.scrollIntoView({ behavior: "smooth" });
  };

  // One global $/% control for all P&L figures (overview band + both portfolio panels).
  const pnlToggle = (
    <SegmentedControl<PnlMode>
      value={pnlMode}
      onChange={setPnlMode}
      size="sm"
      className="self-start"
      options={[
        { value: "usd", label: "$" },
        { value: "pct", label: "%" },
      ]}
    />
  );

  const portfolios = usePortfolios();
  const recommendations = useRecommendations();
  const snapshots = useSnapshots();
  const startRun = useStartRun();
  const refresh = useInvalidateAll();

  const handleRun = async () => {
    try {
      const { runId } = await startRun.mutateAsync();
      setActiveRunId(runId);
    } catch (e) {
      toast.error("Couldn't start analysis", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const handleStreamFinished = (status: "done" | "error", message?: string) => {
    setActiveRunId(null);
    void refresh();
    if (status === "error") {
      const interrupted = /abandon|restart/i.test(message ?? "");
      if (interrupted) {
        toast("Run interrupted by a server restart", { description: "Nothing was saved — just re-run." });
      } else {
        toast.error("Run failed", { description: message });
      }
    } else {
      toast.success("Analysis complete", { description: "Report and snapshots updated." });
    }
  };

  return (
    <div className="min-h-screen">
      <Atmosphere />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#181C22",
            border: "1px solid #2E343D",
            color: "#E6E9EE",
            borderRadius: "12px",
          },
        }}
      />
      <Header
        onManage={() => setShowManager(true)}
        onSchedule={() => setShowSchedule(true)}
        onRun={handleRun}
        running={activeRunId != null || startRun.isPending}
      />

      <main className="mx-auto max-w-[1400px] space-y-10 px-6 py-8">
        <Section title="Overview" index={0} action={portfolios.data ? pnlToggle : null}>
          {portfolios.data ? (
            <SummaryBand
              user={portfolios.data.user}
              ai={portfolios.data.ai}
              snapshots={snapshots.data}
              horizon={horizon}
              onHorizonChange={setHorizon}
              pnlMode={pnlMode}
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </Section>

        <Section title="Equity curve · You vs AI vs SPY" index={1}>
          <Card className="p-5">
            <CardHeader
              eyebrow="Performance"
              title="Cumulative equity"
              className="mb-5"
            />
            {snapshots.data ? (
              <EquityCurve
                user={snapshots.data.user}
                ai={snapshots.data.ai}
                spy={snapshots.data.spy}
                horizon={horizon}
                onHorizonChange={setHorizon}
              />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </Card>
        </Section>

        <Section title="Portfolios" index={2} action={portfolios.data ? pnlToggle : null}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {portfolios.data ? (
              <>
                <PortfolioPanel p={portfolios.data.user} badge="advisory" tone="accent" pnlMode={pnlMode} />
                <PortfolioPanel p={portfolios.data.ai} badge="paper · auto" tone="pos" pnlMode={pnlMode} />
              </>
            ) : portfolios.isError ? (
              <div className="card col-span-full p-10 text-center text-sm text-text-muted">
                Failed to load portfolios — is the API running?
              </div>
            ) : (
              <>
                <Skeleton className="h-96 w-full" />
                <Skeleton className="h-96 w-full" />
              </>
            )}
          </div>
        </Section>

        <Section title={activeRunId ? "Live analysis" : "Daily recommendations"} index={3}>
          {activeRunId ? (
            <AnalysisStream runId={activeRunId} onFinished={handleStreamFinished} />
          ) : (
            <>
              <MarketContextBanner report={recommendations.data?.report ?? null} />
              <Recommendations
                report={recommendations.data?.report ?? null}
                onViewJournal={(ticker) => {
                  setJournalTicker(ticker);
                  document.getElementById("journal")?.scrollIntoView({ behavior: "smooth" });
                }}
                onViewInGraph={viewInGraph}
              />
            </>
          )}
        </Section>

        <Section title="Market view" index={4}>
          <MarketView />
        </Section>

        <Section title="AI trading" index={5}>
          <AiTrades />
        </Section>

        <Section title="Journal &amp; query" index={6}>
          <div id="journal">
            <Journal ticker={journalTicker} onClearFilter={() => setJournalTicker(undefined)} />
          </div>
        </Section>

        <Section title="Knowledge graph" index={7}>
          <div id="graph">
            <KnowledgeGraph focusId={graphFocus} />
          </div>
        </Section>

        <Section title="Knowledge library" index={8}>
          <KnowledgeLibrary />
        </Section>

        <Section title="AI knowledge library" index={9}>
          <AiLibrary />
        </Section>

        <Section title="Performance wiki" index={10}>
          <Wiki onViewInGraph={viewInGraph} />
        </Section>

        <Section title="Ask your portfolio" index={11}>
          <PortfolioQuery />
        </Section>
      </main>

      {showManager && <TickerManager onClose={() => setShowManager(false)} />}
      {showSchedule && <ScheduleDialog onClose={() => setShowSchedule(false)} />}
    </div>
  );
}
