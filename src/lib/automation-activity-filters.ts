import type { AutomationRun } from '../types/automations';
import { canonicalStepNodeId } from './automation-step-identity';

export interface AutomationActivityFilters {
  readonly contact: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly nodeId: string;
}
export const EMPTY_ACTIVITY_FILTERS: AutomationActivityFilters = {contact:'',startDate:'',endDate:'',nodeId:''};
const dateFormatter = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'});
function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function activityFilterError(filters: AutomationActivityFilters): string | null {
  if ((filters.startDate && !validDate(filters.startDate)) || (filters.endDate && !validDate(filters.endDate))) return 'Indique datas válidas.';
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) return 'A data final deve ser igual ou posterior à data inicial.';
  return null;
}
function localDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-PT').trim();
}
export function currentActivityNodeIds(run: Pick<AutomationRun,'current_node_id'|'context'>): string[] {
  const result = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const id = canonicalStepNodeId({node_id:value,detail:null});
    if(id) result.add(id);
  };
  add(run.current_node_id);
  const cursors = run.context?.__cursors;
  if (Array.isArray(cursors)) for (const cursor of cursors) {
    if(typeof cursor === 'object' && cursor !== null && 'node' in cursor) add(cursor.node);
  }
  return [...result];
}
export function matchesActivityFilters(run: AutomationRun, filters: AutomationActivityFilters): boolean {
  if (activityFilterError(filters)) return false;
  const query = normalize(filters.contact);
  if (query) {
    const contact = normalize([run.contact_name,run.contact_email,run.contact_phone].filter(Boolean).join(' '));
    const phoneQuery = filters.contact.replace(/[^0-9]/g,'');
    const phoneOnly = /^[+()\s0-9.-]+$/.test(filters.contact) && phoneQuery.length > 0;
    if (!contact.includes(query) && !(phoneOnly && run.contact_phone?.replace(/[^0-9]/g,'').includes(phoneQuery))) return false;
  }
  if (filters.startDate || filters.endDate) {
    const started = localDate(run.started_at);
    if (!started || (filters.startDate && started < filters.startDate) || (filters.endDate && started > filters.endDate)) return false;
  }
  return !filters.nodeId || currentActivityNodeIds(run).includes(filters.nodeId);
}
