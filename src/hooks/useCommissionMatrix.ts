import { useCallback } from 'react';
import { useOrganization } from './useOrganization';
import type { ServicosProductDetail } from '@/types/proposals';
import type { ModeloServico } from '@/types/proposals';
import { SERVICOS_PRODUCT_CONFIGS } from '@/types/proposals';
import { tr } from '@/i18n';

// --- Unified commission types ---

export interface SolarTier {
  kwpMin: number;
  kwpMax: number;
  baseTransaccional: number;
  adicTransaccional: number;
  baseAas: number;
  adicAas: number;
}

export interface CommissionRule {
  method: 'tiered_kwp' | 'base_plus_per_kwp' | 'formula_percentage' | 'percentage_valor';
  // Only used for tiered_kwp
  tiers: SolarTier[];
  // Used in base_plus_per_kwp
  baseTrans?: number;
  ratePerKwpTrans?: number;
  baseAas?: number;
  ratePerKwpAas?: number;
  // Used in formula_percentage
  factor?: number;
  divisor?: number;
  pctTrans?: number;
  pctAas?: number;
  // percentage_valor reuses pctTrans / pctAas
}

export type CommissionMatrix = Record<string, CommissionRule>;

// --- Energy (EE & Gás) commission types ---

export interface EnergyMarginBand {
  marginMin: number;
  ponderadorLow: number;   // 300 MWh
  valorLow: number;
  ponderador: number;      // 301-600 MWh (reference)
  valor: number;
  ponderadorHigh: number;  // 601+ MWh
  valorHigh: number;
}

export type EnergyVolumeTier = 'low' | 'mid' | 'high';

export interface TierDerivationRule {
  source: 'from_low' | 'from_mid' | 'from_high';
  operation: 'multiply' | 'divide' | 'none';
  value: number;
}

export interface TierRules {
  low: TierDerivationRule;
  mid: TierDerivationRule;
  high: TierDerivationRule;
}

export const DEFAULT_TIER_RULES: TierRules = {
  low:  { source: 'from_mid', operation: 'divide',   value: 1.33 },
  mid:  { source: 'from_mid', operation: 'multiply', value: 1 },
  high: { source: 'from_mid', operation: 'multiply', value: 1.5 },
};

export interface EnergyCommissionConfig {
  bands: EnergyMarginBand[];
  tierRules?: TierRules;
}

export const DEFAULT_ENERGY_CONFIG: EnergyCommissionConfig = {
  bands: [],
};

function findTier(tiers: SolarTier[], kwp: number): SolarTier | null {
  return tiers.find(t => kwp >= t.kwpMin && kwp <= t.kwpMax) ?? null;
}

// --- Volume tier helper ---

export function getVolumeTier(consumoAnualKwh: number): EnergyVolumeTier {
  const mwh = consumoAnualKwh / 1000;
  if (mwh <= 300) return 'low';
  if (mwh <= 600) return 'mid';
  return 'high';
}

// --- Energy commission calculation ---

function findEnergyBand(bands: EnergyMarginBand[], margem: number): EnergyMarginBand | null {
  const sorted = [...bands].sort((a, b) => b.marginMin - a.marginMin);
  return sorted.find(b => margem >= b.marginMin) ?? null;
}

// --- Derivation helpers ---

function getSourceValues(band: EnergyMarginBand, source: 'from_low' | 'from_mid' | 'from_high'): { ponderador: number; valor: number } {
  switch (source) {
    case 'from_low':  return { ponderador: band.ponderadorLow, valor: band.valorLow };
    case 'from_high': return { ponderador: band.ponderadorHigh, valor: band.valorHigh };
    default:          return { ponderador: band.ponderador, valor: band.valor };
  }
}

function applyDerivation(baseValue: number, rule: TierDerivationRule): number {
  switch (rule.operation) {
    case 'multiply': return baseValue * (rule.value || 1);
    case 'divide':   return rule.value ? baseValue / rule.value : baseValue;
    case 'none':     return baseValue;
    default:         return baseValue;
  }
}

function getDerivedValues(
  band: EnergyMarginBand,
  tier: EnergyVolumeTier,
  tierRules?: TierRules
): { ponderador: number; valor: number } {
  // Mid is always the reference — read directly
  if (tier === 'mid') {
    return { ponderador: band.ponderador, valor: band.valor };
  }

  const rules = tierRules ?? DEFAULT_TIER_RULES;
  const rule = rules[tier];

  // Get source column values
  const source = getSourceValues(band, rule.source);

  // Apply derivation operation
  return {
    ponderador: applyDerivation(source.ponderador, rule),
    valor: applyDerivation(source.valor, rule),
  };
}

export function calculateEnergyCommissionPure(
  margem: number,
  config: EnergyCommissionConfig,
  tier: EnergyVolumeTier = 'mid'
): number | null {
  if (!config.bands.length) return null;
  
  const band = findEnergyBand(config.bands, margem);
  if (!band) return null;
  
  const { ponderador, valor } = getDerivedValues(band, tier, config.tierRules);
  
  return valor + (margem - band.marginMin) * (ponderador / 100);
}

// --- Normalizer: fill missing tierRules without overwriting existing ones ---

function normalizeEnergyConfig(raw: EnergyCommissionConfig | null): EnergyCommissionConfig | null {
  if (!raw) return null;
  const tierRules: TierRules = {
    low:  raw.tierRules?.low  ?? DEFAULT_TIER_RULES.low,
    mid:  raw.tierRules?.mid  ?? DEFAULT_TIER_RULES.mid,
    high: raw.tierRules?.high ?? DEFAULT_TIER_RULES.high,
  };
  return { ...raw, tierRules };
}

// --- Tier label helpers (for transparency) ---

const TIER_LABELS: Record<EnergyVolumeTier, string> = {
  low: 'Baixo (≤300 MWh)',
  mid: 'Médio (301–600 MWh)',
  high: 'Alto (+601 MWh)',
};

const OPERATION_LABELS: Record<string, string> = {
  multiply: '×',
  divide: '÷',
  none: '=',
};

export function getTierRuleLabel(tier: EnergyVolumeTier, config: EnergyCommissionConfig | null): string {
  if (!config?.tierRules) return tr(TIER_LABELS[tier]);
  const rule = config.tierRules[tier];
  if (!rule) return tr(TIER_LABELS[tier]);
  const op = OPERATION_LABELS[rule.operation] || '?';
  if (rule.operation === 'none') return `${tr(TIER_LABELS[tier])} | ${tr('Regra: {{source}} (direto)', { source: rule.source })}`;
  return `${tr(TIER_LABELS[tier])} | ${tr('Regra: {{source}} {{op}} {{value}}', { source: rule.source, op, value: rule.value })}`;
}

// --- Main hook ---

export function useCommissionMatrix() {
  const { data: org } = useOrganization();

  const matrix: CommissionMatrix | null = (org as any)?.commission_matrix ?? null;
  const rawEnergyConfig: EnergyCommissionConfig | null = (org as any)?.commission_matrix?.ee_gas ?? null;
  const energyConfig = normalizeEnergyConfig(rawEnergyConfig);

  const calculateCommission = useCallback(
    (productName: string, detail: ServicosProductDetail, modeloServico?: ModeloServico): number | null => {
      if (!matrix) return null;
      const rule = matrix[productName];
      if (!rule) return null;

      const isAas = modeloServico === 'saas';

      switch (rule.method) {
        case 'tiered_kwp': {
          const kwp = detail.kwp;
          if (kwp == null || !rule.tiers?.length) return null;
          let tier = findTier(rule.tiers, kwp);
          let effectiveKwp = kwp;
          if (!tier) {
            const lastTier = rule.tiers[rule.tiers.length - 1];
            if (kwp > lastTier.kwpMax) {
              tier = lastTier;
              effectiveKwp = lastTier.kwpMax;
            }
          }
          if (!tier) return null;
          const base = isAas ? tier.baseAas : tier.baseTransaccional;
          const adic = isAas ? tier.adicAas : tier.adicTransaccional;
          return base + (effectiveKwp - tier.kwpMin) * adic;
        }
        case 'base_plus_per_kwp': {
          const kwp = detail.kwp;
          if (kwp == null) return null;
          const base = isAas ? (rule.baseAas ?? 0) : (rule.baseTrans ?? 0);
          const rate = isAas ? (rule.ratePerKwpAas ?? 0) : (rule.ratePerKwpTrans ?? 0);
          return base + rate * kwp;
        }
        case 'formula_percentage': {
          if (detail.valor == null) return null;
          const factor = rule.factor ?? 1;
          const divisor = rule.divisor ?? 1;
          if (divisor === 0) return null;
          const derivedKwp = (detail.valor * factor) / divisor;
          const pct = isAas ? (rule.pctAas ?? 0) : (rule.pctTrans ?? 0);
          return (derivedKwp * pct) / 100;
        }
        case 'percentage_valor': {
          if (detail.valor == null) return null;
          const pct = isAas ? (rule.pctAas ?? 0) : (rule.pctTrans ?? 0);
          return (detail.valor * pct) / 100;
        }
        default:
          return null;
      }
    },
    [matrix]
  );

  const isAutoCalculated = useCallback(
    (productName: string): boolean => {
      if (!matrix) return false;
      const rule = matrix[productName];
      if (!rule) return false;
      if (rule.method === 'tiered_kwp') return !!rule.tiers?.length;
      return true;
    },
    [matrix]
  );

  const calculateEnergyCommission = useCallback(
    (margem: number, tier: EnergyVolumeTier = 'mid'): number | null => {
      if (!energyConfig) return null;
      return calculateEnergyCommissionPure(margem, energyConfig, tier);
    },
    [energyConfig]
  );

  const hasEnergyConfig = !!energyConfig && energyConfig.bands.length > 0;

  return { matrix, calculateCommission, isAutoCalculated, energyConfig, calculateEnergyCommission, hasEnergyConfig };
}
