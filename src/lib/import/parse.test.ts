import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMapColumns, cleanImportNif, formatImportDay, matchImportOption, parseImportDate, parseImportNumber } from './parse.ts';

test('numbers written the Portuguese and the English way', () => {
  assert.equal(parseImportNumber('1.234,56 €'), 1234.56);
  assert.equal(parseImportNumber('1,234.56'), 1234.56);
  assert.equal(parseImportNumber('99,9'), 99.9);
  assert.equal(parseImportNumber('1.234'), 1234);
  assert.equal(parseImportNumber('12.5'), 12.5);
  assert.equal(parseImportNumber(''), null);
  assert.equal(parseImportNumber('abc'), null);
});

test('dates day first, ISO, and Excel day numbers', () => {
  assert.equal(parseImportDate('31/12/2025'), '2025-12-31');
  assert.equal(parseImportDate('1-2-25'), '2025-02-01');
  assert.equal(parseImportDate('2025-12-31T10:00'), '2025-12-31');
  assert.equal(parseImportDate('45657'), '2024-12-31');
  assert.equal(parseImportDate('31/02/2025'), null);
  assert.equal(parseImportDate(''), null);
});

test('headers are matched once, ignoring case and accents', () => {
  const mapping = autoMapColumns(
    [{ key: 'name', aliases: ['Nome', 'Cliente'] }, { key: 'nif', aliases: ['NIF', 'NIPC'] }, { key: 'client', aliases: ['Cliente'] }],
    ['CLIENTE', 'N.I.P.C.'],
  );
  assert.deepEqual(mapping, { name: 'CLIENTE', nif: 'N.I.P.C.' });
});

test('NIF digits and labelled options', () => {
  assert.equal(cleanImportNif('PT 501 234 567'), '501234567');
  assert.equal(matchImportOption('em negociação', { negotiating: 'Em Negociação', sent: 'Enviada' }), 'negotiating');
  assert.equal(matchImportOption('sent', { negotiating: 'Em Negociação', sent: 'Enviada' }), 'sent');
  assert.equal(matchImportOption('outro', { sent: 'Enviada' }), null);
});

test('days shown back the Portuguese way', () => {
  assert.equal(formatImportDay('2025-03-15'), '15/03/2025');
  assert.equal(formatImportDay(null), null);
});
