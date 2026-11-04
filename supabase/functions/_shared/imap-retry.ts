type Connectable = { connect(): Promise<unknown>; close(): void };

/**
 * Opens an IMAP connection, trying once more after a short pause when the first
 * attempt fails for a reason other than the password. Shared hosting often drops
 * a login that arrives while the account already has connections open; the
 * second try usually lands once one of them is done.
 */
export async function connectWithRetry<T extends Connectable>(open: () => T, waitMs = 1500): Promise<T> {
  const first = open();
  try {
    await first.connect();
    return first;
  } catch (error) {
    try { first.close(); } catch { /* already closed */ }
    if ((error as { authenticationFailed?: boolean } | null)?.authenticationFailed) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const second = open();
  try {
    await second.connect();
    return second;
  } catch (error) {
    try { second.close(); } catch { /* already closed */ }
    throw error;
  }
}
