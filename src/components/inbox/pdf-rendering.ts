export function isPdfDocument(filename: string, mime = ''): boolean {
  return /\.pdf$/i.test(filename.trim()) || mime.split(';')[0].trim().toLowerCase() === 'application/pdf';
}

export function pdfOutputScale(width: number, height: number, pixelRatio: number): number {
  return Math.min(Math.max(1, pixelRatio), 2, Math.sqrt(8_000_000 / (width * height)));
}
