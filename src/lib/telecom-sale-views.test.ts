import assert from 'node:assert/strict';
import test from 'node:test';

import { isTelecomUndatedInstall, matchesTelecomViewInPeriod, type TelecomViewKey } from './telecom-sale-views.ts';

// BDS sales around October 2026, as they are in the database.
const sales = [
  { code: '0034', telecom_status: 'instalado', sale_date: '2026-09-28', scheduled_install_date: '2026-10-02T09:00:00Z', activation_date: '2026-10-02' },
  { code: '0030', telecom_status: 'instalado', sale_date: '2026-09-21', scheduled_install_date: '2026-10-07T09:00:00Z', activation_date: '2026-10-07' },
  { code: '0036', telecom_status: 'instalado', sale_date: '2026-09-28', scheduled_install_date: '2026-10-08T09:00:00Z', activation_date: '2026-10-08' },
  { code: '0027', telecom_status: 'instalado', sale_date: '2026-09-15', scheduled_install_date: '2026-09-29T09:00:00Z', activation_date: '2026-09-29' },
  { code: '0033', telecom_status: 'em_instalacao', sale_date: '2026-09-25', scheduled_install_date: '2026-10-19T09:00:00Z', activation_date: null },
  { code: '0003', telecom_status: 'em_instalacao', sale_date: '2026-09-03', scheduled_install_date: '2026-10-10T09:00:00Z', activation_date: null },
  { code: '0035', telecom_status: 'ativo', sale_date: '2026-09-28', scheduled_install_date: null, activation_date: '2026-09-30' },
  { code: '0018', telecom_status: 'ativo', sale_date: '2026-09-09', scheduled_install_date: '2026-09-26T09:00:00Z', activation_date: '2026-09-10',
    servicos_details: { 'Galp Gás': { activation_date: '2026-10-10' }, 'Galp Energia': { activation_date: '2026-09-10' } } },
  { code: '0041', telecom_status: 'anulado', sale_date: '2026-10-05', scheduled_install_date: null, activation_date: null },
  { code: '0038', telecom_status: 'pendente', sale_date: '2026-10-01', scheduled_install_date: null, activation_date: null },
  { code: '0050', telecom_status: 'em_instalacao', sale_date: '2026-10-06', scheduled_install_date: '2026-11-04T09:00:00Z', activation_date: null },
];

const october = [new Date('2026-10-01T00:00:00'), new Date('2026-10-31T23:59:59')] as const;
const september = [new Date('2026-09-01T00:00:00'), new Date('2026-09-30T23:59:59')] as const;
const codes = (view: TelecomViewKey, [from, to]: readonly [Date, Date]) =>
  sales.filter((s) => matchesTelecomViewInPeriod(s, view, from, to)).map((s) => s.code).sort();

test('installed in October by installation date, even when sold in September', () => {
  assert.deepEqual(codes('instalados', october), ['0030', '0034', '0036']);
  assert.deepEqual(codes('instalados', september), ['0027']);
});

test('active by activation date, including a product activated later', () => {
  assert.deepEqual(codes('ativos', september), ['0018', '0035']);
  // Galp Gás of 0018 was activated on 10 October.
  assert.deepEqual(codes('ativos', october), ['0018']);
});

test('still to install with the installation booked for the month', () => {
  assert.deepEqual(codes('por_instalar', october), ['0003', '0033']);
});

test('next month is the installation booked after the month on screen', () => {
  assert.deepEqual(codes('proximo_mes', october), ['0050']);
});

test('cards without a date of their own still go by the sale date', () => {
  assert.deepEqual(codes('anulados', october), ['0041']);
  assert.equal(isTelecomUndatedInstall(sales.find((s) => s.code === '0038')!), true);
});

test('the total counts each sale once', () => {
  assert.deepEqual(codes('total', october), ['0003', '0018', '0030', '0033', '0034', '0036', '0038', '0041', '0050']);
});
