import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCreateClient } from "@/hooks/useClients";
import { useAddContactNote } from "@/hooks/useContactNotes";
import { useClientLabels } from "@/hooks/useClientLabels";
import { useNifValidation } from "@/hooks/useNifValidation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useClientFieldsSettings } from "@/hooks/useClientFieldsSettings";
import { useAuth } from "@/contexts/AuthContext";
import { CLIENT_SOURCE_LABELS, ClientStatus, DEFAULT_CLIENT_FIELDS_SETTINGS, BillingTarget } from "@/types/clients";
import { isBillingActive } from "@/components/sales/SaleFiscalInfo";
import { COUNTRIES } from "@/lib/countries";
import { User, Building2 } from "lucide-react";

interface CreateClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (clientId: string) => void;
  initialData?: {
    name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    source?: string;
    leadId?: string;
  };
}

export function CreateClientModal({ open, onOpenChange, onCreated, initialData }: CreateClientModalProps) {
  const labels = useClientLabels();
  const { organization } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: fieldSettings } = useClientFieldsSettings();
  const invoicingEnabled = isBillingActive(organization);
  const isTelecom = organization?.niche === 'telecom';

  const settings = fieldSettings || DEFAULT_CLIENT_FIELDS_SETTINGS;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [nif, setNif] = useState("");
  const [companyNif, setCompanyNif] = useState("");
  const [companyAddressLine1, setCompanyAddressLine1] = useState("");
  const [companyAddressLine2, setCompanyAddressLine2] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [companyPostalCode, setCompanyPostalCode] = useState("");
  const [companyCountry, setCompanyCountry] = useState("PT");
  const [billingTarget, setBillingTarget] = useState<BillingTarget>("client");
  const [status, setStatus] = useState<ClientStatus>("active");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("PT");
  const [distrito, setDistrito] = useState("");
  const [conselho, setConselho] = useState("");
  const [grupoEconomico, setGrupoEconomico] = useState("");

  const createClient = useCreateClient();
  const addContactNote = useAddContactNote();

  const nifValidation = useNifValidation({
    nif,
    organizationId: organization?.id,
  });

  const companyNifValidation = useNifValidation({
    nif: companyNif,
    organizationId: organization?.id,
  });

  useEffect(() => {
    if (open && initialData) {
      setName(initialData.name || "");
      setEmail(initialData.email || "");
      setPhone(initialData.phone || "");
      setNotes(initialData.notes || "");
      setSource(initialData.source || "");
    }
  }, [open, initialData]);

  const isValid = useMemo(() => {
    if (settings.name.visible && settings.name.required && !name.trim()) return false;
    if (settings.email.visible && settings.email.required && !email.trim()) return false;
    if (settings.phone.visible && settings.phone.required && !phone.trim()) return false;
    if (settings.company.visible && settings.company.required && !company.trim()) return false;
    if (settings.nif.visible && settings.nif.required && !nif.trim()) return false;
    if (settings.company_nif?.visible && settings.company_nif?.required && !companyNif.trim()) return false;
    if (settings.address.visible && settings.address.required && !addressLine1.trim()) return false;
    // Notes are now an optional "add note to timeline" box — never block on them.
    if (nifValidation.isDuplicate || companyNifValidation.isDuplicate) return false;
    return true;
  }, [name, email, phone, company, nif, companyNif, addressLine1, notes, settings, nifValidation.isDuplicate, companyNifValidation.isDuplicate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    createClient.mutate(
      {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        nif: nif.trim() || undefined,
        company_nif: companyNif.trim() || undefined,
        company_address_line1: companyAddressLine1.trim() || undefined,
        company_address_line2: companyAddressLine2.trim() || undefined,
        company_city: companyCity.trim() || undefined,
        company_postal_code: companyPostalCode.trim() || undefined,
        company_country: companyCountry || undefined,
        billing_target: billingTarget,
        status,
        source: source || undefined,
        address_line1: addressLine1.trim() || undefined,
        address_line2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        postal_code: postalCode.trim() || undefined,
        country: country || undefined,
        lead_id: initialData?.leadId || undefined,
        assigned_to: assignedTo || undefined,
        distrito: distrito.trim() || undefined,
        conselho: conselho.trim() || undefined,
        grupo_economico: grupoEconomico.trim() || undefined,
      },
      {
        onSuccess: (createdClient) => {
          // Notes now live in the unified contact_notes timeline (by phone),
          // not the legacy column.
          const noteText = notes.trim();
          const notePhone = phone.trim();
          if (noteText && notePhone) {
            addContactNote.mutate({ phone: notePhone, content: noteText, source: "crm" });
          }
          resetForm();
          onOpenChange(false);
          onCreated?.(createdClient.id);
        },
      }
    );
  };

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setNif("");
    setCompanyNif("");
    setCompanyAddressLine1("");
    setCompanyAddressLine2("");
    setCompanyCity("");
    setCompanyPostalCode("");
    setCompanyCountry("PT");
    setBillingTarget("client");
    setStatus("active");
    setSource("");
    setNotes("");
    setAssignedTo("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setPostalCode("");
    setCountry("PT");
    setDistrito("");
    setConselho("");
    setGrupoEconomico("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
          <DialogTitle>{labels.new}</DialogTitle>
          <DialogDescription>
            Adicione um novo {labels.singular.toLowerCase()} ao seu CRM.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left Column */}
              <div className="lg:col-span-3 space-y-4">
                {/* Basic Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Informações Básicas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {settings.name.visible && (
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="name">
                            {settings.name.label} {settings.name.required && '*'}
                          </Label>
                          <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={`Nome do ${labels.singular.toLowerCase()}`}
                            required={settings.name.required}
                          />
                        </div>
                      )}

                      {settings.email.visible && (
                        <div className="space-y-2">
                          <Label htmlFor="email">
                            {settings.email.label} {settings.email.required && '*'}
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@exemplo.pt"
                            required={settings.email.required}
                          />
                        </div>
                      )}

                      {settings.phone.visible && (
                        <div className="space-y-2">
                          <Label htmlFor="phone">
                            {settings.phone.label} {settings.phone.required && '*'}
                          </Label>
                          <PhoneInput
                            value={phone}
                            onChange={setPhone}
                            placeholder="912 345 678"
                          />
                        </div>
                      )}

                      {settings.nif.visible && (
                        <div className="space-y-2">
                          <Label htmlFor="nif">
                            NIF (Cliente) {settings.nif.required && '*'}
                          </Label>
                          <Input
                            id="nif"
                            value={nif}
                            onChange={(e) => setNif(e.target.value)}
                            placeholder="NIF pessoal"
                            required={settings.nif.required}
                          />
                          {nifValidation.isDuplicate && (
                            <p className="text-xs text-destructive mt-1">
                              Já existe um cliente com este NIF: {nifValidation.existingClientCode ? `${nifValidation.existingClientCode} - ` : ''}{nifValidation.existingClientName}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Company Card */}
                {settings.company.visible && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Empresa
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="company">
                            {settings.company.label} {settings.company.required && '*'}
                          </Label>
                          <Input
                            id="company"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            placeholder="Nome da empresa"
                            required={settings.company.required}
                          />
                        </div>
                        {settings.company_nif?.visible && (
                          <div className="space-y-2">
                            <Label htmlFor="company-nif">
                              {settings.company_nif.label} {settings.company_nif.required && '*'}
                            </Label>
                            <Input
                              id="company-nif"
                              value={companyNif}
                              onChange={(e) => setCompanyNif(e.target.value)}
                              placeholder="NIF da empresa"
                              required={settings.company_nif.required}
                            />
                            {companyNifValidation.isDuplicate && (
                              <p className="text-xs text-destructive mt-1">
                                Já existe um cliente com este NIF: {companyNifValidation.existingClientCode ? `${companyNifValidation.existingClientCode} - ` : ''}{companyNifValidation.existingClientName}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Address */}
                {settings.address.visible && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        {settings.address.label} {settings.address.required && '*'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                          <Input
                            value={addressLine1}
                            onChange={(e) => setAddressLine1(e.target.value)}
                            placeholder="Rua, número"
                            required={settings.address.required}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Input
                            value={addressLine2}
                            onChange={(e) => setAddressLine2(e.target.value)}
                            placeholder="Apartamento, andar (opcional)"
                          />
                        </div>
                        <Input
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          placeholder="Código Postal"
                        />
                        <Input
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Cidade"
                        />
                        <div className="sm:col-span-2">
                          <Select value={country} onValueChange={setCountry}>
                            <SelectTrigger>
                              <SelectValue placeholder="País" />
                            </SelectTrigger>
                            <SelectContent>
                              {COUNTRIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Telecom/Energy: Distrito, Conselho, Grupo Económico */}
                {isTelecom && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Localização / Grupo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="distrito">Distrito</Label>
                          <Input
                            id="distrito"
                            value={distrito}
                            onChange={(e) => setDistrito(e.target.value)}
                            placeholder="Ex: Lisboa"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="conselho">Concelho</Label>
                          <Input
                            id="conselho"
                            value={conselho}
                            onChange={(e) => setConselho(e.target.value)}
                            placeholder="Ex: Sintra"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="grupo-economico">Grupo Económico</Label>
                          <Input
                            id="grupo-economico"
                            value={grupoEconomico}
                            onChange={(e) => setGrupoEconomico(e.target.value)}
                            placeholder="Ex: Grupo XYZ"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Notes */}
                {settings.notes.visible && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        {settings.notes.label} {settings.notes.required && '*'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={`Notas sobre o ${labels.singular.toLowerCase()}...`}
                        rows={4}
                        required={settings.notes.required}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right Column - Sticky */}
              <div className="lg:col-span-2">
                <div className="lg:sticky lg:top-0 space-y-4">
                  {/* Billing Target */}
                  {invoicingEnabled && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Faturação</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <RadioGroup
                        value={billingTarget}
                        onValueChange={(v) => setBillingTarget(v as BillingTarget)}
                        className="space-y-2"
                      >
                        <label
                          htmlFor="billing-client"
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            billingTarget === 'client'
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-muted-foreground/30'
                          }`}
                        >
                          <RadioGroupItem value="client" id="billing-client" />
                          <User className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Faturar Cliente</p>
                            <p className="text-xs text-muted-foreground">Usa o nome e NIF do cliente</p>
                          </div>
                        </label>
                        <label
                          htmlFor="billing-company"
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            billingTarget === 'company'
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-muted-foreground/30'
                          }`}
                        >
                          <RadioGroupItem value="company" id="billing-company" />
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Faturar Empresa</p>
                            <p className="text-xs text-muted-foreground">Usa o nome e contribuinte da empresa</p>
                          </div>
                        </label>
                      </RadioGroup>
                      {company.trim() && (
                        <div className="mt-4 space-y-3 border-t pt-4">
                          <p className="text-sm font-medium">Morada fiscal da empresa</p>
                          <p className="text-xs text-muted-foreground">Independente da morada do cliente. Obrigatória para faturar à empresa.</p>
                          <Input aria-label="Morada fiscal da empresa" placeholder="Morada" value={companyAddressLine1} onChange={(e) => setCompanyAddressLine1(e.target.value)} />
                          <Input aria-label="Complemento da morada da empresa" placeholder="Complemento (opcional)" value={companyAddressLine2} onChange={(e) => setCompanyAddressLine2(e.target.value)} />
                          <div className="grid grid-cols-2 gap-2">
                            <Input aria-label="Código postal da empresa" placeholder="Código postal" value={companyPostalCode} onChange={(e) => setCompanyPostalCode(e.target.value)} />
                            <Input aria-label="Localidade da empresa" placeholder="Localidade" value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} />
                          </div>
                          <Input aria-label="País da empresa" placeholder="País (código ISO, ex.: PT)" value={companyCountry} onChange={(e) => setCompanyCountry(e.target.value.toUpperCase())} maxLength={2} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Classificação</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>{labels.statusFieldLabel}</Label>
                        <Select value={status} onValueChange={(v) => setStatus(v as ClientStatus)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">{labels.statusActive}</SelectItem>
                            <SelectItem value="inactive">{labels.statusInactive}</SelectItem>
                            <SelectItem value="vip">{labels.statusVip}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Origem</Label>
                        <Select value={source} onValueChange={setSource}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CLIENT_SOURCE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Comercial Responsável</Label>
                        <Select 
                          value={assignedTo || "none"} 
                          onValueChange={(v) => setAssignedTo(v === "none" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sem responsável atribuído" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {teamMembers
                              .filter((member) => member.user_id)
                              .map((member) => (
                                <SelectItem key={member.user_id} value={member.user_id}>
                                  {member.full_name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <Button type="submit" disabled={!isValid || createClient.isPending} className="w-full">
                      {createClient.isPending ? "A criar..." : `Criar ${labels.singular}`}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
