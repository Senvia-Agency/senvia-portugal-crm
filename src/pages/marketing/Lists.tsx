import { useState } from "react";
import { Plus, Upload, Loader2, ArrowLeft, List } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ContactListsTable } from "@/components/marketing/ContactListsTable";
import { CreateListModal } from "@/components/marketing/CreateListModal";
import { ListDetailsModal } from "@/components/marketing/ListDetailsModal";
import { ImportContactsModal } from "@/components/marketing/ImportContactsModal";
import { useContactLists, useDeleteContactList, type ContactList } from "@/hooks/useContactLists";
import { useLanguage } from "@/i18n";

export default function Lists() {
  const { data: lists = [], isLoading } = useContactLists();
  const deleteList = useDeleteContactList();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<ContactList | null>(null);

  return (
    <>
      <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="back" size="icon" className="h-8 w-8" onClick={() => navigate("/marketing")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <List className="h-5 w-5 shrink-0 text-primary" />
                {t("Listas de Transmissão")}
              </h1>
              <p className="text-muted-foreground text-sm">{t("Gira listas de contactos para campanhas")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> {t("Importar")}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> {t("Nova Lista")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <ContactListsTable lists={lists} onView={setSelectedList} onDelete={(id) => deleteList.mutate(id)} />
        )}
      </div>

      <CreateListModal open={createOpen} onOpenChange={setCreateOpen} />
      <ListDetailsModal list={selectedList} open={!!selectedList} onOpenChange={(o) => !o && setSelectedList(null)} />
      <ImportContactsModal open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
