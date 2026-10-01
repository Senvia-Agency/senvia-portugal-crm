import type { MulticanalConfig } from './multicanal.ts';
import { evolutionFetch } from './multicanal.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function profilePictureUrlFromEvolutionResponse(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const url = payload['profilePictureUrl'];
  return typeof url === 'string' && /^https:\/\/\S+$/.test(url) ? url : null;
}

export async function fetchEvolutionContactAvatar(
  config: MulticanalConfig,
  instance: string,
  contactRef: string,
): Promise<string | null> {
  const response = await evolutionFetch(
    config,
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`,
    'POST',
    { number: contactRef },
  );
  if (!response.ok) return null;
  return profilePictureUrlFromEvolutionResponse(await response.json());
}
