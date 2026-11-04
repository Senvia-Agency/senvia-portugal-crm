import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeClockHistoryRow } from "@/hooks/useTimeClock";
import { ACTION_LABELS, formatClock, type PunchAction } from "@/lib/timeclock";
import { tr, useLanguage } from "@/i18n";

const CHANGE_LABELS: Record<TimeClockHistoryRow["action"], string> = {
  create: "Criou",
  update: "Alterou",
  void: "Anulou",
  restore: "Restaurou",
  approve: "Aprovou",
  reject: "Rejeitou",
};

/** What changed in an update, in words: "Hora 09:00 → 09:15". */
function describe(row: TimeClockHistoryRow): string {
  const before = row.old_data ?? {};
  const after = row.new_data ?? {};
  const parts: string[] = [];
  if (row.action === "create" && after.action && after.punched_at) {
    parts.push(tr("{{action}} às {{time}}", { action: tr(ACTION_LABELS[after.action as PunchAction]), time: formatClock(after.punched_at) }));
  }
  if (row.action === "update") {
    if (row.changed_fields.includes("punched_at") && before.punched_at && after.punched_at) {
      parts.push(tr("Hora {{from}} → {{to}}", { from: formatClock(before.punched_at), to: formatClock(after.punched_at) }));
    }
    if (row.changed_fields.includes("action") && before.action && after.action) {
      parts.push(`${tr(ACTION_LABELS[before.action as PunchAction])} → ${tr(ACTION_LABELS[after.action as PunchAction])}`);
    }
    if (row.changed_fields.includes("status") && after.status === "pending") parts.push(tr("Ficou a aguardar aprovação"));
  }
  return parts.join(" · ");
}

export function HistoryList({ rows, loading, nameOf }: {
  rows: TimeClockHistoryRow[];
  loading?: boolean;
  /** Whose entry it is (the org-wide history shows it). */
  nameOf?: (userId: string) => string;
}) {
  const { t } = useLanguage();
  if (loading) return <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (rows.length === 0) return <p className="py-4 text-sm text-muted-foreground">{t("Sem alterações.")}</p>;
  return (
    <ol className="space-y-2">
      {rows.map(row => (
        <li key={row.id} className="rounded-lg border px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              <strong>{row.changed_by_name ?? t("Sistema")}</strong> {t(CHANGE_LABELS[row.action]).toLowerCase()}
              {nameOf && <> {t("o registo de")} <strong>{nameOf(row.user_id)}</strong></>}
            </span>
            <span className="text-xs text-muted-foreground">{format(new Date(row.changed_at), "dd/MM/yyyy HH:mm")}</span>
          </div>
          {describe(row) && <p className="text-xs text-muted-foreground">{describe(row)}</p>}
          {row.reason && <p className="mt-0.5 text-xs italic">“{row.reason}”</p>}
        </li>
      ))}
    </ol>
  );
}
