import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AdminShell, AdminTableSkeleton } from "@/components/system-admin/AdminShell";
import { useLanguage, dateLocale } from "@/i18n";

interface Announcement {
  id: string;
  title: string;
  content: string;
  version: string | null;
  image_url: string | null;
  is_active: boolean;
  published_at: string;
  created_at: string;
  expires_at: string | null;
}

function defaultExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const emptyForm = { title: "", content: "", version: "", image_url: "", is_active: false, expires_at: defaultExpiresAt() };

export default function SystemAdminAnnouncements() {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await (supabase as any)
        .from("app_announcements")
        .select("*")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        content: form.content,
        version: form.version || null,
        image_url: form.image_url || null,
        is_active: form.is_active,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      };
      if (editingId) {
        const { error } = await (supabase as any).from("app_announcements").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("app_announcements").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["latest-announcement"] });
      toast.success(editingId ? t("Novidade atualizada") : t("Novidade criada"));
      closeDialog();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any).from("app_announcements").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["latest-announcement"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("app_announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["latest-announcement"] });
      toast.success(t("Novidade eliminada"));
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditingId(a.id);
    setForm({
      title: a.title,
      content: a.content,
      version: a.version ?? "",
      image_url: a.image_url ?? "",
      is_active: a.is_active,
      expires_at: a.expires_at ? a.expires_at.slice(0, 10) : "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <AdminShell
      title={t("Novidades")}
      description={t("Pop-ups de novidades mostrados uma vez a cada utilizador.")}
      icon={Sparkles}
      maxWidth="4xl"
      action={
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 h-4 w-4" /> {t("Nova")}
        </Button>
      }
    >
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border">
          <AdminTableSkeleton rows={4} cols={4} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">{t("Ainda não há novidades")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Cria um pop-up para anunciar uma funcionalidade ou versão nova.")}
          </p>
          <Button onClick={openCreate} size="sm" className="mt-4">
            <Plus className="mr-1 h-4 w-4" /> {t("Criar a primeira")}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Título")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("Versão")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Publicação", { context: "date" })}</TableHead>
                <TableHead>{t("Expira em")}</TableHead>
                <TableHead>{t("Ativo")}</TableHead>
                <TableHead className="text-right">{t("Ações")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{a.version || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {format(new Date(a.published_at), "dd MMM yyyy HH:mm", { locale: dateLocale() })}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.expires_at
                      ? new Date(a.expires_at) < new Date()
                        ? <span className="text-destructive">{t("Expirado")}</span>
                        : format(new Date(a.expires_at), "dd MMM yyyy", { locale: dateLocale() })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch checked={a.is_active} onCheckedChange={(v) => toggle.mutate({ id: a.id, is_active: v })} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(a)} title={t("Editar")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleteId(a.id)} title={t("Eliminar")}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t("Editar Novidade") : t("Nova Novidade")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("Título *")}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("Ex: Nova funcionalidade de Prospects")} />
            </div>
            <div>
              <Label>{t("Conteúdo (Markdown) *")}</Label>
              <Textarea rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={t("Escreva aqui as novidades em Markdown...")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("Versão")}</Label>
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v2.5" />
              </div>
              <div>
                <Label>{t("URL da Imagem")}</Label>
                <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
              </div>
            </div>
            <div>
              <Label>{t("Expira em (automático)")}</Label>
              <Input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("Deixa em branco para não expirar automaticamente. Por omissão: 7 dias.")}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>{t("Publicar para todas as organizações")}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t("Publica apenas novidades gerais. Não incluas correções de uma organização, dados de clientes ou detalhes internos.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>{t("Cancelar")}</Button>
            <Button onClick={() => save.mutate()} disabled={!form.title || !form.content || save.isPending}>
              {save.isPending ? t("A guardar...") : t("Guardar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar novidade?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Esta ação não pode ser desfeita.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && remove.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
