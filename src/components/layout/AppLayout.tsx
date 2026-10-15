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
interface AppLayoutProps {
  children: ReactNode;
  userName?: string;
  organizationName?: string;
}

export function AppLayout(props: AppLayoutProps) {
  const { user, organization } = useAuth();
  const scope = [user?.id ?? 'signed-out', organization?.id ?? 'no-org'].join(':');
  return <InboxWorkspaceProvider key={scope} scope={scope}><AppLayoutContent {...props} /></InboxWorkspaceProvider>;
}
function AppLayoutContent({ children, userName, organizationName }: AppLayoutProps) {
  const workspace = useInboxWorkspace();
  const docked = workspace?.enabled && workspace.pinned && !workspace.onInbox && !workspace.minimized && !workspace.popup;
  const isMobile = useIsMobile();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { subscriptionStatus, hasChecked } = useStripeSubscription();
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  // Inbox-driven mobile chrome control. `hideNav`: the whole Inbox hides the
  // bottom nav. `immersive`: a conversation is open → also hide header + FAB.
  const immersive = useInboxImmersiveStore((s) => s.immersive);
  const hideNav = useInboxImmersiveStore((s) => s.hideNav);

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
      <div className="min-h-dvh bg-background">
        {!immersive && (
          <MobileHeader
            onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            isMenuOpen={isMobileMenuOpen}
            organizationName={organizationName}
          />
        )}
        {!immersive && showBanner && (
          <div style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top))' }}>
            {showTrialBanner
              ? <TrialBanner daysRemaining={subscriptionStatus!.days_remaining!} totalDays={14} />
              : <PaymentOverdueBanner daysUntilBlock={subscriptionStatus!.days_until_block ?? 0} blockAt={subscriptionStatus!.block_at} />}
          </div>
        )}
        {!immersive && (
          <MobileMenu
            isOpen={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
            userName={userName}
            organizationName={organizationName}
          />
        )}
        <main
          className={immersive || hideNav ? undefined : "pb-20"}
          style={immersive || showBanner ? undefined : { paddingTop: 'calc(3.5rem + env(safe-area-inset-top))' }}
        >
          {!immersive && <SuperAdminVisitBanner />}
          <div className={immersive || hideNav ? undefined : "min-h-[calc(100dvh-8.5rem)]"}>
            {children}
          </div>
        </main>
        {!immersive && !hideNav && <MobileBottomNav />}
        {!immersive && !docked && <OttoFAB />}
        <OttoOnboardingUI />
        {!immersive && <ModuleOnboardingPeek />}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-dvh bg-background">
      <AppSidebar userName={userName} organizationName={organizationName} />
      <main className={cn("transition-[padding] duration-200", sidebarCollapsed ? "pl-16" : "pl-64", docked && "pr-[28rem]")}>
        {showTrialBanner && <TrialBanner daysRemaining={subscriptionStatus!.days_remaining!} />}
        {showOverdueBanner && <PaymentOverdueBanner daysUntilBlock={subscriptionStatus!.days_until_block ?? 0} blockAt={subscriptionStatus!.block_at} />}
        <SuperAdminVisitBanner />
        <div className="min-h-dvh">
          {children}
        </div>
      </main>
      {!docked && <OttoFAB />}
      <OttoOnboardingUI />
      <ModuleOnboardingPeek />
    </div>
  );
}
