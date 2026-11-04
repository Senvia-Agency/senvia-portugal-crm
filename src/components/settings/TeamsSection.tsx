import { useState, useMemo } from 'react';
import { useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam, useAllTeamMembersEntries, useSetTeamMembers, Team } from '@/hooks/useTeams';
import { useTeamMembers, TeamMember } from '@/hooks/useTeam';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Users, Plus, Pencil, Trash2, Crown, Loader2, UserPlus } from 'lucide-react';
import { useLanguage } from '@/i18n';

export function TeamsSection() {
  const { data: teams = [], isLoading: loadingTeams } = useTeams();
  const { data: orgMembers = [], isLoading: loadingMembers } = useTeamMembers();
  const { data: allEntries = [] } = useAllTeamMembersEntries();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const setTeamMembers = useSetTeamMembers();
  const { t } = useLanguage();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Map of user_id -> team they belong to
  const memberTeamMap = useMemo(() => {
    const map: Record<string, string> = {};
    allEntries.forEach(e => { map[e.user_id] = e.team_id; });
    return map;
  }, [allEntries]);

  // Map team_id -> member count
  const teamMemberCount = useMemo(() => {
    const map: Record<string, number> = {};
    allEntries.forEach(e => { map[e.team_id] = (map[e.team_id] || 0) + 1; });
    return map;
  }, [allEntries]);

  // Map user_id -> name
  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    orgMembers.forEach(m => { map[m.user_id] = m.full_name; });
    return map;
  }, [orgMembers]);

  const getLeaderName = (leaderId: string) => memberNameMap[leaderId] || t('Desconhecido');

  const handleOpenCreate = () => {
    setTeamName('');
    setLeaderId('');
    setSelectedMemberIds([]);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (team: Team) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setLeaderId(team.leader_id);
    // Get current members of this team
    const currentMembers = allEntries.filter(e => e.team_id === team.id).map(e => e.user_id);
    setSelectedMemberIds(currentMembers);
    setIsEditOpen(true);
  };

  const handleCreate = () => {
    if (!teamName.trim() || !leaderId) return;
    createTeam.mutate({ name: teamName.trim(), leader_id: leaderId }, {
      onSuccess: (data) => {
        // Set members
        if (selectedMemberIds.length > 0) {
          setTeamMembers.mutate({ teamId: data.id, memberUserIds: selectedMemberIds });
        }
        setIsCreateOpen(false);
      },
    });
  };

  const handleUpdate = () => {
    if (!editingTeam || !teamName.trim() || !leaderId) return;
    updateTeam.mutate({ teamId: editingTeam.id, name: teamName.trim(), leader_id: leaderId }, {
      onSuccess: () => {
        setTeamMembers.mutate({ teamId: editingTeam.id, memberUserIds: selectedMemberIds });
        setIsEditOpen(false);
        setEditingTeam(null);
      },
    });
  };

  const handleDelete = (team: Team) => {
    if (confirm(t('Eliminar a equipa "{{name}}"?', { name: team.name }))) {
      deleteTeam.mutate(team.id);
    }
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // Available members for selection (exclude leader, exclude members already in OTHER teams)
  const getAvailableMembers = (currentTeamId?: string) => {
    return orgMembers.filter(m => {
      if (m.user_id === leaderId) return false; // Leader is not a "member"
      if (m.role === 'super_admin') return false;
      const existingTeam = memberTeamMap[m.user_id];
      if (existingTeam && existingTeam !== currentTeamId) return false; // Already in another team
      return true;
    });
  };

  const renderTeamForm = (isEdit: boolean) => {
    const availableMembers = getAvailableMembers(isEdit ? editingTeam?.id : undefined);
    const isPending = isEdit ? updateTeam.isPending : createTeam.isPending;

    return (
      <>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('Nome da Equipa')}</Label>
            <Input
              placeholder={t('Ex: Equipa Norte')}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Líder')}</Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger>
                <SelectValue placeholder={t('Selecionar líder...')} />
              </SelectTrigger>
              <SelectContent>
                {orgMembers
                  .filter(m => m.role !== 'super_admin')
                  .map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name}
                      <span className="text-muted-foreground text-xs ml-2">
                        ({m.role})
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              {t('Colaboradores ({{n}})', { n: selectedMemberIds.length })}
            </Label>
            {availableMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {!leaderId ? t('Selecione um líder primeiro.') : t('Todos os colaboradores já estão atribuídos a outras equipas.')}
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {availableMembers.map(m => (
                  <label
                    key={m.user_id}
                    className="flex items-center gap-3 p-2 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedMemberIds.includes(m.user_id)}
                      onCheckedChange={() => toggleMember(m.user_id)}
                    />
                    <span className="text-sm font-medium">{m.full_name}</span>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {m.role}
                    </Badge>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => isEdit ? setIsEditOpen(false) : setIsCreateOpen(false)}>
            {t('Cancelar')}
          </Button>
          <Button
            onClick={isEdit ? handleUpdate : handleCreate}
            disabled={!teamName.trim() || !leaderId || isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t('Guardar') : t('Criar Equipa')}
          </Button>
        </DialogFooter>
      </>
    );
  };

  if (loadingTeams || loadingMembers) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t('Equipas')}
            </CardTitle>
            <CardDescription>
              {t('Crie equipas hierárquicas. O líder vê os dados dos colaboradores da sua equipa.')}
            </CardDescription>
          </div>
          <Button onClick={handleOpenCreate} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            {t('Nova Equipa')}
          </Button>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>{t('Nenhuma equipa criada.')}</p>
              <p className="text-sm">{t('Crie equipas para que os líderes vejam os dados dos seus comerciais.')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {teams.map(team => (
                <div
                  key={team.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1">
                    <h4 className="font-medium">{team.name}</h4>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                        {getLeaderName(team.leader_id)}
                      </span>
                      <span>•</span>
                      <span>{t('{{n}} membros', { n: teamMemberCount[team.id] || 0 })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => handleOpenEdit(team)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(team)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Team Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Nova Equipa')}</DialogTitle>
            <DialogDescription>
              {t('Crie uma equipa e atribua um líder e membros.')}
            </DialogDescription>
          </DialogHeader>
          {renderTeamForm(false)}
        </DialogContent>
      </Dialog>

      {/* Edit Team Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Editar Equipa')}</DialogTitle>
            <DialogDescription>
              {t('Altere o nome, líder ou membros da equipa.')}
            </DialogDescription>
          </DialogHeader>
          {renderTeamForm(true)}
        </DialogContent>
      </Dialog>
    </>
  );
}
