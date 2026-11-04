// Floating "now playing" pill — shows when audio is playing but the conversation
// containing it is not currently open. Lets the user pause/resume from anywhere.
import { Play, Pause, X } from 'lucide-react';
import { useGlobalAudio } from '@/stores/useGlobalAudio';
import { useLanguage } from '@/i18n';

export function GlobalAudioPill({ activeMessageId }: { activeMessageId: number | null }) {
  const { url, messageId, playing, cur, dur, toggle, stop } = useGlobalAudio();
  const { t } = useLanguage();

  if (!url || !playing) return null;
  if (messageId != null && messageId === activeMessageId) return null;

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 items-center gap-3 rounded-full border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={() => messageId != null && toggle(url, messageId)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Pause className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{t("Mensagem de voz")}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {fmt(cur)} / {fmt(dur)}
        </span>
      </div>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-1 rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${dur ? (cur / dur) * 100 : 0}%` }}
        />
      </div>
      <button
        type="button"
        onClick={stop}
        className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
