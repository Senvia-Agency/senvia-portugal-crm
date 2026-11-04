import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  MapPin,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OttoActionDecision } from "@/components/otto/ottoProtocol";
import type { OttoActionPreview, OttoActionResult, OttoActionStatus } from "@/stores/useOttoStore";

type OttoActionCardProps =
  | {
      readonly kind: "preview";
      readonly action: OttoActionPreview;
      readonly decision: OttoActionDecision | null;
      readonly onConfirm: () => void;
      readonly onCancel: () => void;
    }
  | {
      readonly kind: "result";
      readonly result: OttoActionResult;
      readonly onOpenResource?: () => void;
    };

interface ResultPresentation {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly className: string;
}

const RESULT_PRESENTATION = {
  succeeded: { icon: CheckCircle2, label: "Ação concluída", className: "border-success/40 bg-success/10 text-success" },
  failed: { icon: AlertCircle, label: "A ação falhou", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  denied: { icon: Ban, label: "Ação recusada", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  expired: { icon: Clock3, label: "Confirmação expirada", className: "border-warning/40 bg-warning/10 text-warning" },
  cancelled: { icon: XCircle, label: "Ação cancelada", className: "border-border bg-muted/50 text-muted-foreground" },
} as const satisfies Record<OttoActionStatus, ResultPresentation>;

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" }).format(new Date(expiresAt));
}

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes} min ${remainder.toString().padStart(2, "0")} s` : `${remainder} s`;
}

export function OttoActionCard(props: OttoActionCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = props.kind === "preview" ? props.action.expiresAt : null;

  useEffect(() => {
    if (expiresAt === null || Date.parse(expiresAt) <= Date.now()) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [expiresAt]);

  if (props.kind === "result") {
    const presentation = RESULT_PRESENTATION[props.result.status];
    const Icon = presentation.icon;
    return (
      <div className={`rounded-xl border p-3 ${presentation.className}`} role="status" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">{presentation.label}</p>
            <p className="break-words text-sm text-foreground/80">{props.result.summary}</p>
            {props.result.error && <p className="break-words text-xs text-destructive">{props.result.error}</p>}
            {props.result.operation && <p className="text-xs text-muted-foreground">Operação: {props.result.operation}</p>}
          </div>
        </div>
        {props.result.status === "succeeded" && props.result.resource && (
          <Button asChild variant="outline" size="sm" className="mt-3 w-full justify-center gap-1.5">
            <Link to={props.result.resource.route} onClick={props.onOpenResource}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir registo
            </Link>
          </Button>
        )}
      </div>
    );
  }

  const expiryTime = Date.parse(props.action.expiresAt);
  const isExpired = !Number.isFinite(expiryTime) || expiryTime <= now;
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-foreground" role="group" aria-label="Confirmação de ação do Otto">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-semibold text-warning">Confirmação necessária</p>
          <h4 className="break-words text-sm font-semibold">{props.action.title}</h4>
          <p className="break-words text-sm leading-relaxed text-foreground/80">{props.action.summary}</p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="break-words">{props.action.destination}</span>
          </p>
          <p className={isExpired ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
            {isExpired
              ? "Esta confirmação expirou."
              : `Expira às ${formatExpiry(props.action.expiresAt)} (${formatRemaining(expiryTime - now)} restantes)`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={props.onConfirm} disabled={props.decision !== null || isExpired}>
          {props.decision === "confirm" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Confirmar ação
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={props.onCancel} disabled={props.decision !== null}>
          {props.decision === "cancel" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Cancelar
        </Button>
      </div>
    </div>
  );
}
