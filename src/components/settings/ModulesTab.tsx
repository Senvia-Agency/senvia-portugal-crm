import { FileText, Calendar, ShoppingBag, Store, UserCheck, Mail, Wallet, Zap, Search, MessageSquare, Users, Workflow } from "lucide-react";
import type { ElementType } from "react";
import { Switch } from "@/components/ui/switch";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useModules, type EnabledModules } from "@/hooks/useModules";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

interface ModuleConfig {
  readonly key: keyof EnabledModules;
  readonly label: string;
  readonly description: string;
  readonly icon: ElementType;
}

const MODULES: readonly ModuleConfig[] = [
  { key: 'inbox', label: 'Caixa de Entrada', description: 'Mensagens de WhatsApp, Instagram e Facebook num só lugar', icon: MessageSquare },
  { key: 'clients', label: 'Clientes', description: 'Gestão de clientes e relacionamento comercial', icon: UserCheck },
  { key: 'proposals', label: 'Propostas', description: 'Gestão de propostas e orçamentos comerciais', icon: FileText },
  { key: 'sales', label: 'Vendas', description: 'Gestão de vendas e entregas', icon: ShoppingBag },
  { key: 'finance', label: 'Financeiro', description: 'Controlo de pagamentos, faturas e fluxo de caixa', icon: Wallet },
  { key: 'calendar', label: 'Agenda', description: 'Agendamento de eventos, reuniões e lembretes', icon: Calendar },
  { key: 'marketing', label: 'Marketing', description: 'Templates de email e campanhas de marketing', icon: Mail },
  { key: 'prospects', label: 'Prospects', description: 'Importação e distribuição de prospects para a equipa comercial', icon: Search },
];

const OTTO_AVAILABILITY_MODULES: readonly ModuleConfig[] = [
  { key: 'leads', label: 'Leads', description: 'Disponibiliza ao Otto as operações suportadas de leads', icon: Users },
  { key: 'automations', label: 'Automações', description: 'Disponibiliza ao Otto as operações suportadas de automações', icon: Workflow },
];

export function ModulesTab() {
  const { modules, isLoading, updateModule, isUpdating } = useModules();
  const { isModuleLocked, getRequiredPlan } = useSubscription();
  const { organization } = useAuth();
  const isTelecom = organization?.niche === 'telecom';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Módulos Ativos</h3>
        <p className="text-sm text-muted-foreground">
          Ative ou desative os módulos disponíveis na sua organização.
        </p>
      </div>

      <div className="space-y-4">
        {MODULES.map((module) => {
          const locked = isModuleLocked(module.key);
          const requiredPlan = getRequiredPlan(module.key);

          return (
            <Card key={module.key} className={locked ? "opacity-60" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <module.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{module.label}</CardTitle>
                        {locked && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            Plano {requiredPlan}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-sm">
                        {module.description}
                      </CardDescription>
                    </div>
                  </div>
                  <Switch
                    id={module.key}
                    checked={locked ? false : modules[module.key]}
                    onCheckedChange={(checked) => 
                      updateModule({ module: module.key, enabled: checked })
                    }
                    disabled={isUpdating || locked}
                  />
                </div>
              </CardHeader>
            </Card>
          );
        })}

        {/* Energy toggle - Telecom only */}
        {isTelecom && (
          <Card className={!modules.energy ? "border-amber-500/30" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <Zap className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">Energias</CardTitle>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-600 dark:text-amber-400">
                        Telecom
                      </Badge>
                    </div>
                    <CardDescription className="text-sm">
                      Campos de energia (EE, Gás), CPEs, consumo anual e tipologia
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  id="energy"
                  checked={modules.energy}
                  onCheckedChange={(checked) => 
                    updateModule({ module: 'energy', enabled: checked })
                  }
                  disabled={isUpdating}
                />
              </div>
            </CardHeader>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Disponibilidade no Otto</h3>
          <p className="text-sm text-muted-foreground">
            Ative explicitamente os módulos que o Otto pode disponibilizar. Este controlo não concede escrita nem altera o acesso às páginas nativas.
          </p>
        </div>

        {OTTO_AVAILABILITY_MODULES.map((module) => (
          <Card key={module.key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <module.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{module.label}</CardTitle>
                    <CardDescription className="text-sm">
                      {module.description}
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  id={`otto-availability-${module.key}`}
                  aria-label={`Disponibilizar ${module.label} no Otto`}
                  checked={modules[module.key]}
                  onCheckedChange={(checked) =>
                    updateModule({ module: module.key, enabled: checked })
                  }
                  disabled={isUpdating}
                />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Os módulos Senvia desativados não aparecem no menu de navegação. A disponibilidade no Otto não altera a navegação e continua a exigir uma autorização de escrita separada.
      </p>
    </div>
  );
}
