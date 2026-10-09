const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');

test('reader measures a viewport mounted after the dialog opens and cancels its document', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let destroyed = 0;
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width: 300 } }]); }
    disconnect() {}
  }
  function DelayedDialog({ children }) {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => { const timer = setTimeout(() => setMounted(true), 20); return () => clearTimeout(timer); }, []);
    return mounted ? React.createElement('section', null, children) : null;
  }
  const primitive = ({ children, ...props }) => React.createElement('div', props, children);
  const moduleExports = {};
  const source = ts.transpileModule(fs.readFileSync(__dirname + '/PdfDocumentCard.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mockedRequire = name => {
    if (name === 'pdfjs-dist') return { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 2 }), destroy: async () => { destroyed++; } }) };
    if (name.includes('pdf.worker')) return { default: '/worker.mjs' };
    if (name === '@/components/ui/dialog') return {
      Dialog: ({ open, children }) => open ? React.createElement(React.Fragment, null, children) : null,
      DialogContent: DelayedDialog, DialogTitle: primitive, DialogDescription: primitive,
    };
    if (name === '@/components/ui/button') return { Button: ({ asChild, variant, size, children, ...props }) => React.createElement('button', props, children) };
    if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (name === './PdfCanvas') return { PdfCanvas: ({ width }) => React.createElement('canvas', { 'data-width': width }) };
    return require(name);
  };
  vm.runInNewContext(source, { exports: moduleExports, require: mockedRequire, IntersectionObserver, ResizeObserver });
  const root = createRoot(document.getElementById('root'));
  try {
    await React.act(async () => { root.render(React.createElement(moduleExports.PdfDocumentCard, { url: '/sample.pdf', filename: 'sample.pdf', detail: 'PDF' })); });
    await React.act(async () => { document.querySelector('[title="Pré-visualizar sample.pdf"]').click(); });
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    const canvases = [...document.querySelectorAll('canvas')];
    assert.ok(canvases.some(canvas => canvas.dataset.width === '268'), 'reader fits its late-mounted viewport instead of retaining 600px');
  } finally {
    await React.act(async () => { root.unmount(); });
    assert.equal(destroyed, 1);
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
