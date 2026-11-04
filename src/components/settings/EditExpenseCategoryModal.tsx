import { useLanguage } from '@/i18n';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateExpenseCategory } from '@/hooks/useExpenseCategories';
import type { ExpenseCategory } from '@/types/expenses';

const CATEGORY_COLORS = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

interface EditExpenseCategoryModalProps {
  category: ExpenseCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditExpenseCategoryModal({ category, open, onOpenChange }: EditExpenseCategoryModalProps) {
  const { t } = useLanguage();
  const updateCategory = useUpdateExpenseCategory();

  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description || '');
  const [color, setColor] = useState(category.color);

  useEffect(() => {
    setName(category.name);
    setDescription(category.description || '');
    setColor(category.color);
  }, [category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    updateCategory.mutate(
      { id: category.id, name: name.trim(), description: description.trim() || null, color },
      {
        onSuccess: () => onOpenChange(false),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Editar Categoria')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-cat-name">{t('Nome *')}</Label>
            <Input
              id="edit-cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Ex: Marketing')}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-cat-desc">{t('Descrição')}</Label>
            <Textarea
              id="edit-cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Descrição opcional...')}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Cor')}</Label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    color === c ? 'border-foreground scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancelar')}
            </Button>
            <Button type="submit" disabled={updateCategory.isPending || !name.trim()}>
              {updateCategory.isPending ? t('A guardar...') : t('Guardar')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
