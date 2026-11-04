import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateCommunication } from '@/hooks/useClientCommunications';
import { toast } from 'sonner';
import { Phone, MessageCircle, Mail, StickyNote, Loader2 } from 'lucide-react';
import type { CommunicationType, CommunicationDirection } from '@/types/communications';
import { COMMUNICATION_TYPE_OPTIONS, COMMUNICATION_DIRECTION_OPTIONS } from '@/types/communications';
import { useLanguage } from "@/i18n";

interface AddCommunicationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string;
  defaultType?: CommunicationType;
  defaultDirection?: CommunicationDirection;
}

const TYPE_ICONS: Record<CommunicationType, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  note: StickyNote,
};

export function AddCommunicationModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  defaultType = 'note',
  defaultDirection = 'outbound',
}: AddCommunicationModalProps) {
  const { t } = useLanguage();
  const [type, setType] = useState<CommunicationType>(defaultType);
  const [direction, setDirection] = useState<CommunicationDirection>(defaultDirection);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<string>('');
  const [occurredAt, setOccurredAt] = useState<string>('');

  const createCommunication = useCreateCommunication();

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setType(defaultType);
      setDirection(defaultDirection);
      setSubject('');
      setContent('');
      setDurationMinutes('');
      // Set default to now
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      setOccurredAt(now.toISOString().slice(0, 16));
    }
  }, [open, defaultType, defaultDirection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createCommunication.mutateAsync({
        client_id: clientId,
        type,
        direction: type === 'note' ? null : direction,
        subject: subject || null,
        content: content || null,
        duration_seconds: durationMinutes ? parseInt(durationMinutes) * 60 : null,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
      });

      toast.success(t("Comunicação registada com sucesso"));
      onOpenChange(false);
    } catch (error) {
      toast.error(t("Erro ao registar comunicação"));
    }
  };

  const showDirection = type !== 'note';
  const showDuration = type === 'call';

  const Icon = TYPE_ICONS[type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {t("Registar Comunicação")}
          </DialogTitle>
          {clientName && (
            <p className="text-sm text-muted-foreground">{t("Cliente:")} {clientName}</p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">{t("Tipo")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as CommunicationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMUNICATION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showDirection && (
              <div className="space-y-2">
                <Label htmlFor="direction">{t("Direção")}</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as CommunicationDirection)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMUNICATION_DIRECTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="occurred_at">{t("Data e Hora")}</Label>
            <Input
              id="occurred_at"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          {showDuration && (
            <div className="space-y-2">
              <Label htmlFor="duration">{t("Duração (minutos)")}</Label>
              <Input
                id="duration"
                type="number"
                min="0"
                placeholder={t("Ex: 5")}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="subject">{t("Assunto (opcional)")}</Label>
            <Input
              id="subject"
              placeholder={t("Breve descrição...")}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">{t("Notas")}</Label>
            <Textarea
              id="content"
              placeholder={t("Detalhes da comunicação...")}
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={createCommunication.isPending}>
              {createCommunication.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("Registar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
