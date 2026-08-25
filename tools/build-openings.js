const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const sb = { console }; vm.createContext(sb); vm.runInContext(blocks[0], sb);
const Rules = vm.runInContext('Rules', sb);

/* ---- SAN -> move, by generating and matching ---- */
function sanToMove(pos, san){
  const want = san.replace(/[+#?!]/g, '');
  for (const mv of Rules.allMoves(pos)){
    if (Rules.san(pos, mv).replace(/[+#]/g, '') === want) return mv;
    for (const p of 'qrbn'){
      const m2 = { from: mv.from, to: mv.to, promo: p };
      if (Rules.san(pos, m2).replace(/[+#]/g, '') === want) return m2;
    }
  }
  return null;
}

/* ---- read every ECO volume ---- */
const rows = [];
for (const v of 'abcde'){
  const lines = fs.readFileSync(require('path').join(__dirname, 'data', v + '.tsv'), 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++){
    const [eco, name, pgn] = lines[i].split('\t');
    if (!eco || !name || !pgn) continue;
    rows.push({ eco, name, pgn });
  }
}
console.log('openings read:', rows.length);

/* ---- convert each line to a UCI path ---- */
let failed = 0, maxDepth = 0;
for (const r of rows){
  let pos = Rules.parse(Rules.START);
  const path = [];
  const sans = r.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
  let ok = true;
  for (const san of sans){
    const mv = sanToMove(pos, san);
    if (!mv){ ok = false; break; }
    path.push(Rules.name(mv.from) + Rules.name(mv.to) + (mv.promo || ''));
    pos = Rules.apply(pos, mv);
  }
  if (!ok){ failed++; r.bad = true; continue; }
  r.path = path;
  maxDepth = Math.max(maxDepth, path.length);
}
console.log('converted, failures:', failed, '| deepest line:', maxDepth, 'plies');

/* ---- name compression: lichess names are "Family: Part, Part" ---- */
const tokens = new Map();
const tokId = t => { if (!tokens.has(t)) tokens.set(t, tokens.size); return tokens.get(t); };
function encodeName(name){
  const [family, rest] = name.split(': ');
  const parts = [tokId(family)];
  if (rest) for (const p of rest.split(', ')) parts.push(tokId(p));
  return parts;
}

/* ---- trie ---- */
const root = { kids: new Map() };
let nodes = 1;
for (const r of rows){
  if (r.bad) continue;
  let n = root;
  for (const mv of r.path){
    if (!n.kids.has(mv)){ n.kids.set(mv, { kids: new Map() }); nodes++; }
    n = n.kids.get(mv);
  }
  n.name = encodeName(r.name);
  n.eco = r.eco;
}
console.log('trie nodes:', nodes, '| name tokens:', tokens.size);

/* ---- serialise: [move, nameParts|0, eco|0, [children]] ---- */
const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
const packMove = uci => A[Rules.idx(uci.slice(0,2))] + A[Rules.idx(uci.slice(2,4))] + (uci[4] || '');
function ser(node){
  const kids = [];
  for (const [mv, kid] of node.kids) kids.push([packMove(mv)].concat(ser(kid)));
  return [node.name || 0, node.eco || 0, kids];
}
const tree = ser(root);
const dict = [...tokens.keys()];
const payload = JSON.stringify({ d: dict, t: tree });
fs.writeFileSync(require('path').join(__dirname, 'openings.json'), payload);
console.log('payload:', (payload.length / 1024).toFixed(1), 'KB');

/* sanity: walk to a known line */
function walk(path){
  let node = tree, out = [];
  for (const uci of path){
    const m = packMove(uci);
    const kid = node[2].find(k => k[0] === m);
    if (!kid) return null;
    node = [kid[1], kid[2], kid[3]];
    if (node[0]) out.push(node[0].map(i => dict[i]).join(' / ') + ' [' + node[1] + ']');
  }
  return out;
}
console.log('\n1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 ->');
console.log('  ' + (walk(['e2e4','c7c6','d2d4','d7d5','b1c3','d5e4','c3e4','c8f5']) || ['?']).join('\n  '));
console.log('\n1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 ->');
console.log('  ' + (walk(['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4','d7d6']) || ['?']).join('\n  '));
