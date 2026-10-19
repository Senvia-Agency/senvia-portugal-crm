import { useAuth } from "@/contexts/AuthContext";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsNewButton } from "@/components/announcements/WhatsNewButton";
import { InterfaceVersionSwitch } from './InterfaceVersionSwitch';

interface MobileHeaderProps {
  onMenuToggle?: () => void;
  isMenuOpen?: boolean;
  organizationName?: string;
}

export function MobileHeader({
  onMenuToggle,
  organizationName = "Senvia OS"
}: MobileHeaderProps) {
  const { organization } = useAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-[60] bg-background border-b border-border safe-top">
      <div className="h-14 flex items-center justify-between px-4">
        <Button variant="ghost" size="icon" onClick={onMenuToggle} aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </Button>
        <img 
          alt={organization?.name || "SENVIA"} 
          className="h-7 w-24 object-contain" 
          src={organization?.logo_url || "/lovable-uploads/7d06b8aa-41ca-4a96-a4b1-699608629148.png"} 
        />
        <div className="flex shrink-0 items-center justify-end gap-1">
          <InterfaceVersionSwitch />
          <WhatsNewButton variant="header" />
        </div>
      </div>
    </header>
  );
}
