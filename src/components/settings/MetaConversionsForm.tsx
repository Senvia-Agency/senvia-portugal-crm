import { useState } from "react";
import { Eye, EyeOff, Loader2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useOrganization, useUpdateOrganization } from "@/hooks/useOrganization";
import { useLanguage } from "@/i18n";

// Per-org Meta Conversions API access token. The pixel(s) are configured per form
// (FormEditor); this token authenticates the server-side events (Lead on capture,
// Purchase when a sale is created from the lead) against that org's pixel.
export function MetaConversionsForm() {
  const { data: org, isLoading } = useOrganization();
  const updateOrg = useUpdateOrganization();
  const { t } = useLanguage();

  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);

  // O TOKEN NÃO VOLTA AO BROWSER.
  //
  // Era lido da coluna para preencher o campo. Essa coluna deixou de ser
  // legível pelo cliente (migração 20260826140000): qualquer colaborador
  // conseguia ler o token de conversões da empresa e enviar eventos em nome
  // dela. Lê-se apenas SE já existe um, para o campo poder dizer "guardado" em
  // vez de parecer por preencher.
  const jaConfigurado = !!(org as { tem_meta_conversions_token?: boolean } | null | undefined)
    ?.tem_meta_conversions_token;

  // Só se grava o que for escrito agora — em branco quer dizer manter o atual.
  const dirty = token.trim().length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t("A carregar...")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Liga o teu pixel para o Senvia avisar a Meta quando um lead da campanha se torna cliente. Assim o Facebook/Instagram Ads otimiza para quem compra mesmo, não só para quem preenche o formulário.")}
      </p>

      <div className="space-y-2">
        <Label htmlFor="meta-capi-token">{t("Token da Conversions API")}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="meta-capi-token"
              type={show ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={jaConfigurado ? t("Guardado — escreve um novo para substituir") : "EAAG..."}
              autoComplete="off"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title={show ? t("Ocultar") : t("Mostrar")}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            onClick={() => { updateOrg.mutate({ meta_conversions_api_token: token.trim() }); setToken(""); }}
            disabled={!dirty || updateOrg.isPending}
          >
            {updateOrg.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Guardar")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Gera o token no Gestor de Eventos da Meta: Definições do conjunto de dados (pixel) → Conversions API → Gerar token de acesso.")}
        </p>
      </div>

      <a
        href="https://www.facebook.com/events_manager2"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        {t("Abrir o Gestor de Eventos da Meta")}
        <ExternalLink className="h-3 w-3" />
      </a>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        {t("O pixel escolhe-se em cada formulário (Definições → Formulários). Este token aplica-se a toda a organização. Sem token, os eventos usam o token global de fallback (se existir).")}
      </div>
    </div>
  );
}
