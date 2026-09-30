import { MoreHorizontal, Pencil, Copy, Trash2, Eye, EyeOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteEmailTemplate, useDuplicateEmailTemplate, useUpdateEmailTemplate } from "@/hooks/useEmailTemplates";
import { TEMPLATE_CATEGORIES, type EmailTemplate } from "@/types/marketing";
import { useEmailTemplateCategories } from "@/hooks/useEmailTemplateCategories";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { useState, useMemo } from "react";

interface TemplatesTableProps {
  templates: EmailTemplate[];
  isLoading: boolean;
  onEdit: (template: EmailTemplate) => void;
  onSend: (template: EmailTemplate) => void;
}

export function TemplatesTable({ templates, isLoading, onEdit, onSend }: TemplatesTableProps) {
  // One lookup for the whole table instead of a find() per row.
  const { data: categories } = useEmailTemplateCategories();
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  );

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTemplate = useDeleteEmailTemplate();
  const duplicateTemplate = useDuplicateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();

  const handleDelete = async () => {
    if (deleteId) {
      await deleteTemplate.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const handleToggleActive = async (template: EmailTemplate) => {
    await updateTemplate.mutateAsync({
      id: template.id,
      is_active: !template.is_active,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Eye className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-semibold">Sem templates</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Crie o seu primeiro template de email para começar.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden sm:table-cell">Categoria</TableHead>
              <TableHead className="hidden md:table-cell">Assunto</TableHead>
              <TableHead className="hidden lg:table-cell">Atualizado</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  {/* The organization's own category when there is one. The
                      legacy text column is the fallback for anything not yet
                      migrated, and its raw value beats the empty chip that a
                      missing label used to produce. */}
                  {(() => {
                    const own = categoryById.get(template.category_id ?? "");
                    if (own) {
                      return (
                        <Badge
                          variant="secondary"
                          style={own.color ? { backgroundColor: own.color + "1f", color: own.color } : undefined}
                        >
                          {own.name}
                        </Badge>
                      );
                    }
                    const legacy = TEMPLATE_CATEGORIES[template.category] ?? template.category;
                    return (
                      <Badge variant="secondary" className={legacy ? undefined : "text-muted-foreground"}>
                        {legacy || "Sem categoria"}
                      </Badge>
                    );
                  })()}
                </TableCell>
                <TableCell className="hidden md:table-cell max-w-[200px] truncate">
                  {template.subject}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                  {format(new Date(template.updated_at), "dd MMM yyyy", { locale: pt })}
                </TableCell>
                <TableCell>
                  <Badge variant={template.is_active ? "default" : "secondary"}>
                    {template.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onSend(template)}>
                        <Send className="mr-2 h-4 w-4" />
                        Enviar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onEdit(template)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateTemplate.mutate(template.id)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActive(template)}>
                        {template.is_active ? (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" />
                            Desativar
                          </>
                        ) : (
                          <>
                            <Eye className="mr-2 h-4 w-4" />
                            Ativar
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteId(template.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar template?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. O template será permanentemente eliminado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
