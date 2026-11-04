import { useState } from "react";
import { FolderTree, Plus, Edit, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useCategories, useUpdateCategory, useDeleteCategory } from "@/hooks/ecommerce";
import { ProductCategory } from "@/types/ecommerce";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { EditCategoryModal } from "./EditCategoryModal";
import { useLanguage } from "@/i18n";

export function CategoriesTable() {
  const { data: categories, isLoading } = useCategories();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const { t } = useLanguage();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<ProductCategory | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleToggleActive = (category: ProductCategory) => {
    updateCategory.mutate({
      id: category.id,
      is_active: !category.is_active,
    });
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteCategory.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t((categories?.length || 0) === 1 ? "{{n}} categoria" : "{{n}} categorias", { n: categories?.length || 0 })}
        </p>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t("Nova Categoria")}
        </Button>
      </div>

      {categories?.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <FolderTree className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">{t("Sem categorias")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Crie categorias para organizar os seus produtos.")}
          </p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4">
            <Plus className="mr-2 h-4 w-4" />
            {t("Criar Categoria")}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Nome")}</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>{t("Posição")}</TableHead>
                <TableHead>{t("Ativo")}</TableHead>
                <TableHead className="text-right">{t("Ações")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories?.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {category.image_url ? (
                        <img
                          src={category.image_url}
                          alt={category.name}
                          className="h-10 w-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                          <FolderTree className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{category.name}</div>
                        {category.description && (
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {category.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {category.slug}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{category.position}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={category.is_active ?? false}
                      onCheckedChange={() => handleToggleActive(category)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditCategory(category)}
                        title={t("Editar")}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(category.id)}
                        title={t("Eliminar")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modals */}
      <CreateCategoryModal open={createOpen} onOpenChange={setCreateOpen} />
      
      {editCategory && (
        <EditCategoryModal
          category={editCategory}
          open={!!editCategory}
          onOpenChange={(open) => !open && setEditCategory(null)}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar Categoria")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tem a certeza que deseja eliminar esta categoria? Os produtos associados perderão a categoria.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
