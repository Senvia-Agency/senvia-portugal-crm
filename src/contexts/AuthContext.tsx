import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { AppRole } from '@/types';
import { safeStorage } from '@/lib/safeStorage';
import { isMfaEnforcementActive } from '@/lib/mfa-rollout';
import type { MfaStatus } from '@/lib/mfa-rollout';

const ACTIVE_ORG_KEY = 'senvia_active_organization_id';

interface Profile {
  id: string;
  organization_id: string | null;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  public_key: string;
  plan: string;
  created_at: string;
  form_settings?: unknown;
  niche?: string;
  enabled_modules?: unknown;
  logo_url?: string | null;
  integrations_enabled?: unknown;
  tax_config?: unknown;
  sales_settings?: unknown;
  ai_qualification_rules?: string | null;
  msg_template_hot?: string | null;
  msg_template_warm?: string | null;
  msg_template_cold?: string | null;
  ai_response_mode?: 'global' | 'per_form';
  tem_brevo_api_key?: boolean;
  tem_keyinvoice_password?: boolean;
  tem_vendus_api_key?: boolean;
  brevo_sender_email?: string | null;
  billing_provider?: string | null;
}

interface UserOrganizationMembership {
  organization_id: string;
  organization_name: string;
  organization_code: string;
  organization_slug: string;
  member_role: AppRole;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  organizations: UserOrganizationMembership[];
  roles: AppRole[];
  isLoading: boolean;
  isSuperAdmin: boolean;
  needsOrgSelection: boolean;
  mfaStatus: MfaStatus;
  completeMfaChallenge: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refetchUserData: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  selectOrganization: (orgId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<UserOrganizationMembership[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingUserData, setIsLoadingUserData] = useState(false);
  const [needsOrgSelection, setNeedsOrgSelection] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus>('checking');

  const isSuperAdmin = roles.includes('super_admin');
  const activeMemberRole = organizations.find(member => member.organization_id === organization?.id && member.is_active)?.member_role;
  const effectiveRoles: AppRole[] = isSuperAdmin ? ['super_admin'] : activeMemberRole ? [activeMemberRole] : [];

  // Check MFA assurance level
  const checkMFAStatus = useCallback(async (userId: string) => {
    setMfaStatus('checking');
    try {
      const [{ data, error }, policy] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.rpc('meets_mfa_policy', { _user_id: userId }),
      ]);
      if (error || !data || policy.error || typeof policy.data !== 'boolean') {
        setMfaStatus('error');
        return;
      }
      if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        setMfaStatus('pending');
      } else if (data.currentLevel === 'aal2') {
        setMfaStatus('verified');
      } else if (isMfaEnforcementActive(Date.now())) {
        setMfaStatus('enrollment');
      } else {
        setMfaStatus('none');
      }
    } catch {
      setMfaStatus('error');
    }
  }, []);

  const completeMfaChallenge = useCallback(() => {
    if (user?.id) void checkMFAStatus(user.id);
  }, [user?.id, checkMFAStatus]);

  // Load organization by ID — only safe fields, never API keys/secrets.
  // trial_ends_at / first_paid_at / billing_exempt são indispensáveis: isOrgOnTrial()
  // decide com eles se a organização está em trial, e um trial vale acesso Elite.
  // Sem estes campos a função vê `undefined`, conclui "não há trial", e o plano
  // efetivo passa a ser organizations.plan — que nas contas novas é 'basic', um id
  // que nem sequer existe em subscription_plans. A app cai então no plano por
  // omissão (Starter) e tranca Financeiro, Marketing, E-commerce e Prospects a
  // quem devia estar a ver o sistema todo.
  const SAFE_ORG_FIELDS = 'id,name,slug,code,public_key,plan,trial_ends_at,first_paid_at,billing_exempt,created_at,form_settings,niche,enabled_modules,logo_url,integrations_enabled,tax_config,sales_settings,ai_qualification_rules,msg_template_hot,msg_template_warm,msg_template_cold,ai_response_mode,servicos_products_config,product_types_config,tem_brevo_api_key,brevo_sender_email,tem_invoicexpress_api_key,tem_keyinvoice_password,tem_whatsapp_api_key,tem_meta_conversions_token,invoicexpress_account_name,billing_provider';
  const loadOrganization = useCallback(async (orgId: string) => {
    const { data: orgData } = await supabase
      .from('organizations')
      .select(SAFE_ORG_FIELDS)
      .eq('id', orgId)
      .maybeSingle();
    
    if (orgData) {
      // Vendus is added by a separately applied SQL migration. Keep sign-in
      // working while the database has not received that additive column.
      const { data: vendusData } = await supabase.from('organizations')
        .select('tem_vendus_api_key').eq('id', orgId).maybeSingle();
      const safeOrg = { ...orgData, tem_vendus_api_key: vendusData?.tem_vendus_api_key === true };
      setOrganization(safeOrg);
      safeStorage.set(ACTIVE_ORG_KEY, orgId);
      setNeedsOrgSelection(false);
      return safeOrg;
    }
    
    return orgData;
  }, []);

  // Fetch profile, organizations and roles
  useEffect(() => {
    let cancelled = false;

    const fetchUserData = async (userId: string) => {
      setIsLoadingUserData(true);
      try {
        // Fetch profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        
        if (cancelled) return;
        setProfile(profileData);

        // Fetch roles
        const { data: rolesData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId);
        
        if (cancelled) return;
        if (rolesData) {
          setRoles(rolesData.map(r => r.role as AppRole));
        }

        // Fetch user's organization memberships
        const { data: orgsData } = await supabase
          .rpc('get_user_organizations', { _user_id: userId });
        
        if (cancelled) return;
        
        // get_user_organizations now returns all orgs for super_admins automatically
        const userOrgs = (orgsData || []) as UserOrganizationMembership[];
        setOrganizations(userOrgs);

        // Determine which organization to load
        const storedOrgId = safeStorage.get(ACTIVE_ORG_KEY);
        
        if (userOrgs.length === 0) {
          setOrganization(null);
          setNeedsOrgSelection(false);
        } else if (userOrgs.length === 1) {
          // Only one organization - auto select
          await loadOrganization(userOrgs[0].organization_id);
        } else if (storedOrgId && userOrgs.some(o => o.organization_id === storedOrgId)) {
          // Multiple orgs but we have a stored selection that's still valid
          await loadOrganization(storedOrgId);
        } else {
          // Multiple organizations and no valid stored selection - need to choose
          setNeedsOrgSelection(true);
          setOrganization(null);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        if (!cancelled) setIsLoadingUserData(false);
      }
    };

    if (user?.id) {
      fetchUserData(user.id);
      checkMFAStatus(user.id);
    } else {
      setProfile(null);
      setOrganization(null);
      setOrganizations([]);
      setRoles([]);
      setNeedsOrgSelection(false);
      setMfaStatus('none');
      setIsLoadingUserData(false);
    }

    return () => {
      cancelled = true;
    };
  }, [user?.id, session?.access_token, loadOrganization, checkMFAStatus]);

  // Auth state listener
  useEffect(() => {
    let mounted = true;

    // Safety net: if getSession() hangs (expired token + network stall on refresh),
    // the Promise never resolves and isLoading stays true forever. Unblock after 8s
    // so the user sees the login page instead of an infinite spinner.
    const loadingTimeout = setTimeout(() => {
      if (mounted) {
        console.warn('[Auth] getSession timeout — forcing isLoading=false');
        setIsLoading(false);
      }
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        clearTimeout(loadingTimeout);
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(loadingTimeout);
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    }).catch(() => {
      clearTimeout(loadingTimeout);
      if (mounted) setIsLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    // Limpar estados ANTES de chamar o Supabase para evitar race conditions
    setUser(null);
    setSession(null);
    setProfile(null);
    setOrganization(null);
    setOrganizations([]);
    setRoles([]);
    setNeedsOrgSelection(false);
    
    // Limpar localStorage
    safeStorage.remove(ACTIVE_ORG_KEY);
    
    // Agora sim, chamar o Supabase
    await supabase.auth.signOut();
  };

  const refetchUserData = async () => {
    if (!user?.id) return;

    try {
      // Re-fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      setProfile(profileData);

      // Re-fetch current organization
      const storedOrgId = safeStorage.get(ACTIVE_ORG_KEY);
      if (storedOrgId) {
        await loadOrganization(storedOrgId);
      } else if (profileData?.organization_id) {
        await loadOrganization(profileData.organization_id);
      }

      // Re-fetch organizations list
      const { data: orgsData } = await supabase
        .rpc('get_user_organizations', { _user_id: user.id });
      
      setOrganizations((orgsData || []) as UserOrganizationMembership[]);
    } catch (error) {
      console.error('Error refetching user data:', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    // Verify user has access to this organization
    const hasAccess = organizations.some(o => o.organization_id === orgId);
    if (!hasAccess && !isSuperAdmin) {
      console.error('User does not have access to this organization');
      return;
    }

    // Sync active_organization_id in JWT so RLS uses the correct org
    await supabase.auth.updateUser({
      data: { active_organization_id: orgId }
    });

    await loadOrganization(orgId);
    
    // Reload the page to ensure all data is fresh for the new organization
    window.location.reload();
  };

  const selectOrganization = async (orgId: string) => {
    // Sync active_organization_id in JWT so RLS uses the correct org
    await supabase.auth.updateUser({
      data: { active_organization_id: orgId }
    });
    await loadOrganization(orgId);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        organization,
        organizations,
        roles: effectiveRoles,
        isLoading: isLoading || isLoadingUserData,
        isSuperAdmin,
        needsOrgSelection,
        mfaStatus,
        completeMfaChallenge,
        signIn,
        signUp,
        signOut,
        refetchUserData,
        switchOrganization,
        selectOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
