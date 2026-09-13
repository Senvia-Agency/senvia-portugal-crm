import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOttoFiles } from './otto-attachments.ts';
import { loadAttachmentParts, validAttachmentPath } from '../../supabase/functions/otto/lib/attachments.ts';
import { toOpenClawInput, fromOpenClawResponse } from '../../supabase/functions/otto/lib/openclaw.ts';

test('multi-file paste/drop caps aggregate count and preserves valid following files', () => {
  const files = Array.from({ length: 7 }, (_, i) => new File(['hello'], `${i}.txt`, { type: 'text/plain' }));
  const result = selectOttoFiles([],files);
  assert.equal(result.files.length,5); assert.equal(result.errors.length,1);
  const mixed = selectOttoFiles([], [new File(['x'],'x.exe'),files[0]]);
  assert.equal(mixed.files.length,1); assert.equal(mixed.errors.length,1);
});
test('attachments are scoped to their tenant and reject encoded traversal', () => {
  for(const path of ['other/x.png','org/../x','org/%2e/x','org/a\\b','org/x?token=1']) assert.equal(validAttachmentPath(path,'org'),false);
  assert.equal(validAttachmentPath('org/id_image.png','org'),true);
});
test('private image bytes become actual multimodal input, and disguised content is rejected', async () => {
  const storage = { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}) }) }) };
  const parts = await loadAttachmentParts(storage,['org/screen.png'],'org');
  assert.equal(parts[1].type,'image_url'); assert.match(parts[1].image_url.url,/^data:image\/png;base64,/);
  const wire = toOpenClawInput([{role:'user',content:parts}]);
  assert.equal(wire[0].content[1].type,'input_image'); assert.equal(wire[0].content[1].source.type,'base64');
  await assert.rejects(loadAttachmentParts({from:()=>({download:async()=>({data:new Blob(['<script>'],{type:'image/png'})})})},['org/x.png'],'org'),/formato/);
});
test('PDF input reaches OpenClaw as a file and function calls preserve identifiers', async () => {
  const parts = await loadAttachmentParts({from:()=>({download:async()=>({data:new Blob(['%PDF-test'],{type:'application/pdf'})})})},['org/test.pdf'],'org');
  const wire = toOpenClawInput([{role:'user',content:parts}]);
  assert.equal(wire[0].content[1].type,'input_file'); assert.equal(wire[0].content[1].source.media_type,'application/pdf');
  const output = [{type:'function_call',id:'item1',call_id:'call1',name:'get_client',arguments:'{"id":"x"}'}];
  const message = fromOpenClawResponse({status:'completed',output}).choices[0].message;
  assert.deepEqual(toOpenClawInput([message,{role:'tool',tool_call_id:'call1',content:'{"ok":true}'}]), [...output,{type:'function_call_output',call_id:'call1',output:'{"ok":true}'}]);
});
