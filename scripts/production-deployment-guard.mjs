const COMMIT = /^[a-f0-9]{40}$/;

export function checkOrganizationQuery(source) {
  if (/\.from\(\s*['"]organizations['"]\s*\)\s*\.select\(\s*['"]\*['"]/.test(source)) {
    throw new Error('Organization wildcard SELECT is forbidden: protected columns break frontend access.');
  }
  const fields = source.match(/const SAFE_ORG_FIELDS = '([^']+)'/)?.[1];
  if (!fields) throw new Error('Explicit organization fields are required.');
  const names = fields.split(',');
  for (const required of ['id', 'name', 'plan', 'enabled_modules']) {
    if (!names.includes(required)) throw new Error(`Organization field missing: ${required}`);
  }
  const secrets = ['whatsapp_api_key', 'brevo_api_key', 'invoicexpress_api_key', 'keyinvoice_password', 'keyinvoice_token', 'webhook_token', 'chatwoot_account_token', 'chatwoot_webhook_secret', 'meta_conversions_api_token', 'vendus_api_key'];
  if (names.some(name => secrets.includes(name))) throw new Error('Organization credentials must not be selected by the frontend.');
  return fields;
}

export function checkProductionSource(env) {
  const isGit = COMMIT.test(env.VERCEL_GIT_COMMIT_SHA ?? '');
  if (env.VERCEL_ENV === 'production' && (!isGit || env.VERCEL_GIT_COMMIT_REF !== 'main')) {
    throw new Error('Production builds require a Git main deployment. Publish by pushing main.');
  }
  return isGit ? 'git' : 'local';
}

export function checkBuildIdentity(info, expectedSha) {
  if (!COMMIT.test(expectedSha)) throw new Error('Expected commit must be a full Git SHA.');
  if (info?.schemaVersion !== 1 || info.gitSha !== expectedSha) throw new Error('Production commit does not match the expected commit.');
  if (info.source !== 'git') throw new Error('Production must serve a Git build; local artifacts are forbidden.');
}
