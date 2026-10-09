import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Loader2 } from 'lucide-react';
import { pdfOutputScale } from './pdf-rendering';

export function PdfCanvas({ document, page, width }: {
  readonly document: PDFDocumentProxy;
  readonly page: number;
  readonly width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let render: RenderTask | undefined;
    setBusy(true);
    setFailed(false);
    async function draw() {
      const pdfPage = await document.getPage(page);
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      const ratio = pdfOutputScale(viewport.width, viewport.height, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) { setFailed(true); return; }
      render = pdfPage.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (active) setBusy(false);
    }
    void draw().catch((error: unknown) => {
      if (active && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
        setFailed(true);
        setBusy(false);
      }
    });
    return () => { active = false; render?.cancel(); };
  }, [document, page, width]);
  return <div className="relative inline-block bg-white shadow-sm">
    <canvas ref={canvasRef} aria-label={`Página ${page} do PDF`} className={failed ? 'hidden' : 'block'} />
    {busy && !failed && <span className="absolute inset-0 flex items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><span className="sr-only">A carregar página</span></span>}
    {failed && <p className="p-4 text-sm text-destructive" role="alert">Não foi possível mostrar esta página.</p>}
  </div>;
}
