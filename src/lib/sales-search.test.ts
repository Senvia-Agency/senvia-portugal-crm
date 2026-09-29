import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesSaleSearch } from './sales-search.ts';

const sale = {
  code: 'V-2026-0042',
  notes: 'Instalação fibra',
  lead: { name: 'João Silva', email: 'joao@example.test' },
  client: {
    name: 'João Silva',
    company: 'Empresa Telecom',
    code: 'CLI-42',
    nif: '245678901',
    company_nif: '509876543',
  },
};

test('telecom sales search matches partial personal and company NIF', () => {
  assert.equal(matchesSaleSearch(sale, '567890', true), true);
  assert.equal(matchesSaleSearch(sale, '509876', true), true);
});

test('other niches keep NIF outside the sales search', () => {
  assert.equal(matchesSaleSearch(sale, '245678901', false), false);
  assert.equal(matchesSaleSearch(sale, 'João', false), true);
});
