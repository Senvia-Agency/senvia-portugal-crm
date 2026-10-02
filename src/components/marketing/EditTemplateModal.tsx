import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateAutomationSection } from "./TemplateAutomationSection";
import { useUpdateEmailTemplate } from "@/hooks/useEmailTemplates";
import { useEmailTemplateCategories } from "@/hooks/useEmailTemplateCategories";
import type { EmailTemplate } from "@/types/marketing";
import { isManualEmailTrigger } from "@/lib/email-template-triggers";
import { FileText, Save } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  subject: z.string().min(1, "Assunto é obrigatório"),
  category_id: z.string().nullable(),
  html_content: z.string(),
  is_active: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface EditTemplateModalProps {
  template: EmailTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditTemplateModal({ template, open, onOpenChange }: EditTemplateModalProps) {
  const updateTemplate = useUpdateEmailTemplate();

  // Automation state
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [triggerType, setTriggerType] = useState('');
  const [fromStatus, setFromStatus] = useState('');
  const [toStatus, setToStatus] = useState('');
  const [delayMinutes, setDelayMinutes] = useState(0);

  const { data: categories } = useEmailTemplateCategories();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      subject: "",
      category_id: null,
      html_content: "",
      is_active: true,
    },
  });
  const hasUnsavedChanges = form.formState.isDirty;

  // Reset form when template changes
  useEffect(() => {
    if (template) {
      form.reset({
        name: template.name,
        subject: template.subject,
        category_id: template.category_id ?? null,
        html_content: template.html_content,
        is_active: template.is_active,
      });
      setAutomationEnabled(Boolean(template.automation_enabled) || isManualEmailTrigger(template.automation_trigger_type ?? ''));
      setTriggerType(template.automation_trigger_type ?? '');
      const config = (template.automation_trigger_config as Record<string, string>) ?? {};
      setFromStatus(config.from_status ?? '');
      setToStatus(config.to_status ?? '');
      setDelayMinutes(template.automation_delay_minutes ?? 0);
    }
  }, [template, form]);

  const onSubmit = async (data: FormData) => {
    if (!template) return;

    const triggerConfig: Record<string, string> = {};
    if (automationEnabled && triggerType) {
      if (fromStatus && fromStatus !== 'any') triggerConfig.from_status = fromStatus;
      if (toStatus) triggerConfig.to_status = toStatus;
    }

    await updateTemplate.mutateAsync({
      id: template.id,
      name: data.name,
      subject: data.subject,
      category_id: data.category_id,
      html_content: data.html_content,
      is_active: data.is_active,
      automation_enabled: automationEnabled && !isManualEmailTrigger(triggerType),
      automation_trigger_type: automationEnabled ? triggerType : null,
      automation_trigger_config: triggerConfig,
      automation_delay_minutes: delayMinutes,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b bg-background px-5 py-4 pr-14 md:px-8">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
              <FileText className="h-3.5 w-3.5" /> Editor de email
            </div>
            <DialogTitle className="truncate text-xl">Editar template</DialogTitle>
            <DialogDescription className="mt-1 truncate">{template?.name || 'Configure o conteúdo, a apresentação e a automação.'}</DialogDescription>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <span className={hasUnsavedChanges ? "h-2 w-2 rounded-full bg-warning" : "h-2 w-2 rounded-full bg-success"} />
            {hasUnsavedChanges ? 'Alterações não guardadas' : 'Tudo guardado'}
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="grid shrink-0 gap-4 border-b bg-muted/20 px-5 py-5 md:grid-cols-[minmax(0,1fr)_16rem] md:px-8">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do Template</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "__none__" ? null : value)}
                      value={field.value ?? "__none__"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem categoria" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sem categoria</SelectItem>
                        {(categories ?? []).map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!categories?.length && (
                      <p className="text-xs text-muted-foreground">
                        Ainda não há categorias. Crie-as em Definições, Categorias de Templates.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <main className="min-h-0 overflow-y-auto px-5 py-6 md:px-8">
                <div className="mx-auto max-w-6xl space-y-6">
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assunto do email</FormLabel>
                        <FormControl>
                          <Input className="h-11 text-base" {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Personaliza o assunto com variáveis, por exemplo: <code className="rounded bg-muted px-1 py-0.5">{'{{nome}}'}</code>.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="html_content"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <FormLabel className="text-base">Conteúdo do email</FormLabel>
                            <p className="mt-1 text-sm text-muted-foreground">Escreve, edita HTML e confirma o resultado antes de guardar.</p>
                          </div>
                        </div>
                        <FormControl>
                          <TemplateEditor workspace value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </main>
              <aside className="border-t bg-muted/20 p-5 xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0 md:p-6">
                <div className="mx-auto max-w-md space-y-5">
                  <FormField
                    control={form.control}
                    name="is_active"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4 rounded-xl border bg-background p-4">
                        <div>
                          <FormLabel className="text-sm font-semibold">Template ativo</FormLabel>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Fica disponível para envio e automações.</p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <TemplateAutomationSection
                    enabled={automationEnabled}
                    onEnabledChange={setAutomationEnabled}
                    triggerType={triggerType}
                    onTriggerTypeChange={setTriggerType}
                    fromStatus={fromStatus}
                    onFromStatusChange={setFromStatus}
                    toStatus={toStatus}
                    onToStatusChange={setToStatus}
                    delayMinutes={delayMinutes}
                    onDelayMinutesChange={setDelayMinutes}
                  />
                </div>
              </aside>
            </div>

            <footer className="flex shrink-0 flex-col-reverse gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:items-center sm:justify-end md:px-8">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateTemplate.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {updateTemplate.isPending ? "A guardar..." : "Guardar alterações"}
              </Button>
            </footer>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
