// Fullscreen media viewer with zoom, pan, and keyboard navigation.
// Telegram-inspired: dark backdrop, auto-hiding controls, wheel zoom, drag pan.
//
// Supports:
// - Images: zoom (wheel + buttons), pan (drag), double-click toggle
// - Videos: inline player with controls (native <video>)
// - Keyboard: Esc to close, ArrowLeft/Right to navigate, +/- to zoom
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  filename?: string;
  /** Who sent it — shown top-left, like WhatsApp ("Você", the contact's name). */
  title?: string;
  /** When it was sent. */
  subtitle?: string;
  /** The text sent with it. Stays on screen; the controls auto-hide. */
  caption?: string;
}

export const MediaViewer = memo(function MediaViewer({
  items,
  index,
  onClose,
  onNavigate,
  onDownload,
}: {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDownload?: (item: MediaItem) => void;
}) {
  const item = items[index];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showControls, setShowControls] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const touchRef = useRef<{ startX: number; startY: number; horizontal: boolean } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const controlsTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) window.clearTimeout(controlsTimer.current);
    controlsTimer.current = window.setTimeout(() => setShowControls(false), 3000);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (index > 0) { onNavigate(index - 1); resetZoom(); }
          break;
        case 'ArrowRight':
          if (index < items.length - 1) { onNavigate(index + 1); resetZoom(); }
          break;
        case '+':
        case '=':
          setZoom((z) => Math.min(5, z + 0.3));
          break;
        case '-':
          setZoom((z) => Math.max(1, z - 0.3));
          break;
        case '0':
          resetZoom();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onNavigate, resetZoom]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Reset zoom when item changes
  useEffect(() => { resetZoom(); setImgLoaded(false); }, [index, resetZoom]);

  // Auto-hide controls on mouse inactivity
  useEffect(() => { showControlsBriefly(); }, [index, showControlsBriefly]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((z) => Math.max(1, Math.min(5, z + delta * z)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st) return;
    setPan({
      x: st.panX + (e.clientX - st.startX),
      y: st.panY + (e.clientY - st.startY),
    });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const onDoubleClick = () => {
    if (zoom > 1) resetZoom();
    else setZoom(2.5);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (zoom > 1) return;
    const t = e.touches[0];
    touchRef.current = { startX: t.clientX, startY: t.clientY, horizontal: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const st = touchRef.current;
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.startX;
    const dy = t.clientY - st.startY;
    if (!st.horizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      st.horizontal = true;
    }
    if (st.horizontal) {
      setSwipeOffset(dx);
    }
  };

  const onTouchEnd = () => {
    const st = touchRef.current;
    touchRef.current = null;
    if (!st || !st.horizontal) return;
    if (swipeOffset < -80 && index < items.length - 1) {
      onNavigate(index + 1);
      resetZoom();
    } else if (swipeOffset > 80 && index > 0) {
      onNavigate(index - 1);
      resetZoom();
    }
    setSwipeOffset(0);
  };

  const prevItem = index > 0 ? items[index - 1] : null;
  const nextItem = index < items.length - 1 ? items[index + 1] : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      onMouseMove={showControlsBriefly}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div className={cn(
        'absolute top-0 inset-x-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 py-3 transition-opacity duration-300',
        showControls ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">
            {item?.title || item?.filename || (item?.type === 'video' ? 'Vídeo' : 'Imagem')}
          </p>
          {(item?.subtitle || items.length > 1) && (
            <p className="text-xs text-white/50">
              {[item?.subtitle, items.length > 1 ? `${index + 1} de ${items.length}` : null]
                .filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {onDownload && item && (
          <button
            type="button"
            onClick={() => onDownload(item)}
            title="Transferir"
            className="mr-2 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Download className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Fechar (Esc)"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Prev arrow */}
      {prevItem && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); resetZoom(); }}
          title="Anterior (←)"
          className={cn(
            'absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition-all hover:bg-white/10 hover:text-white',
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}

      {/* Next arrow */}
      {nextItem && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); resetZoom(); }}
          title="Seguinte (→)"
          className={cn(
            'absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition-all hover:bg-white/10 hover:text-white',
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      {/* Media content */}
      {item?.type === 'video' ? (
        <video
          src={item.url}
          controls
          autoPlay
          className="max-h-[90dvh] max-w-[95vw] rounded-xl"
        />
      ) : item ? (
        <div
          className="flex h-full w-full items-center justify-center overflow-hidden"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ cursor: zoom > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}
        >
          {!imgLoaded && (
            <div className="absolute flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/50" />
            </div>
          )}
          <img
            src={item.url}
            alt={item.filename || 'Imagem'}
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            className={cn(
              // Room above for the sender bar and below for the caption and zoom.
              'max-h-[calc(100dvh-10rem)] max-w-[92vw] select-none rounded-xl object-contain transition-opacity duration-200',
              imgLoaded ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) translateX(${swipeOffset}px)`,
              transition: dragRef.current || touchRef.current ? 'none' : undefined,
            }}
          />
        </div>
      ) : null}

      {/* Bottom: thumbnails, caption, zoom — stacked so they never overlap.
          The caption stays put; the controls fade with the rest. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-4 pb-4">
      {items.length > 1 && (
        <div className={cn(
          'hidden gap-1 transition-opacity duration-300 md:flex',
          showControls ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}>
          {items.slice(Math.max(0, index - 3), index + 4).map((it, i) => {
            const realIdx = Math.max(0, index - 3) + i;
            return (
              <button
                key={realIdx}
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigate(realIdx); }}
                className={cn(
                  'h-12 w-12 overflow-hidden rounded-md border-2 transition-all',
                  realIdx === index ? 'border-primary opacity-100' : 'border-transparent opacity-50 hover:opacity-80',
                )}
              >
                {it.type === 'image' ? (
                  <img src={it.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/10">
                    <video src={it.url} className="h-full w-full object-cover" muted />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {item?.caption && (
        <p className="pointer-events-auto max-h-28 max-w-3xl overflow-y-auto whitespace-pre-wrap break-words text-center text-sm text-white/90">
          {item.caption}
        </p>
      )}

      {item?.type === 'image' && (
        <div className={cn(
          'flex items-center gap-1 rounded-full bg-black/60 px-2 py-1.5 backdrop-blur transition-opacity duration-300',
          showControls ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z - 0.3))}
            title="Diminuir zoom (-)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3rem] text-center text-xs font-medium tabular-nums text-white/80">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(5, z + 0.3))}
            title="Aumentar zoom (+)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-white/20" />
          <button
            type="button"
            onClick={resetZoom}
            title="Repor zoom (0)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      )}
      </div>
    </div>
  );
});
