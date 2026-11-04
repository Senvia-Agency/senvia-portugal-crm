import { Link } from "react-router-dom";
import { Clock3, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { OttoModule, OttoWriteGrant } from "@/hooks/useOttoWriteGrants";

interface OttoWriteGrantCardProps {
  readonly module: OttoModule;
  readonly grant?: OttoWriteGrant;
  readonly isAvailable: boolean;
  readonly disabled: boolean;
  readonly onToggle: (isGranted: boolean) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function OttoWriteGrantCard({ module, grant, isAvailable, disabled, onToggle }: OttoWriteGrantCardProps) {
  const isGranted = grant?.is_granted ?? false;
  const changedAt = grant ? (grant.is_granted ? grant.granted_at : grant.revoked_at) : null;
  const switchId = `otto-write-${module.key}`;

  return (
    <div className="flex items-start gap-4 rounded-lg border border-border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={switchId} className="cursor-pointer text-sm font-semibold">{module.label}</Label>
          <Badge variant="outline" className={isGranted ? "border-success/30 bg-success/10 text-success" : undefined}>
            {isGranted ? "Concedido" : "Desligado"}
          </Badge>
          {!isAvailable && <Badge variant="outline">Indisponível no Otto</Badge>}
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{module.description}</p>
        {!isAvailable && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ative primeiro a disponibilidade correspondente em{" "}
            <Link to="/settings?og=modules&os=modules-list" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Módulos e Campos
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
            .
          </p>
        )}
        {changedAt && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            {isGranted ? "Concedido" : "Revogado"} em {formatDate(changedAt)} por um administrador
          </p>
        )}
      </div>
      <Switch
        id={switchId}
        checked={isGranted}
        disabled={disabled || (!isAvailable && !isGranted)}
        aria-label={`${isGranted ? "Revogar" : "Conceder"} escrita do Otto em ${module.label}`}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
