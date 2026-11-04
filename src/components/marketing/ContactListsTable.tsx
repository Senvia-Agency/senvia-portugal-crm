import { format } from "date-fns";
import { dateLocale, useLanguage } from "@/i18n";
import { MoreHorizontal, Eye, Trash2, Users, Bot } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ContactList } from "@/hooks/useContactLists";

interface Props {
  lists: ContactList[];
  onView: (list: ContactList) => void;
  onDelete: (id: string) => void;
}

export function ContactListsTable({ lists, onView, onDelete }: Props) {
  const isMobile = useIsMobile();
  const { t } = useLanguage();

  if (lists.length === 0) {
    return (
      <div className="text-center py-12">
        <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">{t("Nenhuma lista criada")}</p>
      </div>
    );
  }

  const NameWithBadge = ({ list }: { list: ContactList }) => (
    <div className="flex items-center gap-2">
      <span className="font-medium truncate">{list.name}</span>
      {list.is_system && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 shrink-0">
          <Bot className="h-3 w-3" />
          {t("Auto")}
        </Badge>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="space-y-3">
        {lists.map(list => (
          <Card key={list.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => onView(list)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <NameWithBadge list={list} />
                  {list.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{list.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">{t("{{n}} contacto(s)", { n: list.member_count })}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(list.created_at), "dd MMM yyyy", { locale: dateLocale() })}
                    </span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(list); }}>
                      <Eye className="h-4 w-4 mr-2" /> {t("Ver")}
                    </DropdownMenuItem>
                    {!list.is_system && (
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(list.id); }}>
                        <Trash2 className="h-4 w-4 mr-2" /> {t("Eliminar")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Nome")}</TableHead>
            <TableHead>{t("Descrição")}</TableHead>
            <TableHead className="text-center">{t("Contactos")}</TableHead>
            <TableHead>{t("Criado em")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map(list => (
            <TableRow key={list.id} className="cursor-pointer" onClick={() => onView(list)}>
              <TableCell><NameWithBadge list={list} /></TableCell>
              <TableCell className="text-muted-foreground text-sm">{list.description || "—"}</TableCell>
              <TableCell className="text-center">
                <Badge variant="secondary">{list.member_count}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(list.created_at), "dd MMM yyyy", { locale: dateLocale() })}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(list); }}>
                      <Eye className="h-4 w-4 mr-2" /> {t("Ver detalhes")}
                    </DropdownMenuItem>
                    {!list.is_system && (
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(list.id); }}>
                        <Trash2 className="h-4 w-4 mr-2" /> {t("Eliminar")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
