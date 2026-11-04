import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n";

interface ShortcutItem {
  keys: string;
  description: string;
}

const SHORTCUT_GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: "Navegação",
    items: [
      { keys: "↑ / K", description: "Conversa anterior" },
      { keys: "↓ / J", description: "Próxima conversa" },
      { keys: "Enter", description: "Abrir conversa selecionada" },
      { keys: "/", description: "Focar pesquisa" },
      { keys: "Esc", description: "Fechar painel/conversa" },
    ],
  },
  {
    title: "Ações",
    items: [
      { keys: "E", description: "Arquivar conversa" },
      { keys: "C", description: "Nova conversa" },
      { keys: "Cmd/Ctrl+Enter", description: "Enviar mensagem" },
      { keys: "Cmd/Ctrl+K", description: "Command palette" },
      { keys: "Cmd/Ctrl+/", description: "Mostrar estes atalhos" },
    ],
  },
];

export function ShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Atalhos de teclado")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(group.title)}
              </h3>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">{t(item.description)}</span>
                    <kbd className="shrink-0 rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
