import { useState } from "react";
import { Search, UserMinus, UserPlus, Loader2, Users, Pencil, Check, X, ArrowRightCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useContactListMembers, useRemoveListMember, useAddListMembers, useUpdateContactList, useMarketingContacts, type ContactList } from "@/hooks/useContactLists";
import { ConvertToLeadModal } from "@/components/marketing/ConvertToLeadModal";
import { normalizeString } from "@/lib/utils";
import type { MarketingContact } from "@/types/marketing";
import { useLanguage } from "@/i18n";

interface Props {
  list: ContactList | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ListDetailsModal({ list, open, onOpenChange }: Props) {
  const { data: members = [], isLoading } = useContactListMembers(list?.id ?? null);
  const removeMember = useRemoveListMember();
  const addMembers = useAddListMembers();
  const updateList = useUpdateContactList();
  const { data: allContacts = [] } = useMarketingContacts();
  const { t } = useLanguage();

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const [editingList, setEditingList] = useState(false);
  const [listName, setListName] = useState("");
  const [listDesc, setListDesc] = useState("");
  const [selectedForConvert, setSelectedForConvert] = useState<string[]>([]);
  const [showConvertModal, setShowConvertModal] = useState(false);

  if (!list) return null;

  const memberIds = new Set(members.map(m => m.contact_id));
  const availableContacts = allContacts.filter(c => !memberIds.has(c.id));
  const filteredAvailable = availableContacts.filter(c => {
    if (!search) return true;
    const q = normalizeString(search);
    return normalizeString(c.name).includes(q) || normalizeString(c.email || '').includes(q) || normalizeString(c.phone || '').includes(q);
  });

  const filteredMembers = members.filter(m => {
    if (!memberSearch) return true;
    const q = normalizeString(memberSearch);
    return normalizeString(m.contact?.name || '').includes(q) || normalizeString(m.contact?.email || '').includes(q) || normalizeString(m.contact?.phone || '').includes(q);
  });

  const handleAddSelected = async () => {
    if (selected.length === 0) return;
    await addMembers.mutateAsync({ listId: list.id, contactIds: selected });
    setSelected([]);
    setShowAdd(false);
  };

  const startEditList = () => {
    setEditingList(true);
    setListName(list.name);
    setListDesc(list.description || "");
  };

  const saveList = async () => {
    await updateList.mutateAsync({ id: list.id, name: listName, description: listDesc || undefined });
    setEditingList(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        <div className="p-6 pb-0 max-w-3xl mx-auto w-full">
          <DialogHeader>
            {editingList ? (
              <div className="space-y-2">
                <Input value={listName} onChange={e => setListName(e.target.value)} placeholder={t("Nome da lista")} className="text-lg font-semibold" />
                <Textarea value={listDesc} onChange={e => setListDesc(e.target.value)} placeholder={t("Descrição (opcional)")} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveList} disabled={!listName.trim() || updateList.isPending}>
                    <Check className="h-4 w-4 mr-1" /> {t("Guardar")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingList(false)}>
                    <X className="h-4 w-4 mr-1" /> {t("Cancelar")}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  {list.name}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={startEditList}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </DialogTitle>
                {list.description && <p className="text-sm text-muted-foreground mt-1">{list.description}</p>}
              </div>
            )}
          </DialogHeader>

          <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
            <Badge variant="secondary">{t("{{n}} contacto(s)", { n: members.length })}</Badge>
            <div className="flex gap-2">
              {selectedForConvert.length > 0 && (
                <Button size="sm" onClick={() => setShowConvertModal(true)}>
                  <ArrowRightCircle className="h-4 w-4 mr-1" /> {t("Converter {{n}} em Leads", { n: selectedForConvert.length })}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
                <UserPlus className="h-4 w-4 mr-1" /> {t("Adicionar")}
              </Button>
            </div>
          </div>

          {showAdd && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30 mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder={t("Pesquisar contactos de marketing...")} value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
              </div>
              <ScrollArea className="max-h-[150px]">
                <div className="space-y-1">
                  {filteredAvailable.map(c => (
                    <div key={c.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}>
                      <Checkbox checked={selected.includes(c.id)} />
                      <span className="text-sm font-medium truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{c.email}</span>
                    </div>
                  ))}
                  {filteredAvailable.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t("Nenhum contacto disponível")}</p>}
                </div>
              </ScrollArea>
              <Button size="sm" onClick={handleAddSelected} disabled={selected.length === 0 || addMembers.isPending}>
                {t("Adicionar {{n}} selecionado(s)", { n: selected.length })}
              </Button>
            </div>
          )}

          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t("Pesquisar membros por nome, email ou telefone...")} value={memberSearch} onChange={e => setMemberSearch(e.target.value)} className="pl-10" />
          </div>
        </div>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="max-w-3xl mx-auto w-full">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filteredMembers.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">{memberSearch ? t("Nenhum resultado encontrado") : t("Lista vazia")}</p>
            ) : (
              <div className="space-y-1">
                {filteredMembers.map(m => (
                  <div key={m.id} className="border rounded-lg p-3 hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedForConvert.includes(m.contact_id)}
                        onCheckedChange={(checked) => {
                          setSelectedForConvert(prev =>
                            checked ? [...prev, m.contact_id] : prev.filter(id => id !== m.contact_id)
                          );
                        }}
                      />
                      <div className="flex items-center justify-between flex-1 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{m.contact?.name}</p>
                            {(m.contact as any)?.converted_to_lead && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{t("Convertido")}</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <p className="text-xs text-muted-foreground truncate">{m.contact?.email}</p>
                            {m.contact?.phone && <p className="text-xs text-muted-foreground truncate">{m.contact.phone}</p>}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeMember.mutate({ listId: list.id, contactId: m.contact_id })}>
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>

      <ConvertToLeadModal
        open={showConvertModal}
        onOpenChange={setShowConvertModal}
        contacts={members
          .filter(m => selectedForConvert.includes(m.contact_id) && m.contact)
          .map(m => m.contact as MarketingContact)}
        onSuccess={() => setSelectedForConvert([])}
      />
    </Dialog>
  );
}
