import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const normalize = (address: string) => address.trim().toLowerCase();

/**
 * Senders whose remote images the user always shows ("Mostrar sempre as
 * imagens deste remetente"). Stored on the user's profile, so the choice
 * follows them to every device. Every open email reads the same cached list,
 * so trusting a sender in one updates the others at once.
 */
export function useEmailImageSenders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['email-image-senders', user?.id];

  const { data: senders = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('email_image_senders')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return (data?.email_image_senders ?? []).map(normalize);
    },
  });

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ email_image_senders: next })
        .eq('id', user!.id)
        .select('email_image_senders')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Preferência não foi gravada');
      return data.email_image_senders.map(normalize);
    },
    // Stop an older read from replacing a newly saved preference.
    onMutate: async () => { await qc.cancelQueries({ queryKey: key }); },
    onSuccess: (persisted) => { qc.setQueryData(key, persisted); },
    onError: () => {
      toast.error('Não foi possível guardar a preferência das imagens. Tenta novamente.');
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    /** Still reading the list: keep images blocked until it is known. */
    loading: isLoading,
    saving: save.isPending,
    trusts: (address: string | null | undefined) => !!address && senders.includes(normalize(address)),
    trust: (address: string) => save.mutate([...new Set([...senders, normalize(address)])]),
    untrust: (address: string) => save.mutate(senders.filter((s) => s !== normalize(address))),
  };
}
