import { useState } from "react";
import { Check, Copy, Linkedin, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { REFERRAL_MESSAGE } from "@/hooks/useReferralDashboard";
import { useLanguage } from "@/i18n";

/** The referral link with one-click sharing: copy, WhatsApp, email, LinkedIn. */
export function ReferralShare({ link, compact = false, className }: { link: string; compact?: boolean; className?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const text = `${REFERRAL_MESSAGE} ${link}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t("Link copiado. Agora é só partilhar."));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("Selecione e copie o link."));
    }
  };
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  const channels = [
    { label: "WhatsApp", icon: MessageCircle, className: "text-[#128C7E] hover:bg-[#25D366]/10", url: `https://wa.me/?text=${encodeURIComponent(text)}` },
    { label: "Email", icon: Mail, className: "text-primary hover:bg-primary/10", url: `mailto:?subject=${encodeURIComponent("Experimenta o Senvia OS")}&body=${encodeURIComponent(text)}` },
    { label: "LinkedIn", icon: Linkedin, className: "text-[#0A66C2] hover:bg-[#0A66C2]/10", url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` },
  ];

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <Input readOnly value={link} onFocus={e => e.target.select()} aria-label={t("Link de indicação")} className={cn("min-w-0 bg-muted/40", compact ? "h-9 text-xs" : "h-10")} />
        <Button onClick={copy} className={cn("shrink-0", compact && "h-9")}>
          {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{copied ? t("Copiado") : t("Copiar")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {channels.map(c => (
          <Button key={c.label} type="button" variant="outline" size="sm" onClick={() => open(c.url)} className={cn("h-8 gap-1.5", c.className)}>
            <c.icon className="h-3.5 w-3.5" />{t(c.label)}
          </Button>
        ))}
      </div>
    </div>
  );
}
