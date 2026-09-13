export const OTTO_ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json']);
const EXTENSIONS: Record<string, string> = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json' };
export function normalizeOttoFile(file: File): File {
  if (file.type) return file;
  const type = EXTENSIONS[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}
export function selectOttoFiles(existing: File[], incoming: File[]): { files: File[]; errors: string[] } {
  const files: File[] = []; const errors: string[] = [];
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  for (const raw of incoming) {
    const file = normalizeOttoFile(raw);
    if (existing.length + files.length >= 5) { errors.push('Máximo de 5 anexos por mensagem.'); break; }
    if (!OTTO_ACCEPTED_TYPES.has(file.type)) { errors.push(`${file.name}: formato não suportado. Usa JPG, PNG, WebP, PDF, TXT, CSV, Markdown ou JSON.`); continue; }
    const limit = (file.type.startsWith('image/') ? 10 : 5) * 1024 * 1024;
    if (!file.size || file.size > limit || total + file.size > 12 * 1024 * 1024) { errors.push(`${file.name}: imagens até 10 MB, documentos até 5 MB e 12 MB no total.`); continue; }
    total += file.size; files.push(file);
  }
  return { files, errors };
}
