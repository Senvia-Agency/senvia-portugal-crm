import { useEffect, useMemo, useState } from "react";
import { Loader2, Users, User, Shuffle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImportStep1Upload } from "@/components/marketing/import/ImportStep1Upload";
import { useTeamMembers } from "@/hooks/useTeam";
import { useImportLeads, type ImportLeadsResult } from "@/hooks/useImportLeads";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useLanguage } from "@/i18n";

interface ImportLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DistributionMode = "round_robin_all" | "selected_members" | "single_user";

const TARGET_FIELDS = [
  { key: "name", label: "Nome do contacto" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "company_name", label: "Empresa" },
  { key: "company_nif", label: "NIF" },
  { key: "source", label: "Origem" },
  { key: "value", label: "Valor (€)" },
  { key: "notes", label: "Observações" },
] as const;

const NONE_VALUE = "__none__";

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["nome", "name", "contact", "contacto", "nomedocontacto", "fullname", "nomecompleto"],
  email: ["email", "mail", "correio", "eaddress"],
  phone: ["telefone", "telemovel", "phone", "tel", "mobile", "contacto", "numero", "number"],
  company_name: ["empresa", "company", "companyname", "nomedaempresa", "organizacao"],
  company_nif: ["nif", "vat", "nipc", "fiscalnumber"],
  source: ["origem", "source", "fonte"],
  value: ["valor", "value", "amount", "preco"],
  notes: ["notas", "notes", "observacoes", "obs", "comentarios", "remarks"],
};

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const target of TARGET_FIELDS) {
    const aliases = FIELD_ALIASES[target.key] || [];
    const match = headers.find((h) => aliases.includes(normalize(h)));
    if (match) mapping[target.key] = match;
  }
  return mapping;
}

export function ImportLeadsDialog({ open, onOpenChange }: ImportLeadsDialogProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importName, setImportName] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [distributionMode, setDistributionMode] = useState<DistributionMode>("round_robin_all");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [singleUserId, setSingleUserId] = useState<string>("");
  const [selectedStageKey, setSelectedStageKey] = useState<string>("");
  const [result, setResult] = useState<ImportLeadsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: teamMembers = [] } = useTeamMembers();
  const { data: stages = [] } = usePipelineStages();
  const importMutation = useImportLeads();

  const activeStages = useMemo(
    () => stages.filter((s) => !s.is_final_positive && !s.is_final_negative),
    [stages]
  );

  useEffect(() => {
    if (activeStages.length > 0 && !selectedStageKey) {
      setSelectedStageKey(activeStages[0].key);
    }
  }, [activeStages, selectedStageKey]);

  const activeMembers = useMemo(
    () => teamMembers.filter((m) => !m.is_banned),
    [teamMembers]
  );

  useEffect(() => {
    if (!open) {
      setStep(1);
      setImportName("");
      setFileName("");
      setHeaders([]);
      setRows([]);
      setMapping({});
      setDistributionMode("round_robin_all");
      setSelectedMembers([]);
      setSingleUserId("");
      setSelectedStageKey(activeStages[0]?.key ?? "");
      setResult(null);
      setError(null);
    }
  }, [open]);

  const handleFileLoaded = (name: string, h: string[], r: Record<string, string>[]) => {
    setFileName(name);
    setHeaders(h);
    setRows(r);
    setMapping(autoMap(h));
    setResult(null);
    setError(null);
  };

  const clearFile = () => {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
  };

  const canGoStep2 = !!fileName && rows.length > 0 && importName.trim() !== "";
  const nameMapped = !!mapping.name;
  const canGoStep3 = nameMapped;

  const distributionReady =
    (distributionMode === "round_robin_all" && activeMembers.length > 0) ||
    (distributionMode === "selected_members" && selectedMembers.length > 0) ||
    (distributionMode === "single_user" && !!singleUserId);

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleImport = async () => {
    setError(null);
    setResult(null);

    let assigneeIds: string[] = [];
    if (distributionMode === "round_robin_all") {
      assigneeIds = activeMembers.map((m) => m.user_id);
    } else if (distributionMode === "selected_members") {
      assigneeIds = selectedMembers;
    } else {
      assigneeIds = [singleUserId];
    }

    try {
      const res = await importMutation.mutateAsync({
        rows,
        mapping,
        assigneeIds,
        stageKey: selectedStageKey,
        fileName,
        name: importName,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Erro ao importar leads"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-4 md:px-6">
          <DialogTitle>{t("Importar leads")}</DialogTitle>
          <DialogDescription>
            {t("Carrega um Excel ou CSV, mapeia as colunas e distribui pelos comerciais. Importação silenciosa (não dispara automações).")}
          </DialogDescription>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className={step === 1 ? "font-semibold text-foreground" : ""}>{t("1. Ficheiro")}</span>
            <span>›</span>
            <span className={step === 2 ? "font-semibold text-foreground" : ""}>{t("2. Mapeamento")}</span>
            <span>›</span>
            <span className={step === 3 ? "font-semibold text-foreground" : ""}>{t("3. Distribuição")}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <strong>{t("Importação concluída")}</strong>
                <span className="font-mono text-xs bg-primary/10 border border-primary/20 rounded px-2 py-0.5 select-all">{result.importCode}</span>
              </div>
              <div className="text-muted-foreground">{t("{{n}} criados", { n: result.inserted })}{result.updated ? ` • ${t("{{n}} atualizados", { n: result.updated })}` : ""}{result.failed ? ` • ${t("{{n}} falhados", { n: result.failed })}` : ""}</div>
              {result.firstError && (
                <div className="text-xs text-muted-foreground">{t("Primeiro erro: {{error}}", { error: result.firstError })}</div>
              )}
              <div className="text-xs text-muted-foreground">{t("Guarda este código para rastrear ou corrigir este lote.")}</div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="import-name" className="text-sm font-medium">
                  {t("Nome da importação")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="import-name"
                  placeholder={t("Ex: Leads telecom março 2026")}
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  maxLength={120}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  {t("Identifica este lote para o conseguires encontrar/apagar mais tarde no histórico.")}
                </p>
              </div>

              <ImportStep1Upload
                fileName={fileName}
                headers={headers}
                rows={rows}
                onFileLoaded={handleFileLoaded}
                onClearFile={clearFile}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("Associa cada coluna do ficheiro ao campo correspondente no CRM. O campo Nome é obrigatório.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {TARGET_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {t(field.label)}
                      {field.key === "name" && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Select
                      value={mapping[field.key] || NONE_VALUE}
                      onValueChange={(v) =>
                        setMapping((prev) => ({ ...prev, [field.key]: v === NONE_VALUE ? "" : v }))
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t("— não importar —")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>{t("— não importar —")}</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {t("{{n}} linhas serão importadas.", { n: rows.length })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Etapa do pipeline")}</Label>
                <Select value={selectedStageKey} onValueChange={setSelectedStageKey}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("Selecionar etapa...")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-sm text-muted-foreground">{t("Escolhe como distribuir os {{n}} leads:", { n: rows.length })}</p>

              <div className="space-y-2">
                <button
                  onClick={() => setDistributionMode("round_robin_all")}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    distributionMode === "round_robin_all"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Shuffle className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("Round-robin entre todos os membros")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("Divide igualmente entre os {{n}} comerciais ativos.", { n: activeMembers.length })}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setDistributionMode("selected_members")}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    distributionMode === "selected_members"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Users className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("Selecionar membros específicos")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("Divide round-robin apenas entre os comerciais escolhidos.")}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setDistributionMode("single_user")}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    distributionMode === "single_user"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <User className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("Atribuir todos a um único comercial")}</div>
                    <div className="text-xs text-muted-foreground">{t("Todos os leads vão para a mesma pessoa.")}</div>
                  </div>
                </button>
              </div>

              {distributionMode === "selected_members" && (
                <div className="space-y-2">
                  <Label className="text-xs">{t("Membros selecionados ({{n}})", { n: selectedMembers.length })}</Label>
                  <ScrollArea className="h-[240px] rounded-md border">
                    <div className="divide-y">
                      {activeMembers.map((m) => (
                        <label
                          key={m.user_id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selectedMembers.includes(m.user_id)}
                            onCheckedChange={() => toggleMember(m.user_id)}
                          />
                          <div className="flex-1">
                            <div className="text-sm">{m.full_name}</div>
                            <div className="text-xs text-muted-foreground">{m.email}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {distributionMode === "single_user" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Comercial responsável")}</Label>
                  <Select value={singleUserId} onValueChange={setSingleUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("Selecionar comercial...")} />
                    </SelectTrigger>
                    <SelectContent>
                      {activeMembers.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-4 md:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                  {t("Voltar")}
                </Button>
              )}
              {step === 1 && (
                <Button onClick={() => setStep(2)} disabled={!canGoStep2}>
                  {t("Continuar")}
                </Button>
              )}
              {step === 2 && (
                <Button onClick={() => setStep(3)} disabled={!canGoStep3}>
                  {t("Continuar")}
                </Button>
              )}
              {step === 3 && (
                <Button
                  onClick={handleImport}
                  disabled={!distributionReady || !selectedStageKey || importMutation.isPending}
                >
                  {importMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("Importar {{n}} leads", { n: rows.length })}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
