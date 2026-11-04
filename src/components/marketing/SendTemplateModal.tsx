import { useState, useMemo } from "react";
import { Search, Users, User, Send, Loader2, Mail, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClients } from "@/hooks/useClients";
import { useSendTemplateEmail } from "@/hooks/useSendTemplateEmail";
import type { EmailTemplate } from "@/types/marketing";
import type { CrmClient } from "@/types/clients";
import { CLIENT_STATUS_STYLES } from "@/types/clients";
import { useClientLabels } from "@/hooks/useClientLabels";
import { useLanguage } from "@/i18n";

interface SendTemplateModalProps {
  template: EmailTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "select" | "confirm" | "success";

export function SendTemplateModal({ template, open, onOpenChange }: SendTemplateModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClients, setSelectedClients] = useState<CrmClient[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectionMode, setSelectionMode] = useState<"individual" | "filter">("individual");
  
  const { data: clients = [], isLoading: loadingClients } = useClients();
  const clientLabels = useClientLabels();
  const sendTemplate = useSendTemplateEmail();
  const { t } = useLanguage();

  // Filter clients based on search and status
  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      // Must have email
      if (!client.email) return false;
      
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        client.name.toLowerCase().includes(searchLower) ||
        client.email.toLowerCase().includes(searchLower) ||
        client.company?.toLowerCase().includes(searchLower);
      
      // Status filter
      const matchesStatus = statusFilter === "all" || client.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [clients, searchQuery, statusFilter]);

  // Clients available for selection (with email)
  const clientsWithEmail = useMemo(() => {
    return clients.filter(c => c.email);
  }, [clients]);

  const handleToggleClient = (client: CrmClient) => {
    setSelectedClients(prev => {
      const isSelected = prev.some(c => c.id === client.id);
      if (isSelected) {
        return prev.filter(c => c.id !== client.id);
      }
      return [...prev, client];
    });
  };

  const handleSelectAll = () => {
    if (selectedClients.length === filteredClients.length) {
      setSelectedClients([]);
    } else {
      setSelectedClients(filteredClients);
    }
  };

  const handleSend = async () => {
    if (!template || selectedClients.length === 0) return;

    const recipients = selectedClients.map(client => ({
      email: client.email!,
      name: client.name,
      clientId: client.id,
      variables: {
        nome: client.name,
        email: client.email || '',
        empresa: client.company || '',
        telefone: client.phone || '',
      },
    }));

    // Note: {{vendedor}} is resolved server-side from client's assigned_to field

    await sendTemplate.mutateAsync({
      templateId: template.id,
      recipients,
    });

    setStep("success");
  };

  const handleClose = () => {
    setStep("select");
    setSearchQuery("");
    setSelectedClients([]);
    setStatusFilter("all");
    setSelectionMode("individual");
    onOpenChange(false);
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-hidden flex flex-col">
        {step === "select" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                {t("Enviar Template")}
              </DialogTitle>
              <DialogDescription>
                {t("Selecione os clientes que receberão o email \"{{name}}\"", { name: template.name })}
              </DialogDescription>
            </DialogHeader>

            <Tabs value={selectionMode} onValueChange={(v) => setSelectionMode(v as "individual" | "filter")} className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="individual" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {t("Individual")}
                </TabsTrigger>
                <TabsTrigger value="filter" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {t("Por Filtro")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="individual" className="flex-1 overflow-hidden flex flex-col mt-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("Pesquisar por nome, email ou empresa...")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <ScrollArea className="flex-1 border rounded-md">
                  <div className="p-2 space-y-1">
                    {loadingClients ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredClients.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        {searchQuery ? t("Nenhum cliente encontrado") : t("Sem clientes com email")}
                      </div>
                    ) : (
                      filteredClients.map((client) => {
                        const isSelected = selectedClients.some(c => c.id === client.id);
                        return (
                          <div
                            key={client.id}
                            className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-primary/10' : ''}`}
                            onClick={() => handleToggleClient(client)}
                          >
                            <Checkbox checked={isSelected} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{client.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                            </div>
                            {client.company && (
                              <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                                {client.company}
                              </Badge>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="filter" className="flex-1 overflow-hidden flex flex-col mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>{t("Filtrar por {{field}}", { field: clientLabels.statusFieldLabel.toLowerCase() })}</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("Selecionar {{field}}", { field: clientLabels.statusFieldLabel.toLowerCase() })} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("Todos")}</SelectItem>
                      <SelectItem value="active">{clientLabels.statusActive}</SelectItem>
                      <SelectItem value="inactive">{clientLabels.statusInactive}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm">
                    <p className="font-medium">{t("{{n}} clientes", { n: filteredClients.length })}</p>
                    <p className="text-muted-foreground">{t("correspondem ao filtro")}</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    {selectedClients.length === filteredClients.length ? t("Desmarcar todos") : t("Selecionar todos")}
                  </Button>
                </div>

                <ScrollArea className="flex-1 border rounded-md">
                  <div className="p-2 space-y-1">
                    {filteredClients.map((client) => {
                      const isSelected = selectedClients.some(c => c.id === client.id);
                      const statusStyle = CLIENT_STATUS_STYLES[client.status as keyof typeof CLIENT_STATUS_STYLES];
                      return (
                        <div
                          key={client.id}
                          className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-primary/10' : ''}`}
                          onClick={() => handleToggleClient(client)}
                        >
                          <Checkbox checked={isSelected} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{client.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                          </div>
                          <Badge 
                            variant="secondary" 
                            className="text-xs"
                            style={{ 
                              backgroundColor: statusStyle?.bg, 
                              color: statusStyle?.text 
                            }}
                          >
                            {{ active: clientLabels.statusActive, inactive: clientLabels.statusInactive, vip: clientLabels.statusActive }[client.status] || client.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-4">
              <div className="flex items-center justify-between w-full">
                <p className="text-sm text-muted-foreground">
                  {t("{{n}} selecionado(s)", { n: selectedClients.length })}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>
                    {t("Cancelar")}
                  </Button>
                  <Button 
                    onClick={() => setStep("confirm")} 
                    disabled={selectedClients.length === 0}
                  >
                    {t("Continuar")}
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("Confirmar Envio")}</DialogTitle>
              <DialogDescription>
                {t("Reveja os detalhes antes de enviar")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("Template:")}</span>
                  <span className="text-sm font-medium">{template.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("Assunto:")}</span>
                  <span className="text-sm font-medium truncate max-w-[200px]">{template.subject}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t("Destinatários:")}</span>
                  <span className="text-sm font-medium">{selectedClients.length}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">{t("Destinatários:")}</Label>
                <ScrollArea className="h-[150px] border rounded-md">
                  <div className="p-2 space-y-1">
                    {selectedClients.map((client) => (
                      <div key={client.id} className="flex items-center gap-2 p-2 text-sm">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{client.name}</span>
                        <span className="text-muted-foreground">({client.email})</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("select")}>
                {t("Voltar")}
              </Button>
              <Button 
                onClick={handleSend}
                disabled={sendTemplate.isPending}
              >
                {sendTemplate.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("A enviar...")}
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    {t("Enviar Agora")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <Check className="h-5 w-5" />
                {t("Emails Enviados")}
              </DialogTitle>
            </DialogHeader>

            <div className="py-8 text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
                <Check className="h-8 w-8" />
              </div>
              <p className="text-lg font-medium">
                {t("{{n}} email(s) enviado(s) com sucesso!", { n: selectedClients.length })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("Os destinatários receberão o email em breve.")}
              </p>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full">
                {t("Fechar")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
