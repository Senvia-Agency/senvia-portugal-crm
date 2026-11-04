import ReactMarkdown from "react-markdown";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import type { ChangelogEntry } from "@/hooks/useChangelog";
import { useLanguage, dateLocale } from "@/i18n";

/** One release note, read as an article: image, version, date, then the text. */
export function ChangelogArticle({ entry, newer, older, onOpen }: {
  readonly entry: ChangelogEntry;
  readonly newer?: ChangelogEntry | null;
  readonly older?: ChangelogEntry | null;
  readonly onOpen: (id: string) => void;
}) {
  const { t } = useLanguage();
  const published = parseISO(entry.published_at);

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {entry.image_url && (
        <img src={entry.image_url} alt="" className="max-h-80 w-full object-cover" />
      )}
      <div className="space-y-6 p-6 sm:p-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {entry.version && (
              <span className="rounded-full bg-yellow-400/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-800 dark:text-yellow-300">
                v{entry.version.replace(/^v/i, "")}
              </span>
            )}
            <time dateTime={entry.published_at}>
              {format(published, t("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() })}
            </time>
            <span aria-hidden="true">·</span>
            <span>{formatDistanceToNow(published, { addSuffix: true, locale: dateLocale() })}</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{entry.title}</h2>
        </header>

        <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mt-8 prose-h2:text-xl prose-h3:text-base prose-p:leading-relaxed prose-a:text-primary prose-strong:text-foreground prose-li:my-1 prose-img:rounded-xl">
          <ReactMarkdown>{entry.content}</ReactMarkdown>
        </div>

        {(newer || older) && (
          <nav className="grid gap-3 border-t border-border pt-6 sm:grid-cols-2" aria-label={t("Outras atualizações")}>
            {older ? (
              <Button variant="outline" className="h-auto justify-start gap-3 rounded-2xl px-4 py-3 text-left" onClick={() => onOpen(older.id)}>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">{t("Atualização anterior")}</span>
                  <span className="block truncate font-medium">{older.title}</span>
                </span>
              </Button>
            ) : <span />}
            {newer && (
              <Button variant="outline" className="h-auto justify-end gap-3 rounded-2xl px-4 py-3 text-right" onClick={() => onOpen(newer.id)}>
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">{t("Atualização seguinte")}</span>
                  <span className="block truncate font-medium">{newer.title}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </Button>
            )}
          </nav>
        )}
      </div>
    </article>
  );
}
