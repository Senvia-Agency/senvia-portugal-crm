import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { User, Loader2, Save } from "lucide-react";
import { AvatarCard } from "./AvatarCard";
import { WorkScheduleCard } from "./WorkScheduleCard";
import { LanguageCard } from "./LanguageCard";
import { useLanguage } from "@/i18n";

// Personal account data (extracted from the former GeneralContent). Lives under
// the "A Minha Conta" group — editable by any role, scoped to the logged-in user.
// The Brevo sender email + email signature were moved to the Brevo integration.
interface ProfileContentProps {
  profile: {
    full_name: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  fullName: string;
  setFullName: (value: string) => void;
  profileEmail: string;
  setProfileEmail: (value: string) => void;
  profilePhone: string;
  setProfilePhone: (value: string) => void;
  handleSaveProfile: () => void;
  updateProfileIsPending: boolean;
}

export const ProfileContent = ({
  profile,
  fullName,
  setFullName,
  profileEmail,
  setProfileEmail,
  profilePhone,
  setProfilePhone,
  handleSaveProfile,
  updateProfileIsPending,
}: ProfileContentProps) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-6 max-w-4xl">
      <AvatarCard />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />{t("Dados Pessoais")}</CardTitle>
          <CardDescription>{t("Edite as suas informações pessoais.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="full-name">{t("Nome Completo")}</Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("O seu nome")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-email">{t("Email de contacto")}</Label>
              <Input
                id="profile-email"
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder={t("email@exemplo.com")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">{t("Telefone")}</Label>
              <Input
                id="profile-phone"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                placeholder="+351 900 000 000"
              />
           </div>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={updateProfileIsPending || (fullName === profile?.full_name && profileEmail === (profile?.email || '') && profilePhone === (profile?.phone || ''))}
            className="w-full sm:w-auto"
          >
            {updateProfileIsPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {t("Guardar perfil")}
          </Button>
        </CardContent>
      </Card>
      <LanguageCard />
      <WorkScheduleCard />
    </div>
  );
};
