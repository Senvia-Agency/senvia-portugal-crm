// OpenClaw /v1/responses supports PDF/document input; /chat/completions does not.
// Keep the CRM's existing tool loop contract while adapting the wire protocol.
function source(dataUrl: string, filename?: string) {
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid inline attachment');
  return { type: 'base64', media_type: match[1], data: match[2], ...(filename ? { filename } : {}) };
}
export function toOpenClawInput(messages: any[]): any[] {
  return messages.flatMap(message => {
    // Preserve returned output items, including ids and provider metadata.
    if (message._openclaw_output) return message._openclaw_output;
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    const content = typeof message.content === 'string' ? message.content : (message.content || []).map((part: any) => {
      if (part.type === 'text') return { type: 'input_text', text: part.text };
      if (part.type === 'image_url') return { type: 'input_image', source: source(part.image_url.url) };
      if (part.type === 'file') return { type: 'input_file', source: source(part.file.file_data, part.file.filename) };
      throw new Error('Unsupported attachment content');
    });
    const output: any[] = content ? [{ type: 'message', role: message.role, content }] : [];
    for (const call of message.tool_calls || []) output.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return output;
  });
}
export function fromOpenClawResponse(result: any) {
  if (result.error || result.status === 'failed' || result.status === 'incomplete') throw new Error('OpenClaw não concluiu a análise.');
  const output = result.output || [];
  const content = output.filter((item: any) => item.type === 'message').flatMap((item: any) => item.content || [])
    .filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('\n');
  const calls = output.filter((item: any) => item.type === 'function_call').map((item: any) => ({
    id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments },
  }));
  return { choices: [{ message: { role: 'assistant', content, tool_calls: calls, _openclaw_output: output } }] };
}
