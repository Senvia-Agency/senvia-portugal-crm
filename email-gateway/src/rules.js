// Email rules (email_rules): which of a caixa's rules match a new Inbox message and what to do
// with it. Pure functions — the IMAP work lives in commands.js (applyInboxRules).

const ROLE_BY_ACTION = { archive: 'archive', trash: 'trash', spam: 'junk' };

const norm = (value) => String(value ?? '').normalize('NFC').toLocaleLowerCase('pt-PT').trim();

function addressList(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => [entry?.address, entry?.name]).filter(Boolean);
}

// The texts one condition looks at: each address and name of a list, the subject, the body.
function candidates(field, message) {
  switch (field) {
    case 'from': return [message.from_address, message.from_name].filter(Boolean);
    case 'to': return addressList(message.to_addresses);
    case 'cc': return addressList(message.cc_addresses);
    case 'subject': return [message.subject ?? ''];
    case 'body': return [message.body ?? ''];
    default: return [];
  }
}

export function conditionMatches(condition, message) {
  if (condition?.field === 'has_attachments') {
    return Boolean(message.has_attachments) === (condition.value === 'true');
  }
  const wanted = norm(condition?.value);
  if (!wanted) return false;
  const texts = candidates(condition.field, message).map(norm);
  switch (condition.operator) {
    case 'contains': return texts.some((text) => text.includes(wanted));
    case 'not_contains': return !texts.some((text) => text.includes(wanted));
    case 'equals': return texts.some((text) => text === wanted);
    case 'starts_with': return texts.some((text) => text.startsWith(wanted));
    case 'ends_with': return texts.some((text) => text.endsWith(wanted));
    default: return false;
  }
}

export function ruleMatches(rule, message) {
  const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
  if (conditions.length === 0) return false;
  return rule.match_all
    ? conditions.every((condition) => conditionMatches(condition, message))
    : conditions.some((condition) => conditionMatches(condition, message));
}

/** Rules that look at the body need it downloaded before they run. */
export function rulesNeedBody(rules) {
  return rules.some((rule) => (rule.conditions ?? []).some((condition) => condition?.field === 'body'));
}

/**
 * Runs the rules in order on one message. Flags add up across every matching rule; the first
 * destination wins (a message ends up in one folder); stop_processing ends the run.
 */
export function planRules(rules, message) {
  const plan = { matched: [], seen: false, flagged: false, destination: null };
  for (const rule of rules) {
    if (!ruleMatches(rule, message)) continue;
    plan.matched.push(rule.id);
    for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
      if (action?.type === 'mark_read') plan.seen = true;
      else if (action?.type === 'flag') plan.flagged = true;
      else if (!plan.destination && action?.type === 'move' && action.folderId) plan.destination = { folderId: action.folderId };
      else if (!plan.destination && ROLE_BY_ACTION[action?.type]) plan.destination = { role: ROLE_BY_ACTION[action.type] };
    }
    if (rule.stop_processing) break;
  }
  return plan;
}
