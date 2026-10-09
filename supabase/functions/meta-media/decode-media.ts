const BASE64_CHUNK_SIZE = 65_536;

export function decodeMediaBase64(base64: string): Uint8Array<ArrayBuffer> {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(Math.floor(base64.length * 3 / 4) - padding);
  let offset = 0;
  // Keep only one small decoded string; Array.from on a whole document creates
  // an intermediate array large enough to terminate the edge worker.
  for (let start = 0; start < base64.length; start += BASE64_CHUNK_SIZE) {
    const chunk = atob(base64.slice(start, start + BASE64_CHUNK_SIZE));
    for (let index = 0; index < chunk.length; index++) {
      bytes[offset++] = chunk.charCodeAt(index);
    }
  }
  return bytes;
}
