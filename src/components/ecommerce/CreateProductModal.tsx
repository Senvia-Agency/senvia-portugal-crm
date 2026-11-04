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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateEcommerceProduct } from "@/hooks/ecommerce";
import { useActiveCategories } from "@/hooks/ecommerce";
import { useLanguage } from "@/i18n";

const formSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  short_description: z.string().optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  slug: z.string().optional(),
  price: z.coerce.number().min(0).optional(),
  compare_at_price: z.coerce.number().min(0).optional(),
  category_id: z.string().optional(),
  track_inventory: z.boolean().default(true),
  stock_quantity: z.coerce.number().min(0).default(0),
  low_stock_threshold: z.coerce.number().min(0).default(5),
  is_digital: z.boolean().default(false),
  requires_shipping: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

type FormData = z.infer<typeof formSchema>;

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProductModal({ open, onOpenChange }: CreateProductModalProps) {
  const createProduct = useCreateEcommerceProduct();
  const { t } = useLanguage();
  const { data: categories } = useActiveCategories();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      short_description: "",
      description: "",
      sku: "",
      slug: "",
      price: undefined,
      compare_at_price: undefined,
      category_id: "",
      track_inventory: true,
      stock_quantity: 0,
      low_stock_threshold: 5,
      is_digital: false,
      requires_shipping: true,
      is_active: true,
    },
  });

  const onSubmit = (data: FormData) => {
    createProduct.mutate(
      {
        name: data.name,
        short_description: data.short_description,
        description: data.description,
        sku: data.sku,
        slug: data.slug,
        price: data.price,
        compare_at_price: data.compare_at_price,
        category_id: data.category_id || undefined,
        track_inventory: data.track_inventory,
        stock_quantity: data.stock_quantity,
        low_stock_threshold: data.low_stock_threshold,
        is_digital: data.is_digital,
        requires_shipping: data.requires_shipping,
        is_active: data.is_active,
      },
      {
        onSuccess: () => {
          form.reset();
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Novo Produto")}</DialogTitle>
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
                    <Input placeholder={t("Nome do produto")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input placeholder="PROD-001" {...field} />
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
                    <FormLabel>{t("Categoria")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("Selecionar categoria")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories?.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
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
              name="short_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Descrição Curta")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("Breve descrição")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Descrição Completa")}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t("Descrição detalhada do produto")}
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Preço (€)")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="compare_at_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Preço Comparativo (€)")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormDescription>{t("Preço original (para mostrar desconto)")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="font-medium">{t("Inventário")}</h4>
              
              <FormField
                control={form.control}
                name="track_inventory"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>{t("Controlar Stock")}</FormLabel>
                      <FormDescription>{t("Monitorizar quantidade disponível")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch("track_inventory") && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="stock_quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Quantidade em Stock")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="low_stock_threshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Alerta de Stock Baixo")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="font-medium">{t("Opções")}</h4>
              
              <FormField
                control={form.control}
                name="is_digital"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>{t("Produto Digital")}</FormLabel>
                      <FormDescription>{t("Não requer envio físico")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>{t("Ativo")}</FormLabel>
                      <FormDescription>{t("Disponível para venda")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={createProduct.isPending}>
                {createProduct.isPending ? t("A criar...") : t("Criar Produto")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
