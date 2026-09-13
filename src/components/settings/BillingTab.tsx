import { Link } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _version = '2026-06-29-force-rebuild';
import { Check, Crown, Loader2, ExternalLink, Sparkles, Users, FileText, MessageSquare, BarChart3, Puzzle, Zap, Package, CreditCard, Clock, Inbox, Plus, Minus, AlertTriangle, Info, Lightbulb, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useStripeSubscription } from '@/hooks/useStripeSubscription';
import { STRIPE_PLANS, type StripePlan, type BillingPeriod } from '@/lib/stripe-plans';
import { PricingPlans, PricingCtaButton } from '@/components/billing/PricingPlans';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { monthlyPrice } from '@/lib/stripe-plans';
import { useQuery } from '@tanstack/react-query';

const INTEGRATION_ICONS: Record<string, React.ElementType> = {
  WhatsApp: MessageSquare,
  'Meta Pixels': BarChart3,
  'Faturação (KeyInvoice, InvoiceXpress)': FileText,
  'Pagamentos (Stripe)': CreditCard,
};

export function BillingTab() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const { isLoading, subscriptionStatus, hasChecked, checkSubscription, createCheckout, openCustomerPortal } = useStripeSubscription();
  const [checkingPlan, setCheckingPlan] = useState<string | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [extraSeatsLoading, setExtraSeatsLoading] = useState(false);
  const [extraSeatsDelta, setExtraSeatsDelta] = useState(0);

  // Fetch org data directly for the current org (works for super admin viewing other orgs)
  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ['org-extra-seats', organization?.id],
    enabled: !!organization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('plan, extra_seats, max_users_override')
        .eq('id', organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch active member count for the current org
  const { data: memberCountData } = useQuery({
    queryKey: ['org-member-count', organization?.id],
    enabled: !!organization?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization!.id)
        .eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Extra seats logic — use org data directly (works for super admin)
  const currentSeats = orgData?.extra_seats ?? subscriptionStatus?.extra_seats ?? 0;
  const baseUsers = orgData ? (orgData.plan === 'elite' ? 999999 : orgData.plan === 'pro' ? 15 : 5) : (subscriptionStatus?.plan_base_users ?? 5);
  const activeMembers = memberCountData ?? subscriptionStatus?.active_members ?? 0;
  // Use max_users_override if set, otherwise calculate from base + extra
  const planLimit = orgData?.max_users_override != null
    ? Number(orgData.max_users_override)
    : baseUsers + currentSeats;
  const availableSlots = Math.max(0, planLimit - activeMembers);
  const currentPlanIdFromOrg = orgData?.plan ?? subscriptionStatus?.plan_id;
  const showExtraSeats = organization?.id && !orgLoading;

  // Smart recommendation
  const smartRecommendation = useMemo(() => {
    const planId = currentPlanIdFromOrg;
    if (!planId) return null;
    const planIndex = STRIPE_PLANS.findIndex(p => p.id === planId);
    if (planIndex < 0) return null;
    const memberOverage = activeMembers - baseUsers;
    
    // How many extra seats we'd need if upgrading to next plan
    const nextPlan = planIndex < STRIPE_PLANS.length - 1 ? STRIPE_PLANS[planIndex + 1] : null;
    const nextPlanUsers = nextPlan ? (parseInt(nextPlan.limits.users) || 999999) : 999999;
    
    if (nextPlan && activeMembers > 0) {
      const currentPlanMonthly = STRIPE_PLANS[planIndex].priceMonthly;
      const nextPlanMonthly = nextPlan.priceMonthly;
      const upgradeCost = nextPlanMonthly - currentPlanMonthly;
      
      // Cost of individual extra seats vs cost of upgrade
      const seatsNeeded = nextPlanUsers - baseUsers;
      const extraSeatCost = seatsNeeded * 5;
      
      if (memberOverage >= 2) {
        // Already paying for 2+ extra seats
        const currentExtraCost = memberOverage * 5;
        if (upgradeCost < currentExtraCost && nextPlanUsers >= activeMembers) {
          return {
            type: 'upgrade' as const,
            message: `Com ${memberOverage} utilizadores extra (${currentExtraCost}€/mês), compensa fazer upgrade para ${nextPlan.name} (mais ${upgradeCost - currentExtraCost}€/mês) e ganhar mais funcionalidades.`,
            plan: nextPlan,
            savings: currentExtraCost - upgradeCost,
          };
        }
      }
      
      if (memberOverage === 1 && upgradeCost >= 5 && upgradeCost <= 10) {
        // Almost worth upgrading but not yet
        return {
          type: 'info' as const,
          message: `Com mais ${seatsNeeded - memberOverage} utilizador(es) extra (${extraSeatCost}€/mês no total), talvez compense fazer upgrade para ${nextPlan.name} (+${upgradeCost}€/mês) com mais funcionalidades.`,
          plan: nextPlan,
        };
      }
    }
    
    return null;
  }, [currentPlanIdFromOrg, activeMembers, baseUsers, currentSeats]);

  const handleBuyExtraSeats = async (quantity: number) => {
    setExtraSeatsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('buy-extra-seats', {
        body: {
          quantity,
          organization_id: organization?.id,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
      } else {
        await checkSubscription();
      }
      setExtraSeatsDelta(0);
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message || 'Erro ao adquirir utilizadores extra',
        variant: 'destructive',
      });
    } finally {
      setExtraSeatsLoading(false);
    }
  };

  const isOnTrial = subscriptionStatus?.on_trial === true;
  const hasActiveSubscription = subscriptionStatus?.subscribed === true;
  // Only use plan_id as "current" if user has an active paid subscription (not trial)
  const currentPlanId = hasActiveSubscription ? 'starter' : null;
  const currentIndex = currentPlanId ? STRIPE_PLANS.findIndex(p => p.id === currentPlanId) : -1;
  const hasNoSubscription = !hasChecked || !hasActiveSubscription;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      // Fire Meta Pixel Purchase event
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Purchase', {
          content_name: 'Senvia OS Subscription',
          content_category: 'subscription',
          currency: 'EUR',
          value: 0,
        });
      }
      setTimeout(() => checkSubscription(), 2000);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [checkSubscription]);

  const handleSelectPlan = async (plan: StripePlan) => {
    if (plan.id === currentPlanId) return;
    // Use the price id for the chosen period; annual ids may not be set up in
    // Stripe yet, in which case we don't start a (wrong) checkout.
    const priceId = period === 'yearly' ? plan.priceIdYearly : plan.priceId;
    if (!priceId) return;
    setCheckingPlan(plan.id);
    await createCheckout(priceId);
    setCheckingPlan(null);
  };

  return (
    <div className="space-y-6">
      <Link to="/settings?og=account&os=account-referrals" className="block rounded-xl border bg-card p-4 text-sm hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <span className="font-semibold text-primary">Indicações e meses gratuitos →</span>
        <span className="mt-1 block text-muted-foreground">Copia o teu link, acompanha os pagamentos das empresas indicadas e consulta o próximo bónus.</span>
      </Link>
      {/* Billing Exempt Status */}
      {subscriptionStatus?.billing_exempt && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-4 w-4 text-emerald-500" />
            <span className="font-semibold text-sm">Plano Vitalício</span>
            <Badge className="bg-emerald-500 text-white text-[10px] px-2.5 py-1">
              <Sparkles className="h-3 w-3 mr-1" />
              Isento
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            A sua organização tem acesso vitalício ao SENVIA OS sem necessidade de pagamento.
          </p>
        </div>
      )}

      {/* Trial Status */}
      {isOnTrial && subscriptionStatus?.days_remaining !== undefined && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="font-semibold text-sm">Período de Teste</span>
            <Badge className="bg-amber-500 text-white text-[10px] px-2.5 py-1">
              {subscriptionStatus.days_remaining} {subscriptionStatus.days_remaining === 1 ? 'dia restante' : 'dias restantes'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Tem acesso total a todos os módulos. Escolha um plano antes do fim do período de teste.
          </p>
        </div>
      )}

      {/* Current Plan Status - only when subscribed */}
      {!subscriptionStatus?.billing_exempt && subscriptionStatus?.subscribed && subscriptionStatus.subscription_end && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Subscrição Ativa</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Próxima renovação: {format(new Date(subscriptionStatus.subscription_end), "d 'de' MMMM 'de' yyyy", { locale: pt })}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-2"
            onClick={openCustomerPortal}
            disabled={isLoading}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Gerir Subscrição
          </Button>
        </div>
      )}

      {/* Extra Seats — available for Starter and Pro plans only */}
      {showExtraSeats && orgData && orgData.plan !== 'elite' && (
        <div className="rounded-xl border border-primary/10 bg-card p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Utilizadores Adicionais</span>
            <Badge variant="secondary" className="text-[10px]">{currentSeats} extra</Badge>
          </div>

          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{activeMembers}</span> de{" "}
                <span className="font-medium">{planLimit}</span> utilizadores em uso
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Base do plano: {baseUsers} utilizadores + {currentSeats} extra{currentSeats > 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExtraSeatsDelta(Math.max(-currentSeats, extraSeatsDelta - 1))}
                disabled={extraSeatsLoading}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="font-semibold text-lg tabular-nums w-8 text-center">
                {Math.max(0, currentSeats + extraSeatsDelta)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExtraSeatsDelta(extraSeatsDelta + 1)}
                disabled={extraSeatsLoading}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Price per extra seat */}
          <p className="text-xs text-muted-foreground mb-3">
            5€/mês por utilizador extra. Ao fazer upgrade para um plano superior,
            os utilizadores extra são automaticamente absorvidos — não paga a dobrar.
          </p>

          {/* Smart recommendation */}
          {smartRecommendation && (
            <div className={`rounded-lg p-3 mb-3 text-sm flex items-start gap-2 ${
              smartRecommendation.type === 'upgrade'
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'bg-amber-500/10 border border-amber-500/20'
            }`}>
              {smartRecommendation.type === 'upgrade' ? (
                <Lightbulb className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              ) : (
                <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-xs">{smartRecommendation.message}</p>
                {smartRecommendation.type === 'upgrade' && smartRecommendation.plan && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs mt-1"
                    onClick={() => handleSelectPlan(smartRecommendation.plan!)}
                  >
                    Fazer upgrade para {smartRecommendation.plan.name}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Purchase button */}
          {extraSeatsDelta !== 0 && (
            <Button
              size="sm"
              onClick={() => handleBuyExtraSeats(Math.max(0, currentSeats + extraSeatsDelta))}
              disabled={extraSeatsLoading}
              className="gap-2"
            >
              {extraSeatsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : extraSeatsDelta > 0 ? (
                <>
                  <Plus className="h-4 w-4" />
                  Adicionar {extraSeatsDelta} utilizador{extraSeatsDelta > 1 ? 'es' : ''} extra
                </>
              ) : (
                <>
                  <Minus className="h-4 w-4" />
                  Remover {Math.abs(extraSeatsDelta)} utilizador{Math.abs(extraSeatsDelta) > 1 ? 'es' : ''} extra
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Plans — reference visual (brush, heading, animated switch, gradient
          CTAs), shared with the public /precos page. */}
      <PricingPlans
        period={period}
        onPeriodChange={setPeriod}
        currentPlanId={currentPlanId}
        renderCta={(plan, { isCurrent, popular }) => {
          if (subscriptionStatus?.billing_exempt) {
            return (
              <PricingCtaButton popular={popular} disabled>
                Incluído no vitalício
              </PricingCtaButton>
            );
          }
          const planIndex = STRIPE_PLANS.findIndex((p) => p.id === plan.id);
          const isUpgrade = !hasNoSubscription && planIndex > currentIndex;
          const isDowngrade = !hasNoSubscription && planIndex < currentIndex;
          // Annual price ids aren't configured in Stripe yet: block annual checkout
          // for select/upgrade (downgrade goes through the customer portal).
          const blockAnnual = period === 'yearly' && !plan.priceIdYearly && !isDowngrade && !isCurrent;
          const busy = checkingPlan === plan.id;
          return (
            <PricingCtaButton
              popular={popular}
              disabled={isCurrent || isLoading || busy || blockAnnual}
              onClick={() => (isDowngrade ? openCustomerPortal() : handleSelectPlan(plan))}
            >
              {busy ? (
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              ) : isCurrent ? (
                'Plano Atual'
              ) : blockAnnual ? (
                'Anual em breve'
              ) : hasNoSubscription ? (
                'Selecionar'
              ) : isUpgrade ? (
                'Fazer Upgrade'
              ) : (
                'Fazer Downgrade'
              )}
            </PricingCtaButton>
          );
        }}
      />
    </div>
  );
}
