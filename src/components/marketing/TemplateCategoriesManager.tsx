import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  useEmailTemplateCategories,
  useCreateEmailTemplateCategory,
  useUpdateEmailTemplateCategory,
  useDeleteEmailTemplateCategory,
} from '@/hooks/useEmailTemplateCategories';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import type { EmailTemplateCategoryRow } from '@/types/marketing';

/** Same swatches the expense categories offer, so the two screens match. */
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

/**
 * Categories live next to the templates they organize. This is the whole
 * screen, shown inside a dialog opened from the templates list.
 */
export function TemplateCategoriesManager() {
  const { data: categories, isLoading } = useEmailTemplateCategories();
  const { data: templates } = useEmailTemplates();
  const deleteCategory = useDeleteEmailTemplateCategory();

  const [editing, setEditing] = useState<EmailTemplateCategoryRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplateCategoryRow | null>(null);

  // How many templates each category holds. Shown on the row, and again on the
  // delete confirmation — deleting is safe, but nobody should have to guess
  // how much it touches.
  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const template of templates ?? []) {
      if (template.category_id) tally[template.category_id] = (tally[template.category_id] ?? 0) + 1;
    }
    return tally;
  }, [templates]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setEditing('new')} className="gap-2">
          <Plus className="h-4 w-4" />
          Adicionar categoria
        </Button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !categories?.length ? (
          <div className="py-8 text-center text-muted-foreground">
            <p>Nenhuma categoria criada.</p>
            <p className="text-sm">Clique em "Adicionar" para criar a primeira.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((category) => {
              const used = counts[category.id] ?? 0;
              return (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: category.color ?? '#6366f1' }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{category.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {used === 1 ? '1 template' : `${used} templates`}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(category)} aria-label={`Editar ${category.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(category)}
                      aria-label={`Remover ${category.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CategoryDialog
        category={editing}
        onClose={() => setEditing(null)}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {(counts[deleting?.id ?? ''] ?? 0) > 0
                ? `Os ${counts[deleting?.id ?? ''] } templates desta categoria não são apagados: ficam sem categoria e pode atribuir outra depois.`
                : 'Esta categoria não está a ser usada por nenhum template.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) deleteCategory.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Create and rename share one dialog: the fields are the same two. */
function CategoryDialog({
  category,
  onClose,
}: {
  category: EmailTemplateCategoryRow | 'new' | null;
  onClose: () => void;
}) {
  const create = useCreateEmailTemplateCategory();
  const update = useUpdateEmailTemplateCategory();

  const existing = category && category !== 'new' ? category : null;
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  // Seeded when the dialog opens rather than on every render, so typing is not
  // overwritten by the row it came from.
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = existing?.id ?? (category === 'new' ? 'new' : null);
  if (key && seeded !== key) {
    setSeeded(key);
    setName(existing?.name ?? '');
    setColor(existing?.color ?? COLORS[0]);
  }

  const busy = create.isPending || update.isPending;
  const valid = name.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    const done = { onSuccess: () => { setSeeded(null); onClose(); } };
    if (existing) update.mutate({ id: existing.id, name, color }, done);
    else create.mutate({ name, color }, done);
  };

  return (
    <Dialog open={!!category} onOpenChange={(open) => { if (!open) { setSeeded(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Editar categoria' : 'Nova categoria'}</DialogTitle>
          <DialogDescription>
            {existing
              ? 'O novo nome aparece em todos os templates desta categoria.'
              : 'Fica disponível ao criar ou editar qualquer template.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-category-name">Nome</Label>
            <Input
              id="template-category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
              placeholder="Ex.: Trial, Onboarding, Reativação"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Cor ${swatch}`}
                  aria-pressed={color === swatch}
                  className={
                    color === swatch
                      ? 'h-8 w-8 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'h-8 w-8 rounded-full ring-1 ring-border'
                  }
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setSeeded(null); onClose(); }}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {existing ? 'Guardar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
