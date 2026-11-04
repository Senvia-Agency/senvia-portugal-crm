import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import type { ClientCommunication, CommunicationType } from '@/types/communications';
import { tr } from "@/i18n";

export type HistoryEventType = 'proposal' | 'sale' | 'meeting' | 'note' | 'call' | 'whatsapp' | 'email';

export interface ClientHistoryEvent {
  id: string;
  type: HistoryEventType;
  title: string;
  description?: string;
  date: string;
  value?: number;
  status?: string;
  direction?: 'inbound' | 'outbound' | null;
  duration_seconds?: number | null;
  metadata?: Record<string, unknown>;
}

export function useClientProposals(clientId: string | null) {
  return useQuery({
    queryKey: ['client-proposals', clientId],
    queryFn: async () => {
      if (!clientId) return [];

      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching client proposals:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useClientSales(clientId: string | null) {
  return useQuery({
    queryKey: ['client-sales', clientId],
    queryFn: async () => {
      if (!clientId) return [];

      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching client sales:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useClientEvents(clientId: string | null) {
  return useQuery({
    queryKey: ['client-events', clientId],
    queryFn: async () => {
      if (!clientId) return [];

      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('client_id', clientId)
        .order('start_time', { ascending: false });

      if (error) {
        console.error('Error fetching client events:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useClientCommunicationsHistory(clientId: string | null) {
  return useQuery({
    queryKey: ['client-communications', clientId],
    queryFn: async () => {
      if (!clientId) return [];

      const { data, error } = await supabase
        .from('client_communications')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false });

      if (error) {
        console.error('Error fetching client communications:', error);
        throw error;
      }

      return data as ClientCommunication[];
    },
    enabled: !!clientId,
  });
}

const COMMUNICATION_TYPE_LABELS: Record<CommunicationType, string> = {
  call: 'Chamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  note: 'Nota',
};

export function useClientHistory(clientId: string | null) {
  const { data: proposals = [], isLoading: loadingProposals } = useClientProposals(clientId);
  const { data: sales = [], isLoading: loadingSales } = useClientSales(clientId);
  const { data: events = [], isLoading: loadingEvents } = useClientEvents(clientId);
  const { data: communications = [], isLoading: loadingCommunications } = useClientCommunicationsHistory(clientId);

  const timeline = useMemo(() => {
    const items: ClientHistoryEvent[] = [];

    // Add proposals
    proposals.forEach((p) => {
      items.push({
        id: p.id,
        type: 'proposal',
        title: p.code ? tr("Proposta {{code}}", { code: p.code }) : tr('Proposta'),
        description: p.notes || undefined,
        date: p.created_at || '',
        value: p.total_value,
        status: p.status,
        metadata: { proposalId: p.id },
      });
    });

    // Add sales
    sales.forEach((s) => {
      items.push({
        id: s.id,
        type: 'sale',
        title: s.code ? tr("Venda {{code}}", { code: s.code }) : tr('Venda'),
        description: s.notes || undefined,
        date: s.created_at || '',
        value: s.total_value,
        status: s.status,
        metadata: { saleId: s.id },
      });
    });

    // Add events/meetings
    events.forEach((e) => {
      items.push({
        id: e.id,
        type: 'meeting',
        title: e.title,
        description: e.description || undefined,
        date: e.start_time,
        status: e.status || undefined,
        metadata: { eventId: e.id, eventType: e.event_type },
      });
    });

    // Add communications
    communications.forEach((c) => {
      const type = c.type as HistoryEventType;
      const typeLabel = tr(COMMUNICATION_TYPE_LABELS[c.type]);
      const title = c.subject 
        ? `${typeLabel}: ${c.subject}` 
        : c.direction === 'inbound' ? tr("{{type}} recebida", { type: typeLabel })
        : c.direction === 'outbound' ? tr("{{type}} enviada", { type: typeLabel })
        : typeLabel;
      
      items.push({
        id: c.id,
        type,
        title,
        description: c.content || undefined,
        date: c.occurred_at,
        direction: c.direction,
        duration_seconds: c.duration_seconds,
        metadata: { communicationId: c.id, communicationType: c.type },
      });
    });

    // Sort by date descending
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [proposals, sales, events, communications]);

  return {
    timeline,
    proposals,
    sales,
    events,
    communications,
    isLoading: loadingProposals || loadingSales || loadingEvents || loadingCommunications,
  };
}
