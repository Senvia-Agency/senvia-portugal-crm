import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, Calendar, ExternalLink, FileSpreadsheet, FileText, Globe, Hash, Layers, Mail, MapPin,
  MessageCircle, Phone, Search, Star, Tag, User, Zap, type LucideIcon,
} from 'lucide-react';

import { initialsOf } from '@/components/leads/lead-display';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, getInboxUrl } from '@/lib/format';
import { getProspectCom, getProspectSegment } from '@/lib/prospects/segment';
import { cn } from '@/lib/utils';
import type { Prospect } from '@/types/prospects';
import { useLanguage, intlLocale } from '@/i18n';

interface ProspectDetailsModalProps {
  readonly prospect: Prospect | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly stateLabel: string;
  readonly statePill: string;
  /** Name of the salesperson it is assigned to. */
  readonly salesperson: string | null;
  /** Perfect2Gether: energy prospects (CPE, consumption, COM). */
  readonly isEnergy: boolean;
}

const sectionTitle = 'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

const SOURCE_LABELS: Record<string, string> = {
  import: 'Importação de ficheiro',
  apify_google_maps: 'Google Maps',
};

// Metadata shown in its own rows or links, so left out of "Outras informações".
const SHOWN_KEYS = new Set([
  'address', 'city', 'postal_code', 'rating', 'reviews_count', 'google_maps_url', 'website',
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'additional_emails', 'additional_phones',
  'source_search', 'source_location', 'com', 'raw_row',
]);

const METADATA_LABELS: Record<string, string> = {
  numero: 'Número', nt: 'NT', pc: 'PC', gestor_totallink: 'Gestor Totallink',
};

const SOCIALS: readonly [string, string][] = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['twitter', 'X/Twitter'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'],
];

/** One label/value line of the details column. */
function DetailRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4 shrink-0" />{label}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** One figure of the strip under the header. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[7rem] flex-1 rounded-xl border border-border/70 bg-card px-3.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('truncate text-base font-semibold', tone)}>{value}</p>
    </div>
  );
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || null;
  if (typeof value === 'object') return null;
  return String(value);
};

const href = (url: string) => (url.startsWith('http') ? url : `https://${url}`);
const Empty = () => <span className="text-muted-foreground">—</span>;

/** The prospect record in full screen, laid out like the client's: who, how to reach them, and everything known. */
export function ProspectDetailsModal({ prospect, onOpenChange, stateLabel, statePill, salesperson, isEnergy }: ProspectDetailsModalProps) {
  const { t } = useLanguage();
  if (!prospect) return null;
  const metadata = (prospect.metadata ?? {}) as Record<string, unknown>;
  const website = text(metadata.website);
  const mapsUrl = text(metadata.google_maps_url);
  const address = [text(metadata.address), [text(metadata.postal_code), text(metadata.city)].filter(Boolean).join(' ')].filter(Boolean);
  const rating = typeof metadata.rating === 'number' ? metadata.rating : null;
  const segment = isEnergy ? getProspectSegment(prospect) : prospect.segment;
  const com = isEnergy ? getProspectCom(prospect) : null;
  const socials = SOCIALS.filter(([key]) => text(metadata[key]));
  const extras = Object.entries(metadata)
    .filter(([key, value]) => !SHOWN_KEYS.has(key) && text(value))
    .map(([key, value]) => [METADATA_LABELS[key] ? t(METADATA_LABELS[key]) : key.replace(/_/g, ' '), text(value)!] as const);
  const rawRow = metadata.raw_row && typeof metadata.raw_row === 'object'
    ? Object.entries(metadata.raw_row as Record<string, unknown>).filter(([, value]) => text(value))
    : [];
  const subtitle = [
    prospect.contact_name,
    prospect.nif && `NIF ${prospect.nif}`,
    t('importado em {{date}}', { date: formatDate(prospect.imported_at || prospect.created_at) }),
  ].filter(Boolean).join(' · ');

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('Ficha do prospect {{name}}', { name: prospect.company_name })}</DialogTitle>
          <DialogDescription>{t('Contactos, estado e toda a informação do prospect')}</DialogDescription>
        </DialogHeader>

        {/* Header: who it is, how to reach them. */}
        <header className="shrink-0 border-b bg-background py-3 pl-4 pr-14 sm:pl-6">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-3">
            <Button variant="back" size="icon" onClick={() => onOpenChange(false)} className="h-9 w-9 shrink-0 rounded-full" aria-label={t("Voltar")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
              {initialsOf(prospect.company_name || '?')}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-xl font-semibold tracking-tight">{prospect.company_name}</h2>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statePill)}>{stateLabel}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {prospect.phone && (
                <>
                  <Button variant="outline" size="sm" asChild className="h-9 rounded-full border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400">
                    <Link to={getInboxUrl(prospect.phone)}><MessageCircle className="h-4 w-4" />WhatsApp</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="h-9 rounded-full">
                    <a href={`tel:${prospect.phone}`}><Phone className="h-4 w-4" />{t('Ligar')}</a>
                  </Button>
                </>
              )}
              {prospect.email && (
                <Button variant="outline" size="sm" asChild className="h-9 rounded-full">
                  <a href={`mailto:${prospect.email}`}><Mail className="h-4 w-4" />Email</a>
                </Button>
              )}
              {website && (
                <Button variant="outline" size="sm" asChild className="h-9 rounded-full">
                  <a href={href(website)} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4" />{t('Site')}</a>
                </Button>
              )}
              {prospect.converted_lead_id && (
                <Button size="sm" asChild className="h-9 rounded-full">
                  <Link to={`/leads?lead=${prospect.converted_lead_id}`}><ExternalLink className="h-4 w-4" />{t('Ver lead')}</Link>
                </Button>
              )}
            </div>
          </div>

          <div className="mx-auto mt-3 flex w-full max-w-7xl flex-wrap gap-2">
            <Figure label={t("Estado")} value={stateLabel} />
            <Figure label={t("Comercial")} value={salesperson ?? t('Não atribuído')} tone={salesperson ? undefined : 'text-muted-foreground'} />
            {segment && <Figure label={t("Segmento")} value={segment} />}
            {com && <Figure label="COM" value={com} />}
            {isEnergy && prospect.annual_consumption_kwh !== null && (
              <Figure label={t("Consumo anual")} value={`${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(prospect.annual_consumption_kwh)} kWh`} />
            )}
            {rating !== null && (
              <Figure label="Google" value={`★ ${rating.toLocaleString(intlLocale())}${typeof metadata.reviews_count === 'number' ? ` · ${t('{{n}} opiniões', { n: metadata.reviews_count })}` : ''}`} tone="text-amber-600 dark:text-amber-400" />
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2">
            {/* Right: what was written about it, and everything else the source brought. */}
            <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
              <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
                <h3 className={sectionTitle}><FileText className="h-3.5 w-3.5" />{t('Observações')}</h3>
                {prospect.observations
                  ? <p className="whitespace-pre-wrap text-sm">{prospect.observations}</p>
                  : <p className="text-sm text-muted-foreground">{t('Sem observações.')}</p>}
              </div>

              {(extras.length > 0 || text(metadata.additional_emails) || text(metadata.additional_phones)) && (
                <div className="space-y-1 rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={sectionTitle}><Tag className="h-3.5 w-3.5" />{t('Outras informações')}</h3>
                  <div className="divide-y divide-border/60">
                    {text(metadata.additional_phones) && <DetailRow icon={Phone} label={t("Outros telefones")}>{text(metadata.additional_phones)}</DetailRow>}
                    {text(metadata.additional_emails) && <DetailRow icon={Mail} label={t("Outros emails")}>{text(metadata.additional_emails)}</DetailRow>}
                    {extras.map(([label, value]) => <DetailRow key={label} icon={Hash} label={label}>{value}</DetailRow>)}
                  </div>
                </div>
              )}

              {rawRow.length > 0 && (
                <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={sectionTitle}><FileSpreadsheet className="h-3.5 w-3.5" />{t('Linha original do ficheiro')}</h3>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        {rawRow.map(([column, value]) => (
                          <tr key={column}>
                            <th scope="row" className="w-2/5 bg-muted/40 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">{column}</th>
                            <td className="break-words px-3 py-1.5">{text(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Left: the data, each block in its card, like the client record. */}
            <aside className="order-first min-w-0 lg:col-start-1 lg:row-start-1">
              <div className="space-y-4 lg:sticky lg:top-0">
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={cn(sectionTitle, 'mb-1')}>{t('Detalhes')}</h3>
                  <div className="divide-y divide-border/60">
                    <DetailRow icon={Building2} label={t("Empresa")}>{prospect.company_name}</DetailRow>
                    <DetailRow icon={User} label={t("Contacto")}>{prospect.contact_name ?? <Empty />}</DetailRow>
                    {prospect.nif && <DetailRow icon={FileText} label="NIF">{prospect.nif}</DetailRow>}
                    <DetailRow icon={Phone} label={t("Telefone")}>
                      {prospect.phone
                        ? <span className="flex flex-wrap items-center gap-x-2">{prospect.phone}<Link to={getInboxUrl(prospect.phone)} className="text-xs text-emerald-600 hover:underline dark:text-emerald-400">WhatsApp</Link></span>
                        : <Empty />}
                    </DetailRow>
                    <DetailRow icon={Mail} label="Email">
                      {prospect.email ? <a href={`mailto:${prospect.email}`} className="text-primary hover:underline">{prospect.email}</a> : <Empty />}
                    </DetailRow>
                    {address.length > 0 && (
                      <DetailRow icon={MapPin} label={t("Morada")}>
                        {address.map((line) => <p key={line}>{line}</p>)}
                        {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{t('Ver no mapa')}</a>}
                      </DetailRow>
                    )}
                    {website && (
                      <DetailRow icon={Globe} label={t("Site")}>
                        <a href={href(website)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      </DetailRow>
                    )}
                    {socials.length > 0 && (
                      <DetailRow icon={Star} label={t("Redes sociais")}>
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {socials.map(([key, label]) => (
                            <a key={key} href={href(text(metadata[key])!)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{label}</a>
                          ))}
                        </span>
                      </DetailRow>
                    )}
                    {isEnergy && <DetailRow icon={Zap} label="CPE">{prospect.cpe ? <span className="font-mono text-xs">{prospect.cpe}</span> : <Empty />}</DetailRow>}
                    {segment && <DetailRow icon={Layers} label={t("Segmento")}>{segment}</DetailRow>}
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={cn(sectionTitle, 'mb-1')}>{t('Percurso')}</h3>
                  <div className="divide-y divide-border/60">
                    <DetailRow icon={FileSpreadsheet} label={t("Origem")}>{SOURCE_LABELS[prospect.source] ? t(SOURCE_LABELS[prospect.source]) : prospect.source}</DetailRow>
                    {prospect.source_file_name && <DetailRow icon={FileText} label={t("Ficheiro")}>{prospect.source_file_name}</DetailRow>}
                    {text(metadata.source_search) && (
                      <DetailRow icon={Search} label={t("Pesquisa")}>
                        {text(metadata.source_search)}{text(metadata.source_location) && ` · ${text(metadata.source_location)}`}
                      </DetailRow>
                    )}
                    <DetailRow icon={Calendar} label={t("Importado")}>{formatDate(prospect.imported_at || prospect.created_at)}</DetailRow>
                    <DetailRow icon={User} label={t("Comercial")}>
                      {salesperson ?? <span className="text-muted-foreground">{t('Não atribuído')}</span>}
                      {prospect.assigned_at && <span className="block text-xs text-muted-foreground">{t('desde {{date}}', { date: formatDate(prospect.assigned_at) })}</span>}
                    </DetailRow>
                    {prospect.converted_at && <DetailRow icon={ExternalLink} label={t("Convertido")}>{formatDate(prospect.converted_at)}</DetailRow>}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
