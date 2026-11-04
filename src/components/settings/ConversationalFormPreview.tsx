import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { FormSettings } from "@/types";
import { AIAvatar } from "@/components/conversational/AIAvatar";
import { useLanguage } from "@/i18n";

interface ConversationalFormPreviewProps {
  settings: FormSettings;
  organizationName?: string;
}

export function ConversationalFormPreview({ 
  settings,
  organizationName 
}: ConversationalFormPreviewProps) {
  const { t } = useLanguage();
  const primaryColor = settings.primary_color || "#3B82F6";

  // Build preview steps from settings
  const visibleFields: string[] = [];
  if (settings.fields.name.visible) visibleFields.push(settings.fields.name.label);
  if (settings.fields.email.visible) visibleFields.push(settings.fields.email.label);
  if (settings.fields.phone.visible) visibleFields.push(settings.fields.phone.label);
  if (settings.fields.message.visible) visibleFields.push(settings.fields.message.label);
  settings.custom_fields.forEach(f => visibleFields.push(f.label));

  return (
    <div className="bg-card/80 backdrop-blur-sm rounded-2xl shadow-xl border border-border/50 overflow-hidden">
      {/* Progress Bar */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div 
              className="h-full rounded-full"
              style={{ backgroundColor: primaryColor }}
              initial={{ width: "0%" }}
              animate={{ width: "25%" }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <span className="text-xs text-muted-foreground">1/{visibleFields.length + 1}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 md:p-8">
        {/* AI Avatar / Logo (same component as the live form) */}
        <div className="flex justify-center mb-8">
          <AIAvatar primaryColor={primaryColor} logoUrl={settings.logo_url} />
        </div>

        {/* Welcome Message */}
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            {settings.title}
          </h1>
          <p className="text-muted-foreground">
            {settings.subtitle}
          </p>

          {settings.fields.name.visible && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground block">
                {settings.fields.name.label}
              </label>
              <div className="h-12 rounded-lg border border-border bg-background px-4 flex items-center justify-center">
                <span className="text-muted-foreground/50">O teu nome...</span>
              </div>
            </div>
          )}

          <button
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 text-white font-medium opacity-50"
            style={{ backgroundColor: primaryColor }}
          >
            Começar
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Steps indicator */}
        {visibleFields.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground text-center mb-2">
              {t("Campos:")} {visibleFields.join(" → ")}
            </p>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground pb-4">
        Powered by Senvia OS
      </p>
    </div>
  );
}
