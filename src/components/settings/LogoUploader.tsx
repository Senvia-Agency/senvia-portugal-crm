import { useState, useCallback, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

interface LogoUploaderProps {
  value: string | null;
  onChange: (url: string | null) => void;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml', 'image/gif'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export function LogoUploader({ value, onChange }: LogoUploaderProps) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return t('Tipo de ficheiro não suportado. Use PNG, JPG, WEBP, SVG ou GIF.');
    }
    if (file.size > MAX_SIZE) {
      return t('Ficheiro demasiado grande. Máximo 50MB.');
    }
    return null;
  };

  const extractPathFromUrl = (url: string): string | null => {
    try {
      const match = url.match(/organization-logos\/(.+)$/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  };

  const deleteOldLogo = async () => {
    if (!value) return;
    const path = extractPathFromUrl(value);
    if (path) {
      await supabase.storage.from('organization-logos').remove([path]);
    }
  };

  const uploadFile = async (file: File) => {
    if (!organization?.id) {
      toast({
        title: t('Erro'),
        description: t('Organização não encontrada.'),
        variant: 'destructive',
      });
      return;
    }

    const error = validateFile(file);
    if (error) {
      toast({
        title: t('Ficheiro inválido'),
        description: error,
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Delete old logo first
      await deleteOldLogo();

      // Generate unique filename
      const ext = file.name.split('.').pop();
      const filename = `${organization.id}/${Date.now()}.${ext}`;

      // Simulate progress (Supabase doesn't provide upload progress natively)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 100);

      const { data, error: uploadError } = await supabase.storage
        .from('organization-logos')
        .upload(filename, file, {
          cacheControl: '3600',
          upsert: true,
        });

      clearInterval(progressInterval);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('organization-logos')
        .getPublicUrl(data.path);

      setUploadProgress(100);
      onChange(urlData.publicUrl);

      toast({
        title: t('Logo carregado'),
        description: t('O logo foi carregado com sucesso.'),
      });
    } catch (err) {
      console.error('Upload error:', err);
      toast({
        title: t('Erro no upload'),
        description: t('Não foi possível carregar o ficheiro. Tente novamente.'),
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        uploadFile(file);
      }
    },
    [organization?.id, value]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    // Reset input
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    await deleteOldLogo();
    onChange(null);
    toast({
      title: t('Logo removido'),
      description: t('O logo foi removido com sucesso.'),
    });
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />

      {value ? (
        <div className="relative rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 flex-shrink-0 rounded-lg border bg-background p-2">
              <img
                src={value}
                alt="Logo"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t('Logo atual')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Clique em substituir para carregar um novo')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('Substituir')
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleRemove}
                disabled={isUploading}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !isUploading && inputRef.current?.click()}
          className={cn(
            'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all cursor-pointer',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
            isUploading && 'pointer-events-none opacity-70'
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium">{t('A carregar...')}</p>
              <div className="w-full max-w-[200px] mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="rounded-full bg-muted p-3 mb-3">
                {isDragging ? (
                  <Upload className="h-6 w-6 text-primary" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <p className="text-sm font-medium">
                {isDragging ? t('Largue aqui') : t('Arraste uma imagem')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('ou clique para selecionar')}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-3">
                {t('PNG, JPG, WEBP, SVG, GIF • Máx. 50MB')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
