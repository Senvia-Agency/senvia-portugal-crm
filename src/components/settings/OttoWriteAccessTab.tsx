import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  History,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OttoWriteGrantCard } from "@/components/settings/OttoWriteGrantCard";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import {
  OTTO_MODULES,
  type OttoModule,
  useOttoWriteGrants,
} from "@/hooks/useOttoWriteGrants";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";

interface OttoWriteAccessTabProps {
  readonly canManageOtto: boolean;
}

type PendingGrantChange = Readonly<{ module: OttoModule; moduleKey: OttoModule["key"]; isGranted: boolean }>;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function moduleLabel(moduleKey: string): string {
  return OTTO_MODULES.find((module) => module.key === moduleKey)?.label ?? moduleKey;
}

export function OttoWriteAccessTab({ canManageOtto }: OttoWriteAccessTabProps) {
  const { organization, organizations, isSuperAdmin } = useAuth();
  const { modules, isLoading: modulesLoading } = useModules();
  const [pendingChange, setPendingChange] = useState<PendingGrantChange | null>(null);
  const {
    grants,
    history,
    isLoading,
    error,
    refetch,
    setGrant,
    isUpdating,
    mutationError,
  } = useOttoWriteGrants({ enabled: canManageOtto });

  if (!canManageOtto) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Acesso restrito
          </CardTitle>
          <CardDescription>Apenas administradores da organização podem gerir as autorizações do Otto.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasPortalAccess = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  });
  const visibleModules = OTTO_MODULES.filter((module) => {
    if (!module.active) return false;
    if ("requiresPortalAccess" in module && module.requiresPortalAccess && !hasPortalAccess) return false;
    return true;
  });
  const grantsByModule = new Map(grants.map((grant) => [grant.module_key, grant]));
  const confirmChange = () => {
    if (!pendingChange) return;
    setGrant(
      { moduleKey: pendingChange.moduleKey, isGranted: pendingChange.isGranted },
      { onSuccess: () => setPendingChange(null) },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
            Autorizações de escrita do Otto
          </CardTitle>
          <CardDescription>
            Todos os módulos começam desligados. Uma autorização permite apenas operações suportadas e continua sujeita às permissões do utilizador.
          </CardDescription>
        </CardHeader>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Não foi possível carregar as autorizações</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{errorMessage(error, "Ocorreu um erro ao consultar os acessos do Otto.")}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      )}

      {mutationError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Não foi possível guardar a alteração</AlertTitle>
          <AlertDescription>{errorMessage(mutationError, "A autorização anterior foi mantida.")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Escrita por módulo</CardTitle>
          <CardDescription>A autorização só pode ser concedida quando o módulo está disponível nesta organização.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || modulesLoading ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-32 rounded-lg" />)}
            </div>
          ) : visibleModules.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleModules.map((module) => {
                const grant = grantsByModule.get(module.key);
                const isAvailable = !("availabilityKey" in module) || modules[module.availabilityKey];
                return (
                  <OttoWriteGrantCard
                    key={module.key}
                    module={module}
                    grant={grant}
                    isAvailable={isAvailable}
                    disabled={isUpdating || Boolean(error)}
                    onToggle={(nextValue) => setPendingChange({ module, moduleKey: module.key, isGranted: nextValue })}
                  />
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Não existem módulos ativos disponíveis para autorizar.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" aria-hidden="true" />
            Histórico de autorizações
          </CardTitle>
          <CardDescription>Registo redigido das concessões e revogações desta organização.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="space-y-3">
              {history.map((entry) => {
                const isGrant = entry.action === "grant";
                return (
                  <div key={entry.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {isGrant
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{isGrant ? "Autorização concedida" : "Autorização revogada"}</p>
                        <p className="break-words text-sm text-muted-foreground">
                          {moduleLabel(entry.module_key)} por um administrador da organização
                        </p>
                      </div>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.changed_at}>
                      {formatDate(entry.changed_at)}
                    </time>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Ainda não existem alterações de autorização nesta organização.</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingChange !== null}
        onOpenChange={(open) => { if (!open && !isUpdating) setPendingChange(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingChange?.isGranted ? "Conceder escrita ao Otto?" : "Revogar escrita do Otto?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingChange?.isGranted
                ? `O Otto poderá executar operações suportadas em ${pendingChange.module.label}. As permissões do utilizador e as confirmações exigidas continuam a aplicar-se.`
                : `Novas escritas do Otto em ${pendingChange?.module.label ?? "este módulo"} serão bloqueadas de imediato.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmChange}
              disabled={isUpdating}
              className={pendingChange?.isGranted ? undefined : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
            >
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {pendingChange?.isGranted ? "Conceder" : "Revogar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
