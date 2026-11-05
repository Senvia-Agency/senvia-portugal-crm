import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAutomationEmailTemplate } from './automation-email-template.ts';

test('stored automation email applies fallback and formats using runtime values', () => {
  assert.equal(renderAutomationEmailTemplate('Olá {{primeiro_nome | "cliente"}}: {{valor | moeda}}', { valor: 12 }).replaceAll(String.fromCharCode(160), ' '), 'Olá cliente: 12,00 €');
  assert.equal(renderAutomationEmailTemplate('{{quando | data}}', { quando: '2026-11-04' }), '4 de novembro de 2026');
});
test('unsubscribe marker survives automation rendering for existing signed-link pipeline', () => {
  assert.equal(renderAutomationEmailTemplate('<a href="{{ UNSUBSCRIBE }}">Sair</a> {{nome}} {{ausente}}', { nome: 'Ana', unsubscribe: 'untrusted' }), '<a href="{{unsubscribe}}">Sair</a> Ana ');
});
test('rich-text split variable tags remain compatible with stored templates', () => {
  assert.equal(renderAutomationEmailTemplate('<p>{{<span>primeiro_nome</span> | "amigo"}}</p>', {}), '<p>amigo</p>');
});
test('HTML email escapes hostile values in text and attributes while keeping template markup', () => {
  const attack = '<img src=x onerror="alert(1)">&';
  assert.equal(renderAutomationEmailTemplate('<p title="{{nome}}">{{nome}}</p>', { nome: attack }, true), '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;</p>');
  assert.equal(renderAutomationEmailTemplate('<strong>{{<span>nome</span>}}</strong><a href="{{unsubscribe}}">Sair</a>', { nome: attack }, true), '<strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;</strong><a href="{{unsubscribe}}">Sair</a>');
});
test('subject remains plain text and is not HTML encoded', () => {
  assert.equal(renderAutomationEmailTemplate('{{nome}}', { nome: 'Ana & "Filhos" <equipa>' }, false), 'Ana & "Filhos" <equipa>');
});
