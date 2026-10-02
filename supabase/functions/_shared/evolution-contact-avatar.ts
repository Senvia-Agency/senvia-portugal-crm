import type { MulticanalConfig } from './multicanal.ts';
import { evolutionFetch } from './multicanal.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const usableUrl = (value: unknown): string | null =>
  typeof value === 'string' && /^https:\/\/\S+$/.test(value) ? value : null;

export function profilePictureUrlFromEvolutionResponse(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return usableUrl(payload['profilePictureUrl']);
}

/** Evolution's own contact list (`/chat/findContacts`): `profilePicUrl` on the matching contact. */
export function profilePictureUrlFromContacts(payload: unknown, remoteJid: string): string | null {
  const list = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload['contacts']) ? payload['contacts'] : [];
  for (const contact of list) {
    if (!isRecord(contact)) continue;
    if (contact['remoteJid'] !== remoteJid && contact['id'] !== remoteJid) continue;
    const url = usableUrl(contact['profilePicUrl']) ?? usableUrl(contact['profilePictureUrl']);
    if (url) return url;
  }
  return null;
}

/**
 * WhatsApp photo links are signed and expire: `oe` is the expiry as a hex
 * Unix time. An expired one draws as a broken image, so it is fetched again.
 */
export function avatarUrlExpired(url: string | null | undefined, now = Date.now()): boolean {
  if (!url) return true;
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (!oe || !/^[0-9a-f]+$/i.test(oe)) return false;
    // A day early, so a photo shown today still loads tonight.
    return parseInt(oe, 16) * 1000 - 86_400_000 <= now;
  } catch {
    return true;
  }
}

export interface AvatarLookup {
  url: string | null;
  /** Why there is no photo, for the log: what Evolution answered. */
  reason?: string;
}

/**
 * The contact's WhatsApp photo. First the live lookup; when WhatsApp gives
 * nothing (privacy settings, a hiccup), the contact list Evolution keeps from
 * its own sync, which often still holds it.
 */
export async function fetchEvolutionContactAvatar(
  config: MulticanalConfig,
  instance: string,
  contactRef: string,
): Promise<AvatarLookup> {
  const reasons: string[] = [];
  const live = await evolutionFetch(
    config,
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`,
    'POST',
    { number: contactRef },
  );
  const liveBody = await live.text();
  if (live.ok) {
    const url = profilePictureUrlFromEvolutionResponse(JSON.parse(liveBody || 'null'));
    if (url) return { url };
    reasons.push(`fetchProfilePictureUrl sem foto: ${liveBody.slice(0, 160)}`);
  } else {
    reasons.push(`fetchProfilePictureUrl ${live.status}: ${liveBody.slice(0, 160)}`);
  }

  const remoteJid = contactRef.includes('@') ? contactRef : `${contactRef}@s.whatsapp.net`;
  const stored = await evolutionFetch(
    config,
    `/chat/findContacts/${encodeURIComponent(instance)}`,
    'POST',
    { where: { remoteJid } },
  );
  const storedBody = await stored.text();
  if (stored.ok) {
    const url = profilePictureUrlFromContacts(JSON.parse(storedBody || 'null'), remoteJid);
    if (url) return { url };
    reasons.push(`findContacts sem foto: ${storedBody.slice(0, 160)}`);
  } else {
    reasons.push(`findContacts ${stored.status}: ${storedBody.slice(0, 160)}`);
  }
  return { url: null, reason: reasons.join(' | ') };
}
