const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

async function loadView() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'configured-manual-view-'));
  const outfile = path.join(tmp, 'view.cjs');
  await build({
    stdin: {
      contents: "export { ConfiguredWorkflowManualRunView } from './src/components/automations/ConfiguredWorkflowManualRun';",
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [{
      name: 'manual-hook-stub',
      setup(builder) {
        builder.onResolve({ filter: /^@\/hooks\/useConfiguredWorkflowManual$/ }, () => ({
          path: 'manual-hook',
          namespace: 'stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: "export function useConfiguredWorkflowManual(){ throw new Error('wrapper not used in view tests'); }",
          loader: 'js',
        }));
        builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true,
        }));
      },
    }],
  });
  const loaded = require(outfile);
  return { View: loaded.ConfiguredWorkflowManualRunView, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function setupDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test' });
  for (const key of [
    'window', 'document', 'HTMLElement', 'Element', 'Node', 'NodeFilter',
    'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  ]) global[key] = dom.window[key];
  global.getComputedStyle = dom.window.getComputedStyle;
  global.navigator = dom.window.navigator;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function buttonByText(text) {
  return [...document.querySelectorAll('button')].find((button) => button.textContent.includes(text));
}

async function click(React, button) {
  assert.ok(button, 'expected button to exist');
  await React.act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test('shows the impact preview before preparing a server proof', async () => {
  const dom = setupDom();
  const { View, cleanup } = await loadView();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  let prepares = 0;
  let confirms = 0;
  try {
    await React.act(async () => root.render(React.createElement(View, {
      state: { status: 'idle' },
      onPrepare: () => { prepares += 1; },
      onConfirm: () => { confirms += 1; },
      onCancel: () => {},
    })));
    const previewButton = buttonByText('Pré-visualizar execução');
    assert.equal(previewButton.disabled, false);
    await click(React, previewButton);
    assert.match(document.body.textContent, /poderá iniciar as ações configuradas/i);
    assert.equal(prepares, 0);
    assert.equal(confirms, 0);
    await click(React, buttonByText('Preparar confirmação'));
    assert.equal(prepares, 1);
    assert.equal(confirms, 0);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    cleanup();
  }
});

test('only the second explicit confirmation can run a prepared workflow', async () => {
  const dom = setupDom();
  const { View, cleanup } = await loadView();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  let confirms = 0;
  try {
    await React.act(async () => root.render(React.createElement(View, {
      state: { status: 'awaiting_confirmation', expiresAt: '2030-01-02T03:04:05.000Z' },
      onPrepare: () => {},
      onConfirm: () => { confirms += 1; },
      onCancel: () => {},
    })));
    await click(React, buttonByText('Continuar execução'));
    assert.match(document.body.textContent, /confirmação é única/i);
    assert.match(document.body.textContent, /02\/01\/2030/);
    assert.match(document.body.textContent, /03:04:05/);
    await click(React, buttonByText('Confirmar e executar'));
    assert.equal(confirms, 1);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    cleanup();
  }
});

test('labels a known run rejection as execution failure, not preparation failure', async () => {
  const dom = setupDom();
  const { View, cleanup } = await loadView();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(View, {
      state: { status: 'failed', phase: 'run', message: 'Confirmação expirada.' },
      onPrepare: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    })));
    await click(React, buttonByText('Ver rejeição'));
    assert.match(document.body.textContent, /Execução rejeitada/);
    assert.doesNotMatch(document.body.textContent, /Não foi possível preparar a execução/);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    cleanup();
  }
});

test('an unknown result offers review but no retry action', async () => {
  const dom = setupDom();
  const { View, cleanup } = await loadView();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  let reviews = 0;
  try {
    await React.act(async () => root.render(React.createElement(View, {
      state: { status: 'unknown', message: 'Resultado incerto.' },
      onPrepare: () => { throw new Error('must not retry'); },
      onConfirm: () => { throw new Error('must not confirm'); },
      onCancel: () => {},
      onReviewExecutions: () => { reviews += 1; },
    })));
    await click(React, buttonByText('Ver estado da execução'));
    assert.equal(buttonByText('Preparar confirmação'), undefined);
    assert.equal(buttonByText('Confirmar e executar'), undefined);
    await click(React, buttonByText('Ver execuções'));
    assert.equal(reviews, 1);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    cleanup();
  }
});
