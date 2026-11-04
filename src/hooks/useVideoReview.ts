import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";

/** The programme's rules in one place: the screens read them from here. */
export const REVIEW_MIN_SECONDS = 30;
export const REVIEW_DISCOUNT_PERCENT = 25;
export const REVIEW_INSTAGRAM_HANDLE = "@senvia_agency";
export const REVIEW_MAX_BYTES = 500 * 1024 * 1024;
export const REVIEW_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

/**
 * The type to store a video under, or null if it is not one we take. Phones hand over files with
 * odd or empty types (an iPhone .mov, an Android .mp4, a .m4v), so the extension counts too.
 */
export function reviewVideoType(file: { name: string; type: string }): string | null {
  if (REVIEW_MIME_TYPES.includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  return null;
}

export type ReviewStatus = "pending" | "video_approved" | "post_submitted" | "approved" | "rejected";

export interface VideoReview {
  id: string;
  organization_id: string;
  status: ReviewStatus;
  duration_seconds: number;
  instagram_url: string | null;
  reject_reason: string | null;
  discount_percent: number;
  applied_at: string | null;
  created_at: string;
}

// The generated Supabase types do not know this table or its functions yet.
const db = supabase as unknown as {
  from: (table: string) => { select: (cols: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: VideoReview[] | null; error: Error | null }> } } } };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
};

const ERRORS: Array<[RegExp, string]> = [
  [/review_forbidden/, "Só os administradores da empresa podem enviar a avaliação."],
  [/review_consent_required/, "É preciso autorizar a Senvia a publicar o vídeo."],
  [/review_too_short/, "O vídeo tem de ter pelo menos 30 segundos."],
  [/review_already_rewarded/, "A sua empresa já recebeu o desconto da avaliação em vídeo. É dado uma só vez."],
  [/review_already_active|duplicate key|review_submissions_one/, "Já tem uma avaliação em curso. Aguarde a decisão da Senvia."],
  [/review_video_missing|review_bad_path/, "O vídeo não foi carregado. Tente novamente."],
  [/review_bad_link/, "Cole o link da publicação do Instagram (instagram.com/p/…, /reel/… ou /tv/…)."],
  [/review_wrong_status/, "Esta avaliação ainda não está à espera do link do post."],
];
export const reviewErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
  return ERRORS.find(([re]) => re.test(message))?.[1] ?? "Não foi possível concluir. Tente novamente.";
};

/** The organization's latest review (a rejected one stays visible until a new one is sent). */
export function useVideoReview() {
  const { organization } = useAuth();
  const { isAdmin } = usePermissions();
  return useQuery({
    queryKey: ["video-review", organization?.id],
    enabled: !!organization?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<VideoReview | null> => {
      const { data, error } = await db.from("review_submissions")
        .select("id, organization_id, status, duration_seconds, instagram_url, reject_reason, discount_percent, applied_at, created_at")
        .eq("organization_id", organization!.id).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
    select: (review) => ({ review, canSubmit: isAdmin }),
  });
}

export function useSubmitReviewVideo() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, durationSeconds, consent }: { file: File; durationSeconds: number; consent: boolean }) => {
      const contentType = reviewVideoType(file) ?? "video/mp4";
      const extension = contentType === "video/quicktime" ? "mov" : contentType === "video/webm" ? "webm" : "mp4";
      const path = `${organization!.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("review-videos").upload(path, file, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await db.rpc("submit_review_video", {
        _organization_id: organization!.id, _video_path: path, _duration_seconds: Math.round(durationSeconds * 100) / 100, _consent: consent,
      });
      if (error) {
        // The review was refused: do not leave an orphan video in the bucket.
        await supabase.storage.from("review-videos").remove([path]);
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-review"] }),
  });
}

export function useSubmitReviewPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewId, url }: { reviewId: string; url: string }) => {
      const { error } = await db.rpc("submit_review_post", { _review_id: reviewId, _instagram_url: url });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-review"] }),
  });
}

// ── Senvia's side (super admin) ────────────────────────────────────────────────────────

export interface AdminReviewItem {
  id: string;
  organization_id: string;
  organization_name: string;
  video_path: string;
  video_url: string | null;
  duration_seconds: number;
  status: ReviewStatus;
  instagram_url: string | null;
  post_submitted_at: string | null;
  reject_reason: string | null;
  discount_percent: number;
  created_at: string;
}

async function callReviewFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("review-video", { body });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export function useAdminReviews(enabled = true) {
  return useQuery({
    queryKey: ["video-review-admin"],
    enabled,
    queryFn: async () => (await callReviewFunction<{ items: AdminReviewItem[] }>({ action: "list" })).items,
  });
}

export function useAdminReviewAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: "approve_video" | "approve_post" | "reject"; id: string; reason?: string }) => callReviewFunction<{ ok: boolean }>(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-review-admin"] }),
  });
}
