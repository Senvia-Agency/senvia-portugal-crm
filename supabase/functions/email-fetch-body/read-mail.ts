import { ImapFlow } from 'npm:imapflow@1.7.8';
import { simpleParser } from 'npm:mailparser@3.9.24';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'npm:ipaddr.js@2.5.0';

export async function readMailboxMessage(config: { host: string; port: number; secure: boolean; user: string; password: string }, folder: string, uid: number) {
  if (config.port !== 993 || !config.secure) throw new Error('Esta leitura requer IMAP com TLS na porta 993.');
  if (!config.host || config.host.length > 253 || /[\s/@\\%\[\]]/.test(config.host)) throw new Error('Servidor IMAP inválido.');
  const addresses = isIP(config.host) ? [{address:config.host}] : await lookup(config.host,{all:true});
  if (!addresses.length || addresses.some(({address}) => ipaddr.parse(address).range() !== 'unicast')) throw new Error('Servidor IMAP não público.');
  const client = new ImapFlow({ host: addresses[0].address, servername:config.host, port:993, secure:true,
    tls:{rejectUnauthorized:true,servername:config.host}, auth:{user:config.user,pass:config.password}, logger:false,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableAutoIdle:true });
  // Never print connection errors: providers may include account identifiers.
  client.on('error',()=>{});
  const timeout=setTimeout(()=>client.close(),45000);
  try {
    await client.connect();
    await client.mailboxOpen(folder,{readOnly:true});
    const envelope=await client.fetchOne(String(uid),{size:true},{uid:true});
    const maxBytes=15*1024*1024;
    if(!envelope)throw new Error('Mensagem não encontrada no servidor de correio.');
    if(typeof envelope.size !== 'number' || envelope.size>maxBytes)throw new Error('Este email excede o limite de leitura de 15 MB.');
    const fetched=await client.fetchOne(String(uid),{source:true},{uid:true});
    if(!fetched || !fetched.source)throw new Error('Mensagem sem conteúdo no servidor de correio.');
    if(fetched.source.length>maxBytes)throw new Error('Este email excede o limite de leitura de 15 MB.');
    const parsed=await simpleParser(fetched.source,{skipImageLinks:true});
    if(parsed.attachments.length>100)throw new Error('Este email tem demasiados anexos.');
    return { html:parsed.html || parsed.textAsHtml || null, text:parsed.text || null,
      attachments:parsed.attachments.map((a: any,index: number)=>({part_id:'edge:'+index,filename:a.filename || 'anexo',content_type:a.contentType,
        size:a.size,inline:!!a.related || a.contentDisposition==='inline',content_id:a.cid || null,data_b64:a.content.toString('base64')})) };
  } finally { clearTimeout(timeout); client.close(); }
}

