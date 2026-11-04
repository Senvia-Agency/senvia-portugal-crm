import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tr, useLanguage } from "@/i18n";

const BUCKET = "avatars";

/** Centre-crops to a 512 px square and encodes WebP (JPEG where WebP is not available). */
async function toSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.85));
  const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
  if (!blob) throw new Error(tr("Não foi possível preparar a imagem."));
  return blob;
}

/** The file inside our bucket that a public avatar URL points to, if it is one of ours. */
function ownPath(url: string | null | undefined): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = url?.indexOf(marker) ?? -1;
  return url && at >= 0 ? decodeURIComponent(url.slice(at + marker.length).split("?")[0]) : null;
}

export function AvatarCard() {
  const { user, profile, refetchUserData } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useLanguage();
  const name = profile?.full_name ?? "";

  const save = async (url: string | null) => {
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user!.id);
    if (error) throw error;
    const old = ownPath(profile?.avatar_url);
    if (old && old !== ownPath(url)) await supabase.storage.from(BUCKET).remove([old]);
    refetchUserData();
  };

  const upload = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) { toast.error(t("Escolha uma imagem.")); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error(t("A imagem tem mais de 15 MB.")); return; }
    setBusy(true);
    try {
      const blob = await toSquare(file);
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
      if (error) throw error;
      await save(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      toast.success(t("Fotografia atualizada."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Não foi possível guardar a fotografia."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await save(null);
      toast.success(t("Fotografia removida."));
    } catch {
      toast.error(t("Não foi possível remover a fotografia."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile?.avatar_url ?? undefined} alt="" className="object-cover" />
          <AvatarFallback className="bg-blue-100 text-2xl font-semibold text-blue-800">{name.trim().charAt(0).toUpperCase() || "?"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{name || t("Sem nome")}</p>
          <p className="text-sm text-muted-foreground">{t("A fotografia aparece à equipa nas mensagens, tarefas e no ponto.")}</p>
        </div>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
            {profile?.avatar_url ? t("Mudar fotografia") : t("Adicionar fotografia")}
          </Button>
          {profile?.avatar_url && (
            <Button variant="ghost" size="icon" onClick={remove} disabled={busy} aria-label={t("Remover fotografia")}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
