import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useStripeConnection } from '@/hooks/useStripeConnection';
import {
  NOT_SYNCED,
  useStripeProductMappings,
  useStripeProductSync,
  type ProductStripeMappingSummary,
} from '@/hooks/useStripeProductSync';

/** Crachá compacto para a listagem de produtos. */
export function ProductStripeBadge({ mapping }: { mapping: ProductStripeMappingSummary | undefined }) {
  if (!mapping || mapping.status === 'not_synced' || mapping.status === 'disabled') return null;
  if (mapping.status === 'error') {
    return (
      <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px]">
        Erro Stripe
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
      Stripe
    </Badge>
  );
}

interface ProductStripeSyncProps {
  productId: string | null;
  isRecurring: boolean;
}

/**
 * Controlo "Sincronizar com Stripe" de um produto.
 *
 * Só aparece em produtos recorrentes: um produto avulso não tem subscrição, e um
 * Price recorrente no Stripe não teria a que ser ligado.
 */
export function ProductStripeSync({ productId, isRecurring }: ProductStripeSyncProps) {
  const { connection } = useStripeConnection();
  const { data: mappings = {} } = useStripeProductMappings();
  const { sync, isSyncing } = useStripeProductSync();

  if (!isRecurring) return null;

  // Produto ainda por gravar: não há id para mapear no Stripe.
  if (!productId) {
    return (
      <p className="text-xs text-muted-foreground">
        Guarde o produto primeiro para o poder sincronizar com o Stripe.
      </p>
    );
  }

  if (!connection.connected) {
    return (
      <div className="rounded-md border border-dashed p-3 space-y-1">
        <p className="text-sm font-medium">Sincronizar com Stripe</p>
        <p className="text-xs text-muted-foreground">
          Ligue a conta Stripe da sua empresa para cobrar este serviço automaticamente todos os meses.{' '}
          <Link to="/settings?tab=integrations" className="text-primary underline">
            Ir a Definições
          </Link>
        </p>
      </div>
    );
  }

  const mapping = mappings[productId] ?? NOT_SYNCED;
  const enabled = mapping.status === 'synced' || mapping.status === 'error';

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={`stripe-sync-${productId}`} className="text-sm font-medium">
            Sincronizar com Stripe
          </Label>
          <p className="text-xs text-muted-foreground">
            Cria o produto no Stripe e cobra o preço bruto, acrescentando IVA apenas quando o preço base não o inclui.
          </p>
        </div>
        <Switch
          id={`stripe-sync-${productId}`}
          checked={enabled}
          disabled={isSyncing}
          onCheckedChange={(checked) =>
            sync({ productId, action: checked ? 'enable' : 'disable' })
          }
        />
      </div>

      {mapping.status === 'synced' && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            Sincronizado
            {mapping.syncedAt && ` em ${new Date(mapping.syncedAt).toLocaleDateString('pt-PT')}`}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={isSyncing}
            onClick={() => sync({ productId, action: 'sync' })}
          >
            {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </Button>
        </div>
      )}

      {mapping.status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{mapping.syncError ?? 'A última sincronização falhou.'}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2 h-7 text-xs"
            disabled={isSyncing}
            onClick={() => sync({ productId, action: 'sync' })}
          >
            {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  );
}
