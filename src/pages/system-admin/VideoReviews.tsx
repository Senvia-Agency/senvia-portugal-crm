import { useState } from "react";
import { Check, ExternalLink, Instagram, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminShell, AdminTableSkeleton } from "@/components/system-admin/AdminShell";
import { useAdminReviewAction, useAdminReviews, REVIEW_INSTAGRAM_HANDLE, type AdminReviewItem } from "@/hooks/useVideoReview";
import { dateLocale, useLanguage } from "@/i18n";

/** Senvia's queue: videos waiting for approval, and Instagram posts waiting to be confirmed. */
export default function VideoReviews() {
  const { t } = useLanguage();
  const { data: items = [], isLoading, error } = useAdminReviews();
  const waitingVideo = items.filter(i => i.status === "pending");
  const waitingPost = items.filter(i => i.status === "post_submitted");
  const waitingOrg = items.filter(i => i.status === "video_approved");

  return (
    <AdminShell title={t("Avaliações em vídeo")} description={t("Aprovar os vídeos e confirmar as publicações no Instagram antes de aplicar o desconto.")}>
      {isLoading ? <AdminTableSkeleton rows={3} cols={4} /> : error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("Não foi possível carregar as avaliações.")}</p>
      ) : (
        <div className="space-y-6">
          <Section title={t("Vídeos por aprovar")} items={waitingVideo} empty={t("Nenhum vídeo à espera.")} />
          <Section title={t("Publicações por confirmar")} items={waitingPost} empty={t("Nenhuma publicação à espera.")} />
          {waitingOrg.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t("À espera da empresa publicar no Instagram")}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {waitingOrg.map(i => <p key={i.id}>{i.organization_name} · {format(new Date(i.created_at), "dd/MM/yyyy", { locale: dateLocale() })}</p>)}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}

function Section({ title, items, empty }: { title: string; items: AdminReviewItem[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title} <span className="text-muted-foreground">({items.length})</span></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : items.map(i => <ReviewItem key={i.id} item={i} />)}
      </CardContent>
    </Card>
  );
}

function ReviewItem({ item }: { item: AdminReviewItem }) {
  const { t } = useLanguage();
  const act = useAdminReviewAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const isPost = item.status === "post_submitted";

  const run = async (action: "approve_video" | "approve_post" | "reject") => {
    try {
      await act.mutateAsync({ action, id: item.id, reason });
      toast.success(action === "reject" ? t("Avaliação rejeitada.") : action === "approve_video" ? t("Vídeo aprovado. A empresa já pode publicar.") : t("Publicação confirmada. Desconto aplicado no Stripe."));
      setRejecting(false); setReason("");
    } catch (e) { toast.error(e instanceof Error ? e.message : t("Não foi possível concluir.")); }
  };

  return (
    <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      {item.video_url
        ? <video src={item.video_url} controls className="max-h-72 w-full rounded-lg bg-black" />
        : <div className="flex h-40 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">{t("Vídeo indisponível")}</div>}
      <div className="space-y-3">
        <div>
          <p className="font-semibold">{item.organization_name}</p>
          <p className="text-sm text-muted-foreground">
            {t("Duração: {{s}} segundos", { s: Math.round(item.duration_seconds) })} · {format(new Date(item.created_at), "dd/MM/yyyy HH:mm", { locale: dateLocale() })}
          </p>
        </div>
        {isPost && item.instagram_url && (
          <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
            <a href={item.instagram_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all font-medium text-primary hover:underline">
              <Instagram className="h-4 w-4 shrink-0" />{item.instagram_url}<ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            <p className="text-muted-foreground">{t("Confirme que a publicação está pública, é o mesmo vídeo e marca {{handle}}.", { handle: REVIEW_INSTAGRAM_HANDLE })}</p>
          </div>
        )}
        {rejecting ? (
          <div className="flex flex-wrap gap-2">
            <Input value={reason} onChange={e => setReason(e.target.value.slice(0, 500))} placeholder={t("Motivo (a empresa vai ler e pode enviar outro vídeo)")} className="min-w-[14rem] flex-1" autoFocus />
            <Button variant="ghost" onClick={() => setRejecting(false)}>{t("Cancelar")}</Button>
            <Button variant="destructive" onClick={() => run("reject")} disabled={reason.trim().length < 3 || act.isPending}>{t("Rejeitar")}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(isPost ? "approve_post" : "approve_video")} disabled={act.isPending}>
              {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {isPost ? t("Confirmar e aplicar desconto") : t("Aprovar vídeo")}
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRejecting(true)} disabled={act.isPending}><X className="mr-2 h-4 w-4" />{t("Rejeitar")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
