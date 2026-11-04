import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangelogArticle } from "@/components/announcements/ChangelogArticle";
import { useChangelog, useChangelogEntry } from "@/hooks/useChangelog";
import { useLanguage } from "@/i18n";

/** One release note on its own page (phones, and links shared to a single note). */
export default function NovidadeDetail() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const { data: entry, isLoading } = useChangelogEntry(id);
  const { data: entries = [] } = useChangelog();
  const index = entries.findIndex((e) => e.id === id);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-20 md:p-6 md:pb-6 lg:p-8">
      <Button variant="ghost" className="-ml-2 gap-2 text-muted-foreground" onClick={() => navigate("/novidades")}>
        <ArrowLeft className="h-4 w-4" />{t("Todas as novidades")}
      </Button>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-72 w-full rounded-3xl" />
        </div>
      ) : !entry ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
          {t("Atualização não encontrada.")}
        </div>
      ) : (
        <ChangelogArticle
          entry={entry}
          newer={index > 0 ? entries[index - 1] : null}
          older={index >= 0 ? entries[index + 1] ?? null : null}
          onOpen={(next) => navigate(`/novidades/${next}`)}
        />
      )}
    </div>
  );
}
