import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRef, useEffect, useState } from 'react';
import {
  Bold, Italic, Underline, Link as LinkIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Palette, Columns2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { insertEmailPaste, safeEmailLink, sanitizeEmailHtml } from '@/lib/email-html';

// Lightweight WYSIWYG editor (contentEditable + execCommand) used for email
// signatures and the vacation reply body. Produces HTML (innerHTML) that the
// email gateway sends as-is. Images are embedded inline as base64 data URLs.
//
// IMPORTANT: contentEditable is uncontrolled. The parent should remount this
// (via a `key`) when it wants to load a different initial value — the editor
// only reads `value` on mount.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 180,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layoutFileRef = useRef<HTMLInputElement>(null);
  const fontSelection = useRef<Range | null>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const selectedImg = useRef<HTMLImageElement | null>(null);
  const [imgSelected, setImgSelected] = useState(false);

  // Load the initial value once on mount.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeEmailHtml(value || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the HTML without the transient selection outline we add to images.
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('img').forEach((img) => {
      img.style.outline = '';
      if (!img.getAttribute('style')?.trim()) img.removeAttribute('style');
    });
    onChange(sanitizeEmailHtml(clone.innerHTML));
  };

  const clearImgSelection = () => {
    if (selectedImg.current) selectedImg.current.style.outline = '';
    selectedImg.current = null;
    setImgSelected(false);
  };

  // Click an image to select it; the size bar then lets the user resize it
  // (contentEditable gives no resize handles on its own).
  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') {
      if (selectedImg.current && selectedImg.current !== t) selectedImg.current.style.outline = '';
      selectedImg.current = t as HTMLImageElement;
      selectedImg.current.style.outline = '2px solid #3b82f6';
      setImgSelected(true);
    } else {
      clearImgSelection();
    }
  };

  const sizeImage = (width: string | null) => {
    const img = selectedImg.current;
    if (!img) return;
    if (width) { img.style.width = width; img.style.height = 'auto'; }
    else { img.style.width = ''; img.style.height = ''; } // original
    emit();
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const onPickImage = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      // Inline images live in the signature HTML — keep them small.
      alert('Imagem demasiado grande (máx. 2 MB para assinaturas).');
      return;
    }
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    ref.current?.focus();
    // Insert the image INLINE, surrounded by zero-width spaces, so the caret can
    // always land before AND after it (a leading <img> otherwise traps the caret
    // and you can't type in front of it). insertHTML lets us control the markup.
    const html = `​<img src="${dataUrl}" style="display:inline-block;vertical-align:middle;max-width:100%" />​`;
    document.execCommand('insertHTML', false, sanitizeEmailHtml(html));
    emit();
    if (fileRef.current) fileRef.current.value = '';
  };

  const addLink = () => {
    const url = window.prompt('URL do link:', 'https://');
    if (url && safeEmailLink(url)) exec('createLink', url);
  };

  // Read a file to a base64 data URL.
  const fileToDataUrl = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  // Insert a ready-made 2-column layout (logo on the left, editable text on the
  // right) — the email-safe way to get text beside an image. The user just edits
  // the right cell; no HTML knowledge needed.
  const onPickLayoutImage = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Imagem demasiado grande (máx. 2 MB).'); return; }
    const dataUrl = await fileToDataUrl(file);
    const html =
      `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif">` +
      `<tr>` +
      `<td style="vertical-align:middle;padding-right:16px"><img src="${dataUrl}" style="display:block;width:90px;height:auto" /></td>` +
      `<td style="vertical-align:middle;font-size:13px;color:#1f2937;line-height:1.6">` +
      `<div style="font-size:16px;font-weight:bold;color:#111827">O teu nome</div>` +
      `<div style="font-weight:bold;color:#2563eb">Empresa</div>` +
      `<div>email@empresa.com</div>` +
      `<div>+351 ...</div>` +
      `</td></tr></table><br>`;
    ref.current?.focus();
    document.execCommand('insertHTML', false, sanitizeEmailHtml(html));
    emit();
    if (layoutFileRef.current) layoutFileRef.current.value = '';
  };

  const Btn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep selection in the editor
      onClick={onClick}
      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
  const Sep = () => <div className="mx-1 h-4 w-px bg-border" />;

  return (
    <div className="rounded-md border bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        <Select value="" onOpenChange={open => { if (open) { const selection = window.getSelection(); fontSelection.current = selection?.rangeCount && ref.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null; } }} onValueChange={size => { ref.current?.focus(); if (fontSelection.current) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(fontSelection.current); } exec('fontSize', size); }}><SelectTrigger aria-label="Tamanho do texto" className="mr-1 h-7 w-28 px-2 text-xs"><SelectValue placeholder="Tamanho" /></SelectTrigger><SelectContent onCloseAutoFocus={event => { event.preventDefault(); ref.current?.focus(); }}><SelectItem value="2">Pequeno</SelectItem><SelectItem value="3">Normal</SelectItem><SelectItem value="5">Grande</SelectItem><SelectItem value="6">Enorme</SelectItem></SelectContent></Select>
        <Btn title="Negrito" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></Btn>
        <Btn title="Itálico" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></Btn>
        <Btn title="Sublinhado" onClick={() => exec('underline')}><Underline className="h-3.5 w-3.5" /></Btn>
        <Btn title="Cor do texto" onClick={() => colorRef.current?.click()}><Palette className="h-3.5 w-3.5" /></Btn>
        <input
          ref={colorRef}
          type="color"
          className="absolute h-0 w-0 opacity-0"
          onChange={(e) => exec('foreColor', e.target.value)}
        />
        <Sep />
        <Btn title="Link" onClick={addLink}><LinkIcon className="h-3.5 w-3.5" /></Btn>
        <Btn title="Imagem" onClick={() => fileRef.current?.click()}><ImageIcon className="h-3.5 w-3.5" /></Btn>
        <Btn title="Imagem + texto ao lado (logo à esquerda)" onClick={() => layoutFileRef.current?.click()}><Columns2 className="h-3.5 w-3.5" /></Btn>
        <Sep />
        <Btn title="Alinhar à esquerda" onClick={() => exec('justifyLeft')}><AlignLeft className="h-3.5 w-3.5" /></Btn>
        <Btn title="Centrar" onClick={() => exec('justifyCenter')}><AlignCenter className="h-3.5 w-3.5" /></Btn>
        <Btn title="Alinhar à direita" onClick={() => exec('justifyRight')}><AlignRight className="h-3.5 w-3.5" /></Btn>
        <Sep />
        <Btn title="Lista" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></Btn>
        <Btn title="Lista numerada" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></Btn>
      </div>

      {/* Image size bar — appears when an image is selected (click it). */}
      {imgSelected && (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-blue-500/5 px-3 py-1.5 text-xs">
          <span className="mr-1 font-medium text-muted-foreground">Tamanho da imagem:</span>
          {[
            { label: 'Pequena', w: '120px' },
            { label: 'Média', w: '240px' },
            { label: 'Grande', w: '480px' },
            { label: '100%', w: '100%' },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => sizeImage(opt.w)}
              className="rounded border bg-background px-2 py-0.5 hover:bg-accent"
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => sizeImage(null)}
            className="rounded border bg-background px-2 py-0.5 hover:bg-accent"
          >
            Original
          </button>
        </div>
      )}

      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(event) => { insertEmailPaste(event); emit(); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        onBlur={emit}
        onClick={onEditorClick}
        className={cn(
          'overflow-y-auto px-3 py-2.5 text-sm outline-none',
          'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_img]:inline-block [&_img]:max-w-full [&_img]:align-middle',
        )}
        style={{ minHeight }}
      />

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0] ?? null)} />
      <input ref={layoutFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickLayoutImage(e.target.files?.[0] ?? null)} />
    </div>
  );
}
