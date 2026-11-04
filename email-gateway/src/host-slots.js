// Shared hosting (cPanel and the like) refuses an account's extra IMAP/SMTP
// logins when several arrive at once. Work that opens a connection to one
// server runs at most MAX_PER_HOST at a time; the rest wait for a free slot.
const MAX_PER_HOST = 2;
const hosts = new Map(); // host -> { running, waiting: [resolve] }

export async function withHostSlot(host, fn, max = MAX_PER_HOST) {
  const key = String(host || '').toLowerCase();
  let slot = hosts.get(key);
  if (!slot) { slot = { running: 0, waiting: [] }; hosts.set(key, slot); }
  // A freed slot is handed straight to the next in line, so a newcomer can
  // never slip in between and push the count past the limit.
  if (slot.running >= max) await new Promise((resolve) => slot.waiting.push(resolve));
  else slot.running++;
  try {
    return await fn();
  } finally {
    const next = slot.waiting.shift();
    if (next) next();
    else if (--slot.running === 0) hosts.delete(key);
  }
}

export function hostSlotsInUse(host) {
  return hosts.get(String(host || '').toLowerCase())?.running ?? 0;
}
