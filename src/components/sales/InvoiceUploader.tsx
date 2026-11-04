import { useState, useRef } from "react";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";

interface InvoiceUploaderProps {
  value: string | null;
  onChange: (url: string | null) => void;
  organizationId: string;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function InvoiceUploader({
  value,
  onChange,
  organizationId,
  disabled = false,
}: InvoiceUploaderProps) {
  const { t } = useLanguage();
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(t("Tipo de ficheiro não suportado. Use PDF, PNG ou JPG."));
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("Ficheiro demasiado grande. Máximo 10MB."));
      return;
    }

    setIsUploading(true);

    try {
      // Generate unique filename
      const ext = file.name.split('.').pop();
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const path = `${organizationId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(path, file);

      if (uploadError) {
        console.error("Upload error:", uploadError);
        toast.error(t("Erro ao carregar ficheiro"));
        return;
      }

      // Store just the path (not full URL since bucket is private)
      onChange(path);
      toast.success(t("Ficheiro anexado com sucesso"));
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(t("Erro ao carregar ficheiro"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = async () => {
    if (!value) return;

    try {
      await supabase.storage.from('invoices').remove([value]);
      onChange(null);
      toast.success(t("Ficheiro removido"));
    } catch (error) {
      console.error("Remove error:", error);
      toast.error(t("Erro ao remover ficheiro"));
    }
  };

  // Extract filename from path
  const getFilename = (path: string) => {
    const parts = path.split('/');
    return parts[parts.length - 1];
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
        <FileText className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="text-sm truncate flex-1">{getFilename(value)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={handleRemove}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer",
        dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isUploading}
      />
      
      <div className="flex flex-col items-center gap-2 text-center">
        {isUploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t("A carregar...")}</span>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div>
              <span className="text-sm text-muted-foreground">
                {t("Arraste ou clique para anexar")}
              </span>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {t("PDF, PNG, JPG • Máx. 10MB")}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
