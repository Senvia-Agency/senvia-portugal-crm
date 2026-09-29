import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SERIES_FIELDS = [
  { key: 'invoice', label: 'Fatura (FT)', code: '4' },
  { key: 'invoice_receipt', label: 'Fatura-recibo (FR)', code: '34' },
  { key: 'receipt', label: 'Recibo (RC)', code: '9' },
  { key: 'credit_note', label: 'Nota de crédito (NC)', code: '7' },
] as const;

type SeriesKind = typeof SERIES_FIELDS[number]['key'];
type SeriesValues = Record<SeriesKind, string>;
const emptySeries = (): SeriesValues => ({ invoice: '', invoice_receipt: '', receipt: '', credit_note: '' });

export function KeyInvoiceSeriesSettings() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [series, setSeries] = useState<SeriesValues>(emptySeries);
  const [storedConfig, setStoredConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setSeries(emptySeries());
    if (!organization?.id) {
      setLoading(false);
      return;
    }
    void supabase.from('organizations')
      .select('keyinvoice_series_config')
      .eq('id', organization.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast({ title: 'Não foi possível carregar as séries fiscais', description: error.message, variant: 'destructive' });
        } else {
          const config = (data?.keyinvoice_series_config ?? {}) as Record<string, { series?: string }>;
          setStoredConfig(config);
          setSeries(Object.fromEntries(SERIES_FIELDS.map(({ key }) => [key, config[key]?.series ?? ''])) as SeriesValues);
          setLoaded(true);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [organization?.id, toast]);

  const save = async () => {
    if (!organization?.id || !loaded) return;
    const config = Object.fromEntries(SERIES_FIELDS.flatMap(({ key, code }) => {
      const value = series[key].trim();
      return value ? [[key, { ...storedConfig[key], series: value, provider_document_type_code: code }]] : [];
    }));
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>)('configure_keyinvoice_series', {
        p_organization_id: organization.id,
        p_config: config,
      });
      if (error) throw new Error(error.message);
      toast({ title: 'Séries fiscais guardadas' });
    } catch (error) {
      toast({
        title: 'Não foi possível guardar as séries',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          A emissão manual usa a série predefinida no KeyInvoice. Na recorrência automática, indica a série de cada documento para evitar duplicações se a ligação falhar durante a emissão.
          Copia a série configurada no KeyInvoice; o número e o ATCUD continuam a ser atribuídos por ele.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SERIES_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`keyinvoice-series-${key}`}>{label}</Label>
            <Input
              id={`keyinvoice-series-${key}`}
              value={series[key]}
              onChange={(event) => setSeries((current) => ({ ...current, [key]: event.target.value }))}
              placeholder="Série no KeyInvoice"
              maxLength={100}
              disabled={loading || saving}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Para “Fatura-recibo quando totalmente pago”, preenche FR. Para “Fatura e recibos”, preenche FT e RC.
      </p>
      <Button type="button" variant="outline" onClick={save} disabled={loading || saving || !loaded || !organization?.id}>
        {(loading || saving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar séries
      </Button>
    </div>
  );
}
