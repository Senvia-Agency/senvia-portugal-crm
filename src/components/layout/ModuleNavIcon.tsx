import type { ElementType } from 'react';
import { cn } from '@/lib/utils';

type NavTone = 'communication' | 'commercial' | 'finance' | 'calendar' | 'neutral';

const routeTones: Readonly<Partial<Record<string, NavTone>>> = {
  '/dashboard': 'communication',
  '/inbox': 'communication',
  '/marketing': 'communication',
  '/leads': 'commercial',
  '/clients': 'commercial',
  '/proposals': 'commercial',
  '/sales': 'commercial',
  '/prospects': 'commercial',
  '/automacoes': 'commercial',
  '/financeiro': 'finance',
  '/calendar': 'calendar',
};

interface ModuleNavIconProps {
  readonly icon: ElementType;
  readonly to: string;
  readonly sidebar?: boolean;
  readonly locked?: boolean;
}

export function ModuleNavIcon({ icon: Icon, to, sidebar = false, locked = false }: ModuleNavIconProps) {
  return <span aria-hidden="true" data-nav-tone={routeTones[to] ?? 'neutral'} className={cn(
    'module-nav-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
    sidebar && 'module-nav-icon--sidebar',
    locked && 'opacity-40 grayscale',
  )}>
    <Icon className="h-[18px] w-[18px]" />
  </span>;
}
