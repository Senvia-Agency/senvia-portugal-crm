import { parseAudioInput, readAudioBody } from './audio-input.ts';

const input = {
  organization_id: '11111111-1111-4111-8111-111111111111',
  message_id: '22222222-2222-4222-8222-222222222222',
  media_id: '123456789',
};

Deno.test('rejects caller-controlled audio URLs before any download', () => {
  if (parseAudioInput({ ...input, url: 'https://127.0.0.1/private' }).success) {
    throw new Error('Legacy arbitrary URL must not be accepted');
  }
});

Deno.test('accepts a message attachment identity', () => {
  if (!parseAudioInput(input).success) throw new Error('Valid attachment rejected');
});

Deno.test('accepts a WhatsApp QR attachment id', () => {
  if (!parseAudioInput({ ...input, media_id: '3A21965641AA9360AD2B' }).success) throw new Error('QR id rejected');
});

Deno.test('rejects an id with path characters', () => {
  if (parseAudioInput({ ...input, media_id: '../secret' }).success) throw new Error('Path-like id accepted');
});

Deno.test('rejects an excessive declared audio size', async () => {
  const response = new Response('audio', { headers: { 'content-length': '100' } });
  try {
    await readAudioBody(response, 4);
  } catch (error) {
    if (error instanceof RangeError) return;
    throw error;
  }
  throw new Error('Declared oversized audio accepted');
});

Deno.test('caps streaming audio even without content-length', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5]));
      controller.close();
    },
  }));
  try {
    await readAudioBody(response, 4);
  } catch (error) {
    if (error instanceof RangeError) return;
    throw error;
  }
  throw new Error('Streaming size limit bypassed');
});

Deno.test('preserves permitted audio bytes', async () => {
  const blob = await readAudioBody(new Response(new Uint8Array([1, 2, 3])), 3);
  const result = new Uint8Array(await blob.arrayBuffer());
  if (result.join(',') !== '1,2,3') throw new Error('Audio data changed');
});
