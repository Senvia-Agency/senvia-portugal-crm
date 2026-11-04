import { useRef, useState } from 'react';
import { FileText, Upload, Trash2, Download, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLeadAttachments, useUploadLeadAttachment, useDeleteLeadAttachment, getAttachmentSignedUrl, LeadAttachment } from '@/hooks/useLeadAttachments';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

interface LeadAttachmentsProps {
  leadId: string;
  readOnly?: boolean;
}

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function LeadAttachments({ leadId, readOnly = false }: LeadAttachmentsProps) {
  const { t } = useLanguage();
  const { data: attachments = [], isLoading } = useLeadAttachments(leadId);
  const upload = useUploadLeadAttachment();
  const remove = useDeleteLeadAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) continue;
      await upload.mutateAsync({ leadId, file });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (attachment: LeadAttachment) => {
    setDownloadingId(attachment.id);
    try {
      const url = await getAttachmentSignedUrl(attachment.file_path);
      window.open(url, '_blank');
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("A carregar...")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          {t("Faturas Anexadas")}
          {attachments.length > 0 && (
            <span className="text-xs text-muted-foreground">({attachments.length})</span>
          )}
        </h4>
        {!readOnly && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("Anexar")}
            </Button>
          </>
        )}
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{t("Nenhuma fatura anexada.")}</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30"
            >
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{att.file_name}</p>
                {att.file_size && (
                  <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDownload(att)}
                  disabled={downloadingId === att.id}
                >
                  {downloadingId === att.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(att)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
