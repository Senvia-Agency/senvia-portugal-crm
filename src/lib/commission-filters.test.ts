import { describe, expect, test } from 'bun:test';
import { buildSaleTypeIds } from './commission-filters';
import type { CatalogProduct } from '@/types/proposals';

describe('buildSaleTypeIds', () => {
  test('uses the technology selected on a Fibra/Satélite sale', () => {
    const catalog: CatalogProduct[] = [{
      name: 'Fibra/Satélite',
      price: 200,
      has_commission: true,
      commission_pct: 30,
      // The catalog entry is intentionally broad. The sale-line technology
      // must take precedence over those generic tags when filtering.
      type_ids: ['fibra', 'satelite', 'cartoes'],
    }];
    const typeIdsForSale = buildSaleTypeIds(catalog);

    expect(typeIdsForSale({
      servicos_details: {
        'Fibra/Satélite': { tecnologia: 'fibra' },
      },
    })).toEqual(['fibra']);
    expect(typeIdsForSale({
      servicos_details: {
        'Fibra/Satélite': { tecnologia: 'satelite' },
      },
    })).toEqual(['satelite']);
  });
});
