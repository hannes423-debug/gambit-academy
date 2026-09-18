/* Ask the engine (and the tablebase, for small positions) about a position
   BEFORE writing it into a lesson spec. Authoring blind and letting
   tools/author/build.js reject the result works, but it costs a full build per
   mistake; this answers the same questions in seconds.

     node tools/probe.js "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
     node tools/probe.js --depth 20 --multipv 6 "<fen>"
     node tools/probe.js --moves d1d8,d1a4 "<fen>"     score named moves too
     node tools/probe.js --legal "<fen>"               list every legal move

   Prints, for each line: the SAN, the uci, the score from the side to move,
   the win% gap to the best move, and the tablebase category when available. */
const { load } = require('./lib/app.js');
const { Engine } = require('./lib/engine.js');

const argv = process.argv.slice(2);
const flag = k => argv.indexOf(k) >= 0;
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const fen = argv.filter(a => /\//.test(a) && / [wb] /.test(a))[0];
if (!fen){ console.error('usage: node tools/probe.js [--depth N] [--multipv N] [--moves a,b] [--legal] "<fen>"'); process.exit(2); }

const DEPTH = +opt('--depth', 18), MULTIPV = +opt('--multipv', 5);
const get = load(['SECTION 13 — RULES LAYER', 'SECTION 33 — ACADEMY MODEL']);
const Rules = get('Rules'), A = get('Academy');

const pos = Rules.parse(fen);
const san = uci => { try { return Rules.san(pos, Rules.coerce(pos, uci)); } catch(e){ return '??'; } };
const legal = uci => { const m = Rules.coerce(pos, uci); return !!m && !!pos.board[m.from] && Rules.moves(pos, m.from).indexOf(m.to) >= 0; };
const fmt = l => l.mate != null ? '#' + l.mate : ((l.cp > 0 ? '+' : '') + (l.cp / 100).toFixed(2));
const win = l => A.winPct(l.cp, l.mate);

async function tablebase(){
  const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
  if (!r.ok) throw new Error('tablebase HTTP ' + r.status);
  const j = await r.json();
  /* the API reports a move's category from the OPPONENT's point of view */
  const mine = c => ({ loss:'WIN', win:'LOSS', draw:'draw', 'cursed-win':'draw(cursed)', 'blessed-loss':'draw(blessed)' })[c] || c;
  return { position:j.category, moves:j.moves.map(m => ({ uci:m.uci, verdict:mine(m.category), dtz:m.dtz })) };
}

(async () => {
  const pieces = pos.board.filter(Boolean).length;
  console.log('\n' + fen);
  console.log(pieces + ' pieces · ' + (pos.turn === 'w' ? 'White' : 'Black') + ' to move' +
              (Rules.inCheck(pos, pos.turn === 'w') ? ' · IN CHECK' : '') +
              (Rules.inCheck(pos, pos.turn !== 'w') ? ' · ILLEGAL: the side not to move is in check' : ''));
  const all = [];
  pos.board.forEach((p, i) => {
    if (!p || Rules.isW(p) !== (pos.turn === 'w')) return;
    Rules.moves(pos, i).forEach(to => all.push(Rules.name(i) + Rules.name(to)));
  });
  console.log(all.length + ' legal moves' + (flag('--legal') ? ': ' + all.map(u => san(u) + '(' + u + ')').join(' ') : ''));

  if (pieces <= 7){
    try {
      const tb = await tablebase();
      console.log('\ntablebase — position is a ' + tb.position.toUpperCase() + ' for the side to move');
      const by = {}; tb.moves.forEach(m => { (by[m.verdict] = by[m.verdict] || []).push(san(m.uci) + '(' + m.uci + ')'); });
      Object.keys(by).forEach(k => console.log('  ' + k.padEnd(14) + by[k].join(' ')));
    } catch (e){ console.log('\ntablebase unavailable: ' + e.message); }
  }

  const eng = new Engine({ hash:64 });
  try {
    const lines = await eng.analyse(fen, { depth:DEPTH, multipv:MULTIPV });
    console.log('\nengine depth ' + DEPTH + ', top ' + lines.length + ':');
    const best = lines[0];
    lines.forEach(l => console.log('  ' + String(l.rank).padStart(2) + '. ' + san(l.move).padEnd(8) + fmt(l).padStart(7) +
      '  drop ' + (win(best) - win(l)).toFixed(1) + '%   pv ' + l.pv.slice(0, 6).join(' ')));
    const named = (opt('--moves', '') || '').split(',').filter(Boolean);
    if (named.length){
      console.log('\nnamed moves:');
      for (const u of named){
        if (!legal(u)){ console.log('  ' + u + ' — ILLEGAL'); continue; }
        const l = await eng.scoreMove(fen, u, { depth:DEPTH });
        console.log('  ' + san(u).padEnd(8) + '(' + u + ') ' + fmt(l).padStart(7) + '  drop ' + (win(best) - win(l)).toFixed(1) + '%');
      }
    }
  } finally { eng.quit(); }
})();
