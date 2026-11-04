import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContactLists, useCreateContactList } from "@/hooks/useContactLists";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";

import { ImportStepHeader } from "./import/ImportStepHeader";
import { ImportStep1Upload } from "./import/ImportStep1Upload";
import { ImportStep2Mapping } from "./import/ImportStep2Mapping";
import { ImportStep3List } from "./import/ImportStep3List";
import { ImportStep4Finalize } from "./import/ImportStep4Finalize";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SYSTEM_FIELDS = [
  { key: "name", label: "Nome" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "company", label: "Empresa" },
];

export function ImportContactsModal({ open, onOpenChange }: Props) {
  const { organization } = useAuth();
  const { data: lists = [] } = useContactLists();
  const createList = useCreateContactList();
  const { t } = useLanguage();

  const [activeStep, setActiveStep] = useState(1);
  const [stepsCompleted, setStepsCompleted] = useState([false, false, false, false]);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedListId, setSelectedListId] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [clearEmptyFields, setClearEmptyFields] = useState(false);
  const [optInCertified, setOptInCertified] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; updated: number; duplicates: number; errors: number } | null>(null);

  const reset = () => {
    setActiveStep(1);
    setStepsCompleted([false, false, false, false]);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setSelectedListId("");
    setUpdateExisting(false);
    setClearEmptyFields(false);
    setOptInCertified(false);
    setImporting(false);
    setProgress(0);
    setResult(null);
  };

  const handleClose = () => { reset(); onOpenChange(false); };

  const completeStep = (step: number) => {
    setStepsCompleted(prev => {
      const next = [...prev];
      next[step - 1] = true;
      return next;
    });
    setActiveStep(step + 1);
  };

  const handleFileLoaded = useCallback((name: string, hdrs: string[], data: Record<string, string>[]) => {
    setFileName(name);
    setHeaders(hdrs);
    setRows(data);
    const autoMap: Record<string, string> = {};
    SYSTEM_FIELDS.forEach(f => {
      const match = hdrs.find(h => h.toLowerCase().includes(f.key) || h.toLowerCase().includes(f.label.toLowerCase()));
      if (match) autoMap[f.key] = match;
    });
    setMapping(autoMap);
  }, []);

  const handleClearFile = () => {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setStepsCompleted([false, false, false, false]);
    setActiveStep(1);
  };

  const handleCreateList = async (name: string, description: string) => {
    try {
      const newList = await createList.mutateAsync({ name, description });
      setSelectedListId(newList.id);
      completeStep(3);
    } catch { /* toast handled by hook */ }
  };

  // Import to marketing_contacts (NOT crm_clients)
  const handleImport = async () => {
    if (!organization?.id) return;
    setImporting(true);
    setProgress(0);

    try {
      // Load existing marketing contacts for dedup
      const { data: existingContacts } = await supabase
        .from('marketing_contacts' as any)
        .select('id, email')
        .eq('organization_id', organization.id);

      const emailMap = new Map<string, string>();
      (existingContacts as any[])?.filter((c: any) => c.email).forEach((c: any) => {
        emailMap.set(c.email.toLowerCase(), c.id);
      });

      let imported = 0, updated = 0, duplicates = 0, errors = 0;
      const contactIds: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = mapping.name ? String(row[mapping.name] || "").trim() : "";
          const email = mapping.email ? String(row[mapping.email] || "").trim().toLowerCase() : "";
          const phone = mapping.phone ? String(row[mapping.phone] || "").trim() : "";
          const company = mapping.company ? String(row[mapping.company] || "").trim() : "";

          if (!name) { errors++; continue; }

          let contactId: string;
          if (email && emailMap.has(email)) {
            contactId = emailMap.get(email)!;
            if (updateExisting) {
              const updateData: Record<string, string | null> = {};
              if (name) updateData.name = name;
              if (phone || clearEmptyFields) updateData.phone = phone || null;
              if (company || clearEmptyFields) updateData.company = company || null;
              await supabase.from("marketing_contacts" as any).update(updateData).eq("id", contactId);
              updated++;
            } else {
              duplicates++;
            }
          } else {
            const { data, error } = await supabase
              .from("marketing_contacts" as any)
              .insert({ name, email: email || null, phone: phone || null, company: company || null, organization_id: organization.id, source: "import" })
              .select("id")
              .single();
            if (error) { console.error("Erro ao criar contacto:", error); errors++; continue; }
            contactId = (data as any).id;
            if (email) emailMap.set(email, contactId);
            imported++;
          }
          contactIds.push(contactId);
        } catch (e) { console.error("Erro na linha:", e); errors++; }

        if (i % 20 === 0) setProgress(Math.round(((i + 1) / rows.length) * 80));
      }

      setProgress(90);
      setResult({ imported, updated, duplicates, errors });

      // Add to list via marketing_list_members
      if (contactIds.length > 0) {
        try {
          for (let i = 0; i < contactIds.length; i += 100) {
            const chunk = contactIds.slice(i, i + 100);
            const batchRows = chunk.map(contact_id => ({ list_id: selectedListId, contact_id }));
            const { error } = await supabase
              .from('marketing_list_members' as any)
              .upsert(batchRows, { onConflict: 'list_id,contact_id', ignoreDuplicates: true });
            if (error) throw error;
          }
          toast.success(t("{{n}} contactos adicionados à lista", { n: contactIds.length }));
        } catch (e) {
          console.error("Erro ao associar à lista:", e);
          toast.warning(t("Contactos criados mas houve erro ao associar à lista."));
        }
      }

      setProgress(100);
    } catch (e) {
      console.error("Erro geral:", e);
      toast.error(t("Erro na importação"));
    } finally {
      setImporting(false);
    }
  };

  const canGoToStep = (step: number) => {
    if (step === 1) return true;
    return stepsCompleted[step - 2];
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        <div className="p-6 pb-0 max-w-3xl mx-auto w-full">
          <DialogHeader>
            <DialogTitle className="text-lg">{t("Importar contactos de um ficheiro")}</DialogTitle>
            <DialogDescription>
              {t("Importe contactos de um ficheiro CSV, Excel ou TXT para uma lista de marketing.")}
            </DialogDescription>
          </DialogHeader>
        </div>

        <Separator className="mt-4" />

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="max-w-3xl mx-auto w-full space-y-2">
            <div className="rounded-lg border">
              <ImportStepHeader stepNumber={1} title={t("Carregue o seu ficheiro")} subtitle={t("Selecione um ficheiro com os contactos a importar.")} isCompleted={stepsCompleted[0]} isActive={activeStep === 1} onClick={() => canGoToStep(1) && setActiveStep(1)} />
              {activeStep === 1 && (
                <div className="px-4 pb-4">
                  <ImportStep1Upload fileName={fileName} headers={headers} rows={rows} onFileLoaded={handleFileLoaded} onClearFile={handleClearFile} onConfirm={() => completeStep(1)} />
                </div>
              )}
            </div>

            <div className="rounded-lg border">
              <ImportStepHeader stepNumber={2} title={t("Mapeamento de dados")} subtitle={t("Selecione o atributo de contacto que corresponde aos seus dados.")} isCompleted={stepsCompleted[1]} isActive={activeStep === 2} onClick={() => canGoToStep(2) && setActiveStep(2)} />
              {activeStep === 2 && (
                <div className="px-4 pb-4">
                  <ImportStep2Mapping headers={headers} rows={rows} mapping={mapping} onMappingChange={setMapping} onConfirm={() => completeStep(2)} />
                </div>
              )}
            </div>

            <div className="rounded-lg border">
              <ImportStepHeader stepNumber={3} title={t("Selecionar uma lista")} subtitle={t("Escolha uma lista existente ou crie uma nova.")} isCompleted={stepsCompleted[2]} isActive={activeStep === 3} onClick={() => canGoToStep(3) && setActiveStep(3)} />
              {activeStep === 3 && (
                <div className="px-4 pb-4">
                  <ImportStep3List lists={lists} selectedListId={selectedListId} onSelectList={setSelectedListId} onCreateList={handleCreateList} onConfirm={() => completeStep(3)} isCreating={createList.isPending} />
                </div>
              )}
            </div>

            <div className="rounded-lg border">
              <ImportStepHeader stepNumber={4} title={t("Concluir a importação")} subtitle={t("Reveja as opções e confirme.")} isCompleted={!!result} isActive={activeStep === 4} onClick={() => canGoToStep(4) && setActiveStep(4)} />
              {activeStep === 4 && (
                <div className="px-4 pb-4">
                  <ImportStep4Finalize updateExisting={updateExisting} onUpdateExistingChange={setUpdateExisting} clearEmptyFields={clearEmptyFields} onClearEmptyFieldsChange={setClearEmptyFields} optInCertified={optInCertified} onOptInCertifiedChange={setOptInCertified} importing={importing} progress={progress} result={result} onImport={handleImport} onClose={handleClose} />
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
