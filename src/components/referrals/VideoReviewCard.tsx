import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clapperboard, Copy, ExternalLink, Instagram, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";
import { readMp4Duration } from "@/lib/video-duration";
import {
  REVIEW_DISCOUNT_PERCENT, REVIEW_INSTAGRAM_HANDLE, REVIEW_MAX_BYTES, REVIEW_MIN_SECONDS,
  reviewErrorKey, reviewVideoType, useSubmitReviewPost, useSubmitReviewVideo, useVideoReview,
} from "@/hooks/useVideoReview";

/** Which step of 4 the review is on. */
const STEP_NUMBER = { pending: 2, video_approved: 3, post_submitted: 3, approved: 4, rejected: 1 } as const;

const CAPTION = `Como o Senvia OS ajudou a minha empresa: [diga aqui o que mudou] ${REVIEW_INSTAGRAM_HANDLE} #SenviaOS`;

/**
 * Programa de avaliações em vídeo: a video of 30 s or more saying how Senvia OS helped, approved by
 * Senvia, posted on Instagram tagging @senvia_agency, and a 25% discount on the next monthly invoice.
 * One card: the reward, and only the step you are on.
 */
export function VideoReviewCard() {
  const { t } = useLanguage();
  const { data, isLoading } = useVideoReview();
  const review = data?.review ?? null;
  const canSubmit = data?.canSubmit ?? false;
  const [uploadOpen, setUploadOpen] = useState(false);
  const step = review ? STEP_NUMBER[review.status] : 0;
  const inProgress = !!review && review.status !== "approved" && review.status !== "rejected";

  return (
    <section id="avaliacao" className="flex h-full flex-col rounded-2xl border border-t-4 border-t-rose-500 bg-gradient-to-b from-rose-50/80 via-card to-card p-5 shadow-xl dark:from-rose-950/30">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"><Clapperboard className="h-5 w-5" /></span>
        <h2 className="text-base font-semibold">{t("Avaliação em vídeo")}</h2>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-rose-700 dark:text-rose-300">{t("{{n}}% de desconto", { n: REVIEW_DISCOUNT_PERCENT })}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("na próxima mensalidade. Conte em pelo menos {{s}} segundos como o Senvia OS ajudou a sua empresa.", { s: REVIEW_MIN_SECONDS })}
      </p>

      <div className="mt-5 flex-1 space-y-3">
        {isLoading ? <div className="h-10 animate-pulse rounded-lg bg-muted" /> : (
          <>
            {inProgress && (
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${(step / 4) * 100}%` }} /></div>
                <p className="text-xs text-muted-foreground">{t("Passo {{n}} de 4", { n: step })}</p>
              </div>
            )}

            {review?.status === "rejected" && (
              <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t("A Senvia não aprovou esta avaliação.")}{review.reject_reason ? ` ${review.reject_reason}` : ""} {t("Pode enviar um vídeo novo.")}</p>
              </div>
            )}

            {(!review || review.status === "rejected") && (
              canSubmit ? (
                <div className="space-y-2">
                  <Button onClick={() => setUploadOpen(true)}><Upload className="mr-2 h-4 w-4" />{t("Enviar vídeo")}</Button>
                  <p className="text-xs text-muted-foreground">{t("Depois de aprovado, publique-o no Instagram e marque {{handle}}.", { handle: REVIEW_INSTAGRAM_HANDLE })} {t("O desconto é dado uma vez por empresa.")}</p>
                </div>
              ) : <p className="text-sm text-muted-foreground">{t("Só os administradores da empresa podem enviar a avaliação.")}</p>
            )}

            {review?.status === "pending" && <p className="text-sm">{t("À espera da aprovação da Senvia.")}</p>}

            {(review?.status === "video_approved" || review?.status === "post_submitted") && (canSubmit
              ? <PostStep review={review} />
              : <p className="text-sm text-muted-foreground">{t("O vídeo foi aprovado. Um administrador da empresa tem de o publicar no Instagram.")}</p>)}

            {review?.status === "approved" && (
              <p className="flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span><strong>{t("Desconto de {{n}}% aplicado.", { n: review.discount_percent })}</strong> {t("Sai da próxima mensalidade, automaticamente.")}</span>
              </p>
            )}
          </>
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </section>
  );
}

/** After the video is approved: post it on Instagram, tag Senvia, paste the link. */
function PostStep({ review }: { review: { id: string; status: string; instagram_url: string | null } }) {
  const { t } = useLanguage();
  const submit = useSubmitReviewPost();
  const [url, setUrl] = useState(review.instagram_url ?? "");
  const waiting = review.status === "post_submitted";

  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(CAPTION); toast.success(t("Texto copiado.")); } catch { toast.error(t("Selecione e copie o texto.")); }
  };
  const send = async () => {
    try { await submit.mutateAsync({ reviewId: review.id, url: url.trim() }); toast.success(t("Link enviado. A Senvia vai confirmar a publicação.")); }
    catch (e) { toast.error(t(reviewErrorKey(e))); }
  };

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">{waiting ? t("A Senvia está a confirmar a sua publicação.") : t("O seu vídeo foi aprovado. Falta publicá-lo no Instagram.")}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t("Publique o mesmo vídeo no seu Instagram (perfil público).")}</li>
        <li>{t("Marque {{handle}} na publicação.", { handle: REVIEW_INSTAGRAM_HANDLE })}</li>
        <li>{t("Cole aqui o link da publicação.")}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyCaption}><Copy className="mr-1.5 h-3.5 w-3.5" />{t("Copiar texto sugerido")}</Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href="https://www.instagram.com/senvia_agency/" target="_blank" rel="noopener noreferrer"><Instagram className="mr-1.5 h-3.5 w-3.5" />{REVIEW_INSTAGRAM_HANDLE}<ExternalLink className="ml-1.5 h-3 w-3" /></a>
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" aria-label={t("Link da publicação no Instagram")} inputMode="url" />
        <Button onClick={send} disabled={submit.isPending || url.trim().length < 20} className="shrink-0">
          {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{waiting ? t("Atualizar link") : t("Enviar link")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The length of a video. Recordings made in the browser (WebM) report Infinity until the player has
 * seeked to the end, so seek once and read it again.
 */
function readDuration(video: HTMLVideoElement, done: (seconds: number | null) => void) {
  if (Number.isFinite(video.duration)) { done(video.duration); return; }
  const onTime = () => {
    video.removeEventListener("timeupdate", onTime);
    done(Number.isFinite(video.duration) ? video.duration : null);
    video.currentTime = 0;
  };
  video.addEventListener("timeupdate", onTime);
  video.currentTime = 1e101;
}

/** Picks the video, checks its length in the browser, asks for the consent and uploads it. */
function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLanguage();
  const submit = useSubmitReviewVideo();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noPreview, setNoPreview] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { if (!open) { setFile(null); setPreviewUrl(null); setDuration(null); setConsent(false); setProblem(null); setNoPreview(false); } }, [open]);

  const pick = (picked: File | undefined) => {
    setProblem(null); setDuration(null); setFile(null); setNoPreview(false);
    if (!picked) return;
    if (!reviewVideoType(picked)) { setProblem(t("Use um vídeo MP4, MOV ou WebM.")); return; }
    if (picked.size > REVIEW_MAX_BYTES) { setProblem(t("O vídeo tem mais de {{mb}} MB.", { mb: REVIEW_MAX_BYTES / 1024 / 1024 })); return; }
    const url = URL.createObjectURL(picked);
    setPreviewUrl(url); setFile(picked);
  };

  const tooShort = duration !== null && duration < REVIEW_MIN_SECONDS;
  const ready = !!file && duration !== null && !tooShort && consent;

  const send = async () => {
    if (!file || duration === null) return;
    try {
      await submit.mutateAsync({ file, durationSeconds: duration, consent });
      toast.success(t("Vídeo enviado. A Senvia vai vê-lo em breve."));
      onOpenChange(false);
    } catch (e) { toast.error(t(reviewErrorKey(e))); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle>{t("Enviar a avaliação em vídeo")}</DialogTitle>
          <DialogDescription>{t("Mínimo {{s}} segundos. Pode gravar no telemóvel e escolher o ficheiro aqui.", { s: REVIEW_MIN_SECONDS })}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-5">
            <input ref={input} type="file" accept="video/*,.mp4,.mov,.m4v,.webm" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            {!file ? (
              <button type="button" onClick={() => input.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center hover:border-primary hover:bg-primary/5">
                <Upload className="h-8 w-8 text-primary" />
                <span className="font-medium">{t("Escolher o vídeo")}</span>
                <span className="text-sm text-muted-foreground">{t("MP4, MOV ou WebM, até {{mb}} MB", { mb: REVIEW_MAX_BYTES / 1024 / 1024 })}</span>
              </button>
            ) : (
              <div className="space-y-3">
                <video src={previewUrl ?? undefined} controls className="max-h-[50vh] w-full rounded-xl bg-black"
                  onLoadedMetadata={e => { if (e.currentTarget.videoWidth === 0) setNoPreview(true); readDuration(e.currentTarget, setDuration); }}
                  onError={() => {
                    // The browser cannot play it (an iPhone's HEVC .mov on a computer, say): the length is still in the file.
                    setNoPreview(true);
                    void readMp4Duration(file).then(seconds => {
                      if (seconds === null) { setProblem(t("Não foi possível ler este vídeo. Tente outro ficheiro.")); setFile(null); } else setDuration(seconds);
                    });
                  }} />
                {noPreview && <p className="text-xs text-muted-foreground">{t("Este navegador não consegue mostrar o vídeo, mas pode enviá-lo na mesma.")}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className={cn(tooShort ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {duration === null ? t("A ler o vídeo…") : t("Duração: {{s}} segundos", { s: Math.round(duration) })}
                    {tooShort && ` — ${t("tem de ter pelo menos {{s}} segundos", { s: REVIEW_MIN_SECONDS })}`}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()}>{t("Trocar de vídeo")}</Button>
                </div>
              </div>
            )}
            {problem && <p className="text-sm font-medium text-destructive" role="alert">{problem}</p>}

            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <Checkbox checked={consent} onCheckedChange={c => setConsent(c === true)} className="mt-0.5" />
              <span>{t("Autorizo a Senvia a publicar este vídeo (site e redes sociais) para divulgar o Senvia OS.")}</span>
            </label>

            {submit.isPending && <p className="text-sm text-muted-foreground" role="status">{t("A enviar o vídeo. Pode demorar alguns minutos: não feche esta página.")}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>{t("Cancelar")}</Button>
              <Button onClick={send} disabled={!ready || submit.isPending}>
                {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{submit.isPending ? t("A enviar…") : t("Enviar vídeo")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
