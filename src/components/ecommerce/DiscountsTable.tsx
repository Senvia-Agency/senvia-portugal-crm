import { useState } from "react";
import { format } from "date-fns";
import { Plus, Trash2, Percent, DollarSign, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDiscountCodes, useCreateDiscountCode, useUpdateDiscountCode, useDeleteDiscountCode } from "@/hooks/ecommerce/useDiscountCodes";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { useLanguage, dateLocale } from "@/i18n";

export function DiscountsTable() {
  const { data: discounts, isLoading } = useDiscountCodes();
  const { t } = useLanguage();
  const createMutation = useCreateDiscountCode();
  const updateMutation = useUpdateDiscountCode();
  const deleteMutation = useDeleteDiscountCode();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    type: "percentage" as "percentage" | "fixed_amount",
    value: "",
    min_purchase: "",
    max_uses: "",
    expires_at: "",
  });

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(t("Código copiado!"));
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await updateMutation.mutateAsync({ id, is_active: isActive });
  };

  const handleCreate = async () => {
    if (!formData.code || !formData.value) {
      toast.error(t("Preencha o código e o valor"));
      return;
    }

    await createMutation.mutateAsync({
      code: formData.code.toUpperCase(),
      type: formData.type as "percentage" | "fixed_amount" | "free_shipping",
      value: parseFloat(formData.value),
      min_purchase: formData.min_purchase ? parseFloat(formData.min_purchase) : undefined,
      max_uses: formData.max_uses ? parseInt(formData.max_uses) : undefined,
      expires_at: formData.expires_at || undefined,
    });

    setCreateOpen(false);
    setFormData({
      code: "",
      type: "percentage",
      value: "",
      min_purchase: "",
      max_uses: "",
      expires_at: "",
    });
  };

  const handleDelete = async () => {
    if (deleteId) {
      await deleteMutation.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground">
                {t((discounts?.length || 0) === 1 ? "{{n}} código de desconto" : "{{n}} códigos de desconto", { n: discounts?.length || 0 })}
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("Novo Código")}
            </Button>
          </div>

          {!discounts?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Percent className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg">{t("Sem códigos de desconto")}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("Crie o primeiro código de desconto")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 md:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Código")}</TableHead>
                    <TableHead>{t("Tipo")}</TableHead>
                    <TableHead>{t("Valor")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Mín. Compra")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Usos")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Expira")}</TableHead>
                    <TableHead>{t("Ativo")}</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discounts.map((discount) => (
                    <TableRow key={discount.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                            {discount.code}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleCopyCode(discount.code)}
                          >
                            {copiedCode === discount.code ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {discount.type === "percentage" ? (
                            <><Percent className="h-3 w-3 mr-1" /> {t("Percentagem")}</>
                          ) : discount.type === "fixed_amount" ? (
                            <><DollarSign className="h-3 w-3 mr-1" /> {t("Fixo")}</>
                          ) : (
                            <>{t("Envio Grátis")}</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {discount.type === "percentage"
                          ? `${discount.value}%`
                          : formatCurrency(discount.value)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {discount.min_purchase
                          ? formatCurrency(discount.min_purchase)
                          : "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {discount.uses_count || 0}
                        {discount.max_uses && ` / ${discount.max_uses}`}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {discount.expires_at
                          ? format(new Date(discount.expires_at), "dd MMM yyyy", { locale: dateLocale() })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={discount.is_active ?? true}
                          onCheckedChange={(checked) => handleToggleActive(discount.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(discount.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Novo Código de Desconto")}</DialogTitle>
            <DialogDescription>{t("Crie um código promocional para os seus clientes")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("Código *")}</Label>
              <Input
                placeholder="PROMO20"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Tipo *")}</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: string) =>
                    setFormData({ ...formData, type: value as "percentage" | "fixed_amount" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">{t("Percentagem")}</SelectItem>
                    <SelectItem value="fixed_amount">{t("Valor Fixo")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("Valor *")}</Label>
                <Input
                  type="number"
                  placeholder={formData.type === "percentage" ? "20" : "10.00"}
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Compra Mínima")}</Label>
                <Input
                  type="number"
                  placeholder="50.00"
                  value={formData.min_purchase}
                  onChange={(e) => setFormData({ ...formData, min_purchase: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("Máx. Usos")}</Label>
                <Input
                  type="number"
                  placeholder="100"
                  value={formData.max_uses}
                  onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("Data de Expiração")}</Label>
              <Input
                type="date"
                value={formData.expires_at}
                onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("Cancelar")}
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? t("A criar...") : t("Criar Código")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar código de desconto?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Esta ação não pode ser revertida. O código deixará de funcionar imediatamente.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
