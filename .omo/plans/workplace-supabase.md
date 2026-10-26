# Feed and Tasks shared persistence

Authorized: connect existing Workplace preview to shared Supabase; frontend remains localhost, no publication. Preserve drafts, existing Inbox records, credentials and unrelated work.

1. Confirm current live schema, permissions and singleton client. Complete.
2. Add isolated Feed tables/RLS and additive task status/priority fields with legacy done_at compatibility. Complete, reviewed and applied remotely. no existing row backfill or helper/policy replacements.
3. Complete. Replace preview persistence with organization-scoped shared queries, targeted mutations, realtime and draft-only browser recovery. Keep old rehearsal content private, never auto-publish it.
4. Complete. Apply reviewed additive migration and verify authenticated cross-user, cross-org, anonymous and role boundaries in rollback transactions.
5. Complete. Verify local real-browser workflows, two-tab sharing, failure recovery, Inbox regression tests, type checks and local-preview build; leave localhost open.

Team split: database worker owns migration/testSQL; Feed worker owns Feed persistence/UI; parent owns task integration, selective generated types, DB application, QA and evidence.
