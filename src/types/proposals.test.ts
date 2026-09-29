import { describe, expect, test } from 'bun:test';
import { getSaleLineCommission } from './proposals';
import type { CatalogProduct } from './proposals';

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
});
