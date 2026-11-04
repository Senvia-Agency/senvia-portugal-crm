/**
 * Length of an MP4 / MOV (ISO base media file) read straight from its header, without playing it.
 *
 * Phone videos (an iPhone's HEVC .mov, for instance) often cannot be decoded by the browser of a
 * computer, so a <video> element cannot tell their length — but the container always says it, in the
 * "mvhd" box inside "moov". Walks the top-level boxes (a handful, even for a 500 MB file) and reads it.
 */
interface SliceableFile { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }

const MOOV_READ_LIMIT = 8 * 1024 * 1024;

const fourcc = (view: DataView, offset: number) =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/** Seconds from the bytes of a "moov" box payload, or null. */
export function durationFromMoov(payload: ArrayBuffer): number | null {
  const view = new DataView(payload);
  let offset = 0;
  while (offset + 8 <= view.byteLength) {
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let header = 8;
    if (size === 1 && offset + 16 <= view.byteLength) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
    if (size < header) return null;
    if (type === "mvhd") {
      const body = offset + header;
      const version = view.getUint8(body);
      if (version === 1 && body + 32 <= view.byteLength) {
        const timescale = view.getUint32(body + 20);
        const duration = Number(view.getBigUint64(body + 24));
        return timescale > 0 ? duration / timescale : null;
      }
      if (body + 20 <= view.byteLength) {
        const timescale = view.getUint32(body + 12);
        const duration = view.getUint32(body + 16);
        return timescale > 0 ? duration / timescale : null;
      }
      return null;
    }
    offset += size;
  }
  return null;
}

/** Seconds of an MP4/MOV file, or null when it is not one (or the header cannot be read). */
export async function readMp4Duration(file: SliceableFile): Promise<number | null> {
  try {
    let offset = 0;
    // A real file has a few top-level boxes; the cap stops a corrupt one from looping.
    for (let boxes = 0; boxes < 64 && offset + 8 <= file.size; boxes++) {
      const head = new DataView(await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer());
      if (head.byteLength < 8) return null;
      let size = head.getUint32(0);
      const type = fourcc(head, 4);
      let header = 8;
      if (size === 1 && head.byteLength >= 16) { size = Number(head.getBigUint64(8)); header = 16; }
      else if (size === 0) size = file.size - offset; // runs to the end of the file
      if (size < header) return null;
      if (type === "moov") {
        const end = Math.min(offset + size, offset + header + MOOV_READ_LIMIT, file.size);
        return durationFromMoov(await file.slice(offset + header, end).arrayBuffer());
      }
      offset += size;
    }
    return null;
  } catch {
    return null;
  }
}
