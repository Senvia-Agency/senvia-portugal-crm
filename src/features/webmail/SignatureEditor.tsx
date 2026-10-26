import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code2, Eye, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Palette, Redo2,
  RemoveFormatting, Trash2, Underline, Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sanitizeEmailHtml, safeEmailLink } from '@/lib/email-html';
import { cn } from '@/lib/utils';
import { SIGNATURE_IMAGE_TYPES, describeWebmailError, uploadSignatureImage } from './webmail-api';

/** Same allowlist as outgoing mail; HTTPS images are kept because they sit inside a signature. */
export function sanitizeSignatureHtml(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = sanitizeEmailHtml(`<div class="senvia-signature">${html}</div>`);
  return holder.firstElementChild?.innerHTML ?? '';
}
export const signatureIsEmpty = (html: string) => {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return !holder.textContent?.trim() && !holder.querySelector('img');
};

const SIZES = [{ value: '2', label: 'Pequeno' }, { value: '3', label: 'Normal' }, { value: '5', label: 'Grande' }, { value: '6', label: 'Enorme' }] as const;
const COLORS = ['#111827', '#6b7280', '#2563eb', '#16a34a', '#dc2626', '#ea580c', '#7c3aed', '#0891b2'] as const;
const WIDTHS = [{ value: 80, label: '80' }, { value: 160, label: '160' }, { value: 280, label: '280' }, { value: 0, label: 'Original' }] as const;

interface EditorProps {
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly userId: string;
}

export function SignatureEditor({ value, onChange, userId }: EditorProps) {
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // The editor owns its DOM while typing; outside changes (another signature, HTML mode) are written in.
  useEffect(() => {
    const editor = editorRef.current;
    if (mode === 'visual' && editor && editor.innerHTML !== value) editor.innerHTML = value;
  }, [value, mode]);

  const emit = () => { if (editorRef.current) onChange(editorRef.current.innerHTML); };
  const keepSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) savedRange.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) { selection.removeAllRanges(); selection.addRange(savedRange.current); }
  };
  const command = (name: string, argument?: string) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(name, false, argument);
    keepSelection();
    emit();
  };

  const insertImages = async (files: readonly File[], at?: Range | null) => {
    const images = files.filter(file => SIGNATURE_IMAGE_TYPES.includes(file.type as typeof SIGNATURE_IMAGE_TYPES[number]));
    if (images.length === 0) { if (files.length) toast.error('Use imagens PNG, JPEG, GIF ou WebP.'); return; }
    setUploading(count => count + images.length);
    for (const file of images) {
      try {
        const url = await uploadSignatureImage(userId, file);
        if (at) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(at); editorRef.current?.focus(); }
        else restoreSelection();
        document.execCommand('insertHTML', false, `<img src="${url}" width="160" alt="">`);
        keepSelection();
        emit();
      } catch (error) {
        toast.error('Não foi possível carregar a imagem', { description: error instanceof Error ? error.message : describeWebmailError(error) });
      } finally {
        setUploading(count => count - 1);
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) { event.preventDefault(); keepSelection(); void insertImages(files); return; }
    // Formatting from Outlook, Word or a web page stays, within the email allowlist.
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitizeSignatureHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
    emit();
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    // Inserted where the image is dropped.
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
    void insertImages(files, range);
  };

  const applyLink = () => {
    const raw = linkUrl.trim();
    if (!raw) return;
    const url = /^[a-z]+:/i.test(raw) ? raw : `https://${raw}`;
    if (!safeEmailLink(url)) { toast.error('Use um endereço https://, mailto: ou tel:.'); return; }
    if (image) {
      const link = image.closest('a') ?? document.createElement('a');
      if (!link.parentNode) { image.replaceWith(link); link.append(image); }
      link.setAttribute('href', url);
      emit();
    } else command('createLink', url);
    setLinkOpen(false);
    setLinkUrl('');
  };
  const setImageWidth = (width: number) => {
    if (!image) return;
    if (width) image.setAttribute('width', String(width)); else image.removeAttribute('width');
    image.removeAttribute('height');
    emit();
  };
  const removeImage = () => {
    if (!image) return;
    (image.closest('a') && image.closest('a')!.childNodes.length === 1 ? image.closest('a')! : image).remove();
    setImage(null);
    emit();
  };
  useEffect(() => {
    editorRef.current?.querySelectorAll('img[data-selected]').forEach(node => node.removeAttribute('data-selected'));
    image?.setAttribute('data-selected', 'true');
    return () => image?.removeAttribute('data-selected');
  }, [image]);

  const tool = (label: string, icon: React.ReactNode, run: () => void, active = false) =>
    <Button key={label} type="button" variant="ghost" size="icon" className={cn('h-9 w-9 rounded-lg', active && 'bg-primary/10 text-primary')} aria-label={label} title={label}
      onMouseDown={event => event.preventDefault()} onClick={run}>{icon}</Button>;

  return <div className="overflow-hidden rounded-2xl border bg-card">
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1.5" role="toolbar" aria-label="Formatação da assinatura">
      <div className="mr-1 flex rounded-lg bg-background p-0.5 shadow-sm" role="tablist" aria-label="Modo do editor">
        <button type="button" role="tab" aria-selected={mode === 'visual'} className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', mode === 'visual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          onClick={() => setMode('visual')}><Eye className="h-3.5 w-3.5" />Visual</button>
        <button type="button" role="tab" aria-selected={mode === 'html'} className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', mode === 'html' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          onClick={() => { emit(); setImage(null); setMode('html'); }}><Code2 className="h-3.5 w-3.5" />HTML</button>
      </div>
      {mode === 'visual' && <>
        {tool('Desfazer', <Undo2 className="h-4 w-4" />, () => command('undo'))}
        {tool('Refazer', <Redo2 className="h-4 w-4" />, () => command('redo'))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {tool('Negrito', <Bold className="h-4 w-4" />, () => command('bold'))}
        {tool('Itálico', <Italic className="h-4 w-4" />, () => command('italic'))}
        {tool('Sublinhado', <Underline className="h-4 w-4" />, () => command('underline'))}
        <Select onValueChange={size => command('fontSize', size)}>
          <SelectTrigger aria-label="Tamanho do texto" className="h-9 w-[7.5rem] rounded-lg border-0 bg-transparent text-xs shadow-none" onMouseDown={keepSelection}><SelectValue placeholder="Tamanho" /></SelectTrigger>
          <SelectContent className="z-[80]">{SIZES.map(size => <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>)}</SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" aria-label="Cor do texto" title="Cor do texto" onMouseDown={keepSelection}><Palette className="h-4 w-4" /></Button></PopoverTrigger>
          <PopoverContent className="z-[80] grid w-auto grid-cols-4 gap-1.5 p-2" align="start">
            {COLORS.map(color => <button key={color} type="button" aria-label={`Cor ${color}`} className="h-7 w-7 rounded-full ring-1 ring-border transition-transform hover:scale-110" style={{ background: color }}
              onMouseDown={event => event.preventDefault()} onClick={() => command('foreColor', color)} />)}
          </PopoverContent>
        </Popover>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {tool('Lista com marcas', <List className="h-4 w-4" />, () => command('insertUnorderedList'))}
        {tool('Lista numerada', <ListOrdered className="h-4 w-4" />, () => command('insertOrderedList'))}
        {tool('Alinhar à esquerda', <AlignLeft className="h-4 w-4" />, () => command('justifyLeft'))}
        {tool('Centrar', <AlignCenter className="h-4 w-4" />, () => command('justifyCenter'))}
        {tool('Alinhar à direita', <AlignRight className="h-4 w-4" />, () => command('justifyRight'))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Popover open={linkOpen} onOpenChange={open => { if (open) keepSelection(); setLinkOpen(open); }}>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" aria-label="Inserir ligação" title="Inserir ligação" onMouseDown={event => event.preventDefault()}><Link2 className="h-4 w-4" /></Button></PopoverTrigger>
          <PopoverContent className="z-[80] w-80 space-y-2 p-3" align="start">
            <p className="text-sm font-medium">{image ? 'Ligação da imagem' : 'Ligação'}</p>
            <Input autoFocus value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="www.empresa.pt ou mailto:…"
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }} />
            <div className="flex justify-end"><Button type="button" size="sm" onClick={applyLink}>Aplicar</Button></div>
          </PopoverContent>
        </Popover>
        {tool('Inserir imagem', uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />, () => { keepSelection(); fileRef.current?.click(); })}
        {tool('Limpar formatação', <RemoveFormatting className="h-4 w-4" />, () => command('removeFormat'))}
      </>}
    </div>
    {mode === 'visual' ? <>
      <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Assinatura"
        className="webmail-signature-editor" onInput={emit} onKeyUp={keepSelection} onMouseUp={keepSelection} onBlur={() => { keepSelection(); emit(); }}
        onPaste={onPaste} onDrop={onDrop} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
        onClick={event => setImage(event.target instanceof HTMLImageElement ? event.target : null)} />
      {image && <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2 text-xs" role="group" aria-label="Imagem selecionada">
        <span className="font-medium">Imagem:</span>
        <span className="text-muted-foreground">Largura</span>
        {WIDTHS.map(width => <Button key={width.label} type="button" size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={() => setImageWidth(width.value)}>{width.label}</Button>)}
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={() => { setLinkUrl(image.closest('a')?.getAttribute('href') ?? ''); setLinkOpen(true); }}><Link2 className="mr-1 h-3.5 w-3.5" />Ligação</Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs text-destructive hover:text-destructive" onClick={removeImage}><Trash2 className="mr-1 h-3.5 w-3.5" />Remover</Button>
      </div>}
    </> : <div className="grid gap-0 md:grid-cols-2">
      <textarea aria-label="HTML da assinatura" value={value} onChange={event => onChange(event.target.value)} spellCheck={false}
        className="min-h-[220px] w-full resize-y border-b bg-background p-3 font-mono text-xs outline-none md:border-b-0 md:border-r" />
      <iframe title="Pré-visualização da assinatura" sandbox="" className="min-h-[220px] w-full bg-white"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'"><style>body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;margin:12px;color:#111827}img{max-width:100%;height:auto}</style></head><body>${sanitizeSignatureHtml(value)}</body></html>`} />
    </div>}
    <input ref={fileRef} type="file" accept={SIGNATURE_IMAGE_TYPES.join(',')} multiple hidden onChange={event => { void insertImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Arraste ou cole imagens (até 5 MB). As imagens ficam públicas para quem recebe o email as conseguir ver.</p>
  </div>;
}
