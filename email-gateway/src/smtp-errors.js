// nodemailer's errors are English and technical ("Invalid login: 535 5.7.8 …").
// The person sending needs to know, in pt-PT, what to fix — and the server's own
// reply, which is often the only thing that names the real cause.

export function smtpErrorMessage(err, server) {
  const reply = String(err?.response || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const said = reply ? ` O servidor respondeu: «${reply}»` : '';
  const where = server ? ` (${server})` : '';
  const code = err?.code;
  const status = Number(err?.responseCode) || 0;

  if (code === 'EAUTH' || status === 535 || status === 534 || status === 530) {
    return `O servidor de envio${where} recusou o utilizador ou a palavra-passe. Confirme a palavra-passe SMTP da caixa.${said}`;
  }
  if (code === 'ETLS') {
    return `A ligação segura ao servidor de envio${where} falhou. Confirme a porta SMTP (465 ou 587).${said}`;
  }
  if (code === 'EDNS' || code === 'ECONNECTION' || code === 'ETIMEDOUT' || (code === 'ESOCKET' && err?.command === 'CONN')) {
    return `Não foi possível ligar ao servidor de envio${where}. Confirme o servidor e a porta SMTP, ou tente daqui a pouco.${said}`;
  }
  if (code === 'EENVELOPE') {
    const rejected = Array.isArray(err?.rejected) ? err.rejected.join(', ') : '';
    return rejected
      ? `O servidor de envio recusou o destinatário ${rejected}.${said}`
      : `O servidor de envio recusou o remetente ou os destinatários.${said}`;
  }
  if (status === 552 || /message (size|too (large|big))|exceeds|too large/i.test(reply)) {
    return `A mensagem é demasiado grande para o servidor de envio. Reduza os anexos.${said}`;
  }
  if ([421, 450, 451, 452].includes(status)) {
    return `O servidor de envio está ocupado ou limitou os envios por agora. Tente daqui a alguns minutos.${said}`;
  }
  if (status >= 550 && status < 560) return `O servidor de envio recusou a mensagem.${said}`;
  if (code === 'EMESSAGE' || code === 'ESTREAM') return `O servidor de envio não aceitou a mensagem.${said}`;
  if (code === 'ESOCKET') return `A ligação ao servidor de envio${where} caiu durante o envio. Confirme em Enviados antes de voltar a enviar.${said}`;
  return `O envio falhou: ${err?.message || 'erro desconhecido'}`;
}

// Only failures before the server accepted anything can be retried: a second
// attempt after the message went out would send it twice.
export function retryableBeforeSend(err) {
  return err?.command === 'CONN' || err?.code === 'ECONNECTION' || err?.code === 'EDNS';
}
