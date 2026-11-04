import { eachDayOfInterval, format, isWeekend } from "date-fns";
import { pt } from "date-fns/locale";
import { formatClock, formatDuration, summarizeDays, type TimeClockEntry } from "@/lib/timeclock";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The app's primary colour ("217 91% 60%" in the CSS variable) as a CSS colour. */
function brandColour(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return raw ? `hsl(${raw.split(/\s+/).join(" ")})` : "#2563eb";
}

const time = (e: TimeClockEntry | undefined) =>
  e ? `${formatClock(e.punched_at)}${e.source === "admin" ? "<sup>*</sup>" : ""}` : "";

/** A day's live entries in four columns — start, pause, back, end — and what does not fit. */
function columns(entries: TimeClockEntry[]) {
  const start = entries.find(e => e.action === "start");
  const pause = entries.find(e => e.action === "pause");
  const resume = entries.find(e => e.action === "resume" && (!pause || e.punched_at > pause.punched_at));
  const stop = [...entries].reverse().find(e => e.action === "stop");
  const used = new Set([start, pause, resume, stop].filter(Boolean).map(e => e!.id));
  const extra = entries.filter(e => !used.has(e.id)).map(e => formatClock(e.punched_at));
  return { start, pause, resume, stop, extra };
}

/**
 * The monthly timesheet to sign: one A4 page per person — the company's logo and
 * name, the month's figures, every day of the month, and the two signatures.
 * Opened in a new window that prints itself (or saves as PDF). "*" marks a time
 * set by an administrator.
 */
export function printTimesheet({ organizationName, logoUrl, month, people }: {
  organizationName: string;
  logoUrl?: string | null;
  month: Date;
  people: Array<{ name: string; entries: TimeClockEntry[] }>;
}) {
  const brand = brandColour();
  const monthLabel = format(month, "MMMM yyyy", { locale: pt });
  const issued = format(new Date(), "dd/MM/yyyy 'às' HH:mm");
  const days = eachDayOfInterval({ start: month, end: new Date(month.getFullYear(), month.getMonth() + 1, 0) });
  const logo = logoUrl
    ? `<img class="logo" src="${esc(logoUrl)}" alt="">`
    : `<div class="logo logo--initial">${esc(organizationName.trim().charAt(0).toUpperCase() || "S")}</div>`;

  const pages = people.map(person => {
    const summary = new Map(summarizeDays(person.entries).map(d => [d.day, d]));
    const all = [...summary.values()];
    const worked = all.reduce((sum, d) => sum + d.workedMs, 0);
    const breaks = all.reduce((sum, d) => sum + d.breakMs, 0);
    const counted = all.filter(d => d.workedMs > 0).length;
    const incomplete = all.filter(d => d.incomplete).length;

    const rows = days.map(day => {
      const d = summary.get(format(day, "yyyy-MM-dd"));
      const live = d?.entries.filter(e => e.status !== "voided") ?? [];
      const c = columns(live);
      const tags = [
        d?.open ? `<span class="tag tag--live">Em curso</span>` : "",
        d?.incomplete ? `<span class="tag tag--bad">Incompleto</span>` : "",
        d?.pending ? `<span class="tag tag--wait">Por aprovar</span>` : "",
      ].join("");
      const notes = [
        c.extra.length ? `Também: ${c.extra.join(", ")}` : "",
        ...live.map(e => e.employee_note ? esc(e.employee_note.slice(0, 80)) : ""),
      ].filter(Boolean).join(" · ");
      return `<tr class="${isWeekend(day) ? "weekend" : ""}">
        <td class="day"><span class="dow">${esc(format(day, "EEE", { locale: pt }))}</span> ${format(day, "dd")}</td>
        <td class="t">${time(c.start)}</td><td class="t">${time(c.pause)}</td><td class="t">${time(c.resume)}</td><td class="t">${time(c.stop)}</td>
        <td class="num muted">${d?.breakMs ? formatDuration(d.breakMs) : ""}</td>
        <td class="num strong">${d?.workedMs ? formatDuration(d.workedMs) : ""}</td>
        <td class="notes">${tags}${notes}</td>
      </tr>`;
    }).join("");

    const figure = (label: string, value: string, warn = false) =>
      `<div class="figure${warn ? " figure--warn" : ""}"><span>${label}</span><strong>${value}</strong></div>`;

    return `<section class="page">
      <header class="top">
        <div class="org">${logo}<div><div class="org-name">${esc(organizationName)}</div><div class="doc">Folha de ponto</div></div></div>
        <div class="month">${esc(monthLabel)}</div>
      </header>
      <div class="person">
        <div><span class="label">Colaborador</span><div class="name">${esc(person.name)}</div></div>
        <div class="figures">
          ${figure("Total do mês", formatDuration(worked))}
          ${figure("Dias com registo", String(counted))}
          ${figure("Média por dia", counted ? formatDuration(worked / counted) : "0h00")}
          ${figure("Pausas", formatDuration(breaks))}
          ${figure("Incompletos", String(incomplete), incomplete > 0)}
        </div>
      </div>
      <table>
        <thead><tr><th>Dia</th><th>Início</th><th>Pausa</th><th>Retoma</th><th>Fim</th><th class="num">Pausas</th><th class="num">Horas</th><th>Notas</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">Total</td><td class="num">${formatDuration(breaks)}</td><td class="num">${formatDuration(worked)}</td><td></td></tr></tfoot>
      </table>
      <div class="signs">
        <div><div class="line"></div>O colaborador</div>
        <div><div class="line"></div>A entidade empregadora</div>
      </div>
      <footer><span><sup>*</sup> hora registada ou corrigida por um administrador</span><span>Emitido em ${issued} · Senvia OS</span></footer>
    </section>`;
  }).join("");

  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Folha de ponto · ${esc(monthLabel)}</title>
<style>
  :root { --brand: ${brand}; }
  @page { size: A4; margin: 10mm 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 9.5px/1.4 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2430; background: #fff; }
  .page { page-break-after: always; display: flex; flex-direction: column; min-height: 276mm; }
  .page:last-child { page-break-after: auto; }
  .top { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 3px solid var(--brand); }
  .org { display: flex; align-items: center; gap: 10px; }
  .logo { height: 40px; max-width: 120px; object-fit: contain; }
  .logo--initial { width: 40px; height: 40px; border-radius: 10px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; }
  .org-name { font-size: 14px; font-weight: 700; }
  .doc { color: #6b7280; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .month { background: var(--brand); color: #fff; border-radius: 999px; padding: 5px 14px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
  .person { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 12px 0 10px; }
  .label { color: #6b7280; font-size: 8.5px; letter-spacing: .08em; text-transform: uppercase; }
  .name { font-size: 16px; font-weight: 700; }
  .figures { display: flex; gap: 6px; }
  .figure { min-width: 64px; border: 1px solid #e5e7eb; border-top: 3px solid var(--brand); border-radius: 6px; padding: 4px 8px; }
  .figure span { display: block; color: #6b7280; font-size: 8px; }
  .figure strong { font-size: 12px; }
  .figure--warn { border-top-color: #dc2626; } .figure--warn strong { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: var(--brand); color: #fff; font-weight: 600; text-align: left; padding: 4px 6px; font-size: 8.5px; letter-spacing: .04em; text-transform: uppercase; }
  thead th:first-child { border-top-left-radius: 5px; } thead th:last-child { border-top-right-radius: 5px; }
  td { padding: 2.5px 6px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tr.weekend td { background: #f1f3f6 !important; color: #8a92a0; }
  .day { white-space: nowrap; font-weight: 600; } .dow { display: inline-block; width: 24px; color: #8a92a0; font-weight: 500; text-transform: capitalize; }
  .t { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; } .muted { color: #8a92a0; }
  sup { color: var(--brand); font-weight: 700; }
  .notes { color: #4b5563; font-size: 8.5px; }
  .tag { display: inline-block; margin-right: 4px; border-radius: 999px; padding: 0 6px; font-size: 7.5px; font-weight: 600; }
  .tag--bad { background: #fee2e2; color: #b91c1c; } .tag--wait { background: #fef3c7; color: #92400e; } .tag--live { background: #dcfce7; color: #166534; }
  tfoot td { border-top: 2px solid var(--brand); border-bottom: 0; font-weight: 700; padding-top: 5px; }
  .signs { display: flex; gap: 48px; margin-top: auto; padding-top: 28px; text-align: center; color: #4b5563; }
  .signs > div { flex: 1; } .line { border-top: 1px solid #1f2430; margin-bottom: 4px; }
  footer { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 6px; border-top: 1px solid #e5e7eb; color: #8a92a0; font-size: 8px; }
</style></head><body>${pages}<script>
  // Print once the logos have loaded (or failed), so they are on the page.
  const imgs = [...document.images];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => window.print());
</script></body></html>`;

  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
