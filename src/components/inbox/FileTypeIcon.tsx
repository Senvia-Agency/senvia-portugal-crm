// File type icon with color-coded badge, Telegram-style.
// Each extension gets a distinct color so users can scan a list of files
// at a glance — PDF (red), DOC (blue), XLS (green), ZIP (amber), etc.
import {
  FileText, FileSpreadsheet, FileImage, FileArchive, FileAudio,
  FileVideo, FileType, FileCode, File as FileIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type FileMeta = { Icon: LucideIcon; color: string; bg: string };

const MAP: Record<string, FileMeta> = {
  // Documents
  pdf:  { Icon: FileText,       color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10' },
  doc:  { Icon: FileText,       color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-500/10' },
  docx: { Icon: FileText,       color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-500/10' },
  txt:  { Icon: FileText,       color: 'text-slate-600 dark:text-slate-400',  bg: 'bg-slate-500/10' },
  rtf:  { Icon: FileText,       color: 'text-slate-600 dark:text-slate-400',  bg: 'bg-slate-500/10' },
  odt:  { Icon: FileText,       color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10' },
  // Spreadsheets
  xls:  { Icon: FileSpreadsheet, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10' },
  xlsx: { Icon: FileSpreadsheet, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10' },
  csv:  { Icon: FileSpreadsheet, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  ods:  { Icon: FileSpreadsheet, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  // Images
  jpg:  { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  jpeg: { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  png:  { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  gif:  { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  webp: { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  svg:  { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  bmp:  { Icon: FileImage, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  // Archives
  zip:  { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  rar:  { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  '7z': { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  tar:  { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  gz:   { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  // Audio
  mp3:  { Icon: FileAudio, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10' },
  wav:  { Icon: FileAudio, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10' },
  ogg:  { Icon: FileAudio, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10' },
  m4a:  { Icon: FileAudio, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10' },
  flac: { Icon: FileAudio, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10' },
  // Video
  mp4:  { Icon: FileVideo, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
  mov:  { Icon: FileVideo, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
  avi:  { Icon: FileVideo, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
  mkv:  { Icon: FileVideo, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
  webm: { Icon: FileVideo, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
  // Code
  js:   { Icon: FileCode, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10' },
  ts:   { Icon: FileCode, color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10' },
  jsx:  { Icon: FileCode, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10' },
  tsx:  { Icon: FileCode, color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10' },
  html: { Icon: FileCode, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10' },
  css:  { Icon: FileCode, color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10' },
  json: { Icon: FileCode, color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-500/10' },
  xml:  { Icon: FileCode, color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-500/10' },
  // Presentation
  ppt:  { Icon: FileType, color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-500/10' },
  pptx: { Icon: FileType, color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-500/10' },
};

const DEFAULT: FileMeta = { Icon: FileIcon, color: 'text-slate-500', bg: 'bg-slate-500/10' };

export function getFileMeta(ext: string | null | undefined): FileMeta {
  if (!ext) return DEFAULT;
  return MAP[ext.toLowerCase()] ?? DEFAULT;
}

export function FileTypeIcon({
  extension,
  size = 'md',
  showLabel = false,
}: {
  extension: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}) {
  const meta = getFileMeta(extension);
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  const { Icon } = meta;
  return (
    <div className={`flex ${showLabel ? 'flex-col gap-1' : 'flex-row items-center'} `}>
      <div className={`flex ${dim} shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
        <Icon className={`${iconSize} ${meta.color}`} />
      </div>
      {showLabel && extension && (
        <span className={`text-[10px] font-bold uppercase ${meta.color}`}>
          {extension}
        </span>
      )}
    </div>
  );
}
