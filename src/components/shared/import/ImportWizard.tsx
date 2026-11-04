import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { ImportStep1Upload } from '@/components/marketing/import/ImportStep1Upload';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { autoMapColumns } from '@/lib/import/parse';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

export interface ImportField {
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
  /** Headers this field is recognised by, so most files map themselves. */
  readonly aliases: readonly string[];
  readonly hint?: string;
}

/** One file line once read: what it becomes, or why it cannot. */
export interface ImportPlanRow<T> {
  /** The spreadsheet line, header being line 1. */
  readonly line: number;
  /** How the line is named in the check list, e.g. the client's name. */
  readonly label: string;
  readonly detail?: string;
  readonly data: T | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportRunResult {
  readonly inserted: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

export type ImportRecord = Record<string, string>;

interface ImportWizardProps<T> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  /** "clientes", "vendas"… */
  readonly noun: string;
  /** "cliente", "venda"… for a count of one. */
  readonly nounOne: string;
  readonly fields: readonly ImportField[];
  /** Choices that apply to every line (default seller, state…), shown under the columns. */
  readonly settings?: ReactNode;
  /** Changes when a setting changes, so the check runs again. */
  readonly settingsKey?: string;
  /** Reads every line into what it becomes, finding clients and people it refers to. */
  readonly plan: (records: ImportRecord[]) => Promise<ImportPlanRow<T>[]>;
  readonly run: (rows: T[], onProgress: (done: number, total: number) => void) => Promise<ImportRunResult>;
}

type Step = 1 | 2 | 3;
const NONE = '__none__';
const STEPS: readonly [Step, string][] = [[1, 'Ficheiro'], [2, 'Colunas'], [3, 'Verificar']];

/** File → columns → check every line → import the good ones. Shared by clients, proposals and sales. */
export function ImportWizard<T>({ open, onOpenChange, title, description, noun, nounOne, fields, settings, settingsKey, plan, run }: ImportWizardProps<T>) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [planned, setPlanned] = useState<ImportPlanRow<T>[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);

  useEffect(() => {
    if (open) return;
    setStep(1); setFileName(''); setHeaders([]); setRows([]); setMapping({});
    setPlanned(null); setPlanError(null); setProgress(null); setResult(null);
  }, [open]);

  const records = useMemo<ImportRecord[]>(() => rows.map((row) => {
    const record: ImportRecord = {};
    for (const field of fields) {
      const column = mapping[field.key];
      record[field.key] = column ? String(row[column] ?? '').trim() : '';
    }
    return record;
  }), [rows, mapping, fields]);

  // Every time the check step opens, or a setting changes there, read the lines again.
  useEffect(() => {
    if (step !== 3 || result) return;
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    plan(records)
      .then((next) => { if (!cancelled) setPlanned(next); })
      .catch((error: unknown) => { if (!cancelled) setPlanError(error instanceof Error ? error.message : t('Não foi possível verificar o ficheiro.')); })
      .finally(() => { if (!cancelled) setPlanning(false); });
    return () => { cancelled = true; };
    // plan is rebuilt by the parent on every render; settingsKey says when its inputs changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, records, settingsKey, result]);

  const missingRequired = fields.filter((field) => field.required && !mapping[field.key]);
  const valid = planned?.filter((row) => row.data && row.errors.length === 0) ?? [];
  const invalid = planned?.filter((row) => !row.data || row.errors.length > 0) ?? [];
  const withWarnings = valid.filter((row) => row.warnings.length > 0);
  const running = progress !== null && !result;

  const handleFile = (name: string, nextHeaders: string[], nextRows: Record<string, string>[]) => {
    setFileName(name);
    setHeaders(nextHeaders);
    setRows(nextRows);
    setMapping(autoMapColumns(fields, nextHeaders));
    setPlanned(null);
  };

  const handleRun = async () => {
    const data = valid.map((row) => row.data as T);
    setProgress({ done: 0, total: data.length });
    try {
      setResult(await run(data, (done, total) => setProgress({ done, total })));
    } catch (error) {
      setResult({ inserted: 0, failed: data.length, errors: [error instanceof Error ? error.message : t('Erro ao importar.')] });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next); }}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-4 md:px-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          <ol className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            {STEPS.map(([key, label], index) => (
              <li key={key} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden>›</span>}
                <span className={cn(step === key && 'font-semibold text-foreground')}>{key}. {t(label)}</span>
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {step === 1 && (
            <ImportStep1Upload fileName={fileName} headers={headers} rows={rows}
              onFileLoaded={handleFile} onClearFile={() => { setFileName(''); setHeaders([]); setRows([]); setMapping({}); }} />
          )}

          {step === 2 && (
            <div className="mx-auto max-w-4xl space-y-6">
              <p className="text-sm text-muted-foreground">
                {t("Diz de que coluna do ficheiro vem cada campo. Os campos com")} <span className="text-destructive">*</span> {t("são obrigatórios.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {t(field.label)}{field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Select value={mapping[field.key] || NONE}
                      onValueChange={(value) => setMapping((current) => ({ ...current, [field.key]: value === NONE ? '' : value }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("— não importar —")}</SelectItem>
                        {headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {field.hint && <p className="text-[11px] text-muted-foreground">{t(field.hint)}</p>}
                  </div>
                ))}
              </div>
              {settings && <div className="space-y-3 border-t pt-5">{settings}</div>}
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto max-w-5xl space-y-4">
              {result ? (
                <div className={cn('rounded-lg border px-4 py-3 text-sm', result.failed ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10')}>
                  <p className="font-semibold">
                    {t("Importação concluída: {{n}} {{noun}}", { n: result.inserted, noun: t(result.inserted === 1 ? nounOne : noun) })}
                    {result.failed > 0 && ` · ${t("{{n}} falharam", { n: result.failed })}`}
                  </p>
                  {result.errors.slice(0, 5).map((error) => <p key={error} className="mt-1 text-xs text-muted-foreground">{error}</p>)}
                </div>
              ) : planning ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("A verificar {{n}} linhas…", { n: rows.length })}</p>
              ) : planError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{planError}</p>
              ) : planned && (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />{t(valid.length === 1 ? '{{n}} linha pronta a importar' : '{{n}} linhas prontas a importar', { n: valid.length })}
                    </span>
                    {withWarnings.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-4 w-4" />{t("{{n}} com avisos", { n: withWarnings.length })}
                      </span>
                    )}
                    {invalid.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 font-medium text-destructive">
                        <XCircle className="h-4 w-4" />{t("{{n}} com erros, ficam de fora", { n: invalid.length })}
                      </span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr><th className="w-16 px-3 py-2 font-medium">{t("Linha")}</th><th className="px-3 py-2 font-medium">{t("Registo")}</th><th className="px-3 py-2 font-medium">{t("Verificação")}</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {/* Problems first: they are what needs a look. */}
                        {[...invalid, ...withWarnings, ...valid.filter((row) => row.warnings.length === 0)].slice(0, 500).map((row) => {
                          const bad = !row.data || row.errors.length > 0;
                          return (
                            <tr key={row.line} className={cn(bad && 'bg-destructive/[0.04]')}>
                              <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
                              <td className="px-3 py-2">
                                <p className="font-medium">{row.label || '—'}</p>
                                {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {row.errors.map((error) => <p key={error} className="text-destructive">{error}</p>)}
                                {row.warnings.map((warning) => <p key={warning} className="text-amber-700 dark:text-amber-300">{warning}</p>)}
                                {!bad && row.warnings.length === 0 && <span className="text-emerald-700 dark:text-emerald-300">{t("Pronta")}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {planned.length > 500 && <p className="text-xs text-muted-foreground">{t("A mostrar 500 de {{n}} linhas.", { n: planned.length })}</p>}
                </>
              )}
              {running && progress && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />{t("A importar {{done}} de {{total}}…", { done: progress.done, total: progress.total })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-4 md:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>{result ? t('Fechar') : t('Cancelar')}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {step > 1 && !result && (
                <Button variant="outline" disabled={running} onClick={() => setStep((current) => (current - 1) as Step)}>{t("Voltar")}</Button>
              )}
              {step === 1 && <Button disabled={rows.length === 0} onClick={() => setStep(2)}>{t("Continuar")}</Button>}
              {step === 2 && (
                <Button disabled={missingRequired.length > 0} onClick={() => setStep(3)}
                  title={missingRequired.length ? t('Falta: {{fields}}', { fields: missingRequired.map((field) => t(field.label)).join(', ') }) : undefined}>
                  {t("Verificar linhas")}
                </Button>
              )}
              {step === 3 && !result && (
                <Button disabled={planning || running || valid.length === 0} onClick={() => void handleRun()}>
                  {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("Importar {{n}} {{noun}}", { n: valid.length, noun: t(valid.length === 1 ? nounOne : noun) })}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
