import { AlertTriangle, CheckCircle2, Loader2, MailCheck, MailWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { automaticReceiptState } from "@/lib/fiscal-automation";
import type { AutomaticReceiptJob } from "@/hooks/useAutomaticReceipts";

const SENT = new Set(["sent", "delivered"]);
const SENDING = new Set(["pending", "processing", "retry"]);
const SEND_FAILED = new Set(["failed", "bounced", "blocked"]);

/** Where the automatic receipt of a payment stands: queued, issued, emailed or waiting for review. */
export function AutomaticReceiptBadge({ job, className }: { job: AutomaticReceiptJob | undefined; className?: string }) {
  if (!job) return null;
  const state = automaticReceiptState(job.processing_status);
  if (state === "cancelled") return null;

  let tone = "border-amber-300/70 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200";
  let Icon = Loader2;
  let label = "Recibo automático a emitir";
  let detail: string | null = null;
  if (state === "review") {
    tone = "border-destructive/30 bg-destructive/5 text-destructive";
    Icon = AlertTriangle;
    label = "Recibo automático em revisão";
    detail = job.processing_last_error;
  } else if (state === "issued") {
    const reference = job.reference ? `Recibo ${job.reference}` : "Recibo emitido";
    if (SENT.has(job.email_status)) {
      tone = "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200";
      Icon = MailCheck;
      label = `${reference} · enviado`;
    } else if (SENDING.has(job.email_status)) {
      tone = "border-sky-300/70 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200";
      Icon = Loader2;
      label = `${reference} · a enviar`;
    } else if (SEND_FAILED.has(job.email_status)) {
      tone = "border-destructive/30 bg-destructive/5 text-destructive";
      Icon = MailWarning;
      label = `${reference} · envio falhou`;
      detail = job.email_last_error;
    } else {
      tone = "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200";
      Icon = CheckCircle2;
      label = `${reference} emitido`;
    }
  }
  const spinning = Icon === Loader2;
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tone, className)}
      title={detail ?? undefined}
    >
      <Icon className={cn("h-3 w-3 shrink-0", spinning && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
