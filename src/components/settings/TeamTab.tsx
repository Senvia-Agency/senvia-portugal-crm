import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMembers, usePendingInvites, useCancelInvite, useResendInvite, useCreateTeamMember, PendingInvite, TeamMember } from '@/hooks/useTeam';
import { useManageTeamMember } from '@/hooks/useProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationProfiles } from '@/hooks/useOrganizationProfiles';
import { useOrganization } from '@/hooks/useOrganization';
import { useStripeSubscription } from '@/hooks/useStripeSubscription';
import { STRIPE_PLANS } from '@/lib/stripe-plans';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Users, UserPlus, Copy, X, Check, Clock, Loader2, RefreshCw, Eye, EyeOff, MoreHorizontal, Key, UserCog, Ban, CheckCircle, Mail, Pencil, Phone, Trash2, Lightbulb, ArrowRight, AlertTriangle, Crown, Info, Plus, MessageCircleMore } from 'lucide-react';

import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';
import { getBaseUrl } from '@/lib/constants';
import { hardGo } from '@/lib/nav';
import { EmailTemplateGate } from '@/components/marketing/EmailTemplateGate';
import { EMAIL_TEMPLATE_TRIGGERS, EMAIL_TEMPLATE_TRIGGER_LABELS } from '@/lib/email-template-triggers';
import { useEmailTemplateRequirement } from '@/hooks/useEmailTemplateRequirement';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  viewer: 'Visualizador',
  salesperson: 'Comercial',
  super_admin: 'Super Admin',
};

const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  viewer: 'secondary',
  salesperson: 'secondary',
  super_admin: 'default',
};

export function TeamTab() {
  const { user, organization } = useAuth();
  const { data: orgData } = useOrganization();
  const { subscriptionStatus, checkSubscription } = useStripeSubscription();
  const queryClient = useQueryClient();
  const { data: members, isLoading: loadingMembers } = useTeamMembers(true);
  const { data: invites, isLoading: loadingInvites } = usePendingInvites();
  const { profiles } = useOrganizationProfiles();
  const cancelInvite = useCancelInvite();
  const resendInvite = useResendInvite();
  const createTeamMember = useCreateTeamMember();
  const manageTeamMember = useManageTeamMember();
  const { toast } = useToast();
  const teamAccessTemplate = useEmailTemplateRequirement(EMAIL_TEMPLATE_TRIGGERS.teamAccess);
  const teamAccessTemplateMessage = `Configure um template de email ativo com o gatilho «${EMAIL_TEMPLATE_TRIGGER_LABELS[EMAIL_TEMPLATE_TRIGGERS.teamAccess]}» em Marketing → Templates antes de enviar.`;

  const salesSettings = (orgData?.sales_settings as any) || {};
  const commissionsEnabled = !!salesSettings.commissions_enabled;
  const globalRate = salesSettings.commission_percentage;
  const showIndividualCommission = commissionsEnabled && (!globalRate || globalRate <= 0);

  // User limit and upgrade recommendation
  const memberCount = members?.length ?? 0;
  const maxUsers = subscriptionStatus?.max_users ?? 999999;
  const baseUsers = subscriptionStatus?.plan_base_users ?? 5;
  const extraSeats = subscriptionStatus?.extra_seats ?? 0;
  const availableSlots = Math.max(0, maxUsers - memberCount);
  const isAtLimit = memberCount >= maxUsers;
  const isNearLimit = !isAtLimit && memberCount >= maxUsers - 2;

  const upgradeRecommendation = useMemo(() => {
    const planId = subscriptionStatus?.plan_id;
    if (!planId) return null;
    const planIndex = STRIPE_PLANS.findIndex(p => p.id === planId);
    if (planIndex < 0 || planIndex >= STRIPE_PLANS.length - 1) return null;
    const currentPlan = STRIPE_PLANS[planIndex];
    const nextPlan = STRIPE_PLANS[planIndex + 1];
    const nextPlanUsers = parseInt(nextPlan.limits.users) || 999999;
    const upgradeCost = nextPlan.priceMonthly - currentPlan.priceMonthly;
    const extraCostForSameUsers = nextPlanUsers * 5;

    return {
      currentPlan,
      nextPlan,
      nextPlanUsers,
      upgradeCost,
      extraCostForSameUsers,
      upgradeCheaper: upgradeCost < extraCostForSameUsers,
      seatsNeededToCover: nextPlanUsers - baseUsers,
    };
  }, [subscriptionStatus?.plan_id, baseUsers]);

  // Upgrade dialog state
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  // Modal state - Add member
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('salesperson');
  const [showPassword, setShowPassword] = useState(false);
  
  // Success state
  const [createdMember, setCreatedMember] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  
  // Invite list state
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  // Change password modal state
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Change role modal state
  const [changeRoleOpen, setChangeRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState('salesperson');

  // Edit profile modal state
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCommissionRate, setEditCommissionRate] = useState('');

  // Send access email modal state
  const [sendAccessOpen, setSendAccessOpen] = useState(false);
  const [sendingAccessEmail, setSendingAccessEmail] = useState(false);

  // Delete member confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null);

  const handleCreateMember = async () => {
    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: 'As palavras-passe não coincidem', variant: 'destructive' });
      return;
    }

    if (password.length < 6) {
      toast({ title: 'A palavra-passe deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }

    const selectedProfile = profiles.find(p => p.id === role);
    const resolvedRole = selectedProfile?.base_role || role;
    createTeamMember.mutate(
      { email, password, fullName, role: resolvedRole as 'admin' | 'viewer' | 'salesperson', profileId: selectedProfile?.id },
      {
        onSuccess: () => {
          setCreatedMember({ email, password, fullName });
        },
      }
    );
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: 'Copiado!', description: `${field} copiado para a área de transferência.` });
    setTimeout(() => setCopiedField(null), 2000);
  };

  const copyInviteLink = (invite: PendingInvite) => {
    const link = `${getBaseUrl()}/invite/${invite.token}`;
    navigator.clipboard.writeText(link);
    setCopiedInviteId(invite.id);
    toast({ title: 'Link copiado!', description: 'Link de convite copiado para a área de transferência.' });
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const handleResendInvite = (invite: PendingInvite) => {
    resendInvite.mutate(invite.id);
  };

  const handleCloseDialog = () => {
    setIsAddOpen(false);
    setFullName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setRole('salesperson');
    setShowPassword(false);
    setCreatedMember(null);
    setCopiedField(null);
    setSendingEmail(false);
    setEmailSent(false);
  };

  const handleSendAccessEmail = async () => {
    if (!createdMember || !organization || !teamAccessTemplate.isConfigured) return;
    
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-access-email', {
        body: {
          organizationId: organization.id,
          recipientEmail: createdMember.email,
          recipientName: createdMember.fullName,
          loginUrl,
          companyCode: organization.slug,
          password: createdMember.password,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setEmailSent(true);
      toast({ title: 'Email enviado!', description: `Credenciais enviadas para ${createdMember.email}.` });
    } catch (err: any) {
      toast({ 
        title: 'Erro ao enviar email', 
        description: err.message || 'Verifique se a integração Brevo está configurada.', 
        variant: 'destructive' 
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCancelInvite = (invite: PendingInvite) => {
    cancelInvite.mutate(invite.id);
  };

  // Member management handlers
  const openChangePasswordModal = (member: TeamMember) => {
    setSelectedMember(member);
    setChangePasswordOpen(true);
  };

  const openChangeRoleModal = (member: TeamMember) => {
    setSelectedMember(member);
    // Pre-select current profile by profile_id or fallback to role
    const currentProfileId = member.profile_id;
    const matchedProfile = currentProfileId 
      ? profiles.find(p => p.id === currentProfileId)
      : profiles.find(p => p.base_role === member.role);
    setNewRole(matchedProfile?.id || member.role);
    setChangeRoleOpen(true);
  };

  const handleChangeRole = () => {
    if (!selectedMember) return;

    const selectedProfile = profiles.find(p => p.id === newRole);
    const resolvedRole = selectedProfile?.base_role || newRole;
    manageTeamMember.mutate(
      { action: 'change_role', user_id: selectedMember.user_id, new_role: resolvedRole as 'admin' | 'viewer' | 'salesperson', profile_id: selectedProfile?.id, profile_name: selectedProfile?.name },
      {
        onSuccess: () => {
          setChangeRoleOpen(false);
          setSelectedMember(null);
        },
      }
    );
  };

  const handleToggleStatus = (member: TeamMember) => {
    manageTeamMember.mutate({ action: 'toggle_status', user_id: member.user_id });
  };

  const handleDeleteMember = (member: TeamMember) => {
    setMemberToDelete(member);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteMember = () => {
    if (!memberToDelete) return;
    manageTeamMember.mutate(
      { action: 'delete_member', user_id: memberToDelete.user_id },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
          setMemberToDelete(null);
        },
      }
    );
  };

  const openEditProfileModal = async (member: TeamMember) => {
    setSelectedMember(member);
    setEditFullName(member.full_name || '');
    setEditEmail(member.email || '');
    setEditPhone(member.phone || '');
    // Load commission rate from organization_members
    if (showIndividualCommission && organization?.id) {
      const { data } = await supabase
        .from('organization_members')
        .select('commission_rate')
        .eq('user_id', member.user_id)
        .eq('organization_id', organization.id)
        .single();
      setEditCommissionRate(data?.commission_rate ? String(data.commission_rate) : '');
    } else {
      setEditCommissionRate('');
    }
    setEditProfileOpen(true);
  };

  const handleEditProfile = async () => {
    if (!selectedMember) return;
    if (!editFullName.trim()) {
      toast({ title: 'O nome é obrigatório', variant: 'destructive' });
      return;
    }
    // Save commission rate if individual mode
    if (showIndividualCommission && organization?.id) {
      const rate = editCommissionRate ? parseFloat(editCommissionRate) : null;
      await supabase
        .from('organization_members')
        .update({ commission_rate: rate } as any)
        .eq('user_id', selectedMember.user_id)
        .eq('organization_id', organization.id);
      queryClient.invalidateQueries({ queryKey: ['sales-commissions'] });
    }
    manageTeamMember.mutate(
      { action: 'update_profile', user_id: selectedMember.user_id, full_name: editFullName.trim(), email: editEmail.trim(), phone: editPhone.trim() },
      {
        onSuccess: () => {
          setEditProfileOpen(false);
          setSelectedMember(null);
        },
      }
    );
  };

  const openSendAccessModal = (member: TeamMember) => {
    setSelectedMember(member);
    setSendAccessOpen(true);
  };

  const handleSendAccessEmailToMember = async () => {
    if (!selectedMember || !organization || !teamAccessTemplate.isConfigured) return;

    setSendingAccessEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-access-email', {
        body: {
          organizationId: organization.id,
          recipientEmail: selectedMember.email,
          recipientName: selectedMember.full_name,
          loginUrl,
          companyCode: organization.slug,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Email enviado!', description: `Dados de acesso enviados para ${selectedMember.email}.` });
      setSendAccessOpen(false);
      setSelectedMember(null);
    } catch (err: any) {
      toast({
        title: 'Erro ao enviar email',
        description: err.message || 'Verifique se a integração Brevo está configurada.',
        variant: 'destructive',
      });
    } finally {
      setSendingAccessEmail(false);
    }
  };

  const loginUrl = `${getBaseUrl()}/`;

  // Check if member is current user
  const isCurrentUser = (member: TeamMember) => member.user_id === user?.id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Acessos
            </CardTitle>
            <CardDescription>
              Gerencie os utilizadores e permissões da sua organização.
            </CardDescription>
          </div>

          {/* User limit warning banner */}
          {(isAtLimit || isNearLimit) && (
            <div className={`rounded-lg px-3 py-2 flex items-start gap-2 text-sm border ${
              isAtLimit
                ? 'bg-red-500/10 border-red-500/20'
                : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              {isAtLimit ? (
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              ) : (
                <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-xs ${isAtLimit ? 'text-red-600' : 'text-amber-600'}`}>
                  {isAtLimit
                    ? `Atingiu o limite de ${maxUsers} utilizadores. Adicione mais utilizadores extra ou faça upgrade do plano.`
                    : `Restam apenas ${availableSlots} vaga${availableSlots !== 1 ? 's' : ''} de ${maxUsers} utilizadores.`}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {upgradeRecommendation && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setShowUpgradeDialog(true)}
                      >
                        <ArrowRight className="h-3 w-3" />
                        Ver opções
                      </Button>
                      {upgradeRecommendation.upgradeCheaper && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Crown className="h-3 w-3" />
                          Upgrade compensa mais
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <Dialog open={isAddOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
            <DialogTrigger asChild>
              <Button
                data-otto-target="settings-invite-member"
                onClick={() => {
                  if (isAtLimit) {
                    setShowUpgradeDialog(true);
                  } else {
                    setIsAddOpen(true);
                  }
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Adicionar Acesso
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              {!createdMember ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Adicionar Novo Acesso</DialogTitle>
                    <DialogDescription>
                      Crie credenciais de acesso para um novo colaborador.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="full-name">Nome Completo</Label>
                      <Input
                        id="full-name"
                        placeholder="João Silva"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="joao@exemplo.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Palavra-passe</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Mínimo 6 caracteres"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirmar Palavra-passe</Label>
                      <Input
                        id="confirm-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Repetir palavra-passe"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-3">
                      <Label>Perfil</Label>
                      {profiles.length > 0 ? (
                        <Select value={role} onValueChange={(v) => setRole(v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar perfil..." />
                          </SelectTrigger>
                          <SelectContent>
                            {profiles.map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                                <span className="text-muted-foreground text-xs ml-2">
                                  ({ROLE_LABELS[p.base_role] || p.base_role})
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RadioGroup value={role} onValueChange={(v) => setRole(v as 'admin' | 'viewer' | 'salesperson')}>
                          <div className="flex items-start space-x-3 rounded-lg border p-3">
                            <RadioGroupItem value="salesperson" id="role-salesperson" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="role-salesperson" className="font-medium cursor-pointer">Comercial</Label>
                              <p className="text-sm text-muted-foreground">Vê apenas os leads atribuídos.</p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-3 rounded-lg border p-3">
                            <RadioGroupItem value="viewer" id="role-viewer" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="role-viewer" className="font-medium cursor-pointer">Visualizador</Label>
                              <p className="text-sm text-muted-foreground">Vê todos os leads. Não pode eliminar.</p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-3 rounded-lg border p-3">
                            <RadioGroupItem value="admin" id="role-admin" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="role-admin" className="font-medium cursor-pointer">Administrador</Label>
                              <p className="text-sm text-muted-foreground">Acesso total.</p>
                            </div>
                          </div>
                        </RadioGroup>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={handleCloseDialog}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleCreateMember}
                      disabled={!fullName.trim() || !email.trim() || !password || !confirmPassword || createTeamMember.isPending}
                    >
                      {createTeamMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Criar Acesso
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-green-600">
                      <Check className="h-5 w-5" />
                      Acesso Criado com Sucesso!
                    </DialogTitle>
                    <DialogDescription>
                      Envie estas informações ao colaborador por WhatsApp ou email.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Link de Acesso</Label>
                      <div className="flex gap-2">
                        <Input value={loginUrl} readOnly className="font-mono text-sm" />
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => copyToClipboard(loginUrl, 'Link')}
                        >
                          {copiedField === 'Link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Código da Empresa</Label>
                      <div className="flex gap-2">
                        <Input value={organization?.slug || ''} readOnly className="font-mono text-sm" />
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => copyToClipboard(organization?.slug || '', 'Código')}
                        >
                          {copiedField === 'Código' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Email</Label>
                      <div className="flex gap-2">
                        <Input value={createdMember.email} readOnly className="font-mono text-sm" />
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => copyToClipboard(createdMember.email, 'Email')}
                        >
                          {copiedField === 'Email' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Palavra-passe</Label>
                      <div className="flex gap-2">
                        <Input 
                          value={showPassword ? createdMember.password : '••••••••'} 
                          readOnly 
                          className="font-mono text-sm" 
                        />
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => copyToClipboard(createdMember.password, 'Palavra-passe')}
                        >
                          {copiedField === 'Palavra-passe' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                      <p>Guarde estas informações - a palavra-passe não poderá ser recuperada por si.</p>
                    </div>
                  </div>
                  <DialogFooter className="flex-col sm:flex-row gap-2">
                    <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.teamAccess}>
                      <Button
                        variant="outline"
                        onClick={handleSendAccessEmail}
                        disabled={sendingEmail || emailSent}
                        className="w-full sm:w-auto"
                      >
                        {sendingEmail ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : emailSent ? (
                          <Check className="mr-2 h-4 w-4" />
                        ) : (
                          <Mail className="mr-2 h-4 w-4" />
                        )}
                        {emailSent ? 'Email Enviado' : 'Enviar Acesso por Email'}
                      </Button>
                    </EmailTemplateGate>
                    <Button onClick={handleCloseDialog}>Fechar</Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((member) => (
                  <TableRow key={member.id} className={member.is_banned ? 'opacity-50' : ''}>
                    <TableCell>
                      <div>
                        <span className="font-medium">
                          {member.full_name}
                          {isCurrentUser(member) && (
                            <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                          )}
                        </span>
                        {(member.email || member.phone) && (
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {member.email && (
                              <span className="text-xs text-muted-foreground">{member.email}</span>
                            )}
                            {member.phone && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {member.phone}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_VARIANTS[member.role] || 'secondary'}>
                        {member.profile_name || ROLE_LABELS[member.role] || member.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {member.is_banned ? (
                        <Badge variant="outline" className="text-destructive border-destructive">
                          Inativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-success border-success">
                          Ativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isCurrentUser(member) && <DropdownMenuItem onClick={() => openEditProfileModal(member)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar Dados
                          </DropdownMenuItem>}
                          <DropdownMenuItem onClick={() => openChangePasswordModal(member)}>
                            <Key className="mr-2 h-4 w-4" />
                            Recuperar acesso
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            aria-disabled={teamAccessTemplate.isLoading || !teamAccessTemplate.isConfigured}
                            className={!teamAccessTemplate.isLoading && !teamAccessTemplate.isConfigured ? 'opacity-50' : undefined}
                            onSelect={(event) => {
                              if (teamAccessTemplate.isLoading || !teamAccessTemplate.isConfigured) {
                                event.preventDefault();
                                return;
                              }
                              openSendAccessModal(member);
                            }}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            Enviar Email de Acesso
                            {!teamAccessTemplate.isLoading && !teamAccessTemplate.isConfigured && (
                              <span className="ml-auto" title={teamAccessTemplateMessage} aria-label={teamAccessTemplateMessage}>
                                <MessageCircleMore className="h-4 w-4 text-muted-foreground" />
                              </span>
                            )}
                          </DropdownMenuItem>
                          {!isCurrentUser(member) && member.role !== 'super_admin' && (
                            <>
                              <DropdownMenuItem onClick={() => openChangeRoleModal(member)}>
                                <UserCog className="mr-2 h-4 w-4" />
                                Alterar Perfil
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => handleToggleStatus(member)}
                                className={member.is_banned ? '' : 'text-destructive focus:text-destructive'}
                                disabled={manageTeamMember.isPending}
                              >
                                {member.is_banned ? (
                                  <>
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Reativar Acesso
                                  </>
                                ) : (
                                  <>
                                    <Ban className="mr-2 h-4 w-4" />
                                    Desativar Acesso
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleDeleteMember(member)}
                                className="text-destructive focus:text-destructive"
                                disabled={manageTeamMember.isPending}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar Acesso
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {(!members || members.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Nenhum colaborador encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recuperar acesso</DialogTitle>
            <DialogDescription>
              O próprio colaborador deve usar “Esqueceu a palavra-passe?” na página de entrada.
              O link de recuperação será enviado para o email da conta.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setChangePasswordOpen(false)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Access Email Modal */}
      <Dialog open={sendAccessOpen} onOpenChange={setSendAccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Enviar Email de Acesso
            </DialogTitle>
            <DialogDescription>
              Enviar os dados de acesso (link, código da empresa e email) para <strong>{selectedMember?.full_name}</strong>? A palavra-passe atual não será alterada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendAccessOpen(false)}>
              Cancelar
            </Button>
            <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.teamAccess}>
              <Button
                onClick={handleSendAccessEmailToMember}
                disabled={sendingAccessEmail}
              >
                {sendingAccessEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar Email
              </Button>
            </EmailTemplateGate>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar Dados
            </DialogTitle>
            <DialogDescription>
              Edite os dados de contacto de {selectedMember?.full_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-full-name">Nome Completo</Label>
              <Input
                id="edit-full-name"
                placeholder="Nome completo"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email de Contacto</Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="email@exemplo.com"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Telefone</Label>
              <Input
                id="edit-phone"
                type="tel"
                placeholder="+351 912 345 678"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>
            {showIndividualCommission && (
              <div className="space-y-2">
                <Label htmlFor="edit-commission-rate">Comissão (%)</Label>
                <Input
                  id="edit-commission-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder="Ex: 10"
                  value={editCommissionRate}
                  onChange={(e) => setEditCommissionRate(e.target.value)}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Percentagem de comissão individual sobre o valor total das vendas.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProfileOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleEditProfile}
              disabled={!editFullName.trim() || manageTeamMember.isPending}
            >
              {manageTeamMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Modal */}
      <Dialog open={changeRoleOpen} onOpenChange={setChangeRoleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Alterar Perfil
            </DialogTitle>
            <DialogDescription>
              Altere o perfil de {selectedMember?.full_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2 mb-4">
              <Label className="text-muted-foreground">Perfil Atual</Label>
              <Badge variant={selectedMember ? ROLE_VARIANTS[selectedMember.role] : 'secondary'}>
                {selectedMember?.profile_name || (selectedMember ? ROLE_LABELS[selectedMember.role] : '')}
              </Badge>
            </div>
            {profiles.length > 0 ? (
              <div className="space-y-2">
                <Label>Novo Perfil</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <RadioGroup value={newRole} onValueChange={(v) => setNewRole(v as 'admin' | 'viewer' | 'salesperson')}>
                <div className="flex items-start space-x-3 rounded-lg border p-3">
                  <RadioGroupItem value="admin" id="new-role-admin" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="new-role-admin" className="font-medium cursor-pointer">Administrador</Label>
                    <p className="text-sm text-muted-foreground">Acesso total.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 rounded-lg border p-3">
                  <RadioGroupItem value="salesperson" id="new-role-salesperson" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="new-role-salesperson" className="font-medium cursor-pointer">Comercial</Label>
                    <p className="text-sm text-muted-foreground">Vê leads atribuídos.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 rounded-lg border p-3">
                  <RadioGroupItem value="viewer" id="new-role-viewer" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="new-role-viewer" className="font-medium cursor-pointer">Visualizador</Label>
                    <p className="text-sm text-muted-foreground">Apenas visualização.</p>
                  </div>
                </div>
              </RadioGroup>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeRoleOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleChangeRole}
              disabled={manageTeamMember.isPending}
            >
              {manageTeamMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Invites - legacy */}
      {(invites && invites.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Convites Pendentes ({invites.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingInvites ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Expira</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant={ROLE_VARIANTS[invite.role] || 'secondary'}>
                          {ROLE_LABELS[invite.role] || invite.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDistanceToNow(new Date(invite.expires_at), { 
                          addSuffix: true, 
                          locale: pt 
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => copyInviteLink(invite)}
                            title="Copiar link de convite"
                          >
                            {copiedInviteId === invite.id ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleResendInvite(invite)}
                            disabled={resendInvite.isPending}
                            title="Reenviar convite (renova expiração)"
                          >
                            <RefreshCw className={`h-4 w-4 ${resendInvite.isPending ? 'animate-spin' : ''}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleCancelInvite(invite)}
                            disabled={cancelInvite.isPending}
                            title="Cancelar convite"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {/* Upgrade / Extra Seats Dialog */}
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Limite de Utilizadores Atingido
            </DialogTitle>
            <DialogDescription>
              A sua organização tem {memberCount} utilizadores ativos e o limite do plano é {maxUsers}.
              Escolha a opção que compensa mais para o seu negócio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Option 1: Extra Seat */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">Utilizador Extra</span>
                </div>
                <Badge variant="secondary">5€/mês</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Adiciona um utilizador extra ao plano atual. Pode cancelar quando quiser.
              </p>
              <Button
                size="sm"
                className="w-full gap-2"
                onClick={async () => {
                  setShowUpgradeDialog(false);
                  try {
                    const { data, error } = await supabase.functions.invoke('buy-extra-seats', {
                      body: { 
                        quantity: (subscriptionStatus?.extra_seats ?? 0) + 1,
                        organization_id: organization?.id,
                      },
                    });
                    if (error) throw error;
                    if (data?.url) {
                      window.open(data.url, '_blank');
                    }
                  } catch (err: any) {
                    toast({
                      title: 'Erro',
                      description: err.message || 'Erro ao adquirir utilizador extra',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                <Plus className="h-4 w-4" />
                Adicionar 1 Utilizador Extra (5€/mês)
              </Button>
            </div>

            {/* Option 2: Upgrade */}
            {upgradeRecommendation && upgradeRecommendation.nextPlanUsers > memberCount && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-500" />
                    <span className="font-medium text-sm">
                      Upgrade para {upgradeRecommendation.nextPlan.name}
                    </span>
                  </div>
                  <Badge>+{upgradeRecommendation.upgradeCost}€/mês</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Até {upgradeRecommendation.nextPlanUsers} utilizadores incluídos.
                  {upgradeRecommendation.upgradeCheaper
                    ? ' Compensa mais que adicionar utilizadores extra avulso.'
                    : upgradeRecommendation.seatsNeededToCover > 5
                      ? ' Ótimo se precisar de crescer a equipa.'
                      : ''}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    setShowUpgradeDialog(false);
                    hardGo('/settings?tab=billing');
                  }}
                >
                  <ArrowRight className="h-4 w-4" />
                  Fazer Upgrade para {upgradeRecommendation.nextPlan.name}
                </Button>
              </div>
            )}

            {/* Savings comparison */}
            {upgradeRecommendation && upgradeRecommendation.upgradeCheaper && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                <div className="flex items-start gap-2">
                  <Lightbulb className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-emerald-700">Recomendação inteligente</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Fazer upgrade para {upgradeRecommendation.nextPlan.name} (+{upgradeRecommendation.upgradeCost}€/mês)
                      fica mais barato que adicionar {upgradeRecommendation.seatsNeededToCover} utilizadores extra
                      ({upgradeRecommendation.seatsNeededToCover} × 5€ = {upgradeRecommendation.extraCostForSameUsers}€/mês).
                      E ainda ganha mais funcionalidades.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Current usage summary */}
            <div className="text-xs text-muted-foreground border-t pt-3">
              <p>
                <span className="font-medium">Plano atual:</span>{' '}
                {subscriptionStatus?.plan_id ? STRIPE_PLANS.find(p => p.id === subscriptionStatus.plan_id)?.name ?? subscriptionStatus.plan_id : '—'}{' '}
                ({baseUsers} utilizadores incluídos
                {extraSeats > 0 ? ` + ${extraSeats} extra` : ''})
              </p>
              <p className="mt-0.5">
                <span className="font-medium">Utilizadores ativos:</span> {memberCount} de {maxUsers}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgradeDialog(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete member confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar acesso</AlertDialogTitle>
            <AlertDialogDescription>
              Tem a certeza que deseja eliminar o acesso de <strong>{memberToDelete?.full_name}</strong>? 
              Esta ação é irreversível. O colaborador será removido da organização e não poderá mais iniciar sessão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {manageTeamMember.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
