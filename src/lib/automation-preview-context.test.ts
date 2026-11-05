import assert from 'node:assert/strict';
import test from 'node:test';
import { automationPreviewVariables } from './automation-preview-context.ts';

test('selected contact A cannot inherit company, sale or proposal from run B', () => {
  const runB = { nome: 'Bruno', company: 'Empresa B', empresa: 'Empresa B', sale_id: 'venda-b', proposal_id: 'proposta-b', valor_venda: 100 };
  const variables = automationPreviewVariables(runB, { name: 'Ana Silva', email: 'ana@example.com', phone: null });
  assert.equal(variables.nome, 'Ana Silva');
  for (const field of ['sale_id', 'proposal_id', 'valor_venda']) assert.equal(variables[field], undefined);
  assert.ok(!Object.values(variables).includes('Empresa B'));
});

test('selected contact keeps only its own name, company and source aliases', () => {
  const variables = automationPreviewVariables({ company: 'Empresa B' }, { name: '  Ana Silva  ', email: 'ana@example.com', phone: '123', company: 'Empresa A', companyNif: '111', source: 'website' });
  assert.equal(variables.primeiro_nome, 'Ana');
  assert.equal(variables.name, '  Ana Silva  ');
  assert.equal(variables.company, 'Empresa A');
  assert.equal(variables.company_name, 'Empresa A');
  assert.equal(variables.empresa, 'Empresa A');
  assert.equal(variables.nif, '111');
  assert.equal(variables.fonte, 'website');
});

test('run mode retains the chosen run context when no contact is selected', () => {
  const context = { nome: 'Bruno', empresa: 'Empresa B', sale_id: 'venda-b' };
  assert.deepEqual(automationPreviewVariables(context, null), context);
});

test('contact preview exposes only allowed fields even when the source gains internal fields', () => {
  const contact = { name: 'Ana', email: null, phone: null, company: 'Empresa A', credential: 'private', sale_id: 'unrelated' };
  const variables = automationPreviewVariables({ token: 'run-secret' }, contact);
  assert.equal(variables.credential, undefined);
  assert.equal(variables.sale_id, undefined);
  assert.equal(variables.token, undefined);
});
