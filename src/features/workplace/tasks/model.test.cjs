const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const result = esbuild.buildSync({entryPoints:['src/features/workplace/tasks/model.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const box={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:box,exports:box.exports});
const api=box.exports;
const base={id:'original',title:'Preparar proposta',description:'Contexto',status:'todo',priority:'normal',assignedTo:'u1',dueAt:'2026-10-22T10:00:00.000Z',createdAt:'2026-10-20T10:00:00.000Z',source:'local',contactName:null,phone:null};
test('local edits override the original Inbox task by id without duplicates or source mutation',()=>{
 const original={id:'original',title:'Original',description:null,done_at:null,assigned_to:'u1',created_by:'u1',due_at:null,created_at:base.createdAt,contact_name:'Contacto',contact_phone:'351900000000'};
 const local={...base,status:'doing',source:'inbox'};
 const merged=api.mergeTasks([original],[local]);
 assert.equal(merged.length,1);assert.equal(merged[0].status,'doing');assert.equal(original.title,'Original');assert.equal(original.done_at,null);
});
test('personal, overdue and completed scopes respect assignment and status',()=>{
 const tasks=[base,{...base,id:'other',assignedTo:'u2'},{...base,id:'done',status:'done'}];
 const opts={userId:'u1',query:'',now:Date.parse('2026-10-23T10:00:00.000Z')};
 assert.equal(api.filterTasks(tasks,{...opts,scope:'mine'}).length,1);
 assert.equal(api.filterTasks(tasks,{...opts,scope:'overdue'}).length,2);
 assert.equal(api.filterTasks(tasks,{...opts,scope:'done'})[0].id,'done');
 assert.equal(api.filterTasks(tasks,{...opts,scope:'team',query:'inexistente'}).length,0);
});
test('storage keys isolate organizations and users; corrupt dates and blank titles are rejected',()=>{
 assert.notEqual(api.taskStorageKey('org1','user1'),api.taskStorageKey('org2','user1'));
 assert.notEqual(api.taskStorageKey('org1','user1'),api.taskStorageKey('org1','user2'));
 assert.equal(api.taskSchema.safeParse({...base,dueAt:'bad'}).success,false);
 assert.equal(api.taskSchema.safeParse({...base,title:'  '}).success,false);
 assert.equal(api.taskSchema.safeParse(base).success,true);
});
