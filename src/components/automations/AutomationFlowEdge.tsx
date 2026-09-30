import { memo } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge,
} from '@xyflow/react';
import { Plus, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AutomationEdgeData extends Record<string, unknown> {
  /** Branch name shown as a pill sitting on the curve ("Respondeu", "Sim"…). */
  branchLabel: string | null;
  /** CSS colour for the stroke, taken from the source node's category. */
  stroke: string;
  /** Ghost edges (leading to a "+" placeholder) are dashed and not insertable. */
  ghost: boolean;
  onInsert?: (edgeId: string) => void;
  /** Cuts this connection, leaving both steps on the canvas to be rewired. */
  onUnlink?: (edgeId: string) => void;
}

export type AutomationFlowEdgeType = Edge<AutomationEdgeData, 'automation'>;

export const AutomationFlowEdge = memo(({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps<AutomationFlowEdgeType>) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const stroke = data?.stroke ?? 'hsl(var(--muted-foreground) / 0.5)';
  const ghost = data?.ghost;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: 3.5,
          strokeLinecap: 'round',
          strokeDasharray: ghost ? '2 7' : undefined,
          opacity: ghost ? 0.55 : 1,
        }}
      />

      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute flex items-center gap-1.5"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.branchLabel && (
            <span
              className={cn(
                'pointer-events-auto max-w-[130px] truncate rounded-full border px-2 py-0.5',
                'text-[10px] font-semibold leading-tight shadow-sm',
                'border-border bg-card text-foreground',
              )}
              title={data.branchLabel}
            >
              {data.branchLabel}
            </span>
          )}

          {/* Insert between two existing steps. */}
          {!ghost && data?.onInsert && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onInsert?.(id);
              }}
              title="Inserir passo aqui"
              className={cn(
                'pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full',
                'border border-border bg-card text-muted-foreground shadow-sm transition-all',
                'hover:scale-125 hover:border-primary hover:text-primary',
              )}
            >
              <Plus className="h-3 w-3" />
            </button>
          )}

          {/* Cut the connection. Both steps stay; the downstream one waits to be
              rewired rather than disappearing with the line. */}
          {!ghost && data?.onUnlink && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onUnlink?.(id);
              }}
              title="Desligar"
              aria-label="Desligar esta ligação"
              className={cn(
                'pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full',
                'border border-border bg-card text-muted-foreground shadow-sm transition-all',
                'hover:scale-125 hover:border-destructive hover:text-destructive',
              )}
            >
              <Unlink className="h-3 w-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

AutomationFlowEdge.displayName = 'AutomationFlowEdge';
