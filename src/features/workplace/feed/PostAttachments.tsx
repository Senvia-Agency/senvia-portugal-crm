import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { feedFileUrl, fileLabel, isImageMime, type FeedAttachment } from './feed-files';

const useFileUrl = (path: string) => useQuery({ queryKey: ['workplace-feed', 'file', path], queryFn: () => feedFileUrl(path), staleTime: 50 * 60 * 1000 });

function ImageTile({ attachment, onOpen, className }: { attachment: FeedAttachment; onOpen: () => void; className?: string }) {
  const url = useFileUrl(attachment.path);
  return <button type="button" onClick={onOpen} aria-label={`Ver ${attachment.name}`}
    className={cn('relative block overflow-hidden rounded-2xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
    {url.data ? <img src={url.data} alt={attachment.name} className="h-full w-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-muted-foreground" />}
  </button>;
}

function DocumentCard({ attachment }: { attachment: FeedAttachment }) {
  const url = useFileUrl(attachment.path);
  return <a href={url.data} download={attachment.name} target="_blank" rel="noopener noreferrer" aria-disabled={!url.data}
    className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3 transition-colors hover:bg-primary/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white"><FileText className="h-5 w-5" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{attachment.name}</span><span className="text-xs text-muted-foreground">{fileLabel(attachment)}</span></span>
    <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </a>;
}

function Viewer({ images, index, onIndex, onClose }: { images: FeedAttachment[]; index: number | null; onIndex: (index: number) => void; onClose: () => void }) {
  const current = index === null ? null : images[index];
  const url = useQuery({ queryKey: ['workplace-feed', 'file', current?.path], enabled: !!current, queryFn: () => feedFileUrl(current!.path), staleTime: 50 * 60 * 1000 });
  const step = (delta: number) => { if (index !== null) onIndex((index + delta + images.length) % images.length); };
  return <Dialog open={!!current} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-5xl border-0 bg-black/95 p-3 text-white sm:rounded-3xl"
      onKeyDown={event => { if (event.key === 'ArrowRight') step(1); if (event.key === 'ArrowLeft') step(-1); }}>
      <DialogTitle className="sr-only">{current?.name}</DialogTitle>
      <DialogDescription className="sr-only">Fotografia {index !== null ? index + 1 : 0} de {images.length}</DialogDescription>
      <div className="relative flex min-h-[50vh] items-center justify-center">
        {url.data ? <img src={url.data} alt={current?.name} className="max-h-[80vh] max-w-full rounded-xl object-contain" /> : <Loader2 className="h-6 w-6 animate-spin" />}
        {images.length > 1 && <>
          <button type="button" aria-label="Fotografia anterior" onClick={() => step(-1)} className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" aria-label="Fotografia seguinte" onClick={() => step(1)} className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"><ChevronRight className="h-6 w-6" /></button>
        </>}
      </div>
      <div className="flex items-center justify-between gap-3 px-1 pt-2 text-sm">
        <span className="min-w-0 truncate">{current?.name}{images.length > 1 ? ` · ${(index ?? 0) + 1}/${images.length}` : ''}</span>
        {url.data && <a href={url.data} download={current?.name} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25"><Download className="h-4 w-4" />Descarregar</a>}
      </div>
    </DialogContent>
  </Dialog>;
}

/** Photos in a grid (tap to open the viewer) and documents as download cards, as in Realize. */
export function PostAttachments({ attachments }: { attachments: readonly FeedAttachment[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter(item => isImageMime(item.mime));
  const documents = attachments.filter(item => !isImageMime(item.mime));
  return <div className="feed-attachments mt-3 space-y-2">
    {images.length > 0 && <div className={cn('grid gap-1.5', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
      {images.map((image, index) => <ImageTile key={image.path} attachment={image} onOpen={() => setOpen(index)}
        className={cn(images.length === 1 ? 'max-h-[26rem] min-h-48' : 'aspect-square', images.length === 3 && index === 0 && 'col-span-2 aspect-[2/1]')} />)}
    </div>}
    {documents.map(document => <DocumentCard key={document.path} attachment={document} />)}
    <Viewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
  </div>;
}
