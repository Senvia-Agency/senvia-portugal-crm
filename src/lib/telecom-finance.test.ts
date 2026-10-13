import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { telecomCommissionDate, telecomCommissionInPeriod, telecomCommissionParts, telecomCommissionPartsInPeriod, isTelecomCommissionEarned } from './telecom-finance';
const sale={scheduled_install_date:'2026-09-30T09:00:00',activation_date:'2026-08-01',sale_date:'2026-07-01',commission_payment_month_offset:2,commission_expected_date:'2026-12-01',commission_month_override:'2027-01-01',comissao:230,org_commission:50,servicos_produtos:['Energia','Gás'],servicos_details:{Energia:{comissao:200,activation_date:'2026-08-01'},Gás:{comissao:30,activation_date:'2026-11-01'}}};
describe('Telecom installation timing',()=>{
 test('installation in September counts in October despite old dates and exceptions',()=>assert.equal(telecomCommissionDate(sale),'2026-10-01'));
 test('December installation counts in January of the next year',()=>assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'2026-12-31T18:00:00'}),'2027-01-01'));
 test('UTC installation around month end uses the Lisbon installation month',()=>{
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'2026-09-30T23:30:00Z'}),'2026-11-01');
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'2026-09-30T23:30:00+00:00'}),'2026-11-01');
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'2026-10-01T00:30:00+02:00'}),'2026-10-01');
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'2026-10-01T00:30:00+01:00'}),'2026-11-01');
 });
 test('missing or invalid installation never falls back to activation or sale',()=>{
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:null}),null);
  assert.equal(telecomCommissionDate({...sale,scheduled_install_date:'invalid'}),null);
 });
 test('all products and frozen beneficiaries enter the same installation-based month',()=>{
  const parts=telecomCommissionParts(sale);
  assert.deepEqual(parts.map(part=>part.date),['2026-10-01']);
  assert.equal(parts.reduce((sum,part)=>sum+part.gross,0),230);
  assert.equal(parts.reduce((sum,part)=>sum+part.seller,0),180);
  assert.equal(parts.reduce((sum,part)=>sum+part.org,0),50);
 });
 test('selected month includes only its commissions and does not shift twice',()=>{
  assert.equal(telecomCommissionPartsInPeriod(sale,{from:new Date(2026,9,1),to:new Date(2026,9,31)}).length,1);
  assert.equal(telecomCommissionPartsInPeriod(sale,{from:new Date(2026,8,1),to:new Date(2026,8,30)}).length,0);
 });
 test('unfiltered totals exclude commissions before their due month',()=>{
  assert.equal(telecomCommissionInPeriod(sale,undefined,new Date(2026,8,30)),false);
  assert.equal(telecomCommissionInPeriod(sale,undefined,new Date(2026,9,1)),true);
  assert.equal(telecomCommissionInPeriod({...sale,scheduled_install_date:null}),false);
 });
 test('cancelled and uninstalled sales still do not earn commission',()=>{
  assert.equal(isTelecomCommissionEarned({status:'cancelled',telecom_status:'instalado'}),false);
  assert.equal(isTelecomCommissionEarned({status:'in_progress',telecom_status:'em_instalacao'}),false);
 });
});
