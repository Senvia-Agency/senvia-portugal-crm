import { useEffect, useMemo } from 'react';
import { FileText, X } from 'lucide-react';
import { fileLabel, isImageMime } from './feed-files';

/** Files chosen for the next publication: photo thumbnails and document chips, each removable. */
export function ComposerFiles({ files, onRemove, disabled }: { files: readonly File[]; onRemove: (index: number) => void; disabled: boolean }) {
  const previews = useMemo(() => files.map(file => isImageMime(file.type) ? URL.createObjectURL(file) : null), [files]);
  useEffect(() => () => previews.forEach(url => url && URL.revokeObjectURL(url)), [previews]);
  if (files.length === 0) return null;
  return <ul className="feed-composer-files mt-3 flex flex-wrap gap-2" aria-label="Ficheiros a publicar">
    {files.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="relative">
      {previews[index]
        ? <img src={previews[index]!} alt={file.name} className="h-20 w-20 rounded-2xl object-cover ring-1 ring-border" />
        : <span className="flex h-20 max-w-[15rem] items-center gap-2.5 rounded-2xl bg-muted/70 px-3 ring-1 ring-border">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white"><FileText className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{file.name}</span><span className="text-[11.5px] font-normal text-muted-foreground">{fileLabel({ name: file.name, mime: file.type, size: file.size })}</span></span>
          </span>}
      <button type="button" disabled={disabled} onClick={() => onRemove(index)} aria-label={`Remover ${file.name}`}
        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow ring-2 ring-card disabled:opacity-50">
        <X className="h-3.5 w-3.5" />
      </button>
    </li>)}
  </ul>;
}
