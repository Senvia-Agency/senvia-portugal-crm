import { format } from "date-fns";
import { tr } from "@/i18n";

/**
 * Ponto: the rules the screens share. The database (time_clock_punch) is the one
 * that enforces them; these mirror it so the buttons only offer what will work.
 */

export type PunchAction = "start" | "pause" | "resume" | "stop";
export type EntryStatus = "valid" | "pending" | "voided";
export type WorkdayState = "closed" | "working" | "paused";

export interface TimeClockEntry {
  id: string;
  organization_id: string;
  user_id: string;
  action: PunchAction;
  punched_at: string;
  source: "app" | "admin";
  status: EntryStatus;
  employee_note: string | null;
  admin_note: string | null;
  created_at: string;
}

/** A shift never runs past this: an older last entry means the day is closed. */
export const MAX_SHIFT_MS = 12 * 60 * 60 * 1000;

export const ACTION_LABELS: Record<PunchAction, string> = {
  start: "Início do dia",
  pause: "Pausa",
  resume: "Retoma",
  stop: "Fim do dia",
};

export const ACTION_BUTTONS: Record<PunchAction, string> = {
  start: "Iniciar dia",
  pause: "Pausa",
  resume: "Retomar",
  stop: "Terminar dia",
};

export const STATUS_LABELS: Record<EntryStatus, string> = {
  valid: "Válido",
  pending: "Aguarda aprovação",
  voided: "Anulado",
};

export const STATE_LABELS: Record<WorkdayState, string> = {
  working: "A trabalhar",
  paused: "Em pausa",
  closed: "Dia não iniciado",
};

const lisbonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(d);

/** Where the day stands, from the entries (any order). */
export function getWorkday(entries: TimeClockEntry[], now = new Date()) {
  const live = entries.filter(e => e.status !== "voided")
    .sort((a, b) => a.punched_at.localeCompare(b.punched_at));
  const last = live[live.length - 1];
  let state: WorkdayState = "closed";
  let stoppedToday = false;
  if (last && now.getTime() - new Date(last.punched_at).getTime() < MAX_SHIFT_MS) {
    if (last.action === "start" || last.action === "resume") state = "working";
    else if (last.action === "pause") state = "paused";
    else stoppedToday = lisbonDay(new Date(last.punched_at)) === lisbonDay(now);
  }
  const actions: PunchAction[] = state === "working" ? ["pause", "stop"]
    : state === "paused" ? ["resume", "stop"]
    : stoppedToday ? ["resume"] : ["start"];

  // The current session: from its start (or the last stop it continues) to now.
  let sessionStart = -1;
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i].action === "start") { sessionStart = i; break; }
    if (i > 0 && new Date(live[i].punched_at).getTime() - new Date(live[i - 1].punched_at).getTime() >= MAX_SHIFT_MS) { sessionStart = i; break; }
  }
  const session = state === "closed" && !stoppedToday ? [] : live.slice(Math.max(sessionStart, 0));
  const { workedMs, breakMs } = sumSession(session, state === "closed" ? null : now);
  return { state, stoppedToday, actions, last, session, workedMs, breakMs };
}

/** Worked and break time in a run of entries; `openUntil` closes an open stretch. */
export function sumSession(entries: TimeClockEntry[], openUntil: Date | null) {
  let workedMs = 0;
  let breakMs = 0;
  for (let i = 0; i < entries.length; i++) {
    const from = new Date(entries[i].punched_at).getTime();
    const next = entries[i + 1];
    const to = next ? new Date(next.punched_at).getTime() : openUntil?.getTime() ?? from;
    const span = Math.max(0, to - from);
    if (span >= MAX_SHIFT_MS) continue;
    if (entries[i].action === "start" || entries[i].action === "resume") workedMs += span;
    else if (entries[i].action === "pause") breakMs += span;
  }
  return { workedMs, breakMs };
}

export interface DaySummary {
  day: string; // yyyy-MM-dd (Lisbon)
  entries: TimeClockEntry[];
  workedMs: number;
  breakMs: number;
  /** A day that never stopped, or a stretch over 12 h that was not counted. */
  incomplete: boolean;
  open: boolean;
  pending: boolean;
}

/** One line per day of one person. A shift crossing midnight counts on the day it started. */
export function summarizeDays(entries: TimeClockEntry[], now = new Date()): DaySummary[] {
  const all = [...entries].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
  const live = all.filter(e => e.status !== "voided");
  const days = new Map<string, DaySummary>();
  const dayOf = (e: TimeClockEntry) => lisbonDay(new Date(e.punched_at));
  const ensure = (day: string) => {
    let d = days.get(day);
    if (!d) { d = { day, entries: [], workedMs: 0, breakMs: 0, incomplete: false, open: false, pending: false }; days.set(day, d); }
    return d;
  };
  for (const e of all) {
    const d = ensure(dayOf(e));
    d.entries.push(e);
    if (e.status === "pending") d.pending = true;
  }
  // Walk the live entries as shifts: a start (or a 12 h gap) opens one, a stop closes it.
  let shiftDay: string | null = null;
  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    const prev = live[i - 1];
    const gap = prev ? new Date(e.punched_at).getTime() - new Date(prev.punched_at).getTime() : Infinity;
    if (e.action === "start" || !shiftDay || gap >= MAX_SHIFT_MS) {
      if (shiftDay && prev && prev.action !== "stop") ensure(shiftDay).incomplete = true;
      shiftDay = dayOf(e);
    }
    const d = ensure(shiftDay);
    const next = live[i + 1];
    const continues = next && next.action !== "start" && new Date(next.punched_at).getTime() - new Date(e.punched_at).getTime() < MAX_SHIFT_MS;
    if (e.action === "stop") continue;
    if (continues) {
      const span = new Date(next.punched_at).getTime() - new Date(e.punched_at).getTime();
      if (e.action === "pause") d.breakMs += span; else d.workedMs += span;
    } else if (now.getTime() - new Date(e.punched_at).getTime() < MAX_SHIFT_MS && !next) {
      d.open = true;
      const span = now.getTime() - new Date(e.punched_at).getTime();
      if (e.action === "pause") d.breakMs += span; else d.workedMs += span;
    } else {
      d.incomplete = true;
    }
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export function formatDuration(ms: number, withSeconds = false): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${h}h${pad(m)}`;
}

export const formatClock = (iso: string) => format(new Date(iso), "HH:mm");

const ERRORS: Array<[RegExp, string]> = [
  [/time_clock_not_member/, "Já não é membro ativo desta organização."],
  [/time_clock_forbidden/, "Não tem permissão para isto."],
  [/time_clock_reason_required/, "Indique o motivo (pelo menos 3 caracteres)."],
  [/time_clock_note_too_long/, "A observação tem mais de 300 caracteres."],
  [/time_clock_invalid_time/, "Essa hora não é válida: tem de ser nas últimas 12 horas e depois do último registo."],
  [/time_clock_out_of_order/, "A nova hora tem de ficar entre o registo anterior e o seguinte."],
  [/time_clock_invalid_state:working/, "O dia já está iniciado."],
  [/time_clock_invalid_state:paused/, "Está em pausa: retome ou termine o dia."],
  [/time_clock_invalid_state/, "O dia não está iniciado."],
  [/time_clock_not_found/, "O registo já não existe."],
];

export function timeClockError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return tr(ERRORS.find(([re]) => re.test(message))?.[1] ?? "Não foi possível registar. Tente novamente.");
}
