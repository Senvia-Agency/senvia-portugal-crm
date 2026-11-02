import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

const VAPID_PUBLIC_KEY = 'BMFQbnBKJMJK7rTde-4l2udgDG-ntk29I1rpaNrrrcZ8N-kIf3kgGy5jcEyaeCqICHLsi4bhG45n0RXBi8eawBc';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Get the active SW registration, or null. Never throws, never hangs. */
async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    // Prefer one that's already active
    const active = regs.find((r) => r.active);
    if (active) return active;

    // If there's one installing/waiting, wait briefly for it
    const pending = regs.find((r) => r.installing || r.waiting);
    if (pending) {
      const sw = pending.installing || pending.waiting;
      if (sw) {
        await Promise.race([
          new Promise<void>((resolve) => {
            const handler = () => { if (sw.state === 'activated') { sw.removeEventListener('statechange', handler); resolve(); } };
            sw.addEventListener('statechange', handler);
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      if (pending.active) return pending;
    }

    // Last resort: try registering now
    const reg = await Promise.race([
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    return reg;
  } catch {
    return null;
  }
}

// Remembers that the person switched notifications off on this device, so a
// lost subscription is only reported when they still want notifications.
const OPTED_OUT_KEY = 'push-opted-out-v1';
function hasOptedOut(): boolean {
  try { return window.localStorage.getItem(OPTED_OUT_KEY) === '1'; } catch { return false; }
}
function setOptedOut(value: boolean) {
  try {
    if (value) window.localStorage.setItem(OPTED_OUT_KEY, '1');
    else window.localStorage.removeItem(OPTED_OUT_KEY);
  } catch { /* private mode: nothing to remember */ }
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  // Permission granted but the device's subscription is gone (iPhone/iPad
  // revoke it — see public/sw.js). Only a tap can renew it there.
  const [needsReactivation, setNeedsReactivation] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const { user, organization } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const supported =
          'serviceWorker' in navigator &&
          'PushManager' in window &&
          'Notification' in window;

        if (!cancelled) {
          setIsSupported(supported);
          setPermission(supported ? Notification.permission : 'default');
        }

        if (!supported || !user) return;

        const reg = await getSwRegistration();
        if (!reg || cancelled) return;

        let subscription = await reg.pushManager.getSubscription();

        // Auto-heal: se a subscrição existente foi feita com uma chave VAPID
        // DIFERENTE da atual (ex.: após rotação de chaves na migração), ela está
        // morta — renova silenciosamente para a chave nova.
        if (subscription && Notification.permission === 'granted' && organization) {
          const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          const subKey = subscription.options?.applicationServerKey;
          const stale = subKey ? !buffersEqual(new Uint8Array(subKey), currentKey) : false;
          if (stale) {
            try {
              // Order matters: get and SAVE the new subscription first, and only
              // then drop the old one. Deleting first left the device with no
              // row at all whenever anything after the delete failed.
              const oldEndpoint = subscription.endpoint;
              await subscription.unsubscribe();
              subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: currentKey });
              const p256dh = subscription.getKey('p256dh');
              const auth = subscription.getKey('auth');
              if (!p256dh || !auth) throw new Error('no keys on renewed subscription');
              const { error: saveError } = await supabase.from('push_subscriptions').upsert({
                user_id: user.id,
                organization_id: organization.id,
                endpoint: subscription.endpoint,
                p256dh: arrayBufferToBase64(p256dh),
                auth: arrayBufferToBase64(auth),
              }, { onConflict: 'endpoint' });
              if (saveError) throw saveError;
              if (oldEndpoint !== subscription.endpoint) {
                await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', oldEndpoint);
              }
              if (!cancelled) setIsSubscribed(true);
              return;
            } catch (e) {
              console.error('[push] auto-renew failed:', e);
            }
          }
        }

        // Permission is there but the subscription is not: the device dropped it
        // and, on iPhone/iPad, cannot get a new one without a tap. Unless the
        // person switched notifications off here, ask them to reactivate.
        if (!subscription && Notification.permission === 'granted' && !hasOptedOut() && !cancelled) {
          setNeedsReactivation(true);
        }

        if (subscription && !cancelled) {
          const { data, error } = await supabase
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', user.id)
            .eq('endpoint', subscription.endpoint)
            .maybeSingle();

          // The device still holds a live subscription but the server has no
          // row for it: the sender drops rows whose push service answered
          // 404/410, and a device that was re-added or switched organization
          // ends up here too. Re-register silently instead of showing a dead
          // "ativas" — the tablet case: switched on, never receiving.
          if (!error && !data && Notification.permission === 'granted' && organization) {
            const p256dh = subscription.getKey('p256dh');
            const auth = subscription.getKey('auth');
            if (p256dh && auth) {
              const { error: healError } = await supabase.from('push_subscriptions').upsert({
                user_id: user.id,
                organization_id: organization.id,
                endpoint: subscription.endpoint,
                p256dh: arrayBufferToBase64(p256dh),
                auth: arrayBufferToBase64(auth),
              }, { onConflict: 'endpoint' });
              if (!healError) {
                console.info('[push] re-registered this device on the server');
                if (!cancelled) setIsSubscribed(true);
                return;
              }
              console.error('[push] re-register failed:', healError);
            }
          }

          if (!cancelled) setIsSubscribed(!error && !!data);
        }
      } catch (err) {
        console.error('[push] check error:', err);
      } finally {
        // ALWAYS stop loading — no matter what happens above
        if (!cancelled) setIsLoading(false);
      }
    };

    check();
    return () => { cancelled = true; };
  }, [user, organization]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user || !organization) {
      toast({ title: 'Erro', description: 'Notificações push não suportadas ou utilizador não autenticado.', variant: 'destructive' });
      return false;
    }

    setIsLoading(true);
    try {
      const permResult = await Notification.requestPermission();
      setPermission(permResult);

      if (permResult !== 'granted') {
        toast({ title: 'Permissão negada', description: 'Precisa de permitir notificações para receber alertas.', variant: 'destructive' });
        return false;
      }

      const registration = await getSwRegistration();
      if (!registration) {
        toast({ title: 'Erro', description: 'Service worker não disponível. Feche e reabra o app.', variant: 'destructive' });
        return false;
      }

      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');
      if (!p256dh || !auth) throw new Error('Falha ao obter chaves de subscrição');

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          organization_id: organization.id,
          endpoint: subscription.endpoint,
          p256dh: arrayBufferToBase64(p256dh),
          auth: arrayBufferToBase64(auth),
        }, { onConflict: 'endpoint' });

      if (error) throw new Error('Erro ao guardar subscrição');

      setOptedOut(false);
      setNeedsReactivation(false);
      setIsSubscribed(true);
      toast({ title: 'Notificações ativadas', description: 'Vai receber alertas quando chegarem novos leads.' });
      return true;
    } catch (error) {
      console.error('[push] subscribe error:', error);
      toast({ title: 'Erro', description: error instanceof Error ? error.message : 'Erro ao ativar notificações.', variant: 'destructive' });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, user, organization, toast]);

  const unsubscribe = useCallback(async () => {
    if (!user) return false;
    setIsLoading(true);
    try {
      const reg = await getSwRegistration();
      if (reg) {
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', subscription.endpoint);
          await subscription.unsubscribe();
        }
      }
      setOptedOut(true);
      setIsSubscribed(false);
      toast({ title: 'Notificações desativadas', description: 'Já não vai receber alertas de novos leads.' });
      return true;
    } catch (error) {
      console.error('[push] unsubscribe error:', error);
      toast({ title: 'Erro', description: 'Erro ao desativar notificações.', variant: 'destructive' });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  // "Não quero" on the reactivation prompt: same as switching them off.
  const declineReactivation = useCallback(() => {
    setOptedOut(true);
    setNeedsReactivation(false);
  }, []);

  const toggle = useCallback(async () => {
    return isSubscribed ? await unsubscribe() : await subscribe();
  }, [isSubscribed, subscribe, unsubscribe]);

  return { isSupported, isSubscribed, isLoading, permission, needsReactivation, declineReactivation, subscribe, unsubscribe, toggle };
}
