import { useMemo, useState } from "react";
import { Plus, ArrowLeft, Mail, Search, X, Tags } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TemplatesTable } from "@/components/marketing/TemplatesTable";
import { CreateTemplateModal } from "@/components/marketing/CreateTemplateModal";
import { TemplateCategoriesManager } from "@/components/marketing/TemplateCategoriesManager";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EditTemplateModal } from "@/components/marketing/EditTemplateModal";
import { SendTemplateModal } from "@/components/marketing/SendTemplateModal";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useEmailTemplateCategories } from "@/hooks/useEmailTemplateCategories";
import { normalizeString } from "@/lib/utils";
import type { EmailTemplate } from "@/types/marketing";

const ALL_CATEGORIES = "__all__";

export default function Templates() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState<EmailTemplate | null>(null);
  const { data: templates, isLoading } = useEmailTemplates();

  const [search, setSearch] = useState("");
  const [category, setCategory] = usePersistedState("templates-category-v1", ALL_CATEGORIES);

  const { data: categories } = useEmailTemplateCategories();

  const filtered = useMemo(() => {
    const term = normalizeString(search.trim());
    return (templates ?? []).filter((template) => {
      if (category !== ALL_CATEGORIES && (template.category_id ?? "") !== category) return false;
      if (!term) return true;
      // Name and subject both: half these templates are told apart by the
      // subject line, not the name.
      return normalizeString(template.name).includes(term)
        || normalizeString(template.subject ?? "").includes(term);
    });
  }, [templates, search, category]);

  const filtering = search.trim().length > 0 || category !== ALL_CATEGORIES;

  return (
    <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/marketing">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Mail className="h-5 w-5 shrink-0 text-primary" />
                Templates de Email
              </h1>
              <p className="text-sm text-muted-foreground">
                Crie templates reutilizáveis para as suas campanhas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Categories are managed here, beside the templates they sort. */}
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tags className="mr-2 h-4 w-4" />
              Categorias
            </Button>
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Template
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar por nome ou assunto..."
              className="pl-9"
              aria-label="Pesquisar templates"
            />
          </div>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="sm:w-56" aria-label="Filtrar por categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>Todas as categorias</SelectItem>
              {(categories ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtering && (
            <Button
              variant="ghost"
              onClick={() => { setSearch(""); setCategory(ALL_CATEGORIES); }}
              className="shrink-0"
            >
              <X className="mr-2 h-4 w-4" />
              Limpar
            </Button>
          )}
        </div>

        {filtering && !isLoading && (
          <p className="-mt-3 text-sm text-muted-foreground">
            {filtered.length} de {templates?.length ?? 0} templates
          </p>
        )}

        {/* Table */}
        <TemplatesTable
          templates={filtered}
          isLoading={isLoading}
          onEdit={setEditingTemplate}
          onSend={setSendingTemplate}
        />

        {/* Manage categories */}
        <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Categorias de templates</DialogTitle>
              <DialogDescription>
                Crie, renomeie ou remova categorias. Apagar uma nunca apaga templates.
              </DialogDescription>
            </DialogHeader>
            <TemplateCategoriesManager />
          </DialogContent>
        </Dialog>

        {/* Create Modal */}
        <CreateTemplateModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
        />

        {/* Edit Modal */}
        <EditTemplateModal
          template={editingTemplate}
          open={!!editingTemplate}
          onOpenChange={(open) => !open && setEditingTemplate(null)}
        />

        {/* Send Modal */}
        <SendTemplateModal
          template={sendingTemplate}
          open={!!sendingTemplate}
          onOpenChange={(open) => !open && setSendingTemplate(null)}
        />
    </div>
  );
}
