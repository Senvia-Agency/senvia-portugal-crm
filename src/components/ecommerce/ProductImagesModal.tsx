import { useState, useRef } from "react";
import { Upload, Trash2, Star, GripVertical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EcommerceProduct } from "@/types/ecommerce";
import {
  useProductImages,
  useUploadProductImage,
  useSetPrimaryImage,
  useDeleteProductImage,
} from "@/hooks/ecommerce";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";

interface ProductImagesModalProps {
  product: EcommerceProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductImagesModal({ product, open, onOpenChange }: ProductImagesModalProps) {
  const { data: images, isLoading } = useProductImages(product.id);
  const { t } = useLanguage();
  const uploadImage = useUploadProductImage();
  const setPrimary = useSetPrimaryImage();
  const deleteImage = useDeleteProductImage();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    
    for (const file of Array.from(files)) {
      await uploadImage.mutateAsync({
        productId: product.id,
        file,
        isPrimary: !images?.length, // First image is primary
      });
    }
    
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSetPrimary = (imageId: string) => {
    setPrimary.mutate({ imageId, productId: product.id });
  };

  const handleDelete = (imageId: string, url: string) => {
    deleteImage.mutate({ imageId, productId: product.id, url });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Imagens - {{name}}", { name: product.name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload Area */}
          <div
            className="relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 transition-colors hover:border-primary/50"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {uploading ? t("A carregar...") : t("Clique ou arraste imagens")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("PNG, JPG ou WebP até 5MB")}
            </p>
          </div>

          {/* Images Grid */}
          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="aspect-square rounded-lg" />
            </div>
          ) : images?.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t("Sem imagens. Adicione a primeira imagem acima.")}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {images?.map((image) => (
                <div
                  key={image.id}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg border",
                    image.is_primary && "ring-2 ring-primary"
                  )}
                >
                  <img
                    src={image.url}
                    alt={image.alt_text || product.name}
                    className="h-full w-full object-cover"
                  />
                  
                  {/* Overlay Actions */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    {!image.is_primary && (
                      <Button
                        size="icon"
                        variant="secondary"
                        onClick={() => handleSetPrimary(image.id)}
                        title={t("Definir como principal")}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="destructive"
                      onClick={() => handleDelete(image.id, image.url)}
                      title={t("Eliminar")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* Primary Badge */}
                  {image.is_primary && (
                    <div className="absolute left-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      {t("Principal")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Fechar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
