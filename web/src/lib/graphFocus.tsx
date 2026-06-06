import { createContext, useContext, type ReactNode } from "react";

/** "View in graph" deep-link callback: focus the knowledge graph on a node id and scroll to it. */
export type ViewInGraph = (nodeId: string) => void;

const ViewInGraphContext = createContext<ViewInGraph | null>(null);

/** Provides the deep-link callback to any descendant, so surfaces don't thread it through props. */
export function ViewInGraphProvider({ value, children }: { value: ViewInGraph; children: ReactNode }) {
  return <ViewInGraphContext.Provider value={value}>{children}</ViewInGraphContext.Provider>;
}

/** The deep-link callback, or null when rendered outside the dashboard (link simply hides). */
export function useViewInGraph(): ViewInGraph | null {
  return useContext(ViewInGraphContext);
}
