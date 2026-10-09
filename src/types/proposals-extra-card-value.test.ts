import assert from 'node:assert/strict';
import test from 'node:test';

import { getSaleLineCommission, type CatalogProduct } from './proposals.ts';

const VITOR = 'bba643c7-67cb-49c0-a42a-e4c28b5b4758';
const SARA = '7ef11373-6b89-42ce-9fd7-a1707c031442';
const VENDEDOR = '9aeaf184-b91b-4cd7-a364-a0c0ab68d1cc';

// BDS «4 Nível 1»: the operator pays 200 € a sale and 5 € per extra card; the
// seller gets 10 € per extra card — Sara 5 €, so hers cost the org nothing.
const product = {
  name: '4 Nível 1 - < €55',
  price: 0,
  operator_pays: 200,
  included_cards: 1,
  extra_card_commission: 10,
  extra_card_operator_pays: 5,
  splits: [
    { kind: 'user', type: 'fixed', value: 170, user_id: VITOR, extra_cards: true },
    { kind: 'profile', type: 'fixed', value: 160, profile_id: VENDEDOR, extra_cards: true },
    { kind: 'user', type: 'fixed', value: 200, user_id: SARA, extra_cards: true, extra_card_value: 5 },
  ],
} as unknown as CatalogProduct;

// Three cards on the line: one included, two extra.
const cards = { total: 3 } as never;

test('Vítor: 10 € a card to him, the operator adds 5 €, the org gives up 5 €', () => {
  assert.deepEqual(getSaleLineCommission(product, 1, cards, VITOR, null), { gross: 210, seller: 190, org: 20 });
});

test('comerciais (perfil Vendedor): 10 € a card, the org gives up 5 €', () => {
  assert.deepEqual(getSaleLineCommission(product, 1, cards, 'outro-comercial', VENDEDOR), { gross: 210, seller: 180, org: 30 });
});

test('Sara: 5 € a card, exactly what the operator adds — the org stays at 0', () => {
  assert.deepEqual(getSaleLineCommission(product, 1, cards, SARA, null), { gross: 210, seller: 210, org: 0 });
});

test('no extra cards: nothing changes', () => {
  assert.deepEqual(getSaleLineCommission(product, 1, { total: 1 } as never, SARA, null), { gross: 200, seller: 200, org: 0 });
});
