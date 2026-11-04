import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOrganization, useUpdateOrganization } from "@/hooks/useOrganization";
import { useLanguage } from "@/i18n";

interface Pixel {
  id: string;
  name: string;
  pixel_id: string;
  enabled: boolean;
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function OrgPixelsForm() {
  const { data: org, isLoading } = useOrganization();
  const updateOrg = useUpdateOrganization();
  const { t } = useLanguage();

  const [pixels, setPixels] = useState<Pixel[]>([]);

  const storedPixels: Pixel[] =
    (org as { meta_pixels?: Pixel[] | null } | null | undefined)?.meta_pixels ?? [];

  useEffect(() => {
    setPixels(storedPixels);
  }, [storedPixels]);

  const dirty = JSON.stringify(pixels) !== JSON.stringify(storedPixels);

  const addPixel = () => {
    setPixels((prev) => [
      ...prev,
      { id: generateId(), name: "", pixel_id: "", enabled: true },
    ]);
  };

  const removePixel = (id: string) => {
    setPixels((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePixel = (id: string, field: keyof Pixel, value: string | boolean) => {
    setPixels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const save = () => {
    const clean = pixels.map((p) => ({
      id: p.id,
      name: p.name.trim(),
      pixel_id: p.pixel_id.trim(),
      enabled: p.enabled,
    })).filter((p) => p.pixel_id);
    updateOrg.mutate({ meta_pixels: clean as any });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t('A carregar...')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <div>
        <h4 className="text-sm font-medium">{t('Pixels da Organização')}</h4>
        <p className="text-xs text-muted-foreground mt-1">
          {t('Os pixels aqui configurados são usados para enviar eventos de conversão (Purchase) quando um lead se torna cliente. Os pixels dos formulários continuam a ser configurados em Definições > Formulários.')}
        </p>
      </div>

      {pixels.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {t('Nenhum pixel configurado. Adiciona um pixel para começar.')}
        </p>
      )}

      <div className="space-y-3">
        {pixels.map((pixel) => (
          <div
            key={pixel.id}
            className="flex items-start gap-3 rounded-md border p-3"
          >
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">{t('Nome')}</Label>
                  <Input
                    value={pixel.name}
                    onChange={(e) => updatePixel(pixel.id, "name", e.target.value)}
                    placeholder={t('Ex: Pixel Site')}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">{t('Pixel ID')}</Label>
                  <Input
                    value={pixel.pixel_id}
                    onChange={(e) => updatePixel(pixel.id, "pixel_id", e.target.value)}
                    placeholder={t('Ex: 1234567890')}
                    className="h-8 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={pixel.enabled}
                  onCheckedChange={(v) => updatePixel(pixel.id, "enabled", v)}
                />
                <span className="text-xs text-muted-foreground">
                  {pixel.enabled ? t('Ativo') : t('Inativo')}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removePixel(pixel.id)}
              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={addPixel}>
          <Plus className="h-4 w-4 mr-1" />
          {t('Adicionar Pixel')}
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || updateOrg.isPending}
        >
          {updateOrg.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          {t('Guardar')}
        </Button>
      </div>

      <a
        href="https://www.facebook.com/events_manager2"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {t('Abrir o Gestor de Eventos da Meta')}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
