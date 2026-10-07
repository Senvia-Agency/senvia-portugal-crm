import { describe, expect, test } from 'bun:test';
import { isBdsOrganization, parseChargebackAmount } from './bds-finance';

describe('BDS finance rules', () => {
  test('limits BDS-only finance controls to the BDS organization', () => {
    expect(isBdsOrganization('BDS Telecomunicações')).toBe(true);
    expect(isBdsOrganization('Senvia Agency')).toBe(false);
    expect(isBdsOrganization(null)).toBe(false);
  });

  test('accepts positive euro values and rejects invalid manual chargebacks', () => {
    expect(parseChargebackAmount('25,50')).toBe(25.5);
    expect(parseChargebackAmount('0')).toBeNull();
    expect(parseChargebackAmount('-1')).toBeNull();
    expect(parseChargebackAmount('abc')).toBeNull();
  });
});
