const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

const source = fs.readFileSync(__dirname + '/MetaInbox.tsx', 'utf8');
const ast = ts.createSourceFile('MetaInbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
function evaluate(code, context) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: () => jsx, ...context });
  return exports;
}
function nodes(tree) {
  const result = [];
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    result.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  return result;
}
const conversation = id => ({ id, channel_id: 'whatsapp', contact_name: id, contact_ref: '351912345678', unread_count: 0 });
function inbox(width) {
  const state = [];
  let index = 0;
  const context = {
    useState: initial => {
      const slot = index++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
    useEffect: () => {}, useMemo: callback => callback(),
    useMetaConversations: () => ({ data: [conversation('a'), conversation('b')] }),
    useFillContactAvatars: () => {}, useMarkMetaRead: () => ({ mutate: () => {} }),
    localStorage: { getItem: () => '0', setItem: () => {} }, window: { innerWidth: width },
    cn: (...args) => args.filter(Boolean).join(' '),
    Button: 'button', Input: 'input', ContactAvatar: 'avatar', MetaThread: 'thread',
    MetaContactPanel: 'panel', Sheet: 'sheet', SheetContent: 'sheet-content', SheetTitle: 'sheet-title',
  };
  const { MetaInbox } = evaluate(declaration('MetaInbox').getText(ast), context);
  const render = () => { index = 0; return nodes(MetaInbox({ channelId: 'whatsapp', channelLabel: 'WhatsApp', channelType: 'whatsapp' })); };
  return { render };
}

for (const width of [375, 1280]) {
  test(`message action opens the task form on the correct surface at ${width}px`, () => {
    // Given: a selected conversation with the contact panel closed.
    const app = inbox(width);
    app.render().find(node => node.type === 'button' && node.props.onClick).props.onClick();
    const selected = app.render();
    // When: the user converts message text to a draft task.
    assert.equal(typeof selected.find(node => node.type === 'thread').props.onCreateTask, 'function');
    selected.find(node => node.type === 'thread').props.onCreateTask('Enviar proposta');
    const opened = app.render();
    // Then: exactly the visible surface receives the draft for this UUID.
    const panels = opened.filter(node => node.type === 'panel');
    assert.equal(panels.filter(node => node.props.taskPrefill === 'Enviar proposta').length, 1);
    assert.equal(panels.find(node => node.props.taskPrefill)?.key, 'a');
    assert.equal(opened.find(node => node.type === 'sheet').props.open, width < 1024);
    panels.find(node => node.props.taskPrefill).props.onPrefillConsumed();
    assert.ok(app.render().filter(node => node.type === 'panel').every(node => !node.props.taskPrefill));
  });
}

test('changing conversation cannot reuse another contact task draft', () => {
  // Given: a draft task in conversation A.
  const app = inbox(1280);
  app.render().find(node => node.type === 'button' && node.props.onClick).props.onClick();
  app.render().find(node => node.type === 'thread').props.onCreateTask('A only');
  // When: conversation B is selected.
  app.render().filter(node => node.type === 'button' && node.props.onClick)[1].props.onClick();
  // Then: B gets fresh panels without A's prefill.
  const panels = app.render().filter(node => node.type === 'panel');
  assert.ok(panels.every(node => node.key === 'b' && !node.props.taskPrefill));
});

test('contact panel forwards the draft and native conversation identity to the task form', () => {
  // Given: a message draft for the selected native conversation.
  const consume = () => {};
  const context = {
    useNavigate: () => () => {}, useCrmContactByPhone: () => ({ data: null }),
    useClientSales: () => ({}), useClientProposals: () => ({}),
    usePipelineStages: () => ({}), useTeamMembers: () => ({}), useState: () => [false, () => {}],
    OPEN_SALE_STATUSES: [], OPEN_PROPOSAL_STATUSES: [], cn: (...args) => args.filter(Boolean).join(' '),
    ContactAvatar: 'avatar', Button: 'button', X: 'icon', Phone: 'icon', Copy: 'icon', ExternalLink: 'icon',
    UserPlus: 'icon', ConversationTasks: 'tasks', ContactNotes: 'notes', AddLeadModal: 'lead-modal',
  };
  const { MetaContactPanel } = evaluate(`export ${declaration('MetaContactPanel').getText(ast)}`, context);
  // When: the matching panel renders.
  const tasks = nodes(MetaContactPanel({
    conversation: conversation('a'), channelType: 'whatsapp', taskPrefill: 'Confirmar orçamento',
    onPrefillConsumed: consume, onClose: () => {},
  })).find(node => node.type === 'tasks');
  // Then: the existing task form receives the draft without creating a task.
  assert.equal(tasks.props.prefill, 'Confirmar orçamento');
  assert.equal(tasks.props.onPrefillConsumed, consume);
  assert.equal(tasks.props.nativeConversationId, 'a');
  assert.equal(tasks.props.channelId, 'whatsapp');
});

test('task action supports text in both directions without a provider message ID', () => {
  // Given: the real message mapper and accessible task button.
  let mapper;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'messages.map') mapper = node.arguments[0];
    ts.forEachChild(node, find);
  }
  find(declaration('MetaThread'));
  assert.ok(mapper);
  const calls = [];
  const context = {
    cn: (...args) => args.filter(Boolean).join(' '), MessageText: 'message',
    TaskFromMessageButton: 'task-action', formatRelativeTime: () => 'now', onCreateTask: text => calls.push(text),
  };
  const { renderMessage } = evaluate(`export const renderMessage = ${mapper.getText(ast)};`, context);
  // When: messages are rendered with text, deleted content, or no text.
  for (const direction of ['incoming', 'outgoing']) {
    const base = { id: direction, direction, external_id: null, content: 'Call customer', attachments: [] };
    const action = nodes(renderMessage(base)).find(node => node.type === 'task-action');
    assert.ok(action);
    action.props.onClick();
    assert.equal(nodes(renderMessage({ ...base, is_deleted: true })).some(node => node.type === 'task-action'), false);
    assert.equal(nodes(renderMessage({ ...base, content: '  ' })).some(node => node.type === 'task-action'), false);
    assert.equal(nodes(renderMessage({ ...base, content: null })).some(node => node.type === 'task-action'), false);
  }
  // Then: only actionable text is handed to the existing task form.
  assert.deepEqual(calls, ['Call customer', 'Call customer']);
  const { TaskFromMessageButton } = evaluate(`export ${declaration('TaskFromMessageButton')?.getText(ast) ?? 'function TaskFromMessageButton() { return null; }'}`, { Button: 'button', ClipboardList: 'icon' });
  const button = TaskFromMessageButton({ onClick: () => {} });
  assert.equal(button.type, 'button');
  assert.ok(button.props['aria-label']);
  assert.equal(button.props.type, 'button');
  assert.doesNotMatch(button.props.className, /opacity-0/);
});


test('received-message task action follows its bubble and remains visible', () => {
  let mapper;
  const find = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'messages.map') mapper = node.arguments[0]; ts.forEachChild(node, find); };
  find(declaration('MetaThread'));
  const context = { cn: (...args) => args.filter(Boolean).join(' '), MessageText: 'message', TaskFromMessageButton: 'task-action', formatRelativeTime: () => 'now', onCreateTask: () => {} };
  const { renderMessage } = evaluate(`export const renderMessage = ${mapper.getText(ast)};`, context);
  for (const direction of ['incoming', 'outgoing']) {
    const row = renderMessage({ id: direction, direction, external_id: null, content: 'Enviar proposta ao cliente', attachments: [] });
    const children = row.props.children.flat().filter(Boolean);
    const action = children.findIndex(node => node.type === 'task-action');
    const bubble = children.findIndex(node => node.type === 'div');
    assert.ok(action >= 0 && bubble >= 0);
    assert.equal(action > bubble, direction === 'incoming');
  }
});
