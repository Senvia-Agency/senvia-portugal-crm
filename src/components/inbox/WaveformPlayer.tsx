// Waveform-style voice message visualization with playback speed control.
// Uses the global audio store so playback continues across conversation switches.
import { useRef, useCallback, memo } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlobalAudio } from '@/stores/useGlobalAudio';
import { useLanguage } from '@/i18n';

const BAR_COUNT = 38;
const SPEEDS = [1, 1.5, 2];

function generateBars(seed: number): number[] {
  const bars: number[] = [];
  let s = seed;
  for (let i = 0; i < BAR_COUNT; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const base = 0.3 + ((s % 1000) / 1000) * 0.7;
    const taper = Math.sin((i / BAR_COUNT) * Math.PI);
    bars.push(Math.max(0.15, base * taper));
  }
  return bars;
}

export const WaveformPlayer = memo(function WaveformPlayer({
  url,
  outgoing,
  seed = 1,
  compact = false,
}: {
  url: string;
  outgoing: boolean;
  seed?: number;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const bars = useRef(generateBars(seed)).current;
  const { url: activeUrl, playing, cur, dur, speed, toggle, setSpeed, seek } = useGlobalAudio();

  const isActive = activeUrl === url;
  const pct = isActive && dur ? (cur / dur) * 100 : 0;

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const adj = s / speed;
    const m = Math.floor(adj / 60);
    return `${m}:${String(Math.floor(adj % 60)).padStart(2, '0')}`;
  };

  const onSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || !dur) {
      toggle(url, seed);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(ratio);
  }, [isActive, dur, url, seed, toggle, seek]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  }, [speed, setSpeed]);

  return (
    <div className={cn('flex items-center gap-2', compact ? 'min-w-[160px]' : 'min-w-[200px]')}>
      <button
        type="button"
        onClick={() => toggle(url, seed)}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
          outgoing
            ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30'
            : 'bg-primary/10 text-primary hover:bg-primary/20',
        )}
      >
        {isActive && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button>

      <div
        onClick={onSeek}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
      >
        {bars.map((h, i) => {
          const barPct = (i / BAR_COUNT) * 100;
          const active = barPct <= pct;
          return (
            <div
              key={i}
              className={cn(
                'flex-1 rounded-full transition-colors',
                active
                  ? (outgoing ? 'bg-primary-foreground' : 'bg-primary')
                  : (outgoing ? 'bg-primary-foreground/30' : 'bg-muted-foreground/30'),
              )}
              style={{ height: `${h * 100}%`, maxHeight: '24px' }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        title={t("Velocidade de reprodução")}
        className={cn(
          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors',
          speed !== 1 && (outgoing
            ? 'bg-primary-foreground/20 text-primary-foreground'
            : 'bg-primary/15 text-primary'),
          speed === 1 && (outgoing
            ? 'text-primary-foreground/60 hover:text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'),
        )}
      >
        {speed}×
      </button>

      <span className={cn(
        'shrink-0 text-[10px] tabular-nums',
        outgoing ? 'text-primary-foreground/70' : 'text-muted-foreground',
      )}>
        {isActive && (playing || cur > 0) ? fmt(cur) : fmt(dur)}
      </span>
    </div>
  );
});
