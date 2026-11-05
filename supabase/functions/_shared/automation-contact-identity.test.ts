import assert from 'node:assert/strict';
import test from 'node:test';
import { automationContactSubjectId, contactRunIdentityFilter, InvalidAutomationContactIdentity } from './automation-contact-identity.ts';
test('normalized email generates stable organization-scoped UUIDv8 independent of event ids', async () => {
  const first = await automationContactSubjectId('org-a', { email: ' Ana@Example.test ', id: 'event-one' });
  assert.equal(await automationContactSubjectId('org-a', { email: 'ana@example.test', id: 'event-two' }), first);
  assert.notEqual(await automationContactSubjectId('org-b', { email: 'ana@example.test' }), first);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('phone identity takes precedence and stable UUID remains fallback for addressless contacts', async () => {
  const phone = await automationContactSubjectId('org', { phoneKey: '912345678', email: 'one@example.test' });
  assert.equal(await automationContactSubjectId('org', { phoneKey: '912345678', email: 'two@example.test' }), phone);
  const id = '12345678-1234-8123-8123-123456789abc';
  assert.equal(await automationContactSubjectId('org', { id }), id);
  await assert.rejects(() => automationContactSubjectId('org', { id: 'email-event' }), InvalidAutomationContactIdentity);
});
test('email lookup escapes LIKE metacharacters and retains legacy phone identity scope', () => {
  assert.deepEqual(contactRunIdentityFilter({ email: ' A_B%tag@Example.test ' }), { column: 'contact_email', value: 'a\_b\%tag@example.test', insensitive: true });
  assert.deepEqual(contactRunIdentityFilter({ phoneKey: '912345678', email: 'a@example.test' }), { column: 'contact_phone_key', value: '912345678', insensitive: false });
});
