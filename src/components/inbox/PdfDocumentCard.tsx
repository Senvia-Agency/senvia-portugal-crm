import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PdfCanvas } from './PdfCanvas';

export function PdfDocumentCard({ url, filename, detail, outgoing }: {
  readonly url: string;
  readonly filename: string;
  readonly detail: string;
  readonly outgoing?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [readerWidth, setReaderWidth] = useState(600);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setFailed(false);
    setDocument(undefined);
    async function load() {
      const pdf = await import('pdfjs-dist');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      if (!active) return;
      pdf.GlobalWorkerOptions.workerSrc = worker;
      task = pdf.getDocument({ url });
      const loaded = await task.promise;
      if (active) setDocument(loaded);
    }
    void load().catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; void task?.destroy(); };
  }, [url, visible]);
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setReaderWidth(Math.max(180, entry.contentRect.width - 32));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  return <div ref={hostRef} className={cn('mt-1 w-72 max-w-full overflow-hidden rounded-xl', outgoing ? 'bg-primary-foreground/15' : 'bg-background/80')}>
    <button type="button" onClick={() => { setVisible(true); setPage(1); setZoom(1); setOpen(true); }} title={`Pré-visualizar ${filename}`} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex h-48 justify-center overflow-hidden bg-muted/60 p-2">
        {document ? <PdfCanvas document={document} page={1} width={124} /> : <span className="flex flex-col items-center justify-center gap-2 text-xs">
          {failed ? <><FileText className="h-7 w-7" />Pré-visualização indisponível</> : <><Loader2 className="h-5 w-5 animate-spin" />A carregar PDF</>}
        </span>}
      </div>
      <div className="flex items-center gap-3 p-3"><FileText className="h-5 w-5 shrink-0" /><span className="min-w-0"><span className="line-clamp-2 break-words text-sm font-medium">{filename}</span><span className="mt-1 block text-xs opacity-70">{detail || 'PDF'} · Abrir pré-visualização</span></span></div>
    </button>
    <a href={url} target="_blank" rel="noreferrer" download={filename} className="flex min-h-10 items-center justify-center gap-2 border-t border-current/10 text-xs hover:bg-muted/20"><Download className="h-4 w-4" />Descarregar PDF</a>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-3 sm:max-w-5xl sm:p-4">
        <DialogTitle className="pr-8 text-sm leading-5 break-words">{filename}</DialogTitle>
        <DialogDescription className="sr-only">Leitor PDF com navegação entre páginas, zoom e descarga.</DialogDescription>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Página anterior" disabled={!document || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-20 text-center text-xs" aria-live="polite">{page} / {document?.numPages ?? '—'}</span>
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Página seguinte" disabled={!document || page === document.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Reduzir zoom" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .25))}><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="ghost" className="h-10 px-2 text-xs" onClick={() => setZoom(1)} aria-label="Ajustar à largura">{Math.round(zoom * 100)}%</Button>
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Aumentar zoom" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}><ZoomIn className="h-4 w-4" /></Button>
            <Button asChild variant="outline" size="icon" className="h-10 w-10"><a href={url} download={filename} target="_blank" rel="noreferrer" aria-label="Descarregar PDF"><Download className="h-4 w-4" /></a></Button>
          </div>
        </div>
        <div ref={setViewport} className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-4">
          {document ? <div className="min-w-full w-fit text-center"><PdfCanvas document={document} page={page} width={readerWidth * zoom} /></div> : <p role={failed ? 'alert' : 'status'} className="py-12 text-center text-sm text-muted-foreground">{failed ? 'Não foi possível abrir este PDF. Pode descarregar o ficheiro original.' : 'A carregar PDF…'}</p>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
