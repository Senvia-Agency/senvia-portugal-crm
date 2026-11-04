import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { dateLocale, useLanguage } from "@/i18n";

interface ListItem {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
}

interface Props {
  lists: ListItem[];
  selectedListId: string;
  onSelectList: (id: string) => void;
  onCreateList: (name: string, description: string) => void;
  onConfirm: () => void;
  isCreating: boolean;
}

export function ImportStep3List({ lists, selectedListId, onSelectList, onCreateList, onConfirm, isCreating }: Props) {
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [tab, setTab] = useState<string>("select");
  const { t } = useLanguage();

  const filtered = lists.filter(l => l.name.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateList(newName, newDesc);
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="select">{t("Selecionar uma lista")}</TabsTrigger>
        <TabsTrigger value="create">{t("Criar uma lista")}</TabsTrigger>
      </TabsList>

      <TabsContent value="select" className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t("Pesquisar listas...")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <ScrollArea className="max-h-[250px]">
          <div className="space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("Nenhuma lista encontrada")}</p>
            ) : (
              filtered.map((list, idx) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => onSelectList(list.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-md flex items-center gap-3 transition-colors text-sm",
                    selectedListId === list.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                    selectedListId === list.id ? "border-primary" : "border-muted-foreground/30"
                  )}>
                    {selectedListId === list.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <span className="text-xs text-muted-foreground w-6">{idx + 1}</span>
                  <span className="flex-1 font-medium truncate">{list.name}</span>
                  <span className="text-xs text-muted-foreground">{t("{{n}} contactos", { n: list.member_count })}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {format(new Date(list.created_at), "dd MMM yyyy", { locale: dateLocale() })}
                  </span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            {selectedListId ? t("1 lista selecionada") : t("Nenhuma lista selecionada")}
          </p>
          <Button size="sm" onClick={onConfirm} disabled={!selectedListId}>{t("Confirmar lista")}</Button>
        </div>
      </TabsContent>

      <TabsContent value="create" className="space-y-4">
        <div className="space-y-2">
          <Label>{t("Nome da lista *")}</Label>
          <Input placeholder={t("Ex: Importação Fevereiro")} value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("Descrição (opcional)")}</Label>
          <Textarea placeholder={t("Breve descrição da lista...")} value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={!newName.trim() || isCreating}>
            {isCreating ? t("A criar...") : t("Criar e selecionar")}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
