const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

const source = fs.readFileSync(__dirname + '/AppSidebar.tsx', 'utf8');
const ast = ts.createSourceFile('AppSidebar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppSidebar');
function setup() {
  const store = { collapsed: false, toggle() { store.collapsed = !store.collapsed; } };
  const context = {
    exports: {}, require: () => jsx,
    useState: value => [value, () => {}], useLocation: () => ({ pathname: '/dashboard' }), useNavigate: () => () => {},
    useAuth: () => ({ roles: [], organizations: [] }), useOttoStore: () => ({}),
    useSidebarStore: selector => selector(store), useModules: () => ({ modules: {} }),
    usePermissions: () => ({}), useSubscription: () => ({}), useActivationProgress: () => ({}),
    hasPerfect2GetherAccess: () => false, workspaceNavigation: [],
    cn: (...values) => values.filter(Boolean).join(' '), getRoleLabel: () => 'Colaborador', APP_VERSION: 'test', CollapsedTooltip: 'tooltip',
  };
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    const imports = statement.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) {
      for (const imported of imports.elements) context[imported.name.text] ??= imported.name.text;
    }
  }
  const code = ts.transpileModule('exports.render = ' + component.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, context);
  const render = props => {
    const controls = [];
    const visit = element => {
      if (Array.isArray(element)) return element.forEach(visit);
      if (!element || typeof element !== 'object') return;
      if (element.type === 'button' && element.props['aria-label']) controls.push(element);
      visit(element.props?.children);
    };
    visit(context.exports.render(props));
    return controls;
  };
  return { store, render };
}

test('a temporarily collapsed sidebar always exposes a working expand control', () => {
  const app = setup();
  let expanded = false;
  const controls = app.render({ forceCollapsed: true, onExpand: () => { expanded = true; } });
  const button = controls.find(node => node.props['aria-label'] === 'Expandir menu');
  assert.ok(button, 'Forced collapse must never hide the expansion control');
  button.props.onClick();
  assert.equal(expanded, true);
  assert.equal(app.store.collapsed, false);
});

test('tablet expansion overrides automatic collapse without changing desktop preference', () => {
  const app = setup();
  app.store.collapsed = true;
  let closed = false;
  const button = app.render({ forceCollapsed: true, expanded: true, onCollapse: () => { closed = true; } })
    .find(node => node.props['aria-label'] === 'Recolher menu');
  assert.ok(button);
  button.props.onClick();
  assert.equal(closed, true);
  assert.equal(app.store.collapsed, true);
});

test('ordinary desktop collapse and expansion still toggle the saved preference', () => {
  const app = setup();
  app.render({}).find(node => node.props['aria-label'] === 'Recolher menu').props.onClick();
  assert.equal(app.store.collapsed, true);
  app.render({}).find(node => node.props['aria-label'] === 'Expandir menu').props.onClick();
  assert.equal(app.store.collapsed, false);
});
