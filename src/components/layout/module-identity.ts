// Workplace: every module keeps its own colour wherever it appears (menu, page
// header, small marks), so people learn to find a module by its colour. The
// colours themselves live in workplace.css ([data-module='…'] → --module-tone).
const routeModules: Readonly<Record<string, string>> = {
  '/dashboard': 'dashboard',
  '/feed': 'feed',
  '/mensagens': 'messages',
  '/inbox': 'inbox',
  '/webmail': 'webmail',
  '/marketing': 'marketing',
  '/tasks': 'tasks',
  '/calendar': 'calendar',
  '/ponto': 'timeclock',
  '/indicacoes': 'referrals',
  '/novidades': 'news',
  '/leads': 'leads',
  '/clients': 'clients',
  '/proposals': 'proposals',
  '/sales': 'sales',
  '/prospects': 'prospects',
  '/financeiro': 'finance',
  '/automacoes': 'automations',
};

/** The module a route belongs to ("/sales/123" → "sales"); unknown routes are neutral. */
export function moduleOf(pathname: string): string {
  return routeModules[`/${pathname.split('/').filter(Boolean)[0] ?? 'dashboard'}`] ?? 'neutral';
}
