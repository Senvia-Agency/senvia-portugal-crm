import test from 'node:test';
import assert from 'node:assert/strict';
import { linkFromTypedWord, normalizeLink } from './email-links.ts';

test('typed emails, http(s) and www addresses become links', () => {
  assert.equal(linkFromTypedWord('thiago@gmail.com'), 'mailto:thiago@gmail.com');
  assert.equal(linkFromTypedWord('https://senvia.pt/precos'), 'https://senvia.pt/precos');
  assert.equal(linkFromTypedWord('www.senvia.pt'), 'https://www.senvia.pt');
});

test('ordinary words and bare names stay text', () => {
  assert.equal(linkFromTypedWord('olá'), null);
  assert.equal(linkFromTypedWord('relatorio.pdf'), null);
  assert.equal(linkFromTypedWord('javascript:alert(1)'), null);
});

test('the link box accepts sites, emails and phones', () => {
  assert.equal(normalizeLink('senvia.pt'), 'https://senvia.pt');
  assert.equal(normalizeLink(' https://senvia.pt '), 'https://senvia.pt');
  assert.equal(normalizeLink('geral@senvia.pt'), 'mailto:geral@senvia.pt');
  assert.equal(normalizeLink('+351 939 135 114'), 'tel:+351939135114');
});

test('the link box refuses what is not a link', () => {
  assert.equal(normalizeLink(''), null);
  assert.equal(normalizeLink('javascript:alert(1)'), null);
  assert.equal(normalizeLink('isto não é link'), null);
});
