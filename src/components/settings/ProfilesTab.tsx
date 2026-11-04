import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  useOrganizationProfiles,
  OrganizationProfile,
  GranularPermissions,
  MODULE_SCHEMA,
  ACTION_LABELS,
  buildDefaultPermissions,
  buildAllPermissions,
  DataScope,
  DATA_SCOPE_LABELS,
  DATA_SCOPE_DESCRIPTIONS,
  ProfileDashboardWidget,
} from '@/hooks/useOrganizationProfiles';
import { useAuth } from '@/contexts/AuthContext';
import { WIDGET_DEFINITIONS, WidgetType, filterWidgetsByModules, getAllAvailableWidgets, isWidgetForNiche, type NicheType } from '@/lib/dashboard-templates';
import { Shield, Plus, Pencil, Trash2, Loader2, Eye, LayoutDashboard, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/i18n';

const BASE_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  viewer: 'Visualizador',
  salesperson: 'Comercial',
};

export function ProfilesTab() {
  const { profiles, isLoading, createProfile, updateProfile, deleteProfile } = useOrganizationProfiles();
  const { organization } = useAuth();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<OrganizationProfile | null>(null);

  const [name, setName] = useState('');
  const [baseRole, setBaseRole] = useState<string>('salesperson');
  const [dataScope, setDataScope] = useState<DataScope>('own');
  const [permissions, setPermissions] = useState<GranularPermissions>(buildDefaultPermissions('salesperson'));
  const [useCustomDashboard, setUseCustomDashboard] = useState(false);
  const [dashboardWidgets, setDashboardWidgets] = useState<ProfileDashboardWidget[]>([]);

  const enabledModules = (organization?.enabled_modules as Record<string, boolean>) || {
    sales: true, proposals: true, calendar: true, ecommerce: false,
  };

  const availableWidgets = getAllAvailableWidgets().filter(w => {
    if (w.requiredModule && enabledModules[w.requiredModule] === false) return false;
    // Same rule as the "Editar Dashboard" dialog: don't offer a widget this
    // org's niche never renders.
    if (!isWidgetForNiche(w.type, organization?.niche as NicheType)) return false;
    return true;
  });

  const openCreate = () => {
    setEditingProfile(null);
    setName('');
    setBaseRole('salesperson');
    setDataScope('own');
    setPermissions(buildDefaultPermissions('salesperson'));
    setUseCustomDashboard(false);
    setDashboardWidgets([]);
    setIsOpen(true);
  };

  const openEdit = (profile: OrganizationProfile) => {
    setEditingProfile(profile);
    setName(profile.name);
    setBaseRole(profile.base_role);
    setDataScope(profile.data_scope || 'own');
    setPermissions(profile.module_permissions);
    setUseCustomDashboard(!!profile.dashboard_widgets);
    setDashboardWidgets(profile.dashboard_widgets || []);
    setIsOpen(true);
  };

  const handleBaseRoleChange = (role: string) => {
    setBaseRole(role);
    if (!editingProfile) {
      setPermissions(buildDefaultPermissions(role));
    }
  };

  const toggleAction = (module: string, subarea: string, action: string) => {
    setPermissions(prev => {
      const mod = prev[module];
      const sub = mod?.subareas?.[subarea] || {};
      const newValue = !sub[action];
      const newSub = { ...sub, [action]: newValue };
      if (action === 'view' && !newValue) {
        for (const k of Object.keys(newSub)) newSub[k] = false;
      }
      if (action !== 'view' && newValue) {
        newSub.view = true;
      }
      return {
        ...prev,
        [module]: {
          subareas: { ...mod?.subareas, [subarea]: newSub },
        },
      };
    });
  };

  const setModuleAll = (module: string, value: boolean) => {
    setPermissions(prev => {
      const schema = MODULE_SCHEMA[module];
      if (!schema) return prev;
      const subareas: Record<string, Record<string, boolean>> = {};
      for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
        const actions: Record<string, boolean> = {};
        for (const action of subSchema.actions) actions[action] = value;
        subareas[subKey] = actions;
      }
      return { ...prev, [module]: { subareas } };
    });
  };

  const isModuleAllEnabled = (module: string): boolean => {
    const mod = permissions[module];
    if (!mod?.subareas) return false;
    const schema = MODULE_SCHEMA[module];
    if (!schema) return false;
    for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
      for (const action of subSchema.actions) {
        if (!mod.subareas[subKey]?.[action]) return false;
      }
    }
    return true;
  };

  const isModulePartial = (module: string): boolean => {
    const mod = permissions[module];
    if (!mod?.subareas) return false;
    let hasTrue = false, hasFalse = false;
    const schema = MODULE_SCHEMA[module];
    if (!schema) return false;
    for (const [subKey, subSchema] of Object.entries(schema.subareas)) {
      for (const action of subSchema.actions) {
        if (mod.subareas[subKey]?.[action]) hasTrue = true;
        else hasFalse = true;
      }
    }
    return hasTrue && hasFalse;
  };

  const toggleDashboardWidget = (widgetType: WidgetType) => {
    setDashboardWidgets(prev => {
      const exists = prev.find(w => w.type === widgetType);
      if (exists) return prev.filter(w => w.type !== widgetType);
      return [...prev, { type: widgetType, is_visible: true }];
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const dw = useCustomDashboard ? dashboardWidgets : null;
    if (editingProfile) {
      updateProfile.mutate({ id: editingProfile.id, name: name.trim(), base_role: baseRole, module_permissions: permissions, data_scope: dataScope, dashboard_widgets: dw }, {
        onSuccess: () => setIsOpen(false),
      });
    } else {
      createProfile.mutate({ name: name.trim(), base_role: baseRole, module_permissions: permissions, data_scope: dataScope, dashboard_widgets: dw }, {
        onSuccess: () => setIsOpen(false),
      });
    }
  };

  const handleDelete = (profile: OrganizationProfile) => {
    if (profile.is_default) return;
    deleteProfile.mutate(profile.id);
  };

  const getActiveModules = (perms: GranularPermissions): string[] => {
    return Object.entries(MODULE_SCHEMA)
      .filter(([key]) => {
        const mod = perms[key];
        if (!mod?.subareas) return false;
        return Object.values(mod.subareas).some(sub => Object.values(sub).some(v => v));
      })
      .map(([, schema]) => schema.label);
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  }

  // ── Full-page editor view ──
  if (isOpen) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="back" size="icon" onClick={() => setIsOpen(false)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{editingProfile ? t('Editar Perfil') : t('Criar Perfil')}</h2>
            <p className="text-sm text-muted-foreground">{t('Configure permissões granulares por módulo e sub-área.')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left column */}
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('Informações Gerais')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('Nome do Perfil')}</Label>
                  <Input placeholder={t('Ex: Diretor Comercial')} value={name} onChange={e => setName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>{t('Função Base')}</Label>
                  <Select value={baseRole} onValueChange={handleBaseRoleChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t('Administrador')}</SelectItem>
                      <SelectItem value="viewer">{t('Visualizador')}</SelectItem>
                      <SelectItem value="salesperson">{t('Comercial', { context: 'role' })}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('Define as políticas de segurança base.')}</p>
                </div>

                <div className="space-y-2">
                  <Label>{t('Visibilidade de Dados')}</Label>
                  <Select value={dataScope} onValueChange={(v) => setDataScope(v as DataScope)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['own', 'team', 'all'] as DataScope[]).map(scope => (
                        <SelectItem key={scope} value={scope}>
                          {t(DATA_SCOPE_LABELS[scope])} — {t(DATA_SCOPE_DESCRIPTIONS[scope])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('Define de quem o utilizador pode ver os dados.')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('Permissões por Módulo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="border rounded-lg">
                  {Object.entries(MODULE_SCHEMA).map(([moduleKey, schema]) => {
                    const allEnabled = isModuleAllEnabled(moduleKey);
                    const partial = isModulePartial(moduleKey);

                    return (
                      <AccordionItem key={moduleKey} value={moduleKey} className="border-b last:border-b-0">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center gap-3 flex-1">
                            <span className="font-medium text-sm">{t(schema.label)}</span>
                            {allEnabled && <Badge variant="secondary" className="text-xs">{t('Tudo')}</Badge>}
                            {partial && !allEnabled && <Badge variant="outline" className="text-xs">{t('Parcial')}</Badge>}
                            {!allEnabled && !partial && <Badge variant="outline" className="text-xs text-muted-foreground">{t('Desativado')}</Badge>}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="flex gap-2 mb-3">
                            <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={() => setModuleAll(moduleKey, true)}>{t('Tudo')}</Button>
                            <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={() => setModuleAll(moduleKey, false)}>{t('Nada')}</Button>
                          </div>
                          <div className="space-y-4">
                            {Object.entries(schema.subareas).map(([subKey, subSchema]) => {
                              const subPerms = permissions[moduleKey]?.subareas?.[subKey] || {};
                              return (
                                <div key={subKey} className="space-y-2">
                                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t(subSchema.label)}</p>
                                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                                    {subSchema.actions.map(action => (
                                      <label key={action} className="flex items-center gap-1.5 cursor-pointer">
                                        <Checkbox checked={subPerms[action] ?? false} onCheckedChange={() => toggleAction(moduleKey, subKey, action)} />
                                        <span className="text-sm">{ACTION_LABELS[action] ? t(ACTION_LABELS[action]) : action}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-4 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    {t('Dashboard Personalizado')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('Widgets personalizados')}</Label>
                    <Switch checked={useCustomDashboard} onCheckedChange={setUseCustomDashboard} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {useCustomDashboard
                      ? t('Selecione os widgets que este perfil verá por defeito no painel.')
                      : t('A usar a predefinição do nicho da organização.')}
                  </p>
                  {useCustomDashboard && (
                    <div className="grid grid-cols-1 gap-2 border rounded-lg p-3">
                      {availableWidgets.map(widget => {
                        const isSelected = dashboardWidgets.some(dw => dw.type === widget.type);
                        return (
                          <label key={widget.type} className="flex items-center gap-2 cursor-pointer py-1">
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleDashboardWidget(widget.type)} />
                            <widget.icon className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm">{widget.title}</span>
                              {widget.description && (
                                <span className="text-xs text-muted-foreground ml-2">{widget.description}</span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button onClick={handleSave} disabled={!name.trim() || createProfile.isPending || updateProfile.isPending} className="w-full">
                  {(createProfile.isPending || updateProfile.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingProfile ? t('Guardar') : t('Criar')}
                </Button>
                <Button variant="outline" onClick={() => setIsOpen(false)} className="w-full">{t('Cancelar')}</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile fixed bottom bar */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t flex gap-2 lg:hidden z-50">
          <Button variant="outline" onClick={() => setIsOpen(false)} className="flex-1">{t('Cancelar')}</Button>
          <Button onClick={handleSave} disabled={!name.trim() || createProfile.isPending || updateProfile.isPending} className="flex-1">
            {(createProfile.isPending || updateProfile.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingProfile ? t('Guardar') : t('Criar')}
          </Button>
        </div>
        <div className="h-20 lg:hidden" />
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t('Perfis de Acesso')}
            </CardTitle>
            <CardDescription>{t('Defina perfis com permissões granulares por módulo e sub-área.')}</CardDescription>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('Criar Perfil')}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profiles.map(profile => (
              <div key={profile.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{profile.name}</p>
                    {profile.is_default && <Badge variant="outline" className="text-xs">{t('Predefinido')}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{t('Base: {{role}}', { role: BASE_ROLE_LABELS[profile.base_role] ? t(BASE_ROLE_LABELS[profile.base_role], { context: 'role' }) : profile.base_role })}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {t(DATA_SCOPE_LABELS[(profile.data_scope || 'own') as DataScope])}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {getActiveModules(profile.module_permissions).map(label => (
                      <Badge key={label} variant="secondary" className="text-xs">{t(label)}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(profile)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!profile.is_default && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(profile)} disabled={deleteProfile.isPending}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
