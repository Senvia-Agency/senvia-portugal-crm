import { describe, expect, test } from 'bun:test';
import { getSaleLineCommission } from './proposals';
import type { CatalogProduct, CommissionSplit } from './proposals';

describe('getSaleLineCommission', () => {
  test('keeps no organization commission on a satellite sale', () => {
    const product: CatalogProduct = {
      name: 'Internet Satélite',
      price: 100,
      has_commission: true,
      commission_pct: 0,
      operator_pays_fibra: 100,
      operator_pays_satelite: 100,
      splits: [{
        kind: 'user',
        user_id: 'seller-1',
        type: 'pct',
        value: 100,
        type_fibra: 'pct',
        value_fibra: 100,
        type_satelite: 'pct',
        value_satelite: 30,
      }],
    };

    const commission = getSaleLineCommission(product, 1, undefined, 'seller-1', undefined, 'satelite');

    expect(commission).toEqual({ gross: 30, seller: 30, org: 0 });
  });

  // BDS, 4P: the operator pays 200, the seller's rate is 150, each card over
  // the included one pays the seller 10 — out of the org's margin.
  const fourP = (sellerSplit: Partial<CommissionSplit> = {}): CatalogProduct => ({
    name: '4P',
    price: 55,
    has_commission: true,
    commission_pct: 0,
    operator_pays: 200,
    included_cards: 1,
    extra_card_commission: 10,
    splits: [{ kind: 'user', user_id: 'seller-1', type: 'fixed', value: 150, ...sellerSplit }],
  });

  test('pays an extra card to the seller out of the organization margin', () => {
    const commission = getSaleLineCommission(fourP(), 1, { total: 2 }, 'seller-1', undefined, 'fibra');
    expect(commission).toEqual({ gross: 200, seller: 160, org: 40 });
  });

  test('without extra cards the organization keeps the whole margin', () => {
    const commission = getSaleLineCommission(fourP(), 1, { total: 1 }, 'seller-1', undefined, 'fibra');
    expect(commission).toEqual({ gross: 200, seller: 150, org: 50 });
  });

  test('a seller marked extra_cards: false gets no extra-card money', () => {
    const product = fourP({ value: 200, extra_cards: false });
    const commission = getSaleLineCommission(product, 1, { total: 3 }, 'seller-1', undefined, 'fibra');
    expect(commission).toEqual({ gross: 200, seller: 200, org: 0 });
  });
});
