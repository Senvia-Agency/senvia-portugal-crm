import { useState } from "react";
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
import { TemplateEditor } from "./TemplateEditor";
import { TemplateAutomationSection } from "./TemplateAutomationSection";
import { useCreateEmailTemplate } from "@/hooks/useEmailTemplates";
import { useEmailTemplateCategories } from "@/hooks/useEmailTemplateCategories";
import { isManualEmailTrigger } from "@/lib/email-template-triggers";

const formSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  subject: z.string().min(1, "Assunto é obrigatório"),
  category_id: z.string().nullable().default(null),
  html_content: z.string().default(""),
});

type FormData = z.infer<typeof formSchema>;

interface CreateTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTemplateModal({ open, onOpenChange }: CreateTemplateModalProps) {
  const createTemplate = useCreateEmailTemplate();

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
    },
  });

  const onSubmit = async (data: FormData) => {
    const triggerConfig: Record<string, string> = {};
    if (automationEnabled && triggerType) {
      if (fromStatus && fromStatus !== 'any') triggerConfig.from_status = fromStatus;
      if (toStatus) triggerConfig.to_status = toStatus;
    }

    await createTemplate.mutateAsync({
      name: data.name,
      subject: data.subject,
      category_id: data.category_id,
      html_content: data.html_content,
      automation_enabled: automationEnabled && !isManualEmailTrigger(triggerType),
      automation_trigger_type: automationEnabled ? triggerType : null,
      automation_trigger_config: triggerConfig,
      automation_delay_minutes: delayMinutes,
    });
    form.reset();
    setAutomationEnabled(false);
    setTriggerType('');
    setFromStatus('');
    setToStatus('');
    setDelayMinutes(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90dvh] overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle>Novo Template de Email</DialogTitle>
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
                      <Input placeholder="Ex: Boas-vindas ao Cliente" {...field} />
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

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assunto do Email</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Bem-vindo à {{organizacao}}!" {...field} />
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
              <Button type="submit" disabled={createTemplate.isPending}>
                {createTemplate.isPending ? "A criar..." : "Criar Template"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
