import { useState } from "react";
import { Package, Plus, Edit, Trash2, Image, Eye, EyeOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { useEcommerceProducts, useUpdateEcommerceProduct, useDeleteEcommerceProduct } from "@/hooks/ecommerce";
import { formatCurrency } from "@/lib/format";
import { EcommerceProduct } from "@/types/ecommerce";
import { CreateProductModal } from "./CreateProductModal";
import { EditProductModal } from "./EditProductModal";
import { ProductImagesModal } from "./ProductImagesModal";
import { ProductVariantsModal } from "./ProductVariantsModal";
import { useLanguage } from "@/i18n";

export function ProductsTable() {
  const { data: products, isLoading } = useEcommerceProducts();
  const updateProduct = useUpdateEcommerceProduct();
  const deleteProduct = useDeleteEcommerceProduct();
  const { t } = useLanguage();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<EcommerceProduct | null>(null);
  const [imagesProduct, setImagesProduct] = useState<EcommerceProduct | null>(null);
  const [variantsProduct, setVariantsProduct] = useState<EcommerceProduct | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleToggleActive = (product: EcommerceProduct) => {
    updateProduct.mutate({
      id: product.id,
      is_active: !product.is_active,
    });
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteProduct.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t((products?.length || 0) === 1 ? "{{n}} produto" : "{{n}} produtos", { n: products?.length || 0 })}
        </p>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t("Novo Produto")}
        </Button>
      </div>

      {products?.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <Package className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">{t("Sem produtos")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Crie o seu primeiro produto para começar a vender.")}
          </p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4">
            <Plus className="mr-2 h-4 w-4" />
            {t("Criar Produto")}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Produto")}</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>{t("Preço")}</TableHead>
                <TableHead>{t("Stock")}</TableHead>
                <TableHead>{t("Ativo")}</TableHead>
                <TableHead className="text-right">{t("Ações")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products?.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{product.name}</div>
                        {product.short_description && (
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {product.short_description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {product.sku ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {product.sku}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {product.price ? (
                      <div>
                        <div className="font-medium">
                          {formatCurrency(product.price)}
                        </div>
                        {product.compare_at_price && (
                          <div className="text-sm text-muted-foreground line-through">
                            {formatCurrency(product.compare_at_price)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {product.track_inventory ? (
                      <Badge 
                        variant={
                          (product.stock_quantity ?? 0) <= (product.low_stock_threshold ?? 5)
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {product.stock_quantity ?? 0}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("Ilimitado")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={product.is_active ?? false}
                      onCheckedChange={() => handleToggleActive(product)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setImagesProduct(product)}
                        title={t("Imagens")}
                      >
                        <Image className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setVariantsProduct(product)}
                        title={t("Variantes")}
                      >
                        <Package className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditProduct(product)}
                        title={t("Editar")}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(product.id)}
                        title={t("Eliminar")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modals */}
      <CreateProductModal open={createOpen} onOpenChange={setCreateOpen} />
      
      {editProduct && (
        <EditProductModal
          product={editProduct}
          open={!!editProduct}
          onOpenChange={(open) => !open && setEditProduct(null)}
        />
      )}
      
      {imagesProduct && (
        <ProductImagesModal
          product={imagesProduct}
          open={!!imagesProduct}
          onOpenChange={(open) => !open && setImagesProduct(null)}
        />
      )}
      
      {variantsProduct && (
        <ProductVariantsModal
          product={variantsProduct}
          open={!!variantsProduct}
          onOpenChange={(open) => !open && setVariantsProduct(null)}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar Produto")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tem a certeza que deseja eliminar este produto? Esta ação não pode ser revertida.")}
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
    </div>
  );
}
