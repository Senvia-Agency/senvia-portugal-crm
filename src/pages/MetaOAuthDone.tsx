import { useEffect, useState } from 'react';
import { tr, useLanguage } from '@/i18n';

/**
 * Fim do login da Meta — a última paragem do popup.
 *
 * Porque é que isto existe: o popup do OAuth acaba na edge function, e a
 * Supabase serve TUDO como `text/plain` com `X-Content-Type-Options: nosniff`.
 * O Content-Type que a função define é ignorado, por isso o browser mostra o
 * HTML como texto em vez de o correr — a janela ficava aberta com código à
 * vista e o utilizador tinha de a fechar à mão.
 *
 * Não há forma de contornar isso do lado da função. A saída é o popup voltar ao
 * NOSSO domínio, onde o HTML é HTML: a `meta-connect` redireciona para aqui e
 * esta página faz o que a função não conseguia — avisar a janela que a abriu e
 * fechar-se.
 *
 * O resultado viaja no fragmento (`#`), não na query: assim não fica nos
 * registos de acesso do servidor nem no histórico partilhado.
 */
export default function MetaOAuthDone() {
  const { t } = useLanguage();
  const [presa, setPresa] = useState(false);

  useEffect(() => {
    let payload: Record<string, unknown> = {};
    try {
      const bruto = window.location.hash.replace(/^#/, '');
      if (bruto) payload = JSON.parse(decodeURIComponent(escape(atob(bruto))));
    } catch {
      payload = { error: tr('Resposta da Meta ilegível. Tente ligar outra vez.') };
    }

    // O CRM está à espera desta mensagem para saber que a caixa foi criada.
    // Mesma origem — não é preciso abrir o alvo a '*'.
    window.opener?.postMessage({ type: 'meta-oauth', ...payload }, window.location.origin);

    window.close();
    // Se o browser recusar fechar (acontece quando a janela não foi aberta por
    // script), mostra-se uma mensagem em condições em vez de um ecrã em branco.
    const t = window.setTimeout(() => setPresa(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  if (!presa) return null;

  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <p className="text-sm font-medium">{t('Ligação concluída.')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('Pode fechar esta janela.')}</p>
      </div>
    </div>
  );
}
