const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

test('navigation, minimize, pop-out and reversal preserve the same draft owner; organization change clears it', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test' });
  for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver', 'localStorage']) global[key] = key === 'localStorage' ? dom.window.localStorage : dom.window[key];
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-workspace-'));
  const outfile = path.join(tmp, 'test.cjs');
  const fakeReader = `import React,{useState,useEffect}from'react';import{InboxWorkspaceToolbar}from'./src/components/inbox/workspace/InboxWorkspaceToolbar';
    export function InboxContent(){const[draft,setDraft]=useState('original');useEffect(()=>{global.mounts=(global.mounts||0)+1;return()=>{global.unmounts=(global.unmounts||0)+1}},[]);return <><InboxWorkspaceToolbar/><input aria-label="draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={()=>setDraft('unsent draft')}>Write draft</button></>}`;
  await esbuild.build({
    stdin: { contents: `import React from'react';import{MemoryRouter,Routes,Route,Link}from'react-router-dom';import{InboxWorkspaceProvider}from'./src/components/inbox/workspace/InboxWorkspaceProvider';import{InboxPageSlot}from'./src/components/inbox/workspace/InboxWorkspaceSurface';
      export function App({scope}){return <MemoryRouter initialEntries={['/inbox']}><InboxWorkspaceProvider key={scope} scope={scope}><Link to="/clients">Clients</Link><Link to="/inbox">Inbox route</Link><Routes><Route path="/inbox" element={<InboxPageSlot/>}/><Route path="/clients" element={<p>Clients page</p>}/></Routes></InboxWorkspaceProvider></MemoryRouter>}`, loader: 'tsx', resolveDir: process.cwd() },
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    plugins: [{ name: 'reader-fixture', setup(build) {
      build.onResolve({ filter: /^@\/pages\/Inbox$/ }, () => ({ path: 'reader', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fakeReader, loader: 'tsx', resolveDir: process.cwd() }));
      build.onResolve({ filter: /^(react|react-dom|react-router-dom)(\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
    } }],
  });
  const { App } = require(outfile);
  const root = createRoot(document.getElementById('root'));
  const act = React.act;
  const click = async label => {
    const button = [...document.querySelectorAll('button,a')].find(el => el.textContent.trim() === label || el.getAttribute('aria-label') === label);
    assert.ok(button, `Missing ${label}`);
    await act(async () => { button.click(); });
  };
  const value = () => document.querySelector('input[aria-label="draft"]').value;
  try {
    await act(async () => { root.render(React.createElement(App, { scope: 'org-a' })); });
    await click('Write draft');
    assert.ok(document.body.textContent.includes('Inbox mantido aberto'), 'Inbox must pin by default without clicking');
    await click('Clients');
    assert.equal(value(), 'unsent draft');
    assert.equal(global.mounts, 1);
    await click('Minimizar Inbox');
    assert.ok(document.querySelector('[hidden]').contains(document.querySelector('input')));
    await click('Retomar Inbox');
    assert.equal(value(), 'unsent draft');
    const popupDom = new JSDOM('', { url: 'https://crm.test' });
    const popup = popupDom.window;
    popup.close = () => popup.dispatchEvent(new popup.Event('beforeunload'));
    window.open = () => popup;
    await click('Abrir Inbox noutra janela');
    assert.equal(popup.document.querySelector('input').value, 'unsent draft');
    assert.equal(document.querySelector('input'), null);
    await act(async () => { popup.close(); });
    assert.equal(value(), 'unsent draft');
    await click('Desativar painel');
    assert.equal(localStorage.getItem('senvia-inbox-workspace:org-a'), 'off');
    assert.equal(value(), 'unsent draft');
    await click('Clients');
    assert.ok(document.querySelector('[hidden]').contains(document.querySelector('input')));
    await click('Inbox route');
    assert.equal(value(), 'unsent draft');
    await act(async () => { root.render(React.createElement(App, { scope: 'org-b' })); });
    assert.equal(value(), 'original');
    assert.equal(global.unmounts, 1);
    await act(async () => { root.render(React.createElement(App, { scope: 'org-a' })); });
    assert.ok(document.body.textContent.includes('Ativar painel lateral'), 'Explicit off preference must survive remount');
    await click('Clients');
    assert.equal(document.querySelector('[aria-label="Inbox lateral"]').className, 'hidden');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('minimized WhatsApp reader does not send read receipts for arriving messages', () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../MetaInbox.tsx'), 'utf8');
  const ast = ts.createSourceFile('MetaInbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const thread = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MetaThread');
  const receipts = thread.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect')
    .map(node => node.expression.arguments[0]).filter(node => /mark_seen|markRead\.mutate/.test(node.getText(ast)));
  assert.equal(receipts.length, 2);
  for (const active of [false, true]) {
    const calls = [];
    for (const callback of receipts) {
      const exports = {};
      const code = ts.transpileModule('exports.run = ' + callback.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      vm.runInNewContext(code, { exports, active, windowExpired: false, arquivada: false, conversation: { id: 'test', unread_count: 1 }, act: { mutate: value => calls.push(value) }, markRead: { mutate: value => calls.push(value) } });
      exports.run();
    }
    assert.equal(calls.length, active ? 2 : 0);
  }
});
