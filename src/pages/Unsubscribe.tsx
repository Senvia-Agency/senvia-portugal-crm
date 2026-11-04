import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";

interface UnsubscribeResult {
  success: boolean;
  message: string;
}

export default function Unsubscribe() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("A processar o cancelamento da subscrição...");

  useEffect(() => {
    const unsubscribe = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Link inválido ou incompleto.");
        return;
      }

      const { data, error } = await (supabase as any).rpc("handle_email_unsubscribe", {
        p_token: token,
      });

      if (error) {
        setStatus("error");
        setMessage("Não foi possível cancelar a subscrição. Tente novamente mais tarde.");
        return;
      }

      const result = Array.isArray(data) ? (data[0] as UnsubscribeResult | undefined) : (data as UnsubscribeResult | undefined);

      if (result?.success) {
        setStatus("success");
        setMessage(result.message || "Subscrição cancelada com sucesso.");
        return;
      }

      setStatus("error");
      setMessage(result?.message || "Link inválido ou expirado.");
    };

    unsubscribe();
  }, [token]);

  return (
    <>
      <SEO
        title={t("Cancelar subscrição")}
        description={t("Cancele a subscrição de newsletters do Senvia OS.")}
        canonical="/unsubscribe"
        noindex
      />

      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <Card className="w-full max-w-md border-border bg-card shadow-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/40">
              {status === "loading" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {status === "success" && <CheckCircle2 className="h-5 w-5 text-primary" />}
              {status === "error" && <AlertCircle className="h-5 w-5 text-destructive" />}
            </div>
            <CardTitle className="text-2xl text-foreground">
              {status === "loading" ? t("A processar...") : status === "success" ? t("Subscrição cancelada") : t("Não foi possível concluir")}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {t(message)}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {status !== "loading" && (
              <Button asChild className="w-full">
                <Link to="/privacy">{t("Ver política de privacidade")}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
