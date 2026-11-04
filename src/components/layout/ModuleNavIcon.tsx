import type { ElementType } from 'react';
import { cn } from '@/lib/utils';
import { moduleOf } from './module-identity';
import { getWorkspacePage } from './workspaceNavigation';

type NavTone = 'overview' | 'communication' | 'commercial' | 'finance' | 'calendar' | 'feed' | 'chat' | 'tasks' | 'mail' | 'webmail' | 'neutral';

// Classic interface: one muted tone per group.
const routeTones: Readonly<Partial<Record<string, NavTone>>> = {
  '/dashboard': 'overview',
  '/feed': 'feed',
  '/mensagens': 'chat',
  '/tasks': 'tasks',
  '/inbox': 'communication',
  '/webmail': 'webmail',
  '/marketing': 'mail',
  '/leads': 'commercial',
  '/clients': 'commercial',
  '/proposals': 'commercial',
  '/sales': 'commercial',
  '/prospects': 'commercial',
  '/automacoes': 'commercial',
  '/financeiro': 'finance',
  '/calendar': 'calendar',
  '/ponto': 'tasks',
};

interface ModuleNavIconProps {
  readonly icon: ElementType;
  readonly to: string;
  readonly sidebar?: boolean;
  readonly locked?: boolean;
  readonly className?: string;
}

export function ModuleNavIcon({ icon: Icon, to, sidebar = false, locked = false, className }: ModuleNavIconProps) {
  return <span aria-hidden="true" data-nav-tone={routeTones[to] ?? 'neutral'} data-module={moduleOf(to)} className={cn(
    'module-nav-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
    sidebar && 'module-nav-icon--sidebar',
    locked && 'opacity-40 grayscale',
    className,
  )}>
    <Icon className="h-[18px] w-[18px]" />
  </span>;
}

/** The module's menu tile at the start of a page title, so the page carries the same colour and icon as its menu entry. */
export function PageModuleIcon({ to }: { readonly to: string }) {
  return <ModuleNavIcon icon={getWorkspacePage(to).icon} to={to} className="h-9 w-9" />;
}
