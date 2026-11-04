import { Link } from "react-router-dom";
import type { OttoModule, OttoWriteGrant } from "@/hooks/useOttoWriteGrants";

export type OttoAccessLevel = "off" | "read" | "write";

interface OttoWriteGrantCardProps {
  readonly module: OttoModule;
  readonly grant?: OttoWriteGrant;
  readonly isAvailable: boolean;
  readonly disabled: boolean;
  readonly onChange: (level: OttoAccessLevel) => void;
}

export function OttoWriteGrantCard({ module, grant, isAvailable, disabled, onChange }: OttoWriteGrantCardProps) {
  const separateAvailability = module.key === "leads" || module.key === "automations";
  const level: OttoAccessLevel = !isAvailable ? "off" : grant?.is_granted ? "write" : "read";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{module.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{module.description}</p>
        {!separateAvailability && !isAvailable && (
          <p className="mt-2 text-xs text-muted-foreground">Ative este módulo na organização em <Link className="text-primary underline" to="/settings?og=modules&os=modules-list">Módulos e Campos</Link>.</p>
        )}
        {!separateAvailability && isAvailable && <p className="mt-2 text-xs text-muted-foreground">A consulta acompanha a disponibilidade do módulo na organização.</p>}
      </div>
      <select
        aria-label={`Acesso do Otto a ${module.label}`}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
        value={level}
        disabled={disabled || (!isAvailable && !separateAvailability)}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "off" || value === "read" || value === "write") onChange(value);
        }}
      >
        {(!isAvailable || separateAvailability) && <option value="off">Desativado</option>}
        <option value="read">Consultar</option>
        <option value="write">Criar e editar</option>
      </select>
    </div>
  );
}
