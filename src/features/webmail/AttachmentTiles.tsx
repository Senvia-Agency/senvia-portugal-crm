import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Download, FileArchive, FileSpreadsheet, FileText, File as FileIcon, Image as ImageIcon, Loader2, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PdfCanvas } from '@/components/inbox/PdfCanvas';
import { fmtSize } from '@/components/email/emailShared';
import type { EmailAttachment } from '@/hooks/useEmail';
import { base64ToBlob, readCachedAttachment } from './webmail-api';

/** Downloaded attachments stay in memory for the session (the last 12). */
const memory = new Map<string, Blob>();
function remember(id: string, blob: Blob) {
  memory.set(id, blob);
  while (memory.size > 12) memory.delete(memory.keys().next().value as string);
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};
/** Mail servers often label files "application/octet-stream": guess from the extension. */
export function attachmentType(attachment: Pick<EmailAttachment, 'filename' | 'content_type'>): string {
  const declared = (attachment.content_type || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream') return declared;
  const extension = (attachment.filename || '').split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? 'application/octet-stream';
}
const extensionOf = (name: string | null) => ((name || '').includes('.') ? (name || '').split('.').pop()!.toUpperCase().slice(0, 5) : 'FICH');
function TypeIcon({ type, name }: { type: string; name: string | null }) {
  const extension = (name || '').split('.').pop()?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return <ImageIcon className="h-7 w-7 text-sky-500" />;
  if (type === 'application/pdf') return <FileText className="h-7 w-7 text-rose-500" />;
  if (/xlsx?|csv|ods/.test(extension) || type.includes('spreadsheet')) return <FileSpreadsheet className="h-7 w-7 text-emerald-600" />;
  if (/zip|rar|7z|tar|gz/.test(extension)) return <FileArchive className="h-7 w-7 text-amber-600" />;
  if (/docx?|odt|rtf|pptx?/.test(extension)) return <FileText className="h-7 w-7 text-blue-600" />;
  return <FileIcon className="h-7 w-7 text-muted-foreground" />;
}

export type ResolveAttachment = (attachment: EmailAttachment) => Promise<Blob>;

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'anexo';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 120px tiles: the first six images and PDFs show a preview when their bytes are already cached. */
export function AttachmentTiles({ attachments, resolve }: { attachments: readonly EmailAttachment[]; resolve: ResolveAttachment }) {
  const [preview, setPreview] = useState<EmailAttachment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const files = attachments.filter(attachment => !attachment.inline);
  if (files.length === 0) return null;
  const download = async (attachment: EmailAttachment) => {
    setBusy(attachment.id);
    try { saveBlob(await resolve(attachment), attachment.filename || 'anexo'); }
    finally { setBusy(null); }
  };
  return <>
    <ul className="mb-5 flex flex-wrap gap-3" aria-label="Anexos">
      {files.map((attachment, index) => <li key={attachment.id}>
        <div className="webmail-tile">
          <button type="button" className="flex min-h-0 flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPreview(attachment)}
            aria-label={`Pré-visualizar ${attachment.filename || 'anexo'}`}>
            <span className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/50">
              <Thumb attachment={attachment} eager={index < 6} />
            </span>
            <span className="border-t px-2 py-1.5">
              <span className="block truncate text-[11px] font-medium">{attachment.filename || 'anexo'}</span>
              <span className="block text-[10px] text-muted-foreground">{extensionOf(attachment.filename)} · {fmtSize(attachment.size)}</span>
            </span>
          </button>
          <button type="button" className="webmail-tile-download absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow-sm hover:bg-background"
            aria-label={`Descarregar ${attachment.filename || 'anexo'}`} onClick={() => void download(attachment)} disabled={busy === attachment.id}>
            {busy === attachment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>
        </div>
      </li>)}
    </ul>
    {preview && <AttachmentPreview attachment={preview} resolve={resolve} onClose={() => setPreview(null)} />}
  </>;
}

function Thumb({ attachment, eager }: { attachment: EmailAttachment; eager: boolean }) {
  const type = attachmentType(attachment);
  const image = type.startsWith('image/') && type !== 'image/svg+xml' && (attachment.size ?? 0) <= 5 * 1024 * 1024;
  const pdf = type === 'application/pdf' && (attachment.size ?? 0) <= 10 * 1024 * 1024;
  const [url, setUrl] = useState<string | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!eager || (!image && !pdf)) return;
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      // Only bytes already in the database: a thumbnail never asks the mail server for a file.
      const cached = memory.get(attachment.id) ?? (await readCachedAttachment(attachment.id).then(found => (found ? base64ToBlob(found.data_b64, type) : null)));
      if (!active || !cached) return;
      if (image) { objectUrl = URL.createObjectURL(cached); setUrl(objectUrl); return; }
      const pdfjs = await import('pdfjs-dist');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const loaded = await pdfjs.getDocument({ data: new Uint8Array(await cached.arrayBuffer()) }).promise;
      if (active) setDocument(loaded);
    })().catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, eager, image, pdf, type]);
  if (url) return <img src={url} alt="" className="h-full w-full object-cover" />;
  if (document) return <span className="pointer-events-none pt-2"><PdfCanvas document={document} page={1} width={104} /></span>;
  return <TypeIcon type={type} name={attachment.filename} />;
}

/** Images, PDFs, video, audio and text open here; other files are download-only. SVG is never previewed. */
function AttachmentPreview({ attachment, resolve, onClose }: { attachment: EmailAttachment; resolve: ResolveAttachment; onClose: () => void }) {
  const type = attachmentType(attachment);
  const [state, setState] = useState<{ url: string | null; text: string | null; error: string | null; loading: boolean }>({ url: null, text: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const previewable = type !== 'image/svg+xml' && (type.startsWith('image/') || type === 'application/pdf' || type.startsWith('video/') || type.startsWith('audio/') || type.startsWith('text/'));
  useEffect(() => {
    if (!previewable) { setState({ url: null, text: null, error: null, loading: false }); return; }
    let active = true;
    let objectUrl: string | null = null;
    setState({ url: null, text: null, error: null, loading: true });
    resolve(attachment).then(async blob => {
      if (!active) return;
      if (type.startsWith('text/')) { setState({ url: null, text: (await blob.text()).slice(0, 200_000), error: null, loading: false }); return; }
      objectUrl = URL.createObjectURL(new Blob([blob], { type }));
      setState({ url: objectUrl, text: null, error: null, loading: false });
    }).catch(error => { if (active) setState({ url: null, text: null, error: error instanceof Error ? error.message : 'Não foi possível abrir o anexo.', loading: false }); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, attempt, previewable, resolve, type]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent variant="fullScreen" className="flex flex-col gap-0 bg-zinc-950 p-0 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 pr-14">
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{attachment.filename || 'Anexo'}</DialogTitle>
        <DialogDescription className="sr-only">Pré-visualização do anexo do email.</DialogDescription>
        <Button size="sm" variant="secondary" className="rounded-full" onClick={() => void resolve(attachment).then(blob => saveBlob(blob, attachment.filename || 'anexo'))}>
          <Download className="mr-1.5 h-4 w-4" />Descarregar
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {state.loading ? <Loader2 className="h-7 w-7 animate-spin text-white/70" aria-label="A carregar" />
          : state.error ? <div className="space-y-3 text-center"><p className="text-sm text-white/80">{state.error}</p><Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}><RotateCw className="mr-1.5 h-4 w-4" />Tentar novamente</Button></div>
          : !previewable ? <div className="space-y-2 text-center"><TypeIcon type={type} name={attachment.filename} /><p className="text-sm text-white/80">Este tipo de ficheiro não tem pré-visualização. Use "Descarregar".</p></div>
          : state.text !== null ? <pre className="h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap rounded-2xl bg-white p-5 text-left text-sm text-zinc-900">{state.text}</pre>
          : type === 'application/pdf' ? <iframe title={attachment.filename || 'PDF'} src={state.url ?? undefined} className="h-full w-full max-w-5xl rounded-xl bg-white" />
          : type.startsWith('video/') ? <video src={state.url ?? undefined} controls className="max-h-full max-w-full rounded-xl" />
          : type.startsWith('audio/') ? <audio src={state.url ?? undefined} controls className="w-full max-w-md" />
          : <img src={state.url ?? undefined} alt={attachment.filename || 'Imagem anexada'} className="max-h-full max-w-full rounded-xl object-contain" />}
      </div>
    </DialogContent>
  </Dialog>;
}

type FetchAttachment = (channelId: string, attachmentId: string) => Promise<unknown>;
/** The database cache, else ask the gateway to fetch it from the mail server and poll for up to ~25s. */
export async function fetchCachedAttachment(channelId: string, attachmentId: string, fetchAttachment: FetchAttachment) {
  let cached = await readCachedAttachment(attachmentId);
  if (!cached) {
    await fetchAttachment(channelId, attachmentId);
    for (let round = 0; round < 20 && !cached; round++) {
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      cached = await readCachedAttachment(attachmentId);
    }
  }
  return cached;
}

/** Bytes from memory first, then as above. */
export function makeResolver(channelId: string, fetchAttachment: FetchAttachment): ResolveAttachment {
  return async attachment => {
    const known = memory.get(attachment.id);
    if (known) return known;
    const cached = await fetchCachedAttachment(channelId, attachment.id, fetchAttachment);
    if (!cached) throw new Error('O servidor de correio não entregou o anexo a tempo. Tente novamente.');
    const blob = base64ToBlob(cached.data_b64, attachmentType({ filename: attachment.filename, content_type: cached.content_type || attachment.content_type }));
    remember(attachment.id, blob);
    return blob;
  };
}
