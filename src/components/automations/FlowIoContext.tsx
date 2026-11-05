import { createContext, useContext, type ReactNode } from 'react';
import type { AutomationGraph } from '@/types/automations';
import type { IoField } from '@/lib/automation-io';

/**
 * The variables available to the step being edited — the contact, the
 * trigger's record and what earlier steps added. Provided by NodeDetailsView
 * so VariableChips, nested a few forms deep, offers the right tokens without
 * every form having to pass them along.
 */
const FlowGraphContext = createContext<{ graph: AutomationGraph; currentNodeId?: string } | null>(null);

export function useFlowGraph() { return useContext(FlowGraphContext); }

const FlowIoContext = createContext<IoField[] | null>(null);

export function FlowIoProvider({ fields, children, graph, currentNodeId }: { fields: IoField[]; children: ReactNode; graph?: AutomationGraph; currentNodeId?: string }) {
  return <FlowGraphContext.Provider value={graph ? { graph, currentNodeId } : null}><FlowIoContext.Provider value={fields}>{children}</FlowIoContext.Provider></FlowGraphContext.Provider>;
}

/** Null outside a details view, where the chips fall back to the contact basics. */
export function useFlowVariables(): IoField[] | null {
  return useContext(FlowIoContext);
}
