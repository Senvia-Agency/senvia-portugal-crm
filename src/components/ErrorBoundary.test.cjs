const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');

function fixture() {
  const listeners = new Map();
  let reloads = 0;
  let renders = 0;
  const notices = [];
  const window = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    location: { reload() { reloads++; } },
  };
  const values = new Map();
  const context = {
    window, navigator: {}, console: { error() {} }, Date,
    sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    document: { getElementById: () => ({}) },
  };
  const React = { Component: class { constructor(props) { this.props = props; } } };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const toast = { warning(message, options) { notices.push({ message, options }); } };
  function load(file, imports = {}) {
    const module = { exports: {} };
    const code = esbuild.transformSync(fs.readFileSync(file, 'utf8').replace(/import\.meta\.env\.DEV/g, 'false'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
    vm.runInNewContext(code, { ...context, module, exports: module.exports, require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'sonner') return { toast };
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected dependency ${name}`);
    } }, { filename: file });
    return module.exports;
  }
  const boundary = load('src/components/ErrorBoundary.tsx');
  const main = () => load('src/main.tsx', {
    'react-dom/client': { createRoot: () => ({ render() { renders++; } }) },
    './App.tsx': { default: () => null }, './index.css': {},
    './components/ErrorBoundary': boundary,
    '@/contexts/PaidTrafficFilterContext': { PaidTrafficFilterProvider: () => null },
    '@/lib/senvia-pixel': { loadSenviaPixel() {} },
  });
  return { main, boundary, notices, listeners, reloads: () => reloads, renders: () => renders };
}

test('preload failure never forces a reload and offers an explicit update action', () => {
  const app = fixture();
  app.main();
  let prevented = 0;
  const handler = app.listeners.get('vite:preloadError');
  handler({ preventDefault() { prevented++; } });
  handler({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(app.reloads(), 0, 'A failed lazy chunk must never reload an editing session automatically');
  assert.equal(app.renders(), 1, 'The preload listener never creates a replacement React root');
  assert.ok(app.notices.length > 0, 'Offer a visible explicit update action');
  assert.equal(app.notices[0].options.duration, Infinity);
  app.notices[0].options.action.onClick();
  assert.equal(app.reloads(), 1, 'Reload only after the user explicitly chooses it');
});

test('chunk and ordinary render errors never reload from the error boundary', () => {
  const app = fixture();
  for (const message of ['Failed to fetch dynamically imported module', 'ChunkLoadError', 'Failed to fetch']) {
    const error = new Error(message);
    const boundary = new app.boundary.ErrorBoundary({ children: 'draft' });
    boundary.state = app.boundary.ErrorBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error);
    assert.equal(app.reloads(), 0, `Unexpected automatic reload for ${message}`);
    const view = boundary.render();
    assert.ok(view.props.children, 'Show an explicit recovery screen');
  }
});
