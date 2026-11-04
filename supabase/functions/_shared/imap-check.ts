// Logs in to an IMAP server once, so a mailbox is only saved when it really
// opens. Implicit TLS (port 993) only: plain connections and STARTTLS are not
// tried, and their result is "unchecked". Nothing is read from the mailbox.

export type ImapCheck =
  | { ok: true }
  | { ok: false; reason: 'auth' | 'unreachable' | 'timeout' | 'protocol' | 'microsoft'; message: string }
  | { ok: null; message: string };

/** Microsoft turned off password (basic) sign-in for IMAP: these servers need OAuth. */
export const isMicrosoftHost = (host: string) =>
  /(^|\.)(outlook\.office365\.com|outlook\.com|office365\.com|hotmail\.com|live\.com)$/i.test(host.trim());

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function checkImapLogin(host: string, port: number, ssl: boolean, user: string, password: string, timeoutMs = 12000): Promise<ImapCheck> {
  if (isMicrosoftHost(host)) {
    return { ok: false, reason: 'microsoft', message: 'As caixas Outlook, Hotmail e Microsoft 365 ainda não podem ser ligadas: a Microsoft só aceita o início de sessão Microsoft, que o Senvia ainda não tem.' };
  }
  if (!ssl || port !== 993) return { ok: null, message: 'Ligação sem TLS na porta 993: não foi testada.' };

  let conn: Deno.TlsConn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch { /* already closed */ } }, timeoutMs);
  try {
    conn = await Deno.connectTls({ hostname: host.trim(), port });
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    const readUntil = async (done: (text: string) => boolean) => {
      const chunk = new Uint8Array(4096);
      while (!done(buffer)) {
        const n = await conn!.read(chunk);
        if (n === null) throw new Error('closed');
        buffer += decoder.decode(chunk.subarray(0, n));
        if (buffer.length > 65536) throw new Error('too long');
      }
    };
    await readUntil(t => /\r\n/.test(t));
    if (!/^\* (OK|PREAUTH)/i.test(buffer)) return { ok: false, reason: 'protocol', message: 'O servidor não respondeu como um servidor IMAP.' };
    buffer = '';
    await conn.write(encoder.encode(`a1 LOGIN ${quote(user)} ${quote(password)}\r\n`));
    await readUntil(t => /(^|\r\n)a1 (OK|NO|BAD)/i.test(t));
    const ok = /(^|\r\n)a1 OK/i.test(buffer);
    try { await conn.write(encoder.encode('a2 LOGOUT\r\n')); } catch { /* best effort */ }
    if (ok) return { ok: true };
    const gmail = /gmail|google/i.test(host);
    return {
      ok: false, reason: 'auth',
      message: gmail
        ? 'O Gmail recusou o acesso. Use uma palavra-passe de aplicação (conta Google → Segurança → Verificação em dois passos → Palavras-passe de aplicação), não a palavra-passe normal.'
        : 'O servidor recusou o email ou a palavra-passe. Confirme os dados (alguns fornecedores exigem uma palavra-passe de aplicação).',
    };
  } catch (e) {
    const timedOut = (e as Error)?.message === 'closed' || (e instanceof Deno.errors.BadResource) || (e instanceof Deno.errors.Interrupted);
    return timedOut
      ? { ok: false, reason: 'timeout', message: 'O servidor IMAP não respondeu a tempo. Confirme o servidor e a porta.' }
      : { ok: false, reason: 'unreachable', message: 'Não foi possível ligar ao servidor IMAP. Confirme o endereço e a porta (normalmente 993).' };
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* already closed */ }
  }
}
