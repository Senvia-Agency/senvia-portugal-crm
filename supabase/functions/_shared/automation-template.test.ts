import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAutomationTemplate } from './automation-template.ts';

test('plain variables preserve legacy values and list absent fields once',()=>{
  const result=renderAutomationTemplate('{{nome}} {{zero}} {{false}} {{ausente}} {{ausente}}',{nome:'Ana',zero:0,false:false});
  assert.equal(result.text,'Ana 0 false  ');
  assert.deepEqual(result.missing,['ausente']);
});
test('quoted defaults replace absent null empty and whitespace values without overriding zero',()=>{
  for(const value of [undefined,null,'','  ']) assert.equal(renderAutomationTemplate('{{nome | "olá"}}',{nome:value}).text,'olá');
  assert.equal(renderAutomationTemplate('{{valor | "nada"}}',{valor:0}).text,'0');
  assert.equal(renderAutomationTemplate('{{nome | "A|B"}}',{}).text,'A|B');
});
test('euro formatting supports numeric records and Portuguese formatted values',()=>{
  const normalize=(text:string)=>text.split(String.fromCharCode(160)).join(' ');
  assert.equal(normalize(renderAutomationTemplate('{{valor | moeda}}',{valor:1234.5}).text),'1234,50 €');
  assert.equal(normalize(renderAutomationTemplate('{{valor | moeda}}',{valor:'1.234,50 €'}).text),'1234,50 €');
  assert.equal(normalize(renderAutomationTemplate('{{valor | "0" | moeda}}',{}).text),'0,00 €');
});
test('date format uses the Portuguese calendar and rejects impossible dates',()=>{
  assert.equal(renderAutomationTemplate('{{quando | data}}',{quando:'2026-11-04'}).text,'4 de novembro de 2026');
  assert.equal(renderAutomationTemplate('{{quando | data}}',{quando:'2026-02-31'}).text,'');
  assert.equal(renderAutomationTemplate('{{quando | data}}',{quando:'2026-11-04T12:00:00'}).text,'');
});
test('dot lookup only reads own fields and preserves exact flat keys first',()=>{
  assert.equal(renderAutomationTemplate('{{otto.intencao}}',{otto:{intencao:'comprar'}}).text,'comprar');
  assert.equal(renderAutomationTemplate('{{otto.intencao}}',{'otto.intencao':'flat',otto:{intencao:'nested'}}).text,'flat');
  assert.equal(renderAutomationTemplate('{{constructor.name}}',{}).text,'');
});
test('unsupported expressions are reported and never executed',()=>{
  const result=renderAutomationTemplate('{{nome | eval}} {{globalThis.process}} {{nome()}}',{});
  assert.equal(result.text,'  ');
  assert.deepEqual(result.invalid,['nome | eval','nome()']);
});
test('HTML interpolation escapes values and fallback while preserving template markup',()=>{
  assert.equal(renderAutomationTemplate('<p>{{nome | "<amigo>"}}</p>',{},true).text,'<p>&lt;amigo&gt;</p>');
  assert.equal(renderAutomationTemplate('<p>{{nome}}</p>',{nome:'<script>'},true).text,'<p>&lt;script&gt;</p>');
});
