const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../../public/sw.js'), 'utf8');

// Loads public/sw.js with a fake service-worker scope and fires one push.
async function push(payload, windows = []) {
  const handlers = {};
  const shown = [];
  const self = {
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: async () => {},
    location: { origin: 'https://app.senvia.pt' },
    clients: { matchAll: async () => windows, claim: async () => {} },
    registration: {
      showNotification: async (title, options) => { shown.push({ title, options, closed: false }); },
      getNotifications: async ({ tag } = {}) => shown
        .filter((n) => !tag || n.options.tag === tag)
        .map((n) => ({ close: () => { n.closed = true; } })),
    },
  };
  vm.runInNewContext(source, { self, caches: { keys: async () => [] }, URL, console });
  let pending;
  handlers.push({
    data: payload === undefined ? null : { json: () => payload, text: () => String(payload) },
    waitUntil: (promise) => { pending = promise; },
  });
  await pending;
  return shown;
}

const inboxWindow = { focused: true, visibilityState: 'visible', url: 'https://app.senvia.pt/inbox?c=1' };

test('an inbox push with the inbox open still shows a notification, silently, and closes it', async () => {
  const shown = await push({ title: 'Nova mensagem', body: 'Olá', url: '/inbox?c=1' }, [inboxWindow]);
  assert.equal(shown.length, 1, 'iPhone/iPad revoke the subscription when a push shows nothing');
  assert.equal(shown[0].options.silent, true);
  assert.equal(shown[0].options.vibrate, undefined, 'Chrome rejects silent notifications with a vibration');
  assert.equal(shown[0].closed, true);
});

test('closing the quiet one leaves the other notifications alone', async () => {
  const handlersShown = await push({ title: 'Nova mensagem', body: 'Olá', url: '/inbox' }, [inboxWindow]);
  assert.ok(handlersShown[0].options.tag.startsWith('quiet-'));
});

test('an inbox push with the app elsewhere is a normal notification', async () => {
  const shown = await push({ title: 'Nova mensagem', body: 'Olá', url: '/inbox' },
    [{ ...inboxWindow, url: 'https://app.senvia.pt/dashboard' }]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.silent, undefined);
  assert.equal(shown[0].closed, false);
});

test('other pushes and pushes without a payload are shown', async () => {
  assert.equal((await push({ title: 'Novo lead', body: 'Ana', url: '/leads' }, [inboxWindow]))[0].closed, false);
  const empty = await push(undefined);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, 'Senvia OS');
});
