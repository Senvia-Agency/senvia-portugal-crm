import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';

let server;
let UpgradeModal;
before(async () => {
  server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/') } },
    plugins: [{
      name: 'isolate-subscription-network', enforce: 'pre',
      resolveId(id) {
        if (/\/hooks\/useStripeSubscription(?:\.ts)?$/.test(id.replaceAll('\\', '/'))) return '\0subscription-test';
      },
      load(id) {
        if (id === '\0subscription-test') return 'export const useStripeSubscription = () => ({ isLoading: false, createCheckout: () => { throw new Error("Unexpected checkout during render"); } });';
      },
    }, react()],
  });
  ({ UpgradeModal } = await server.ssrLoadModule('/src/components/shared/UpgradeModal.tsx'));
});
after(async () => { await server?.close(); });

// The navigation mounts the dialog closed with empty state before any click.
// Render the real component so dereferencing an absent plan fails this test.
for (const requiredPlan of ['', 'Pro', 'Elite', 'Starter', 'SENVIA OS', 'removed-plan']) {
  test(`closed navigation dialog safely renders with plan ${JSON.stringify(requiredPlan)}`, () => {
    assert.doesNotThrow(() => renderToString(createElement(UpgradeModal, {
      open: false, onOpenChange() {}, featureName: '', requiredPlan,
    })));
  });
}
