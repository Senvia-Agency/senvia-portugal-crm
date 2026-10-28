const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sourcePath = process.env.OPTOUT_ENGINE_SOURCE || 'supabase/functions/automation-engine/index.ts';
const helperPath = process.env.OPTOUT_HELPER_SOURCE || 'supabase/functions/_shared/automation-contact-optout.ts';
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const engineNode = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'Engine');
const replyNode = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleReply');
function subject(db) {
  const exports = {};
  const helper = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(helper, { exports });
  const context = { exports: {}, automationContactSuppressed: exports.automationContactSuppressed,
    fetch: () => assert.fail('No external message may be sent'), logError: () => {},
    nextNodeIds: (graph,id) => graph.edges.filter(e => e.source === id).map(e => e.target),
    phoneKey: phone => phone.replace(/[^0-9]/g,'').slice(-9),
    handleMessageStart: async () => ({ normal: true }) };
  vm.runInNewContext(ts.transpileModule('exports.Engine = ' + engineNode.getText(ast) + '; exports.reply = ' + replyNode.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const engine = new context.exports.Engine(db);
  engine.executedNodes = async () => new Set();
  engine.recordStep = async () => true;
  return { engine, reply: context.exports.reply };
}
const run = () => ({ id:'run', organization_id:'org', contact_phone:'+351999000001', contact_email:'test@example.invalid', context:{}, steps_taken:0 });
const flow = { max_steps_per_run:10, graph:{ nodes:[{id:'first',type:'trigger'},{id:'send',type:'send_whatsapp'}], edges:[{source:'first',target:'send'}] } };
function database(answer) {
  const writes = [];
  return { writes, rpc: async () => ({data:answer(),error:null}), from: () => ({ update: value => ({ eq: async () => { writes.push(value); } }) }) };
}
test('suppressed queued run cancels before executing any message node', async () => {
  const db = database(() => true); const {engine} = subject(db);
  engine.execute = async () => assert.fail('Suppressed node executed');
  await engine.advance(run(),flow,'first');
  assert.equal(db.writes.at(-1).status,'cancelled');
});
test('opt-out is rechecked between nodes, including already running flows', async () => {
  let calls=0; const db = database(() => ++calls > 1); const {engine} = subject(db);
  engine.execute = async (_run,_flow,node) => { assert.equal(node.id,'first'); return {kind:'next'}; };
  await engine.advance(run(),flow,'first');
  assert.equal(calls,2); assert.equal(db.writes.at(-1).status,'cancelled');
});
test('failure to read consent prevents a send', async () => {
  const db = database(() => false); db.rpc = async () => ({data:null,error:{message:'unavailable'}});
  const {engine}=subject(db); engine.execute=async()=>assert.fail('Consent failure sent');
  await assert.rejects(engine.advance(run(),flow,'first'), /preferência/);
});
test('ordinary contacts continue through the original path', async () => {
  const db = database(() => false); const {engine}=subject(db); let nodes=0;
  engine.execute=async()=>{nodes++;return {kind:'next'};};
  await engine.advance(run(),flow,'first');
  assert.equal(nodes,2); assert.equal(db.writes.at(-1).status,'completed');
});
test('reply from opted-out contact cannot start or resume a flow', async () => {
  const db=database(()=>true); const {reply}=subject(db);
  assert.equal((await reply(db,{organization_id:'org',phone:'351999000001',text:'Quero cancelar'})).suppressed,true);
});
