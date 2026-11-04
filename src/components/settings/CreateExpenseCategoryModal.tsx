import { useLanguage } from '@/i18n';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateExpenseCategory } from '@/hooks/useExpenseCategories';

const CATEGORY_COLORS = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

interface CreateExpenseCategoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateExpenseCategoryModal({ open, onOpenChange }: CreateExpenseCategoryModalProps) {
  const { t } = useLanguage();
  const createCategory = useCreateExpenseCategory();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createCategory.mutate(
      { name: name.trim(), description: description.trim() || undefined, color },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
          setColor(CATEGORY_COLORS[0]);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Nova Categoria de Despesa')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">{t('Nome *')}</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Ex: Marketing')}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-desc">{t('Descrição')}</Label>
            <Textarea
              id="cat-desc"
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
            <Button type="submit" disabled={createCategory.isPending || !name.trim()}>
              {createCategory.isPending ? t('A criar...') : t('Criar')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
