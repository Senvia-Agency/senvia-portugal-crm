import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, HelpCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Achado, RelatorioDiagnostico } from "@/hooks/useWhatsAppDiagnostico";
import { useLanguage } from "@/i18n";

/**
 * O relatório do diagnóstico do WhatsApp, em linguagem de gente.
 *
 * Regra de leitura, e é a razão de haver três estados em vez de dois: um `ok`
 * a `null` quer dizer "não foi possível verificar", que NÃO é o mesmo que
 * "está mal". Pintar as duas coisas de vermelho mandava-nos corrigir o que já
 * estava certo — foi assim que se perderam tardes.
 */

function Sinal({ ok }: { ok: boolean | null }) {
  if (ok === null) return <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  return ok
    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
    : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
}

function Lista({ achados }: { achados: Achado[] }) {
  return (
    <ul className="space-y-2.5">
      {achados.map((a, i) => (
        <li key={i} className="flex gap-2.5">
          <Sinal ok={a.ok} />
          <div className="min-w-0">
            <p className={cn(
              "text-sm font-medium leading-snug",
              a.ok === false && "text-destructive",
            )}>
              {a.passo}
            </p>
            {/* `break-words`: os detalhes trazem ids da Meta com 15 dígitos e
                mensagens de erro longas, que sem isto rebentam o diálogo. */}
            <p className="text-xs text-muted-foreground break-words">{a.detalhe}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  relatorio: RelatorioDiagnostico | null;
  aCarregar: boolean;
  erro: string | null;
}

export function WhatsAppDiagnosticoDialog({ open, onOpenChange, relatorio, aCarregar, erro }: Props) {
  const { t } = useLanguage();
  // Quantas verificações falharam mesmo (as por verificar não contam).
  const falhas = relatorio
    ? [...relatorio.achados, ...relatorio.caixas.flatMap((c) => c.achados)]
      .filter((a) => a.ok === false).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Diagnóstico do WhatsApp")}</DialogTitle>
          <DialogDescription>
            {aCarregar
              ? t("A perguntar à Meta o estado da ligação…")
              : relatorio
                ? falhas === 0
                  ? t("Está tudo como devia. Se mesmo assim não chegam mensagens, avisa — o problema é outro.")
                  : t(falhas === 1 ? "{{n}} problema encontrado. Cada linha a vermelho diz o que corrigir." : "{{n}} problemas encontrados. Cada linha a vermelho diz o que corrigir.", { n: falhas })
                : t("Nada verificado ainda.")}
          </DialogDescription>
        </DialogHeader>

        {aCarregar && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("A verificar…")}
          </div>
        )}

        {erro && !aCarregar && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">{t("Não foi possível correr o diagnóstico")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground break-words">{erro}</p>
          </div>
        )}

        {relatorio && !aCarregar && (
          <div className="space-y-5">
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("A app da Senvia")}
              </h4>
              {/* Isto vale para TODOS os clientes de uma vez. Se falhar aqui,
                  não vale a pena olhar para as caixas. */}
              <Lista achados={relatorio.achados} />
            </section>

            {relatorio.caixas.map((c) => (
              <section key={c.id}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.label || t("Caixa sem nome")}
                </h4>
                <Lista achados={c.achados} />
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
