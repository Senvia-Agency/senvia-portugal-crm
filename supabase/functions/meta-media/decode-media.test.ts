import { decodeMediaBase64 } from "./decode-media.ts";

Deno.test("large WhatsApp document decoding stays within the edge memory budget", () => {
  // Given the observed failed document size, without any customer content.
  const size = 31_717_886;
  const base64 = "A".repeat(Math.ceil(size / 3) * 4 - 1) + "=";
  const before = Deno.memoryUsage().rss;
  // When decoding the same-sized payload used by the Evolution media route.
  const bytes = decodeMediaBase64(base64);
  const growth = Deno.memoryUsage().rss - before;
  // Then decoding is exact and leaves room for JSON within the 256 MiB edge limit.
  if (bytes.length !== size) throw new Error(`Incorrect decoded size: ${bytes.length}`);
  if (growth > 160 * 1024 * 1024) {
    throw new Error(`Decode allocated ${growth} bytes, exceeding the bounded 160 MiB budget`);
  }
});

Deno.test("media decoder preserves binary bytes and chunk boundaries", () => {
  // Given non-text bytes crossing a decoding chunk boundary.
  const expected = new Uint8Array(200_003);
  for (let i = 0; i < expected.length; i++) expected[i] = i % 256;
  const base64 = btoa(Array.from(expected, (byte) => String.fromCharCode(byte)).join(""));
  // When decoding the document.
  const actual = decodeMediaBase64(base64);
  // Then every byte matches, including final padding.
  if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
    throw new Error("Binary content changed during decoding");
  }
});
