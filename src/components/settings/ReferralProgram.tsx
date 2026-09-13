import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Gift, Loader2, RefreshCw, CheckCircle2, Clock3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { getBaseUrl } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { nextReferralBonus, referralTotals, type ReferralDashboard } from '@/lib/referral-dashboard';
import { buildReferralPreview, REFERRAL_PREVIEW_SCENARIOS, type ReferralPreviewScenario } from '@/lib/referral-preview';

const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';

export function ReferralProgram() {
  const { organization, user, isSuperAdmin } = useAuth();
  // Drop transient simulation state when switching accounts or organizations.
  return <ReferralProgramContent key={`${organization?.id}:${user?.id}:${isSuperAdmin}`} />;
}

function ReferralProgramContent() {
  const { organization, user, isSuperAdmin } = useAuth();
  const { isAdmin } = usePermissions();
  const { toast } = useToast();
  const [scenario, setScenario] = useState<ReferralPreviewScenario | null>(null);
  const canPreview = import.meta.env.DEV && isSuperAdmin;
  const previewing = canPreview && scenario !== null;
  const query = useQuery({
    queryKey: ['referral-program', organization?.id, user?.id],
    enabled: !!organization?.id && !!user?.id && isAdmin && !previewing,
    retry: false,
    staleTime: 15_000,
    refetchInterval: query => previewing || ['PGRST202', '42P01', '42883', '42501'].includes((query.state.error as { code?: string } | null)?.code || '') ? false : 30_000,
    queryFn: async () => {
      const result = await supabase.rpc('get_referral_dashboard' as never, { _organization_id: organization!.id } as never);
      if (result.error) throw result.error;
      return result.data as unknown as ReferralDashboard;
    },
  });
  const data = previewing ? buildReferralPreview(scenario!) : query.data;
  const error = previewing ? null : query.error;
  const isLoading = !previewing && query.isLoading;
  const { isFetching, refetch } = query;
  const missingService = error && ['PGRST202', '42P01', '42883'].includes((error as { code?: string }).code || '');
  const totals = data ? referralTotals(data.referrals) : null;
  const bonus = data ? nextReferralBonus(data) : null;
  const link = previewing ? 'https://senvia.example.invalid/login?ref=simulacao-sem-validade'
    : data ? `${getBaseUrl()}/login?tab=signup&ref=${data.code}` : '';

  return <section className="space-y-6" aria-labelledby="referral-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="referral-title" className="flex items-center gap-2 text-xl font-semibold"><Gift className="h-5 w-5 text-primary" />Indicações</h2>
        <p className="mt-1 text-sm text-muted-foreground">Acompanha as empresas que trouxeste para o SENVIA OS e os teus meses gratuitos.</p></div>
      {isAdmin && !previewing && <Button className="shrink-0" variant="outline" size="icon" aria-label="Atualizar indicações" disabled={isFetching} onClick={() => refetch()}>
        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /></Button>}
    </div>
    {canPreview && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      {previewing ? <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold text-primary">Simulação — dados fictícios</p>
          <Button variant="outline" size="sm" onClick={() => setScenario(null)}>Sair da simulação</Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Estás a ver o painel como uma organização cliente. A tua isenção mantém-se. Os pagamentos e bónus abaixo são exemplos; não são efetuadas cobranças.</p>
        <label htmlFor="referral-preview-scenario" className="mb-1 mt-4 block text-sm font-medium">Cenário de teste</label>
        <select id="referral-preview-scenario" value={scenario!} onChange={e => setScenario(e.target.value as ReferralPreviewScenario)}
          className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:max-w-md md:text-sm">
          {REFERRAL_PREVIEW_SCENARIOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </> : <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-semibold">Testes do administrador do sistema</p><p className="mt-1 text-sm text-muted-foreground">Vê os pagamentos e bónus de uma organização pagante, mesmo que a tua esteja isenta.</p></div>
        <Button onClick={() => setScenario('earned')}>Testar como organização pagante</Button>
      </div>}
    </div>}
    {!isAdmin ? <p role="status" className="rounded-xl border p-5 text-sm">Só os administradores podem consultar as indicações e os bónus da organização.</p>
      : isLoading ? <div role="status" className="flex items-center gap-2 rounded-xl border p-6 text-sm"><Loader2 className="h-5 w-5 animate-spin" />A carregar as indicações da organização…</div>
      : error ? <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h3 className="font-semibold">{missingService ? 'Programa de indicações ainda não ativado' : 'Não foi possível atualizar as indicações'}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{missingService
          ? 'O link de convite e o acompanhamento dos bónus ficam disponíveis após a ativação do programa. Ainda não é possível registar indicações nesta versão.'
          : 'O estado dos pagamentos e do próximo bónus não está confirmado. Tenta atualizar daqui a pouco.'}</p>
        {!missingService && <Button className="mt-3" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>}
      </div> : data && totals && bonus ? <>
        <div className="rounded-xl border bg-card p-5 sm:p-6">
          <label htmlFor="referral-link" className="font-semibold">O link de indicação da tua organização</label>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Cada empresa que se registar com este link e fizer o primeiro pagamento dá-te um mês gratuito.</p>
          <div className="flex flex-col gap-2 sm:flex-row"><Input id="referral-link" readOnly value={link} className="min-w-0 text-base md:text-sm" onFocus={e => e.target.select()} />
            <Button className="shrink-0 gap-2" onClick={async () => {
              try { await navigator.clipboard.writeText(link); toast({ title: 'Link de indicação copiado' }); }
              catch { toast({ title: 'Seleciona e copia o link acima', variant: 'destructive' }); }
            }}><Copy className="h-4 w-4" />Copiar link</Button></div>
          {previewing && <p className="mt-2 text-xs text-muted-foreground">Link de demonstração: não abre um registo real nem atribui indicações.</p>}
        </div>
        <div className={`rounded-xl border p-5 sm:p-6 ${bonus.tone === 'positive' ? 'border-emerald-500/30 bg-emerald-500/5' : 'bg-card'}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Próxima mensalidade</p>
          <h3 className="mt-2 text-lg font-semibold">{bonus.title}</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{bonus.detail}</p>
          {!data.billing?.exempt && data.billing?.next_renewal_at && <p className="mt-3 text-sm">Fim do período atual: <strong>{date(data.billing.next_renewal_at)}</strong></p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y py-5 sm:grid-cols-4">
          {[['Meses disponíveis', totals.available], ['Em aplicação', totals.reserved], ['Meses utilizados', totals.used], ['A aguardar pagamento', totals.pending]].map(([label, count]) =>
            <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
        </dl>
        <div>
          <h3 className="mb-3 font-semibold">Empresas indicadas <span className="ml-1 text-sm font-normal text-muted-foreground">({data.referrals.length})</span></h3>
          {data.referrals.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm">
            <p className="font-medium">Ainda não tens empresas indicadas.</p><p className="mt-1 text-muted-foreground">Copia o link acima e partilha-o. A empresa aparece aqui depois de concluir o registo.</p>
          </div> : <ul className="divide-y rounded-xl border bg-card px-4 sm:px-5">{data.referrals.map(r => <li key={r.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]">
            <div className="min-w-0"><p className="break-words font-medium">{r.name}</p><p className="mt-1 text-xs text-muted-foreground">Registo: {date(r.created_at)}</p></div>
            <div><p className="mb-1 text-xs text-muted-foreground">Primeiro pagamento</p><p className="flex items-center gap-1.5 text-sm">{r.qualified_at ? <><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />Confirmado · {date(r.qualified_at)}</> : <><Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />A aguardar pagamento</>}</p></div>
            <div><p className="mb-1 text-xs text-muted-foreground">Bónus</p><Badge variant="secondary">{r.revoked_at ? 'Anulado' : r.redeemed_at ? 'Mês utilizado' : r.reserved ? 'Em aplicação' : r.qualified_at ? '1 mês disponível' : 'Ainda não atribuído'}</Badge>
              {r.redeemed_at && <p className="mt-1 text-xs text-muted-foreground">Utilizado em {date(r.redeemed_at)}</p>}</div>
          </li>)}</ul>}
        </div>
        <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">Os meses acumulam e são utilizados um de cada vez numa renovação mensal, incluindo os utilizadores adicionais do SENVIA OS. O bónus não cobre outros serviços nem é convertível em dinheiro. Nas subscrições anuais, fica guardado para uma futura subscrição mensal.</p>
      </> : null}
  </section>;
}
