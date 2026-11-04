import { useEffect, useState } from 'react';
import { Plus, X, Tags, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useProductTypes, useSaveProductTypes } from '@/hooks/useProductTypes';
import { useServicosProducts } from '@/hooks/useServicosProducts';
import { DEFAULT_PRODUCT_TYPES, type ProductType } from '@/types/product-types';
import { useLanguage } from '@/i18n';

/** A stable id from the name, unique within the list. */
function slugify(name: string, taken: Set<string>): string {
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tipo';
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * The organization's product types — just the list of names. Cartões,
 * Energia, Gás, Fibra, Satélite to start with, plus whatever else it sells.
 *
 * How each type pays is NOT configured here: the five seeded ones carry their
 * own rules (see DEFAULT_PRODUCT_TYPES), and a type added here behaves like
 * Energia — the operator pays X, the seller gets Y.
 */
export function ProductTypesManager() {
  const { all } = useProductTypes();
  const save = useSaveProductTypes();
  const { catalog } = useServicosProducts();
  const [draft, setDraft] = useState<ProductType[]>(all);
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState('');
  const { t: tl } = useLanguage();

  // Follow the stored list until the user starts editing, so a save made
  // elsewhere is not overwritten by a stale draft.
  useEffect(() => {
    if (!dirty) setDraft(all);
  }, [all, dirty]);

  /** How many catalog products sit under each type. */
  const usage = new Map<string, number>();
  for (const p of catalog ?? []) {
    for (const id of p.type_ids ?? []) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  const rename = (id: string, name: string) => {
    setDirty(true);
    setDraft((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (draft.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(tl('Já existe um tipo com esse nome.'));
      return;
    }
    // A seeded name typed back in gets its seeded rules; anything else pays
    // like Energia.
    const seeded = DEFAULT_PRODUCT_TYPES.find((t) => t.name.toLowerCase() === name.toLowerCase());
    setDirty(true);
    setDraft((prev) => [
      ...prev,
      seeded ?? { id: slugify(name, new Set(prev.map((t) => t.id))), name, shape: 'operator_seller' },
    ]);
    setNewName('');
  };

  const remove = (id: string) => {
    const used = usage.get(id) ?? 0;
    if (used > 0) {
      toast.error(tl(used === 1 ? 'Este tipo está em {{n}} produto. Tira-o dos produtos primeiro.' : 'Este tipo está em {{n}} produtos. Tira-o dos produtos primeiro.', { n: used }));
      return;
    }
    setDirty(true);
    setDraft((prev) => prev.filter((t) => t.id !== id));
  };

  const commit = () => {
    if (draft.some((t) => !t.name.trim())) {
      toast.error(tl('Há um tipo sem nome.'));
      return;
    }
    save.mutate(draft.map((t) => ({ ...t, name: t.name.trim() })), {
      onSuccess: () => {
        setDirty(false);
        toast.success(tl('Tipos guardados.'));
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tags className="h-4 w-4" />
              {tl('Tipos de produto')}
            </CardTitle>
            <CardDescription>
              {tl('Cada produto pertence a um ou mais tipos, e a venda começa por escolher um.')}
            </CardDescription>
          </div>
          {dirty && (
            <Button type="button" size="sm" onClick={commit} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {tl('Guardar')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {draft.map((type) => {
            const used = usage.get(type.id) ?? 0;
            return (
              <div key={type.id} className="flex items-center gap-1.5 rounded-md border bg-muted/20 pl-2 pr-1 py-1">
                <Input
                  value={type.name}
                  onChange={(e) => rename(type.id, e.target.value)}
                  className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1"
                />
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-muted-foreground">
                  {used}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  title={used > 0 ? tl('Em uso — tira-o dos produtos primeiro') : tl('Eliminar tipo')}
                  onClick={() => remove(type.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 max-w-sm">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={tl('Novo tipo (ex.: Alarme)')}
            className="h-8 text-sm"
          />
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={add} disabled={!newName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            {tl('Adicionar')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
