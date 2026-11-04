import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangelogArticle } from "@/components/announcements/ChangelogArticle";
import { ModuleNavIcon } from "@/components/layout/ModuleNavIcon";
import { useChangelog, type ChangelogEntry } from "@/hooks/useChangelog";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_VERSION } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useLanguage, dateLocale } from "@/i18n";

/**
 * Novidades: every release note, newest first. A list by month on the left and
 * the selected note as an article on the right; on a phone, the list opens
 * each note on its own page. The selection lives in the URL (?v=), so a note
 * can be shared or reopened.
 */
export default function Novidades() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const { data: entries = [], isLoading } = useChangelog();
  const { announcement, hasUnread, markAsSeen } = useAnnouncements();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  // Opening this page is reading what is new: the top-bar dot goes away, while
  // the note that was unread keeps its "Novo" mark for this visit.
  const [unreadId, setUnreadId] = useState<string | null>(null);
  useEffect(() => {
    if (!hasUnread || !announcement?.id) return;
    setUnreadId(announcement.id);
    markAsSeen();
  }, [hasUnread, announcement?.id, markAsSeen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.title} ${e.version ?? ""} ${e.content}`.toLowerCase().includes(q));
  }, [entries, query]);

  // Grouped by month, keeping the newest-first order.
  const months = useMemo(() => {
    const groups: { key: string; label: string; items: ChangelogEntry[] }[] = [];
    for (const e of filtered) {
      const date = parseISO(e.published_at);
      const key = format(date, "yyyy-MM");
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = { key, label: format(date, t("MMMM 'de' yyyy"), { locale: dateLocale() }), items: [] };
        groups.push(group);
      }
      group.items.push(e);
    }
    return groups;
  }, [filtered, t]);

  const selectedId = params.get("v");
  const index = Math.max(0, entries.findIndex((e) => e.id === selectedId));
  const selected = entries[index] ?? null;
  const open = (id: string) => {
    if (isMobile) navigate(`/novidades/${id}`);
    else setParams({ v: id }, { replace: true });
  };

  return (
    <div className="space-y-6 p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
      <section className="relative overflow-hidden rounded-3xl border border-yellow-300/40 bg-gradient-to-br from-yellow-300/30 via-amber-100/40 to-background p-6 dark:border-yellow-500/20 dark:from-yellow-500/15 dark:via-amber-500/5 sm:p-8">
        <Sparkles className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-yellow-400/20" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <ModuleNavIcon icon={Sparkles} to="/novidades" className="h-12 w-12 rounded-2xl [&_svg]:h-6 [&_svg]:w-6" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("Novidades")}</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground sm:text-base">
                {t("Tudo o que muda no Senvia OS, versão a versão: funcionalidades novas, melhorias e correções.")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-yellow-400/40 bg-background/70 px-3 py-1.5 font-semibold text-foreground backdrop-blur">
              {t("Versão atual")}: v{APP_VERSION}
            </span>
            {!isLoading && (
              <span className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-muted-foreground backdrop-blur">
                {t(entries.length === 1 ? "{{n}} atualização" : "{{n}} atualizações", { n: entries.length })}
              </span>
            )}
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
          <Skeleton className="hidden h-[28rem] w-full rounded-3xl lg:block" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-yellow-500" aria-hidden="true" />
          <p className="mt-3 font-medium">{t("Ainda não há novidades publicadas.")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("Quando o Senvia OS mudar, vai encontrar aqui o que há de novo.")}</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Procurar nas novidades…")}
                aria-label={t("Procurar nas novidades")} className="h-10 rounded-xl pl-9" />
            </div>
            {months.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t("Nenhuma novidade encontrada.")}</p>}
            <nav aria-label={t("Atualizações")} className="space-y-5 lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto lg:pr-1">
              {months.map((month) => (
                <div key={month.key}>
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{month.label}</p>
                  <ul className="space-y-1.5">
                    {month.items.map((e) => {
                      const active = !isMobile && selected?.id === e.id;
                      return (
                        <li key={e.id}>
                          <button type="button" onClick={() => open(e.id)} aria-current={active ? "true" : undefined}
                            className={cn(
                              "group relative flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                              active ? "border-yellow-400/60 bg-yellow-400/10 shadow-sm" : "border-transparent hover:border-border hover:bg-muted/50",
                            )}>
                            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", active ? "bg-yellow-500" : "bg-muted-foreground/30 group-hover:bg-yellow-400")} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                {e.version && <span className="shrink-0 text-xs font-semibold text-yellow-700 dark:text-yellow-400">v{e.version.replace(/^v/i, "")}</span>}
                                {e.id === unreadId && <span className="rounded-full bg-yellow-500 px-1.5 py-px text-[10px] font-semibold text-white">{t("Novo")}</span>}
                              </span>
                              <span className="mt-0.5 block truncate text-sm font-medium text-foreground">{e.title}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {format(parseISO(e.published_at), t("d 'de' MMMM"), { locale: dateLocale() })}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {!isMobile && selected && (
            <ChangelogArticle entry={selected} newer={entries[index - 1] ?? null} older={entries[index + 1] ?? null} onOpen={open} />
          )}
        </div>
      )}
    </div>
  );
}
