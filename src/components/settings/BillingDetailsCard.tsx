import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Receipt, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { intlLocale, tr, useLanguage } from "@/i18n";

interface BillingDetails {
  billing_name: string | null;
  billing_nif: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_country: string;
  billing_email: string | null;
  billing_synced_at?: string | null;
}

const EMPTY: BillingDetails = {
  billing_name: "", billing_nif: "", billing_address_line1: "", billing_address_line2: "",
  billing_postal_code: "", billing_city: "", billing_country: "PT", billing_email: "",
};

const COUNTRIES = [
  ["PT", "Portugal"], ["ES", "Espanha"], ["FR", "França"], ["DE", "Alemanha"], ["IT", "Itália"], ["BE", "Bélgica"],
  ["NL", "Países Baixos"], ["LU", "Luxemburgo"], ["IE", "Irlanda"], ["GB", "Reino Unido"], ["CH", "Suíça"], ["BR", "Brasil"],
  ["AO", "Angola"], ["MZ", "Moçambique"], ["CV", "Cabo Verde"], ["US", "Estados Unidos"],
] as const;

/** The edge function's own message, not the generic "non-2xx" one. */
async function functionError(error: unknown): Promise<string> {
  const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
  return body?.error ?? tr("Não foi possível guardar os dados de faturação.");
}

/**
 * "Dados de faturação": who Senvia invoices. Saved through billing-details, which
 * also updates the Stripe customer so the subscription invoices carry the NIF and address.
 */
export function BillingDetailsCard() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<BillingDetails>(EMPTY);
  const { t } = useLanguage();

  const { data, isLoading } = useQuery({
    queryKey: ["billing-details", organization?.id],
    enabled: !!organization?.id,
    queryFn: async (): Promise<BillingDetails> => {
      const { data, error } = await supabase.functions.invoke("billing-details", { body: { action: "get", organization_id: organization!.id } });
      if (error) throw new Error(await functionError(error));
      return data.details as BillingDetails;
    },
  });
  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ""])) } as BillingDetails);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("billing-details", { body: { action: "save", organization_id: organization!.id, details: form } });
      if (error) throw new Error(await functionError(error));
      return data as { stripeSynced: boolean; hasStripeCustomer?: boolean; stripeError?: string };
    },
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ["billing-details"] });
      if (result.stripeError) toast.warning(t("Guardado, mas o Stripe recusou: {{error}}", { error: result.stripeError }));
      else if (result.stripeSynced) toast.success(t("Dados de faturação guardados e enviados para o Stripe."));
      else toast.success(t("Dados de faturação guardados. Seguem para o Stripe na primeira subscrição."));
    },
    onError: e => toast.error(e instanceof Error ? e.message : t("Não foi possível guardar.")),
  });

  const field = (key: keyof BillingDetails, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`billing-${key}`}>{t(label)}</Label>
      <Input id={`billing-${key}`} value={(form[key] as string) ?? ""} disabled={isLoading}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />{t("Dados de faturação")}</CardTitle>
        <CardDescription>{t("Aparecem nas faturas da subscrição Senvia. Ao guardar, seguem para o Stripe.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          {field("billing_name", "Nome fiscal", { placeholder: organization?.name ?? t("Empresa, Lda.") })}
          {field("billing_nif", form.billing_country === "PT" ? "NIF" : "NIF / VAT", { placeholder: "123456789", inputMode: "numeric" })}
        </div>
        {field("billing_address_line1", "Morada", { placeholder: t("Rua, número") })}
        {field("billing_address_line2", "Complemento (opcional)", { placeholder: t("Andar, fração") })}
        <div className="grid gap-4 md:grid-cols-3">
          {field("billing_postal_code", "Código postal", { placeholder: form.billing_country === "PT" ? "0000-000" : "" })}
          {field("billing_city", "Localidade")}
          <div className="space-y-1.5">
            <Label>{t("País")}</Label>
            <Select value={form.billing_country} onValueChange={v => setForm(f => ({ ...f, billing_country: v }))} disabled={isLoading}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COUNTRIES.map(([code, name]) => <SelectItem key={code} value={code}>{t(name)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {field("billing_email", "Email para as faturas", { type: "email", placeholder: t("financeiro@empresa.pt") })}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t("Guardar dados de faturação")}
          </Button>
          {data?.billing_synced_at && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              {t("No Stripe desde {{date}}", { date: new Date(data.billing_synced_at).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" }) })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
