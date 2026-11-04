const {test}=require('node:test');
const assert=require('node:assert/strict');
const esbuild=require('esbuild');
const vm=require('node:vm');
function load(file){const result=esbuild.buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});const box={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module:box,exports:box.exports});return box.exports;}
const mapping=load('src/features/workplace/tasks/task-mapping.ts');
const model=load('src/features/workplace/tasks/model.ts');
const row={id:'00000000-0000-4000-8000-000000000001',title:'Task',description:null,assigned_to:'owner',participant_ids:['colleague'],due_at:null,done_at:null,created_at:null,source_channel_id:null,contact_phone:null,contact_name:null,workplace_status:'todo',priority:'normal',workplace_version:2};
test('participants survive database read and write without replacing the owner',()=>{const task=mapping.parseSharedTasks([row])[0];assert.deepEqual(Array.from(task.participantIds),['colleague']);const patch=mapping.taskEditableFields(task);assert.deepEqual(Array.from(patch.participant_ids),['colleague']);assert.equal(patch.assigned_to,'owner');});
test('my tasks include participation as well as responsibility',()=>{const task=mapping.parseSharedTasks([row])[0];assert.equal(model.filterTasks([task],{scope:'mine',userId:'colleague',query:'',now:0}).length,1);assert.equal(model.filterTasks([task],{scope:'mine',userId:'outsider',query:'',now:0}).length,0);});
