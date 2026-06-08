import { createContext, useContext, type ReactNode } from "react";

/** "View in journal" deep-link: filter the journal to a ticker and open/scroll to one entry. */
export type ViewInJournal = (entryId: string, ticker: string) => void;

const ViewInJournalContext = createContext<ViewInJournal | null>(null);

/** Provides the deep-link callback to any descendant, so surfaces don't thread it through props. */
export function ViewInJournalProvider({ value, children }: { value: ViewInJournal; children: ReactNode }) {
  return <ViewInJournalContext.Provider value={value}>{children}</ViewInJournalContext.Provider>;
}

/** The deep-link callback, or null when rendered outside the dashboard (link simply hides). */
export function useViewInJournal(): ViewInJournal | null {
  return useContext(ViewInJournalContext);
}
