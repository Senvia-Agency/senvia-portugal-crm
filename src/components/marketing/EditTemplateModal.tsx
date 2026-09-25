import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
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
import { TEMPLATE_CATEGORIES, type EmailTemplate, type EmailTemplateCategory } from "@/types/marketing";
import { isManualEmailTrigger } from "@/lib/email-template-triggers";

const formSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  subject: z.string().min(1, "Assunto é obrigatório"),
  category: z.string(),
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

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      subject: "",
      category: "general",
      html_content: "",
      is_active: true,
    },
  });

  // Reset form when template changes
  useEffect(() => {
    if (template) {
      form.reset({
        name: template.name,
        subject: template.subject,
        category: template.category,
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
      category: data.category as EmailTemplateCategory,
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
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90dvh] overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle>Editar Template</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
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
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(TEMPLATE_CATEGORIES).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assunto do Email</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="html_content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Conteúdo do Email</FormLabel>
                  <FormControl>
                    <TemplateEditor value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <FormLabel className="text-base">Template Ativo</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Templates inativos não aparecem nas opções de envio
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Automation Section */}
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

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateTemplate.isPending}>
                {updateTemplate.isPending ? "A guardar..." : "Guardar Alterações"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
