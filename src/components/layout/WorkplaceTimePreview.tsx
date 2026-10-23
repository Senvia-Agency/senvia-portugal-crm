import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function WorkplaceTimePreview() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  const time = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' }).format(now);
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="workplace-time-preview" aria-label="Ponto: pré-visualização visual">
        <span className="workplace-time-dot" aria-hidden="true" />
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        <time dateTime={now.toISOString()} aria-label={`Hora local: ${time}`}>{time}</time><span className="workplace-time-separator" aria-hidden="true" /><span className="workplace-time-label">Ponto</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 space-y-2">
      <h2 className="text-sm font-semibold">Ponto · pré-visualização</h2>
      <p className="text-sm text-muted-foreground">Nesta fase, este controlo é apenas visual. Não inicia jornadas nem regista horas de trabalho.</p>
    </PopoverContent>
  </Popover>;
}
