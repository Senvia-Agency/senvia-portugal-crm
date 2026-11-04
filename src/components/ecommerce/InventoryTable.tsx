import { useState } from "react";
import { Package, AlertTriangle, Plus, Minus, RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEcommerceProducts, useLowStockProducts } from "@/hooks/ecommerce";
import { useAdjustStock } from "@/hooks/ecommerce";
import { EcommerceProduct } from "@/types/ecommerce";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/i18n";

export function InventoryTable() {
  const { data: allProducts, isLoading } = useEcommerceProducts();
  const { t } = useLanguage();
  const { data: lowStockProducts } = useLowStockProducts();
  const adjustStock = useAdjustStock();
  
  const [adjustProduct, setAdjustProduct] = useState<EcommerceProduct | null>(null);
  const [newQuantity, setNewQuantity] = useState<number>(0);
  const [notes, setNotes] = useState("");

  // Filter only products that track inventory
  const inventoryProducts = allProducts?.filter((p) => p.track_inventory);

  const handleAdjust = (product: EcommerceProduct) => {
    setAdjustProduct(product);
    setNewQuantity(product.stock_quantity ?? 0);
    setNotes("");
  };

  const submitAdjustment = () => {
    if (!adjustProduct) return;
    
    adjustStock.mutate(
      {
        productId: adjustProduct.id,
        newQuantity,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          setAdjustProduct(null);
          setNewQuantity(0);
          setNotes("");
        },
      }
    );
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

  const renderProductsTable = (products: EcommerceProduct[] | undefined) => {
    if (!products?.length) {
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <Package className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">{t("Sem produtos")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Não há produtos com controlo de inventário.")}
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Produto")}</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>{t("Em Stock")}</TableHead>
              <TableHead>{t("Alerta")}</TableHead>
              <TableHead>{t("Estado")}</TableHead>
              <TableHead className="text-right">{t("Ações")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const isLowStock = (product.stock_quantity ?? 0) <= (product.low_stock_threshold ?? 5);
              const isOutOfStock = (product.stock_quantity ?? 0) === 0;
              
              return (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="font-medium">{product.name}</div>
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
                    <span className={`text-lg font-bold ${isLowStock ? "text-amber-500" : ""} ${isOutOfStock ? "text-destructive" : ""}`}>
                      {product.stock_quantity ?? 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{product.low_stock_threshold ?? 5}</Badge>
                  </TableCell>
                  <TableCell>
                    {isOutOfStock ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {t("Esgotado")}
                      </Badge>
                    ) : isLowStock ? (
                      <Badge className="gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20" variant="outline">
                        <AlertTriangle className="h-3 w-3" />
                        {t("Stock Baixo")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                        OK
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAdjust(product)}
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      {t("Ajustar")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            {t("Todos ({{n}})", { n: inventoryProducts?.length || 0 })}
          </TabsTrigger>
          <TabsTrigger value="low" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {t("Stock Baixo ({{n}})", { n: lowStockProducts?.length || 0 })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {renderProductsTable(inventoryProducts)}
        </TabsContent>

        <TabsContent value="low" className="mt-4">
          {renderProductsTable(lowStockProducts)}
        </TabsContent>
      </Tabs>

      {/* Adjust Stock Modal */}
      <Dialog open={!!adjustProduct} onOpenChange={(open) => !open && setAdjustProduct(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("Ajustar Stock")}</DialogTitle>
          </DialogHeader>
          
          {adjustProduct && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3">
                <p className="font-medium">{adjustProduct.name}</p>
                {adjustProduct.sku && (
                  <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                    {adjustProduct.sku}
                  </code>
                )}
              </div>
              
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setNewQuantity(Math.max(0, newQuantity - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                
                <Input
                  type="number"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 text-center text-2xl font-bold"
                />
                
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setNewQuantity(newQuantity + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="text-center text-sm text-muted-foreground">
                {t("Stock atual: {{n}}", { n: adjustProduct.stock_quantity ?? 0 })}
                {newQuantity !== (adjustProduct.stock_quantity ?? 0) && (
                  <span className={newQuantity > (adjustProduct.stock_quantity ?? 0) ? "text-green-600" : "text-red-600"}>
                    {" "}→ {newQuantity} ({newQuantity > (adjustProduct.stock_quantity ?? 0) ? "+" : ""}{newQuantity - (adjustProduct.stock_quantity ?? 0)})
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t("Notas (opcional)")}</Label>
                <Textarea
                  placeholder={t("Motivo do ajuste...")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAdjustProduct(null)}>
                  {t("Cancelar")}
                </Button>
                <Button onClick={submitAdjustment} disabled={adjustStock.isPending}>
                  {adjustStock.isPending ? t("A guardar...") : t("Confirmar")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
