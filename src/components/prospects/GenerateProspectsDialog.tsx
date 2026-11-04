import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useGenerateProspects } from "@/hooks/useProspects";
import { Loader2, Search, ChevronDown } from "lucide-react";
import { toast } from 'sonner';
import { prospectSubmission } from '@/lib/paid-client-input';
import { useLanguage } from '@/i18n';

interface GenerateProspectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

function CollapsibleSection({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={`rounded-lg border transition-colors ${open ? "border-primary/40 bg-primary/5" : "border-transparent"}`}>
        <CollapsibleTrigger className={`flex w-full items-center justify-between rounded-lg p-4 text-sm font-medium transition-colors ${open ? "bg-primary/10 text-primary" : "bg-muted/30 border border-border/60 text-foreground hover:bg-muted/60"}`}>
          <span>{t(title)}</span>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180 text-primary" : "text-muted-foreground"}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 p-4 pt-2">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function GenerateProspectsDialog({ open, onOpenChange, organizationId }: GenerateProspectsDialogProps) {
  // Main
  const [searchStrings, setSearchStrings] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [language, setLanguage] = useState("pt-PT");

  // Search filters
  const [searchMatching, setSearchMatching] = useState("all");
  const [placeMinimumStars, setPlaceMinimumStars] = useState("none");
  const [website, setWebsite] = useState("allPlaces");
  const [skipClosed, setSkipClosed] = useState(true);

  // Additional details
  const [scrapePlaceDetailPage, setScrapePlaceDetailPage] = useState(false);
  const [scrapeTableReservationProvider, setScrapeTableReservationProvider] = useState(false);
  const [includeWebResults, setIncludeWebResults] = useState(false);
  const [scrapeDirectories, setScrapeDirectories] = useState(false);
  const [maxQuestions, setMaxQuestions] = useState(0);

  // Contact enrichment
  const [scrapeContacts, setScrapeContacts] = useState(false);
  const [socialFacebooks, setSocialFacebooks] = useState(false);
  const [socialInstagrams, setSocialInstagrams] = useState(false);
  const [socialYoutubes, setSocialYoutubes] = useState(false);
  const [socialTiktoks, setSocialTiktoks] = useState(false);
  const [socialTwitters, setSocialTwitters] = useState(false);

  // Lead enrichment
  const [maximumLeadsEnrichmentRecords, setMaximumLeadsEnrichmentRecords] = useState(0);

  // Direct URLs
  const [startUrls, setStartUrls] = useState("");

  // Collapsible sections state
  const [openFilters, setOpenFilters] = useState(false);
  const [openDetails, setOpenDetails] = useState(false);
  const [openContacts, setOpenContacts] = useState(false);
  const [openLeads, setOpenLeads] = useState(false);
  const [openUrls, setOpenUrls] = useState(false);

  const generateMutation = useGenerateProspects();
  const { t } = useLanguage();
  const [progressStatus, setProgressStatus] = useState<string | null>(null);

  const handleGenerate = () => {
    const strings = searchStrings.split("\n").map((s) => s.trim()).filter(Boolean);
    const urls = startUrls.split("\n").map((s) => s.trim()).filter(Boolean);

    if (!strings.length && !urls.length) return;
    if (strings.length && !location.trim()) return;

    const parsed = prospectSubmission.safeParse({ searchStrings: strings, startUrls: urls, location: location.trim(), maxResults, maxQuestions, maximumLeadsEnrichmentRecords });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || t('Verifique os parâmetros de pesquisa.')); return; }

    setProgressStatus("starting");

    generateMutation.mutate(
      {
        organizationId,
        searchStrings: strings,
        location: location.trim(),
        maxResults,
        language,
        skipClosed,
        searchMatching,
        placeMinimumStars: placeMinimumStars === "none" ? "" : placeMinimumStars,
        website,
        scrapePlaceDetailPage,
        scrapeTableReservationProvider,
        includeWebResults,
        scrapeDirectories,
        maxQuestions,
        scrapeContacts,
        scrapeSocialMediaProfiles: {
          facebooks: socialFacebooks,
          instagrams: socialInstagrams,
          youtubes: socialYoutubes,
          tiktoks: socialTiktoks,
          twitters: socialTwitters,
        },
        maximumLeadsEnrichmentRecords,
        startUrls: urls,
        onProgress: setProgressStatus,
      },
      {
        onSuccess: () => {
          setProgressStatus(null);
          onOpenChange(false);
          setSearchStrings("");
          setLocation("");
          setMaxResults(50);
          setStartUrls("");
        },
        onError: () => {
          setProgressStatus(null);
        },
      }
    );
  };

  const progressMessage = progressStatus === "starting"
    ? t("A iniciar pesquisa...")
    : progressStatus === "running"
    ? t("A pesquisar no Google Maps... Isto pode demorar alguns minutos.")
    : null;

  const hasSearchTerms = searchStrings.trim().length > 0;
  const hasUrls = startUrls.trim().length > 0;
  const isValid = (hasSearchTerms && location.trim().length > 0) || hasUrls;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen">
        <DialogHeader>
          <DialogTitle>{t("Gerar Prospects")}</DialogTitle>
          <DialogDescription>
            {t("Extraia empresas do Google Maps ao configurar os parâmetros de pesquisa abaixo.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0 px-1 pb-2">
          {/* Main fields */}
          <div className="space-y-2">
            <Label htmlFor="search-strings">{t("Termos de pesquisa")}</Label>
            <Textarea
              id="search-strings"
              placeholder={t("restaurante\ncabeleireiro\nclínica dentária")}
              value={searchStrings}
              onChange={(e) => setSearchStrings(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{t("Até 3 termos, um por linha (máximo 150 caracteres por termo). Alternativa: usar URLs diretas na secção abaixo.")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">{t("Localização")}</Label>
            <Input
              id="location"
              placeholder="Lisboa, Portugal"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-results">{t("Máximo de resultados")}</Label>
              <Input
                id="max-results"
                type="number"
                min={1}
                max={50}
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value) || 50)}
              />
              <p className="text-xs text-muted-foreground">{t("Por termo de pesquisa")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("Idioma")}</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="pt-PT">Português (Portugal)</SelectItem>
                    <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Search Filters */}
          <CollapsibleSection title="Filtros de pesquisa e categorias" open={openFilters} onOpenChange={setOpenFilters}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("Correspondência de nome")}</Label>
                  <Select value={searchMatching} onValueChange={setSearchMatching}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("Todos os locais")}</SelectItem>
                      <SelectItem value="exact">{t("Apenas correspondência exata")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("Avaliação mínima")}</Label>
                  <Select value={placeMinimumStars} onValueChange={setPlaceMinimumStars}>
                    <SelectTrigger><SelectValue placeholder={t("Todas")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Todas")}</SelectItem>
                      <SelectItem value="1">⭐ 1+</SelectItem>
                      <SelectItem value="2">⭐ 2+</SelectItem>
                      <SelectItem value="3">⭐ 3+</SelectItem>
                      <SelectItem value="4">⭐ 4+</SelectItem>
                      <SelectItem value="5">⭐ 5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("Filtrar por website")}</Label>
                <Select value={website} onValueChange={setWebsite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allPlaces">{t("Todos os locais")}</SelectItem>
                    <SelectItem value="withWebsite">{t("Só com website")}</SelectItem>
                    <SelectItem value="withoutWebsite">{t("Só sem website")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t("Ignorar locais fechados")}</p>
                  <p className="text-xs text-muted-foreground">{t("Exclui empresas permanentemente encerradas")}</p>
                </div>
                <Switch checked={skipClosed} onCheckedChange={setSkipClosed} />
              </div>
          </CollapsibleSection>

          <CollapsibleSection title="Detalhes adicionais" open={openDetails} onOpenChange={setOpenDetails}>
              {[
                { label: "Extrair página de detalhes", desc: "Obtém informações mais completas de cada local", checked: scrapePlaceDetailPage, onChange: setScrapePlaceDetailPage },
                { label: "Extrair dados de reserva", desc: "Mesa/reserva online (restaurantes)", checked: scrapeTableReservationProvider, onChange: setScrapeTableReservationProvider },
                { label: "Incluir resultados web", desc: "Inclui resultados web do Google na pesquisa", checked: includeWebResults, onChange: setIncludeWebResults },
                { label: "Extrair centros comerciais", desc: "Pesquisa dentro de centros comerciais e diretórios", checked: scrapeDirectories, onChange: setScrapeDirectories },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{t(item.label)}</p>
                    <p className="text-xs text-muted-foreground">{t(item.desc)}</p>
                  </div>
                  <Switch checked={item.checked} onCheckedChange={item.onChange} />
                </div>
              ))}
              <div className="space-y-2">
                <Label>{t("Perguntas a extrair por local")}</Label>
                <Input type="number" min={0} max={10} value={maxQuestions} onChange={(e) => setMaxQuestions(Number(e.target.value) || 0)} />
                <p className="text-xs text-muted-foreground">{t("0 = nenhuma pergunta")}</p>
              </div>
          </CollapsibleSection>

          <CollapsibleSection title="Enriquecimento de contactos" open={openContacts} onOpenChange={setOpenContacts}>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t("Extrair contactos do website")}</p>
                  <p className="text-xs text-muted-foreground">{t("Visita o website do local para encontrar emails/telefones")}</p>
                </div>
                <Switch checked={scrapeContacts} onCheckedChange={setScrapeContacts} />
              </div>
              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-sm font-medium">{t("Redes sociais a extrair")}</p>
                {[
                  { label: "Facebook", checked: socialFacebooks, onChange: setSocialFacebooks },
                  { label: "Instagram", checked: socialInstagrams, onChange: setSocialInstagrams },
                  { label: "YouTube", checked: socialYoutubes, onChange: setSocialYoutubes },
                  { label: "TikTok", checked: socialTiktoks, onChange: setSocialTiktoks },
                  { label: "X / Twitter", checked: socialTwitters, onChange: setSocialTwitters },
                ].map((s) => (
                  <div key={s.label} className="flex items-center justify-between">
                    <p className="text-sm">{s.label}</p>
                    <Switch checked={s.checked} onCheckedChange={s.onChange} />
                  </div>
                ))}
              </div>
          </CollapsibleSection>

          <CollapsibleSection title="Enriquecimento de leads" open={openLeads} onOpenChange={setOpenLeads}>
              <div className="space-y-2">
                <Label>{t("Máximo de leads por local")}</Label>
                <Input type="number" min={0} max={50} value={maximumLeadsEnrichmentRecords} onChange={(e) => setMaximumLeadsEnrichmentRecords(Number(e.target.value) || 0)} />
                <p className="text-xs text-muted-foreground">{t("0 = desativado. Enriquece com dados adicionais de contacto.")}</p>
              </div>
          </CollapsibleSection>

          <CollapsibleSection title="URLs diretas do Google Maps" open={openUrls} onOpenChange={setOpenUrls}>
              <div className="space-y-2">
                <Label>{t("URLs do Google Maps")}</Label>
                <Textarea
                  placeholder={"https://www.google.com/maps/place/...\nhttps://www.google.com/maps/place/..."}
                  value={startUrls}
                  onChange={(e) => setStartUrls(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">{t("Até 3 URLs HTTPS de www.google.com ou maps.google.com, uma por linha. Alternativa aos termos de pesquisa — se preencher URLs, os termos são opcionais.")}</p>
              </div>
          </CollapsibleSection>
        </div>

        {progressMessage && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <p className="text-sm text-primary font-medium">{progressMessage}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generateMutation.isPending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={handleGenerate} disabled={!isValid || generateMutation.isPending}>
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("A pesquisar...")}
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                {t("Gerar Prospects")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
