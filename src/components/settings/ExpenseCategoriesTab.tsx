import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useExpenseCategories, useDeleteExpenseCategory } from '@/hooks/useExpenseCategories';
import { CreateExpenseCategoryModal } from './CreateExpenseCategoryModal';
import { EditExpenseCategoryModal } from './EditExpenseCategoryModal';
import type { ExpenseCategory } from '@/types/expenses';
import { useLanguage } from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ExpenseCategoriesTab() {
  const { data: categories, isLoading } = useExpenseCategories();
  const deleteCategory = useDeleteExpenseCategory();
  const { t } = useLanguage();

  const [showCreate, setShowCreate] = useState(false);
  const [editCategory, setEditCategory] = useState<ExpenseCategory | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = () => {
    if (deleteId) {
      deleteCategory.mutate(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{t('Tipos de Despesas')}</CardTitle>
          <CardDescription>{t('Categorias para organizar as suas despesas')}</CardDescription>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Adicionar')}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !categories || categories.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>{t('Nenhuma categoria criada.')}</p>
            <p className="text-sm">{t('Clique em "Adicionar" para criar a primeira.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <div>
                    <p className="font-medium">{category.name}</p>
                    {category.description && (
                      <p className="text-sm text-muted-foreground">{category.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditCategory(category)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteId(category.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CreateExpenseCategoryModal open={showCreate} onOpenChange={setShowCreate} />
      
      {editCategory && (
        <EditExpenseCategoryModal
          category={editCategory}
          open={!!editCategory}
          onOpenChange={(open) => !open && setEditCategory(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remover categoria?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('A categoria será desativada. As despesas existentes mantêm o registo.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('Remover')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
