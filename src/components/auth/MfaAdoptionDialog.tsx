import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { safeStorage } from '@/lib/safeStorage';
import {
  getMfaReminderDay,
  isMfaEnforcementActive,
  shouldShowMfaReminder,
} from '@/lib/mfa-rollout';
import { useWhatsNewStore } from '@/stores/useWhatsNewStore';
import { useLanguage } from '@/i18n';

const REMINDER_KEY_PREFIX = 'senvia_mfa_adoption_';

export function MfaAdoptionDialog() {
  const { user, mfaStatus } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const announcementOpen = useWhatsNewStore(state => state.isOpen);
  const [isOpen, setIsOpen] = useState(false);
  const today = getMfaReminderDay(new Date());
  const reminderKey = user ? `${REMINDER_KEY_PREFIX}${user.id}` : null;

  useEffect(() => {
    setIsOpen(shouldShowMfaReminder({
      mfaStatus,
      today,
      dismissedDay: reminderKey ? safeStorage.get(reminderKey) : null,
      enforcementActive: isMfaEnforcementActive(Date.now()),
      announcementOpen,
    }));
  }, [announcementOpen, mfaStatus, reminderKey, today]);

  if (!reminderKey || !isOpen) return null;

  const dismiss = () => {
    safeStorage.set(reminderKey, today);
    setIsOpen(false);
  };

  const openSecuritySettings = () => {
    dismiss();
    navigate('/settings?og=account&os=account-security');
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl">{t("Prepare a autenticação em dois fatores")}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t("A partir de 21 de setembro de 2026, será necessário usar uma aplicação autenticadora para entrar no Senvia OS.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-foreground">
            {t("Pode continuar a trabalhar normalmente até 20 de setembro. Recomendamos ativar agora para evitar dificuldades no primeiro acesso após a mudança.")}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={dismiss}>
            {t("Lembrar mais tarde")}
          </Button>
          <Button type="button" onClick={openSecuritySettings}>
            {t("Ativar agora")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
