# Email body reading — resolved through Supabase

The earlier gateway patch is superseded. Do not apply it to OpenClaw or any VPS.

The current repository already contains the gateway `fetch_body` handler (commit 55d16b2a); the older source copy previously inspected was not the active deployment. The active gateway still rejected that command, and its hosting location was not established. Instead, the authorized correction now reads message bodies directly through the new Supabase `email-fetch-body` function.

Applied after explicit user authorization on 13 September 2026:
- Deployed `supabase/functions/email-fetch-body/` to project `chhmfwlimtbsyjmgtokn`.
- Applied only `20260913090000_email_body_cache.sql`, a server-only atomic cache-fill function. Customer roles cannot call it.
- Updated localhost to invoke that Edge Function instead of queueing `fetch_body`.

User authentication and existing message RLS enforce mailbox access and MFA before private IMAP credentials are read. IMAP uses verified TLS on port 993, public DNS addresses, a read-only mailbox and a 15 MB message limit. This code does not send or delete emails. Existing attachments and cached bodies are preserved; successful retries do not duplicate attachments.

Verification: Deno typecheck, isolated PostgreSQL migration/role/replay tests, real IMAP read of the user's test message, invocation of the cache function on the live schema, rejection of anonymous requests by the deployed function, and a browser test that renders an uncached message through the new frontend request flow. The browser test mocked its API response; no claim is made that an authenticated browser request to the deployed endpoint was observed during that test.

The frontend has not been published to Vercel. The old production frontend still queues body requests until its separate release. No other pending migrations, plans, billing, referral changes, OpenClaw or VPS configuration were applied.
