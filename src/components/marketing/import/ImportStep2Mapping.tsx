import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";

const SYSTEM_FIELDS = [
  { key: "name", label: "Nome" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "company", label: "Empresa" },
];

interface Props {
  headers: string[];
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  onConfirm: () => void;
}

export function ImportStep2Mapping({ headers, rows, mapping, onMappingChange, onConfirm }: Props) {
  const { t } = useLanguage();
  // Reverse mapping: fileHeader -> systemField
  const reverseMap: Record<string, string> = {};
  Object.entries(mapping).forEach(([sysKey, fileHeader]) => {
    if (fileHeader && fileHeader !== "__none__") reverseMap[fileHeader] = sysKey;
  });

  const setHeaderMapping = (fileHeader: string, sysKey: string) => {
    const newMapping = { ...mapping };
    // Remove previous assignment of this system field
    if (sysKey !== "__ignore__") {
      Object.entries(newMapping).forEach(([k, v]) => {
        if (v === fileHeader) delete newMapping[k];
      });
      newMapping[sysKey] = fileHeader;
    } else {
      // Remove any mapping for this file header
      Object.entries(newMapping).forEach(([k, v]) => {
        if (v === fileHeader) delete newMapping[k];
      });
    }
    onMappingChange(newMapping);
  };

  const getMappedSystemKey = (fileHeader: string): string => {
    return reverseMap[fileHeader] || "__ignore__";
  };

  const mappedCount = Object.values(mapping).filter(v => v && v !== "__none__").length;
  const ignoredCount = headers.length - mappedCount;

  const sampleValues = (header: string) => rows.slice(0, 3).map(r => r[header]).filter(Boolean);

  const resetMapping = () => onMappingChange({});

  const hasName = mapping.name && mapping.name !== "__none__";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {headers.map(header => {
          const sysKey = getMappedSystemKey(header);
          const isMapped = sysKey !== "__ignore__";
          const samples = sampleValues(header);

          return (
            <div key={header} className={cn(
              "flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border transition-colors",
              isMapped ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border"
            )}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isMapped ? (
                  <Check className="h-4 w-4 text-primary flex-shrink-0" />
                ) : (
                  <Minus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{header}</p>
                  {samples.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {samples.join(", ")}
                    </p>
                  )}
                </div>
              </div>
              <Select value={sysKey} onValueChange={v => setHeaderMapping(header, v)}>
                <SelectTrigger className="w-full sm:w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ignore__">{t("— Ignorar —")}</SelectItem>
                  {SYSTEM_FIELDS.map(f => (
                    <SelectItem key={f.key} value={f.key} disabled={!!mapping[f.key] && mapping[f.key] !== header}>
                      {t(f.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          {t("Para importação:")} <strong>{mappedCount}</strong> {t("coluna(s)")} · {t("Ignorado:")} <strong>{ignoredCount}</strong> {t("coluna(s)")}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetMapping}>{t("Redefinir mapeamento")}</Button>
          <Button size="sm" onClick={onConfirm} disabled={!hasName}>{t("Confirmar o mapeamento")}</Button>
        </div>
      </div>
    </div>
  );
}
