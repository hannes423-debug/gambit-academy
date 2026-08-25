const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('script blocks:', blocks.length);

const sandbox = {
  console,
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  performance: { now: () => Date.now() },
  requestAnimationFrame: f => setTimeout(f, 0),
  setTimeout, clearTimeout,
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, createElement: () => ({ style:{}, classList:{add(){},remove(){},toggle(){}} }) },
  window: { matchMedia: () => ({ matches:false }), addEventListener(){} }
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);

// syntax check all blocks first
blocks.forEach((b, i) => {
  try { new vm.Script(b, { filename: 'block' + i }); }
  catch (e) { console.log('SYNTAX ERROR in block', i, '->', e.message); process.exit(1); }
});
console.log('syntax: all blocks parse OK');

// run icons + rules + data + state (blocks 0..3)
[0,1,2].forEach(i => vm.runInContext(blocks[i], sandbox));
// top-level const/let live in the context's lexical scope, not on the sandbox object
const Rules = vm.runInContext('Rules', sandbox);
const CURRICULUM = vm.runInContext('CURRICULUM', sandbox);
const VERDICTS = vm.runInContext('VERDICTS', sandbox);
const IDX = vm.runInContext('IDX', sandbox);

let errors = 0;
const err = (...a) => { errors++; console.log('  ✗', ...a); };

function legal(pos, mvStr, what, where){
  const mv = Rules.coerce(pos, mvStr);
  if (mv.from < 0 || mv.to < 0 || mv.from > 63 || mv.to > 63) { err(where, what, mvStr, 'bad square'); return null; }
  const p = pos.board[mv.from];
  if (!p) { err(where, what, mvStr, 'no piece on', Rules.name(mv.from)); return null; }
  const turnOk = Rules.isW(p) === (pos.turn === 'w');
  if (!turnOk) { err(where, what, mvStr, 'wrong side to move (turn=' + pos.turn + ', piece=' + p + ')'); return null; }
  const ms = Rules.moves(pos, mv.from);
  if (!ms.includes(mv.to)) { err(where, what, mvStr, 'ILLEGAL: ' + p + Rules.name(mv.from) + '->' + Rules.name(mv.to)); return null; }
  return mv;
}

for (const dom of CURRICULUM) {
  for (const course of (dom.courses || [])) {
    for (const m of (course.missions || [])) {
      if (!m.steps) continue;
      const where = m.id;
      let pos = Rules.parse(Rules.START);
      m.steps.forEach((st, si) => {
        const tag = where + ' step' + si;
        if (st.fen) {
          pos = Rules.parse(st.fen);
          const kings = pos.board.filter(p => p && p.toLowerCase() === 'k').length;
          if (kings !== 2) err(tag, 'fen has', kings, 'kings');
          if (Rules.inCheck(pos, pos.turn !== 'w')) err(tag, 'fen: side not to move is in check');
        }
        if (st.type === 'teach') {
          if (st.move) { const mv = legal(pos, st.move, 'teach move', tag); if (mv) pos = Rules.apply(pos, mv); }
          return;
        }
        // move step
        const side = m.side === 'b' ? 'b' : 'w';
        if (pos.turn !== side) err(tag, 'learner is', side, 'but it is', pos.turn, 'to move');
        const exp = legal(pos, st.expect, 'expect', tag);
        (st.also || []).forEach(a => legal(pos, a, 'also', tag));
        (st.alts || []).forEach(alt => {
          const amv = legal(pos, alt.move, 'alt ' + alt.verdict, tag);
          if (!VERDICTS[alt.verdict]) err(tag, 'unknown verdict', alt.verdict);
          if (amv && alt.line) {
            let p2 = Rules.apply(pos, amv);
            alt.line.forEach((ln, li) => {
              const lm = legal(p2, ln.move, 'line[' + li + ']', tag + ' alt ' + alt.move);
              if (lm) p2 = Rules.apply(p2, lm);
            });
          }
          if (alt.recovery) {
            const r = alt.recovery;
            const rp = Rules.parse(r.fen);
            const kings = rp.board.filter(p => p && p.toLowerCase() === 'k').length;
            if (kings !== 2) err(tag, 'recovery fen kings=', kings);
            legal(rp, r.expect, 'recovery expect', tag + ' alt ' + alt.move);
            (r.also || []).forEach(a => legal(rp, a, 'recovery also', tag + ' alt ' + alt.move));
            if ((r.side || m.side) !== rp.turn) err(tag, 'recovery side mismatch', r.side, rp.turn);
            ['prompt','success','fail','hint'].forEach(k => { if (!r[k]) err(tag, 'recovery missing', k); });
          }
        });
        if (st.fallback && !VERDICTS[st.fallback.verdict]) err(tag, 'bad fallback verdict');
        if (exp) pos = Rules.apply(pos, exp);
        if (st.reply) { const rm = legal(pos, st.reply.move, 'reply', tag); if (rm) pos = Rules.apply(pos, rm); }
      });
    }
  }
}

// specific chess claims worth verifying
function check(fen, mv, fn, label) {
  const pos = Rules.parse(fen);
  const m = Rules.coerce(pos, mv);
  const after = Rules.apply(pos, m);
  const res = fn(pos, after, m);
  console.log((res ? '  ✓ ' : '  ✗ ') + label);
  if (!res) errors++;
}
const noMoves = p => Rules.allMoves(p).length === 0;
console.log('\nchess claims:');
check('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8', (p,a) => noMoves(a) && Rules.inCheck(a, false), 'Ra8 is checkmate');
check('r2q3k/6pp/8/6N1/8/8/5PPP/6K1 w - - 0 1', 'g5f7', (p,a) => Rules.inCheck(a,false) && Rules.moves({...a,turn:'w'}, Rules.idx('f7')).includes(Rules.idx('d8')), 'Nf7+ forks king and queen');
// pawn on d5 attacks c6 and e6
(function(){
  const pos = Rules.parse('3q1rk1/5ppp/2n1b3/8/3P4/8/5PPP/3Q1RK1 w - - 0 1');
  const after = Rules.apply(pos, Rules.coerce(pos, 'd4d5'));
  after.turn = 'w';
  const targets = Rules.moves(after, Rules.idx('d5'));
  const ok = targets.includes(Rules.idx('c6')) && targets.includes(Rules.idx('e6'));
  console.log((ok?'  ✓ ':'  ✗ ') + 'd5 attacks both c6 and e6 (pawn fork)'); if(!ok) errors++;
})();
// stalemate line in the K+P endgame
(function(){
  let pos = Rules.parse('4k3/8/3K4/4P3/8/8/8/8 w - - 0 1');
  ['e5e6','e8d8','e6e7','d8e8','d6e6'].forEach(s => { pos = Rules.apply(pos, Rules.coerce(pos, s)); });
  const stale = noMoves(pos) && !Rules.inCheck(pos, false);
  console.log((stale?'  ✓ ':'  ✗ ') + 'premature e6 really ends in stalemate'); if(!stale) errors++;
})();
// Bg5 really pins the f6 knight against the queen (relative pin: moving it drops the queen)
(function(){
  const pos = Rules.parse('rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4');
  const after = Rules.apply(pos, Rules.coerce(pos, 'c1g5'));
  const knightMoves = Rules.moves(after, Rules.idx('f6'));
  const punished = knightMoves.length > 0 && knightMoves.every(to => {
    const p2 = Rules.apply(after, {from:Rules.idx('f6'), to});
    return Rules.moves(p2, Rules.idx('g5')).includes(Rules.idx('d8'));
  });
  console.log((punished?'  ✓ ':'  ✗ ') + 'Bg5 pins f6: any knight move loses the queen'); if(!punished) errors++;
})();
// composed pin puzzle: the c6 knight is absolutely pinned and undefended
(function(){
  const pos = Rules.parse('4k3/p4ppp/2n5/1B6/8/5N2/PP3PPP/4K3 w - - 0 1');
  const stuck = Rules.moves({...pos, turn:'b'}, Rules.idx('c6')).length === 0;
  const after = Rules.apply(pos, Rules.coerce(pos,'b5c6'));
  const free = Rules.inCheck(after, false) && !Rules.allMoves(after).some(m => m.to === Rules.idx('c6'));
  console.log((stuck&&free?'  ✓ ':'  ✗ ') + 'pinned knight is stuck and Bxc6+ wins it outright'); if(!(stuck&&free)) errors++;
})();
// castling works
(function(){
  const pos = Rules.parse('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4');
  const ok = Rules.moves(pos, Rules.idx('e1')).includes(Rules.idx('g1'));
  const after = Rules.apply(pos, Rules.coerce(pos,'e1g1'));
  const rook = after.board[Rules.idx('f1')] === 'R' && after.board[Rules.idx('h1')] === null;
  console.log((ok&&rook?'  ✓ ':'  ✗ ') + 'O-O is offered and moves the rook'); if(!(ok&&rook)) errors++;
})();
// SAN sanity
(function(){
  const pos = Rules.parse('rnbqkbnr/pp2pppp/2p5/3pP3/3P4/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 4');
  const s = Rules.san(pos, Rules.coerce(pos,'c6c5'));
  console.log((s==='c5'?'  ✓ ':'  ✗ ') + 'SAN of c6c5 = ' + s); if(s!=='c5') errors++;
  const p2 = Rules.parse('rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 3');
  const s2 = Rules.san(p2, Rules.coerce(p2,'d5e4'));
  console.log((s2==='dxe4'?'  ✓ ':'  ✗ ') + 'SAN of d5xe4 = ' + s2); if(s2!=='dxe4') errors++;
})();


// ---- claims for the newly authored missions ----
(function(){
  const t=(label,ok)=>{console.log((ok?'  ✓ ':'  ✗ ')+label); if(!ok) errors++;};
  const noMoves = p => Rules.allMoves(p).length===0;

  // bm-2: Qg8 is mate
  let p1=Rules.parse('4k3/8/4K3/8/8/8/8/6Q1 w - - 0 1');
  let a1=Rules.apply(p1,Rules.coerce(p1,'g1g8'));
  t('bm-2: Qg8 is checkmate', noMoves(a1) && Rules.inCheck(a1,false));

  // sk-1: Rd1+ skewers king and queen
  let p2=Rules.parse('3q4/pppk4/8/8/8/8/5PPP/R5K1 w - - 0 1');
  let a2=Rules.apply(p2,Rules.coerce(p2,'a1d1'));
  const replies=Rules.allMoves(a2);
  t('sk-1: Rd1 is check and every legal reply is a king move off the d-file',
    Rules.inCheck(a2,false) && replies.length>0 && replies.every(m=>a2.board[m.from]==='k' && (m.to%8)!==3));
  t('sk-1: the queen then hangs on d8', replies.every(m=>{
      const p3=Rules.apply(a2,m);
      return Rules.moves(p3,Rules.idx('d1')).includes(Rules.idx('d8'));
  }));

  // sk-1 step2: Bd4+ skewers king and rook
  let p4=Rules.parse('7r/ppp3k1/8/8/8/4B3/5PPP/6K1 w - - 0 1');
  let a4=Rules.apply(p4,Rules.coerce(p4,'e3d4'));
  t('sk-1b: Bd4 is check and h8 falls next', Rules.inCheck(a4,false) &&
    Rules.allMoves(a4).every(m=>{const p5=Rules.apply(a4,m);
      return Rules.moves(p5,Rules.idx('d4')).includes(Rules.idx('h8'));}));

  // da-1: Bxa8 is a discovered check that wins a rook
  let p6=Rules.parse('r3k3/p1p2ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1');
  t('da-1: black is NOT in check before the bishop moves', !Rules.inCheck(p6,false));
  let a6=Rules.apply(p6,Rules.coerce(p6,'e4a8'));
  t('da-1: Bxa8 discovers check from the rook', Rules.inCheck(a6,false) && a6.board[Rules.idx('a8')]==='B');

  // da-1 step2: Nxc6+ discovered check from the bishop
  let p7=Rules.parse('8/pp4kp/2r5/8/3N4/8/1B3PPP/6K1 w - - 0 1');
  t('da-1b: no check before the knight moves', !Rules.inCheck(p7,false));
  let a7=Rules.apply(p7,Rules.coerce(p7,'d4c6'));
  t('da-1b: Nxc6 wins the rook with discovered check', Rules.inCheck(a7,false) && a7.board[Rules.idx('c6')]==='N');

  // qg-2: the f6 knight really is pinned to the queen
  let p8=Rules.parse('rnbqkb1r/ppp2ppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 0 4');
  let a8=Rules.apply(p8,Rules.coerce(p8,'f6e4'));
  t('qg-2: after ...Ne4 White plays Bxd8', Rules.moves(a8,Rules.idx('g5')).includes(Rules.idx('d8')));

  // re-1: the Lucena bridge sequence is legal all the way to Rb4
  let p9=Rules.parse('2K5/2P1k3/8/8/8/8/7r/3R4 w - - 0 1');
  let ok=true;
  for (const mv of ['d1d4','h2h1','c8b7','h1b1','b7c6','b1c1','c6b6','c1b1','d4b4']){
    const m=Rules.coerce(p9,mv);
    if(!Rules.moves(p9,m.from).includes(m.to)){ ok=false; console.log('    lucena broke at',mv); break; }
    p9=Rules.apply(p9,m);
  }
  t('re-1: full Lucena bridge line is legal (Rd4 … Rb4)', ok && !Rules.inCheck(p9,true));

  // op-1: ...Kd7 really takes the opposition (kings facing, White to move)
  let p10=Rules.parse('8/4k3/8/3K4/4P3/8/8/8 b - - 0 1');
  let a10=Rules.apply(p10,Rules.coerce(p10,'e7d7'));
  const wk=Rules.idx('d5'), bk=Rules.idx('d7');
  t('op-1: ...Kd7 puts the kings in direct opposition with White to move',
    a10.board[bk]==='k' && a10.board[wk]==='K' && a10.turn==='w');

  // it-4: Nxf7 forces Kxf7 (the king really must take)
  let p11=Rules.parse('r1bqkb1r/ppp2ppp/2n5/3np1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 0 1');
  let a11=Rules.apply(p11,Rules.coerce(p11,'g5f7'));
  t('it-4: after Nxf7 the king can capture on f7', Rules.moves(a11,Rules.idx('e8')).includes(Rules.idx('f7')));
})();

console.log('\nmissions playable:', Object.values(IDX.mission).filter(m=>m.playable).length,
            '/ total', Object.values(IDX.mission).length);
console.log(errors ? '\nFAILURES: ' + errors : '\nALL CHECKS PASSED');
