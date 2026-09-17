/* Load the app's own script blocks into a Node vm context, so every tool
   judges chess with exactly the code the browser runs. Blocks are found by
   their SECTION marker, not by index, so adding a block never shifts a tool. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '..', 'index.html');

function blocks(){
  const src = fs.readFileSync(HTML, 'utf8');
  return [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

function sandbox(){
  const store = {};
  const s = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { now: () => Date.now() },
    requestAnimationFrame: f => setTimeout(f, 0),
    setTimeout, clearTimeout,
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener(){},
                createElement: () => ({ style:{}, classList:{ add(){}, remove(){}, toggle(){} } }) },
    window: { matchMedia: () => ({ matches:false }), addEventListener(){} }
  };
  s.window.document = s.document;
  return s;
}

/** Load the blocks whose source contains any of `markers` (in file order). */
function load(markers){
  const ctx = sandbox();
  vm.createContext(ctx);
  const all = blocks();
  const wanted = all.filter(b => markers.some(m => b.includes(m)));
  if (wanted.length !== markers.length) {
    const missing = markers.filter(m => !all.some(b => b.includes(m)));
    if (missing.length) throw new Error('script blocks not found: ' + missing.join(', '));
  }
  wanted.forEach((b, i) => vm.runInContext(b, ctx, { filename: 'block:' + i }));
  return name => vm.runInContext(name, ctx);
}

/** The pure layers: rules, legacy curriculum/helpers, academy model + content. */
function loadAcademy(){
  return load(['SECTION 13 — RULES LAYER', 'SECTION 14 — CURRICULUM DATA', 'SECTION 15 — INDEX + HELPERS',
               'SECTION 33 — ACADEMY MODEL', 'SECTION 34 — ACADEMY CURRICULUM']);
}

module.exports = { blocks, load, loadAcademy, HTML };
