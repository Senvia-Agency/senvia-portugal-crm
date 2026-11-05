import assert from 'node:assert/strict';
import test from 'node:test';
import { unknownTemplateVariables } from './automation-variable-validation.ts';

test('aliases disponíveis não são marcados como desconhecidos', () => {
  const result = unknownTemplateVariables('Olá {{primeiro_nome}}, {{empresa}} {{fonte}} {{nif}}', ['primeiro_nome', 'empresa', 'fonte', 'nif']);
  assert.deepEqual(result, { unknown: [], invalid: [] });
});
test('token desconhecido é reportado sem confundir fallback ou formato', () => {
  const result = unknownTemplateVariables('{{payment_amount | moeda}} {{nome | "Cliente"}} {{nao_existe}}', ['payment_amount', 'nome']);
  assert.deepEqual(result, { unknown: ['nao_existe'], invalid: [] });
});
test('campo aninhado usa o objeto de entrada e sintaxe inválida fica explícita', () => {
  const result = unknownTemplateVariables('{{custom_data.servico}} {{nome + telefone}}', ['custom_data']);
  assert.deepEqual(result, { unknown: [], invalid: ['nome + telefone'] });
});
