import { useRef, useState } from 'react';
import { Loader2, Upload, Trash2, Star, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServiceImages, useUploadServiceImage, useDeleteServiceImage, useSetPrimaryServiceImage } from '@/hooks/useServiceImages';
import { toast } from '@/hooks/use-toast';
import { useLanguage } from '@/i18n';

interface ProductImageGalleryProps {
  productId: string;
  onClose?: () => void;
}

export function ProductImageGallery({ productId, onClose }: ProductImageGalleryProps) {
  const { data: images = [], isLoading } = useServiceImages(productId);
  const uploadImage = useUploadServiceImage();
  const deleteImage = useDeleteServiceImage();
  const setPrimary = useSetPrimaryServiceImage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { t } = useLanguage();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: t('Imagem demasiado grande'), description: t('{{name}} excede 5MB.', { name: file.name }), variant: 'destructive' });
        continue;
      }
      await uploadImage.mutateAsync({ productId, file });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t('Imagens do produto')}</h4>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadImage.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {uploadImage.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {t('Adicionar')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : images.length === 0 ? (
        <div className="rounded-lg border border-dashed py-6 text-center">
          <Upload className="h-6 w-6 mx-auto text-muted-foreground opacity-50" />
          <p className="mt-2 text-xs text-muted-foreground">
            {t('Sem imagens. Clica em "Adicionar".')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
                img.is_primary && 'ring-2 ring-primary ring-offset-1'
              )}
            >
              <img
                src={img.url}
                alt={img.alt_text || t('Imagem do produto')}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setPrimary.mutate({ imageId: img.id, productId })}
                  disabled={img.is_primary}
                  title={img.is_primary ? t('Imagem principal') : t('Definir como principal')}
                  className={cn(
                    'rounded p-1 transition-colors',
                    img.is_primary ? 'text-amber-400' : 'text-white hover:text-amber-400'
                  )}
                >
                  <Star className="h-3 w-3" fill={img.is_primary ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(img.id)}
                  title={t('Eliminar')}
                  className="rounded p-1 text-white hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {img.is_primary && (
                <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
                  {t('Principal')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-full max-w-xs rounded-xl bg-background p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-sm font-semibold">{t('Eliminar imagem?')}</h3>
              <button onClick={() => setPendingDelete(null)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('Esta ação não pode ser revertida.')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                {t('Cancelar')}
              </button>
              <button
                onClick={() => {
                  const img = images.find((i) => i.id === pendingDelete);
                  if (img) {
                    deleteImage.mutate({ imageId: img.id, productId, url: img.url });
                  }
                  setPendingDelete(null);
                }}
                className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground hover:bg-destructive/90"
              >
                {t('Eliminar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
