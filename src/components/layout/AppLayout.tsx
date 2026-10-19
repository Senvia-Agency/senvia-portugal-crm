import { ReactNode, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileMenu } from "./MobileMenu";
import { TrialBanner } from "./TrialBanner";
import { PaymentOverdueBanner } from "./PaymentOverdueBanner";
import { SuperAdminVisitBanner } from "./SuperAdminVisitBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStripeSubscription } from "@/hooks/useStripeSubscription";
import { OttoFAB } from "@/components/otto/OttoFAB";
import { OttoOnboardingUI } from "@/components/otto/OttoOnboardingUI";
import { ModuleOnboardingPeek } from "@/components/otto/ModuleOnboardingPeek";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { useInboxImmersiveStore } from "@/stores/useInboxImmersiveStore";
import { cn } from "@/lib/utils";

import { useAuth } from '@/contexts/AuthContext';
import { InboxWorkspaceProvider } from '@/components/inbox/workspace/InboxWorkspaceProvider';
import { useInboxWorkspace } from '@/components/inbox/workspace/InboxWorkspaceContext';
import { WorkspaceTopbar } from './WorkspaceTopbar';
import { WorkspaceTabStrip } from './WorkspaceTabStrip';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
interface AppLayoutProps {
  children: ReactNode;
  userName?: string;
  organizationName?: string;
}

export function AppLayout(props: AppLayoutProps) {
  const { user, organization } = useAuth();
  const scope = [user?.id ?? 'signed-out', organization?.id ?? 'no-org'].join(':');
  return <InboxWorkspaceProvider key={scope} scope={scope}><AppLayoutContent {...props} scope={scope} /></InboxWorkspaceProvider>;
}
function AppLayoutContent({ children, userName, organizationName, scope }: AppLayoutProps & { scope: string }) {
  const workspace = useInboxWorkspace();
  const legacy = useInterfaceStore(state => state.legacy);
  const docked = !!workspace?.docked;
  const isMobile = useIsMobile();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { subscriptionStatus, hasChecked } = useStripeSubscription();
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  // Inbox-driven mobile chrome control. `hideNav`: the whole Inbox hides the
  // bottom nav. `immersive`: a conversation is open → also hide header + FAB.
  const immersive = useInboxImmersiveStore((s) => s.immersive);
  const hideNav = useInboxImmersiveStore((s) => s.hideNav);
  const mobileInbox = isMobile && !!workspace?.onInbox;

  const showTrialBanner = hasChecked && subscriptionStatus?.on_trial && !subscriptionStatus?.billing_exempt && (subscriptionStatus?.days_remaining ?? 0) > 0;
  // Paying customer overdue but still inside the grace window → warn (don't block).
  // Once plan_expired the ProtectedRoute blocker takes over, so this is unreachable then.
  const showOverdueBanner = hasChecked
    && !!subscriptionStatus?.payment_overdue
    && !subscriptionStatus?.plan_expired
    && !subscriptionStatus?.billing_exempt;
  const showBanner = showTrialBanner || showOverdueBanner;

  // Mobile layout
  if (isMobile) {
    return (
      <div data-interface={legacy ? 'classic' : 'workspace'} className={cn("app-shell min-h-dvh bg-background md:bg-[#0d1422]", mobileInbox && "flex h-dvh flex-col overflow-hidden")}>
        {!immersive && <div className="hidden md:block">
          {isMobileMenuOpen && <button type="button" aria-label="Fechar menu" className="fixed inset-0 z-30 bg-black/40" onClick={() => setIsMobileMenuOpen(false)} />}
          <AppSidebar userName={userName} organizationName={organizationName} legacy={legacy} forceCollapsed expanded={isMobileMenuOpen}
            onExpand={() => setIsMobileMenuOpen(true)} onCollapse={() => setIsMobileMenuOpen(false)} onNavigate={() => setIsMobileMenuOpen(false)} />
        </div>}
        {!immersive && (
          <>
            <div className="md:hidden"><MobileHeader
              onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              isMenuOpen={isMobileMenuOpen}
              organizationName={organizationName}
            /></div>
            <div className="hidden pl-16 md:block"><WorkspaceTopbar organizationName={organizationName} userName={userName} /></div>
            {!mobileInbox && !isMobileMenuOpen && <div className="workspace-tabs-holder fixed left-0 right-0 top-[calc(3.5rem+var(--safe-area-top))] z-50 md:static md:ml-16">
              <WorkspaceTabStrip scope={scope} />
            </div>}
          </>
        )}
        {!immersive && showBanner && (
          <div className={cn("md:pl-16 md:pt-0", mobileInbox || legacy ? "pt-[calc(3.5rem+var(--safe-area-top))]" : "pt-[calc(6.5rem+var(--safe-area-top))]")}>
            {showTrialBanner
              ? <TrialBanner daysRemaining={subscriptionStatus!.days_remaining!} totalDays={14} />
              : <PaymentOverdueBanner daysUntilBlock={subscriptionStatus!.days_until_block ?? 0} blockAt={subscriptionStatus!.block_at} />}
          </div>
        )}
        {!immersive && (
          <div className="md:hidden"><MobileMenu
            isOpen={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
            userName={userName}
            organizationName={organizationName}
          /></div>
        )}
        <main
          className={cn(
            !immersive && 'md:ml-16 md:rounded-tl-[26px] md:bg-background',
            !immersive && !showBanner && (mobileInbox || legacy ? 'pt-[calc(3.5rem+var(--safe-area-top))] md:pt-0' : 'pt-[calc(6.5rem+var(--safe-area-top))] md:pt-0'),
            !immersive && !hideNav && !mobileInbox && 'pb-20 md:pb-0',
            mobileInbox && 'flex min-h-0 flex-1 flex-col overflow-hidden',
          )}
        >
          {!immersive && <SuperAdminVisitBanner />}
          <div className={mobileInbox ? "min-h-0 flex-1 overflow-hidden" : immersive || hideNav ? undefined : "min-h-[calc(100dvh-8.5rem)]"}>
            {children}
          </div>
        </main>
        {!immersive && !hideNav && !mobileInbox && <div className="md:hidden"><MobileBottomNav /></div>}
        {!immersive && !docked && !mobileInbox && <OttoFAB />}
        <OttoOnboardingUI />
        {!immersive && <ModuleOnboardingPeek />}
      </div>
    );
  }

  // Desktop layout
  return (
    <div data-interface={legacy ? 'classic' : 'workspace'} className="app-shell min-h-dvh bg-[#0d1422]">
      <AppSidebar userName={userName} organizationName={organizationName} legacy={legacy} />
      <div className={cn("transition-[padding] duration-200", sidebarCollapsed ? "pl-16" : "pl-64", docked && "pr-[28rem]")}>
        <WorkspaceTopbar organizationName={organizationName} userName={userName} />
        <main className="workspace-main min-h-[calc(100dvh-4rem)] overflow-hidden rounded-tl-[26px] bg-[#f6f8fc] shadow-[-8px_-6px_28px_rgba(0,0,0,.08)]">
          <WorkspaceTabStrip scope={scope} />
          {showTrialBanner && <TrialBanner daysRemaining={subscriptionStatus!.days_remaining!} />}
          {showOverdueBanner && <PaymentOverdueBanner daysUntilBlock={subscriptionStatus!.days_until_block ?? 0} blockAt={subscriptionStatus!.block_at} />}
          <SuperAdminVisitBanner />
          <div className="min-h-[calc(100dvh-7rem)] bg-background">
            {children}
          </div>
        </main>
      </div>
      {!docked && <OttoFAB />}
      <OttoOnboardingUI />
      <ModuleOnboardingPeek />
    </div>
  );
}
