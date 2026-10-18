import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspacePage } from './workspaceNavigation';

interface WorkspaceTab { key: string; label: string; path: string }

function readTabs(key: string): WorkspaceTab[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((tab): tab is WorkspaceTab =>
      !!tab && typeof tab.key === 'string' && typeof tab.label === 'string'
      && typeof tab.path === 'string' && tab.path.startsWith('/') && !tab.path.startsWith('//'));
  } catch { return []; }
}

export function WorkspaceTabStrip({ scope }: { scope: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const storageKey = `senvia-workspace-tabs:${scope}`;
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => readTabs(storageKey));
  const current = getWorkspacePage(location.pathname);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    setTabs((existing) => {
      const tab = { key: current.key, label: current.label, path: currentPath };
      const index = existing.findIndex((item) => item.key === tab.key);
      if (index < 0) return [...existing.slice(-8), tab];
      if (existing[index].path === tab.path && existing[index].label === tab.label) return existing;
      return existing.map((item, at) => at === index ? tab : item);
    });
  }, [current.key, current.label, currentPath]);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(tabs)); } catch { /* Browsing still works without session storage. */ }
  }, [storageKey, tabs]);

  const close = (key: string) => {
    const index = tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const remaining = tabs.filter((tab) => tab.key !== key);
    if (current.key === key) navigate(remaining[Math.max(0, index - 1)]?.path ?? '/dashboard');
    setTabs(remaining);
  };

  // The route is the source of truth. Show it immediately, before the effect
  // persists it, so direct links never render an empty tab strip.
  const visibleTabs = tabs.some((tab) => tab.key === current.key)
    ? tabs : [...tabs, { key: current.key, label: current.label, path: currentPath }];

  return (
    <nav aria-label="Separadores abertos" className="flex h-12 min-w-0 items-end gap-1 overflow-x-auto bg-[#e9edf5] px-2 pt-1.5 sm:px-4">
      {visibleTabs.map((tab) => {
        const page = getWorkspacePage(tab.path);
        const active = tab.key === current.key;
        return <div key={tab.key} className={cn(
          'group flex h-10 min-w-[132px] max-w-[210px] shrink-0 items-center gap-2 rounded-t-xl px-3 text-xs transition-colors',
          active ? 'bg-[#f6f8fc] font-semibold text-[#19243a] shadow-[0_-2px_14px_rgba(16,30,62,.05)]' : 'text-[#68758d] hover:bg-white/50',
        )}>
          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', active ? 'bg-[#e1ebff] text-[#3778f6]' : 'bg-white/70 text-[#72809a]')}>
            <page.icon className="h-3.5 w-3.5" />
          </span>
          <button type="button" onClick={() => navigate(tab.path)} aria-current={active ? 'page' : undefined} title={tab.label}
            className="min-w-0 flex-1 truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-[#3778f6]">
            {tab.label}
          </button>
          <button type="button" onClick={() => close(tab.key)} aria-label={`Fechar ${tab.label}`} title={`Fechar ${tab.label}`}
            className="rounded-md p-0.5 text-[#8793a7] hover:bg-[#dbe3f1] hover:text-[#23324c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3778f6]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>;
      })}
    </nav>
  );
}
