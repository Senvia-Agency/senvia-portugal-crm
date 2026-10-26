import { workspaceNavigation } from './workspaceNavigation';
import { useEffect, useRef, useState } from "react";
import { useScrollEdges } from './useScrollEdges';
import { NavLink, useLocation } from "react-router-dom";
import { Shield, Lock, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOttoStore } from "@/stores/useOttoStore";
import { useModules, EnabledModules } from "@/hooks/useModules";
import { usePermissions } from "@/hooks/usePermissions";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { InboxUnreadBadge } from "./InboxUnreadBadge";
import { WebmailUnreadBadge } from "@/features/webmail/WebmailUnreadBadge";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { ModuleNavIcon } from './ModuleNavIcon';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  moduleKey?: keyof EnabledModules;
}

const allNavItems = workspaceNavigation;


export function MobileBottomNav() {
  const location = useLocation();
  const { setOpen: setOttoOpen } = useOttoStore();
  const { isSuperAdmin, organization, organizations } = useAuth();
  const { modules } = useModules();
  const { canViewModule } = usePermissions();
  const { isModuleLocked, getRequiredPlan } = useSubscription();
  const hasPerfect2GetherModuleAccess = hasPerfect2GetherAccess({
    organizationId: organization?.id,
    memberships: organizations,
    isSuperAdmin,
  });

  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; feature: string; plan: string }>({
    open: false, feature: '', plan: ''
  });

  // On mobile/PWA the on-screen keyboard shrinks the visual viewport, which makes
  // a fixed bottom bar float up into the middle of the screen. Slide it out of
  // the way while the keyboard is open; it returns when the keyboard closes.
  const keyboardOpen = useKeyboardOpen();

  // More modules than fit across a phone: the strip scrolls sideways, fades at the
  // edges that hide items, and also follows a mouse wheel (desktop narrow windows).
  const stripRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(stripRef, 'x');
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const atStart = strip.scrollLeft <= 0;
      const atEnd = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
      if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);
  // The current page's item must be visible, even when it sits past the screen edge.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  // Plan-locked items stay visible; admin-disabled or no-permission items are hidden
  const navItems = allNavItems.filter(item => {
    if (!item.moduleKey) return true;
    if (isModuleLocked(item.moduleKey)) return true;
    if (!modules[item.moduleKey]) return false;
    if (!canViewModule(item.moduleKey)) return false;
    return true;
  });

  const perfect2GetherItems: NavItem[] = hasPerfect2GetherModuleAccess
    ? [
        { to: "/portal-total-link", icon: Building2, label: "Portal" },
      ]
    : [];

  const allItems = isSuperAdmin 
    ? [...navItems, ...perfect2GetherItems, { to: "/system-admin", icon: Shield, label: "Admin" }]
    : [...navItems, ...perfect2GetherItems];

  const handleLockedClick = (e: React.MouseEvent, item: NavItem) => {
    if (item.moduleKey && isModuleLocked(item.moduleKey)) {
      e.preventDefault();
      setUpgradeModal({
        open: true,
        feature: item.label,
        plan: getRequiredPlan(item.moduleKey),
      });
    }
  };

  return (
    <>
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border safe-bottom overflow-hidden transition-transform duration-200",
          keyboardOpen && "translate-y-full pointer-events-none",
        )}
      >
          <div ref={stripRef} data-fade-start={edges.start} data-fade-end={edges.end}
            className="scroll-fade-x flex items-center h-16 px-2 overflow-x-auto overscroll-x-contain no-scrollbar gap-2">
          {allItems.map((item) => {
            const locked = 'moduleKey' in item && item.moduleKey ? isModuleLocked(item.moduleKey) : false;
            const isActive = location.pathname === item.to || 
              (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
            
            return (
              <NavLink
                key={item.to} aria-label={item.label}
                to={locked ? "#" : item.to}
                onClick={(e) => 'moduleKey' in item ? handleLockedClick(e, item as NavItem) : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-xl transition-all min-w-[64px] relative",
                  locked
                    ? "text-muted-foreground/40"
                    : isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                )}
              >
                <div className="relative">
                  <ModuleNavIcon icon={item.icon} to={item.to} locked={locked} />
                  {locked && (
                    <Lock className="h-2.5 w-2.5 absolute -top-1 -right-1.5 text-muted-foreground/60" />
                  )}
                  {item.to === "/inbox" && !locked && (
                    <InboxUnreadBadge className="absolute -right-2.5 -top-1.5 h-4 min-w-[16px] px-1 text-[9px]" />
                  )}
                  {item.to === "/webmail" && !locked && (
                    <WebmailUnreadBadge className="absolute -right-2.5 -top-1.5 h-4 min-w-[16px] px-1 text-[9px]" />
                  )}
                </div>
                <span className={cn(
                  "whitespace-nowrap text-[10px] font-medium",
                  isActive && !locked && "text-primary"
                )}>
                  {item.to === '/inbox' ? 'Inbox' : item.label}
                </span>
              </NavLink>
            );
          })}

          {/* Otto support chat — opens the assistant window (no route) */}
          <button
            type="button"
            onClick={() => setOttoOpen(true)}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl transition-all min-w-[60px] text-muted-foreground"
          >
            <img src="/otto-mascot.svg" alt="Otto" className="h-5 w-5 rounded-full" />
            <span className="text-[10px] font-medium">Suporte</span>
          </button>
        </div>
      </nav>

      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(open) => setUpgradeModal(prev => ({ ...prev, open }))}
        featureName={upgradeModal.feature}
        requiredPlan={upgradeModal.plan}
      />
    </>
  );
}
