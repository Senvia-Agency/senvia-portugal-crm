import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PushNotificationRequest {
  organization_id: string;
  user_ids?: string[];
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ping_only?: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// VAPID public key
const VAPID_PUBLIC_KEY = 'BMFQbnBKJMJK7rTde-4l2udgDG-ntk29I1rpaNrrrcZ8N-kIf3kgGy5jcEyaeCqICHLsi4bhG45n0RXBi8eawBc';

// Helper to convert Uint8Array to ArrayBuffer
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

// Base64URL encode
function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Base64URL decode
function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Standard Base64 decode
function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Create VAPID JWT
async function createVapidJwt(audience: string, privateKeyBase64: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: 'mailto:suporte@senvia.pt',
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyBytes = base64UrlDecode(privateKeyBase64);
  const publicKeyBytes = base64UrlDecode(VAPID_PUBLIC_KEY);
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(privateKeyBytes),
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
  };

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${unsignedToken}.${signatureB64}`;
}

// HKDF using WebCrypto native API
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(ikm), 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(info) },
    key,
    length * 8
  );
  return new Uint8Array(derived);
}

// Generate local ECDH keys
async function generateLocalKeys(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return {
    publicKey: new Uint8Array(publicKeyRaw),
    privateKey: keyPair.privateKey,
  };
}

// Encrypt payload using aes128gcm (RFC 8291)
async function encryptPayload(
  payload: string,
  p256dhBase64: string,
  authBase64: string
): Promise<Uint8Array> {
  const subscriberPublicKeyBytes = base64Decode(p256dhBase64);
  const authSecret = base64Decode(authBase64);

  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(subscriberPublicKeyBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const { publicKey: localPublicKey, privateKey: localPrivateKey } = await generateLocalKeys();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPublicKey },
    localPrivateKey,
    256
  );
  const sharedSecretBytes = new Uint8Array(sharedSecret);

  const infoPrefix = new TextEncoder().encode('WebPush: info\0');
  const keyInfo = new Uint8Array(infoPrefix.length + subscriberPublicKeyBytes.length + localPublicKey.length);
  keyInfo.set(infoPrefix, 0);
  keyInfo.set(subscriberPublicKeyBytes, infoPrefix.length);
  keyInfo.set(localPublicKey, infoPrefix.length + subscriberPublicKeyBytes.length);

  const ikm = await hkdf(authSecret, sharedSecretBytes, keyInfo, 32);
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const payloadBytes = new TextEncoder().encode(payload);
  const plaintext = new Uint8Array(payloadBytes.length + 1);
  plaintext.set(payloadBytes, 0);
  plaintext[payloadBytes.length] = 0x02;

  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(cek), 'AES-GCM', false, ['encrypt']);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    aesKey,
    toArrayBuffer(plaintext)
  );

  const rs = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs, false);

  const idlen = localPublicKey.length;
  const header = new Uint8Array(16 + 4 + 1 + idlen);
  header.set(salt, 0);
  header.set(rsBytes, 16);
  header[20] = idlen;
  header.set(localPublicKey, 21);

  const encrypted = new Uint8Array(header.length + ciphertext.byteLength);
  encrypted.set(header, 0);
  encrypted.set(new Uint8Array(ciphertext), header.length);

  return encrypted;
}

// Send a single push notification
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string | null,
  vapidPrivateKey: string
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  try {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const jwt = await createVapidJwt(audience, vapidPrivateKey);

    const headers: Record<string, string> = {
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'TTL': '86400',
    };

    let body: ArrayBuffer | null = null;

    if (payload) {
      const encrypted = await encryptPayload(payload, subscription.p256dh, subscription.auth);
      body = toArrayBuffer(encrypted);
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Encoding'] = 'aes128gcm';
      headers['Content-Length'] = String(encrypted.length);
    } else {
      headers['Content-Length'] = '0';
    }

    console.log(`Sending to: ${subscription.endpoint.substring(0, 50)}...`);

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (response.ok || response.status === 201) {
      console.log(`✓ Sent successfully (${response.status})`);
      return { success: true, statusCode: response.status };
    } else {
      const errorText = await response.text().catch(() => '');
      console.error(`✗ Failed: ${response.status} - ${errorText}`);
      return { success: false, statusCode: response.status, error: errorText };
    }
  } catch (error) {
    console.error(`✗ Exception:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: PushNotificationRequest = await req.json();
    console.log('Push notification request:', body);

    const { organization_id, user_ids, title, body: messageBody, url, tag, ping_only } = body;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: 'organization_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SECURITY: this function had NO auth check at all — anyone who knew (or
    // guessed) an organization_id could send arbitrary push content (title/
    // body/url) to every device of that org, a phishing/spam vector. Trusted
    // backend callers (chatwoot-webhook, task-reminders, submit-lead,
    // check-reminders) already send `Authorization: Bearer <service role key>`
    // — accept that, or a real user JWT that's actually a member of
    // `organization_id` (the settings page's "test notification" button).
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    // Trusted callers: the service role key (edge functions), or the internal automation
    // secret (database triggers such as the sale notifications, via pg_net).
    let isInternalServiceCall = !!token && token === supabaseKey;
    if (!isInternalServiceCall && token && token.length < 200) {
      const { data: isAutomation } = await supabase.rpc('verify_automation_secret', { p_secret: token });
      isInternalServiceCall = isAutomation === true;
    }
    if (!isInternalServiceCall) {
      if (!token) {
        return new Response(JSON.stringify({ error: 'Não autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Não autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
      if (mfaResponse) return mfaResponse;
      const { data: isMember } = await supabase.rpc('is_org_member', {
        _user_id: user.id,
        _org_id: organization_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Sem acesso a esta organização' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!vapidPrivateKey) {
      console.error('VAPID_PRIVATE_KEY not configured');
      return new Response(JSON.stringify({ error: 'VAPID_PRIVATE_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let query = supabase
      .from('push_subscriptions')
      .select('*')
      .eq('organization_id', organization_id);

    if (user_ids && user_ids.length > 0) {
      query = query.in('user_id', user_ids);
      console.log(`Filtering push to ${user_ids.length} specific users`);
    }

    const { data: subscriptions, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching subscriptions:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch subscriptions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No subscriptions found for organization');
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No subscriptions' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${subscriptions.length} subscriptions`);

    let payload: string | null = null;
    if (!ping_only && title && messageBody) {
      payload = JSON.stringify({
        title: title,
        body: messageBody,
        url: url || '/dashboard',
        tag: tag || 'default',
      });
    }

    // Extract conversation ID from tag (format: "inbox-123") so muted conversations
    // can be filtered per-subscription before sending.
    const conversationId = tag?.startsWith('inbox-') ? parseInt(tag.slice(6), 10) : NaN;

    let successCount = 0;
    const expiredEndpoints: string[] = [];
    const results: Array<{ endpoint: string; success: boolean; status?: number; error?: string }> = [];

    for (const sub of subscriptions) {
      if (!isNaN(conversationId) && Array.isArray(sub.muted_conversation_ids) && sub.muted_conversation_ids.includes(conversationId)) {
        console.log(`Skipping push for user ${sub.user_id} — conversation ${conversationId} is muted`);
        continue;
      }

      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
        vapidPrivateKey
      );

      results.push({
        endpoint: sub.endpoint.substring(0, 40) + '...',
        success: result.success,
        status: result.statusCode,
        error: result.error,
      });

      if (result.success) {
        successCount++;
      } else if (
        result.statusCode === 404 || result.statusCode === 410 ||
        // Registered with an old VAPID key (400 VapidPkHashMismatch) or rejected for that
        // subscription alone (403): it can never succeed again. Drop the row; the device
        // registers a fresh one the next time the app opens (usePushNotifications auto-heal).
        result.statusCode === 403 ||
        (result.statusCode === 400 && /VapidPkHashMismatch|UnauthorizedRegistration|BadJwtToken/i.test(result.error ?? ''))
      ) {
        expiredEndpoints.push(sub.endpoint);
      }
    }

    if (expiredEndpoints.length > 0) {
      console.log(`Removing ${expiredEndpoints.length} expired subscriptions`);
      await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
    }

    console.log(`Result: ${successCount}/${subscriptions.length} sent`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        total: subscriptions.length,
        expired_removed: expiredEndpoints.length,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing request:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
