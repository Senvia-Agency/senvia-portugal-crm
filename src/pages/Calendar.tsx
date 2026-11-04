import { CalendarView } from '@/components/calendar/CalendarView';
import { SEO } from '@/components/SEO';
import { useLanguage } from '@/i18n';

export default function Calendar() {
  const { t } = useLanguage();
  return (
    <>
      <SEO 
        title={t("Agenda | Senvia OS")} 
        description={t("Faça a gestão da sua agenda de eventos e tarefas")}
      />
      <CalendarView />
    </>
  );
}
