import type { ReactNode } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/i18n';

export type ExportKind = 'excel' | 'csv';

interface ExportMenuProps {
  /** How many rows the export takes: the list as filtered on screen. */
  readonly count: number;
  /** "propostas", "vendas"… — names what goes out. */
  readonly noun: string;
  readonly onExport: (kind: ExportKind) => void;
  readonly busy?: boolean;
  /** Extra formats a given organization needs, under the two standard ones. */
  readonly children?: ReactNode;
}

/** The "Exportar ▾" button every list page shares: the filtered list to Excel or CSV. */
export function ExportMenu({ count, noun, onExport, busy = false, children }: ExportMenuProps) {
  const { t } = useLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 shrink-0 rounded-full px-3" disabled={busy} aria-label={t('Exportar {{noun}}', { noun: t(noun) })}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("Exportar")}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {count === 0 ? t('Sem {{noun}} para exportar', { noun: t(noun) }) : t('{{n}} {{noun}} da lista atual', { n: count, noun: t(noun) })}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={count === 0} onSelect={() => onExport('excel')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={count === 0} onSelect={() => onExport('csv')}>
          <FileText className="mr-2 h-4 w-4" />CSV
        </DropdownMenuItem>
        {children && <><DropdownMenuSeparator />{children}</>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
