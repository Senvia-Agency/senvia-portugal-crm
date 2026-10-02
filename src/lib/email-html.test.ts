import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { sanitizeEmailHtml, quoteEmailHtml, toEditorHtml } = await import('./email-html.ts');

test('sanitized email DOM excludes active content, handlers and dangerous URLs', () => {
  // Given
  const input = '<img src=x onerror="alert(1)"><svg onload="alert(2)"></svg><a href="jav&#97;script:alert(3)">link</a><iframe srcdoc="x"></iframe><form><input name="parent"></form><script>alert(4)</script>';
  // When
  const host = dom.window.document.createElement('div');
  host.innerHTML = sanitizeEmailHtml(input);
  // Then
  assert.equal(host.querySelector('script,svg,iframe,form,input'), null);
  assert.equal(host.querySelector('[onerror],[onload],[href],[src]'), null);
});

test('email formatting survives but CSS resources and global layout do not', () => {
  // Given
  const input = '<table class="senvia-quote fixed" style="position:fixed;background-image:url(https://tracker.invalid);color:red"><tr><td style="font-weight:bold;padding-right:16px">Hello <b>team</b><img src="data:image/png;base64,aGVsbG8=" width="90"><img src="https://tracker.invalid/pixel"></td></tr></table>';
  // When
  const host = dom.window.document.createElement('div');
  host.innerHTML = sanitizeEmailHtml(input);
  // Then
  assert.equal(host.querySelector('table')?.className, 'senvia-quote');
  assert.equal(host.querySelector('table')?.style.color, 'red');
  assert.equal(host.querySelector('table')?.style.position, '');
  assert.equal(host.querySelector('table')?.style.backgroundImage, '');
  assert.equal(host.querySelector('b')?.textContent, 'team');
  assert.equal(host.querySelectorAll('img[src]').length, 1);
});

test('signature keeps safe HTTPS image sources and links', () => {
  const input = '<div class="senvia-signature"><a href="https://www.senvia.pt/"><img src="https://app.senvia.pt/icon-192.png" alt="Senvia"></a></div>';

  const host = dom.window.document.createElement('div');
  host.innerHTML = sanitizeEmailHtml(input);

  assert.equal(host.querySelector('img')?.getAttribute('src'), 'https://app.senvia.pt/icon-192.png');
  assert.equal(host.querySelector('a')?.getAttribute('href'), 'https://www.senvia.pt/');
});

test('quoted sender fields remain text and quoted body is sanitized', () => {
  // Given
  const fromName = '<img src=x onerror=alert(1)>';
  // When
  const host = dom.window.document.createElement('div');
  host.innerHTML = quoteEmailHtml({ from_name: fromName, from_address: '<b>address</b>', date: null, html_body: '<p onclick="alert(1)">Hello</p>', text_body: null });
  // Then
  assert.ok(host.textContent?.includes(fromName));
  assert.equal(host.querySelector('img,b,[onclick]'), null);
  assert.ok(host.querySelector('.senvia-quote'));
});

test('draft and signature HTML use the same sanitization boundary', () => {
  // Given / When
  const html = toEditorHtml('<p>Draft<img src=x onerror=alert(1)></p>');
  const plain = toEditorHtml('Hello <team>\nnext');
  // Then
  assert.equal(html, '<p>Draft<img></p>');
  assert.equal(plain, 'Hello &lt;team&gt;<br>next');
});

test('error-handler payload fires in an unsanitized DOM but cannot fire after sanitization', () => {
  // Given
  const sandbox = new JSDOM('<!doctype html><div id="editor"></div>', { runScripts: 'dangerously' });
  const editor = sandbox.window.document.getElementById('editor');
  assert.ok(editor);
  const payload = '<img src="invalid" onerror="document.documentElement.dataset.executed=1">';
  editor.innerHTML = payload;
  editor.querySelector('img')?.dispatchEvent(new sandbox.window.Event('error'));
  assert.equal(sandbox.window.document.documentElement.dataset.executed, '1');
  delete sandbox.window.document.documentElement.dataset.executed;
  // When
  editor.innerHTML = sanitizeEmailHtml(payload);
  editor.querySelector('img')?.dispatchEvent(new sandbox.window.Event('error'));
  // Then
  assert.equal(sandbox.window.document.documentElement.dataset.executed, undefined);
  sandbox.window.close();
});
