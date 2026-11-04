import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Edit } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EcommerceProduct, ProductVariant } from "@/types/ecommerce";
import {
  useProductVariants,
  useCreateVariant,
  useUpdateVariant,
  useDeleteVariant,
} from "@/hooks/ecommerce";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/i18n";

const variantSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  sku: z.string().optional(),
  price: z.coerce.number().min(0, "Preço deve ser positivo"),
  compare_at_price: z.coerce.number().min(0).optional(),
  stock_quantity: z.coerce.number().min(0).default(0),
  low_stock_threshold: z.coerce.number().min(0).default(5),
  is_active: z.boolean().default(true),
});

type VariantFormData = z.infer<typeof variantSchema>;

interface ProductVariantsModalProps {
  product: EcommerceProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductVariantsModal({ product, open, onOpenChange }: ProductVariantsModalProps) {
  const { data: variants, isLoading } = useProductVariants(product.id);
  const { t } = useLanguage();
  const createVariant = useCreateVariant();
  const updateVariant = useUpdateVariant();
  const deleteVariant = useDeleteVariant();
  
  const [showForm, setShowForm] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const form = useForm<VariantFormData>({
    resolver: zodResolver(variantSchema),
    defaultValues: {
      name: "",
      sku: "",
      price: product.price ?? 0,
      compare_at_price: undefined,
      stock_quantity: 0,
      low_stock_threshold: 5,
      is_active: true,
    },
  });

  const handleEdit = (variant: ProductVariant) => {
    setEditingVariant(variant);
    form.reset({
      name: variant.name,
      sku: variant.sku || "",
      price: variant.price,
      compare_at_price: variant.compare_at_price ?? undefined,
      stock_quantity: variant.stock_quantity ?? 0,
      low_stock_threshold: variant.low_stock_threshold ?? 5,
      is_active: variant.is_active ?? true,
    });
    setShowForm(true);
  };

  const handleCreate = () => {
    setEditingVariant(null);
    form.reset({
      name: "",
      sku: "",
      price: product.price ?? 0,
      compare_at_price: undefined,
      stock_quantity: 0,
      low_stock_threshold: 5,
      is_active: true,
    });
    setShowForm(true);
  };

  const onSubmit = (data: VariantFormData) => {
    if (editingVariant) {
      updateVariant.mutate(
        { id: editingVariant.id, ...data },
        {
          onSuccess: () => {
            setShowForm(false);
            setEditingVariant(null);
          },
        }
      );
    } else {
      createVariant.mutate(
        {
          product_id: product.id,
          name: data.name,
          price: data.price,
          sku: data.sku,
          compare_at_price: data.compare_at_price,
          stock_quantity: data.stock_quantity,
          low_stock_threshold: data.low_stock_threshold,
          is_active: data.is_active,
        },
        {
          onSuccess: () => {
            setShowForm(false);
          },
        }
      );
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteVariant.mutate({ variantId: deleteId, productId: product.id });
      setDeleteId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Variantes - {{name}}", { name: product.name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!showForm ? (
            <>
              <div className="flex justify-end">
                <Button onClick={handleCreate} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("Nova Variante")}
                </Button>
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : variants?.length === 0 ? (
                <div className="flex min-h-[150px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("Sem variantes. Crie variantes para oferecer diferentes opções (tamanhos, cores, etc.)")}
                  </p>
                  <Button onClick={handleCreate} className="mt-4" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("Criar Variante")}
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Nome")}</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t("Preço")}</TableHead>
                        <TableHead>{t("Stock")}</TableHead>
                        <TableHead>{t("Ativo")}</TableHead>
                        <TableHead className="text-right">{t("Ações")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {variants?.map((variant) => (
                        <TableRow key={variant.id}>
                          <TableCell className="font-medium">{variant.name}</TableCell>
                          <TableCell>
                            {variant.sku ? (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {variant.sku}
                              </code>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{formatCurrency(variant.price)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                (variant.stock_quantity ?? 0) <= (variant.low_stock_threshold ?? 5)
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {variant.stock_quantity ?? 0}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant.is_active ? "default" : "secondary"}>
                              {variant.is_active ? t("Sim") : t("Não")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(variant)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(variant.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Nome da Variante *")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("Ex: Tamanho M - Azul")} {...field} />
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
                          <Input placeholder="PROD-001-M-AZ" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Preço (€) *")}</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="stock_quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Stock")}</FormLabel>
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
                        <FormLabel>{t("Alerta Stock Baixo")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="is_active"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>{t("Variante Ativa")}</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false);
                      setEditingVariant(null);
                    }}
                  >
                    {t("Cancelar")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createVariant.isPending || updateVariant.isPending}
                  >
                    {editingVariant ? t("Guardar") : t("Criar Variante")}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </div>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Eliminar Variante")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Tem a certeza que deseja eliminar esta variante?")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                {t("Eliminar")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
