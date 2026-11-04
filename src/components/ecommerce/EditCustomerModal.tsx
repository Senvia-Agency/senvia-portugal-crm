import { useEffect } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUpdateCustomer } from "@/hooks/ecommerce";
import { Customer } from "@/types/ecommerce";
import { useLanguage } from "@/i18n";

const formSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  phone: z.string().optional(),
  notes: z.string().optional(),
  accepts_marketing: z.boolean().default(false),
});

type FormData = z.infer<typeof formSchema>;

interface EditCustomerModalProps {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCustomerModal({ customer, open, onOpenChange }: EditCustomerModalProps) {
  const updateCustomer = useUpdateCustomer();
  const { t } = useLanguage();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      notes: customer.notes || "",
      accepts_marketing: customer.accepts_marketing ?? false,
    },
  });

  useEffect(() => {
    form.reset({
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      notes: customer.notes || "",
      accepts_marketing: customer.accepts_marketing ?? false,
    });
  }, [customer, form]);

  const onSubmit = (data: FormData) => {
    updateCustomer.mutate(
      { id: customer.id, ...data },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("Editar Cliente")}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Nome *")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("Nome completo")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email *</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="email@exemplo.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Telefone")}</FormLabel>
                  <FormControl>
                    <Input placeholder="+351 912 345 678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Notas")}</FormLabel>
                  <FormControl>
                    <Textarea placeholder={t("Notas sobre o cliente...")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accepts_marketing"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>{t("Aceita Marketing")}</FormLabel>
                    <FormDescription>{t("Receber emails e promoções")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={updateCustomer.isPending}>
                {updateCustomer.isPending ? t("A guardar...") : t("Guardar Alterações")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
