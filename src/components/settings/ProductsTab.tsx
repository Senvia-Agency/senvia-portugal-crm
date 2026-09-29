import { useState } from 'react';
import { Plus, Pencil, Trash2, Package, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useProducts, useDeleteProduct } from '@/hooks/useProducts';
import { useSyncInvoiceXpressItems } from '@/hooks/useSyncInvoiceXpressItems';
import { useAuth } from '@/contexts/AuthContext';
import { ServicosProductsManager } from './ServicosProductsManager';
import { ProductTypesManager } from './ProductTypesManager';
import { CreateProductModal } from './CreateProductModal';
import { EditProductModal } from './EditProductModal';
import { ProductStripeBadge } from './ProductStripeSync';
import { useStripeProductMappings } from '@/hooks/useStripeProductSync';
import type { Product } from '@/types/proposals';
import { effectiveProductTaxRate, grossUnitPrice, type OrganizationTaxConfig } from '@/lib/product-fiscal';
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

export function ProductsTab() {
  const { data: products = [], isLoading } = useProducts();
  const deleteProduct = useDeleteProduct();
  // Um pedido para o catálogo inteiro. Um por linha transformaria esta página
  // numa cascata de chamadas.
  const { data: stripeMappings = {} } = useStripeProductMappings();
  const syncItems = useSyncInvoiceXpressItems();
  const { organization } = useAuth();
  // The "Outros Serviços" catalog (organizations.servicos_products_config) feeds
  // the product picker in Nova Venda and Nova Proposta for telecom orgs, which
  // never see the standard products table there. This is its only editor, so
  // every telecom org needs it.
  const showServicosManager = organization?.niche === 'telecom';
  const invoicingOrganization = organization as (typeof organization & {
    tem_invoicexpress_api_key?: boolean | null;
    invoicexpress_account_name?: string | null;
  });
  const hasInvoiceXpress = !!invoicingOrganization?.tem_invoicexpress_api_key
    && !!invoicingOrganization?.invoicexpress_account_name;
  const organizationTaxConfig = organization?.tax_config as OrganizationTaxConfig | null | undefined;
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  const handleDelete = () => {
    if (deletingProduct) {
      deleteProduct.mutate(deletingProduct.id, {
        onSuccess: () => setDeletingProduct(null),
      });
    }
  };

  const formatPrice = (price: number | null) => {
    if (price === null) return '-';
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(price);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The types come first: a product is classified into one before its
          commission form even makes sense. */}
      {showServicosManager && <ProductTypesManager />}

      {/* Telecom orgs never see the products table in Nova Venda / Nova Proposta:
          those modals read the "Outros Serviços" catalog instead. Showing both
          catalogs here would offer a product list that cannot be sold. */}
      {!showServicosManager && (
      <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Produtos & Serviços
            </CardTitle>
            <CardDescription>
              Gerir o catálogo de produtos e serviços da organização.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {hasInvoiceXpress && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncItems.mutate()}
                disabled={syncItems.isPending}
              >
                {syncItems.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sincronizar
              </Button>
            )}
            <Button onClick={() => setCreateModalOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Ainda não tem produtos configurados.</p>
              <p className="text-sm">Adicione produtos para criar propostas.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      {product.code && (
                        <span className="text-xs font-mono text-muted-foreground">#{product.code}</span>
                      )}
                      <h4 className="font-medium truncate">{product.name}</h4>
                      {product.is_recurring && (
                        <Badge variant="outline" className="text-xs gap-1 bg-primary/10 text-primary border-primary/30">
                          <RefreshCw className="h-3 w-3" />
                          Mensal
                        </Badge>
                      )}
                      {!product.is_active && (
                        <Badge variant="secondary" className="text-xs">Inativo</Badge>
                      )}
                      <ProductStripeBadge mapping={stripeMappings[product.id]} />
                      <Badge variant="outline" className="text-[10px]">
                        {effectiveProductTaxRate(product.tax_value, organizationTaxConfig) === 0
                          ? 'Isento'
                          : `IVA ${effectiveProductTaxRate(product.tax_value, organizationTaxConfig)}%`}
                        {product.tax_value == null && ' (org.)'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {product.price_includes_vat ? 'Preço c/ IVA' : 'Preço + IVA'}
                      </Badge>
                      {(product.retention_rate ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          Retenção {product.retention_rate}%
                        </Badge>
                      )}
                    </div>
                    {product.description && (
                      <p className="text-sm text-muted-foreground truncate">{product.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right whitespace-nowrap">
                      <span className="font-semibold text-primary">{formatPrice(product.price)}</span>
                      {!product.price_includes_vat && product.price != null && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatPrice(grossUnitPrice(product.price, product, organizationTaxConfig))} c/ IVA
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingProduct(product)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingProduct(product)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateProductModal 
        open={createModalOpen} 
        onOpenChange={setCreateModalOpen}
        onCreated={(product) => setEditingProduct(product)}
      />

      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          open={!!editingProduct}
          onOpenChange={(open) => !open && setEditingProduct(null)}
        />
      )}

      <AlertDialog open={!!deletingProduct} onOpenChange={(open) => !open && setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem a certeza que pretende eliminar "{deletingProduct?.name}"? Esta ação não pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
      )}

      {showServicosManager && <ServicosProductsManager />}
    </div>
  );
}
