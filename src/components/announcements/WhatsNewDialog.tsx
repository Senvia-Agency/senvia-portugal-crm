import { useEffect } from 'react';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useWhatsNewStore } from '@/stores/useWhatsNewStore';
import { isPerfect2GetherOrg } from '@/lib/perfect2gether';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLanguage } from '@/i18n';

interface WhatsNewDialogProps {
  organizationId?: string | null;
}

export function WhatsNewDialog({ organizationId }: WhatsNewDialogProps) {
  const { t } = useLanguage();
  const { announcement, hasUnread, markAsSeen } = useAnnouncements();
  const isOpen = useWhatsNewStore((s) => s.isOpen);
  const autoOpenedId = useWhatsNewStore((s) => s.autoOpenedId);
  const markAutoOpened = useWhatsNewStore((s) => s.markAutoOpened);
  const close = useWhatsNewStore((s) => s.close);

  const blocked = isPerfect2GetherOrg(organizationId);

  // Still shows itself once when something is unread; the bell is there for
  // everything after that (and for reading it again later).
  useEffect(() => {
    if (blocked || !announcement || !hasUnread) return;
    if (autoOpenedId === announcement.id) return;
    markAutoOpened(announcement.id);
  }, [blocked, announcement, hasUnread, autoOpenedId, markAutoOpened]);

  if (blocked || !announcement || !isOpen) return null;

  // Opening it IS reading it — that is what clears the red dot.
  const dismiss = () => {
    markAsSeen();
    close();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            {announcement.title}
            {announcement.version && (
              <span className="text-xs font-normal bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {announcement.version}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {announcement.image_url && (
          <img
            src={announcement.image_url}
            alt={announcement.title}
            className="w-full rounded-lg object-cover max-h-48"
          />
        )}

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{announcement.content}</ReactMarkdown>
        </div>

        <DialogFooter>
          <Button onClick={dismiss} className="w-full sm:w-auto">
            {t('Entendi')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
