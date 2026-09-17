/* Live engine judgement against the real engine.

   tools/academy.test.js pins down what the numbers are ALLOWED to change by
   handing in scores. This one spawns the bundled Stockfish, scores a position
   before and after a move exactly the way the browser runner does, and checks
   that real numbers land on the intended verdict. Slow, so it is part of
   `npm run verify:academy`, not `npm test`.

   Run: node tools/live.test.js [--depth 14] */
const { loadAcademy } = require('./lib/app.js');
const { Engine } = require('./lib/engine.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DEPTH = +arg('--depth', 14);

const get = loadAcademy();
const Rules = get('Rules');
const A = get('Academy');

let failed = 0, passed = 0;
const ok = (cond, name, detail) => {
  if (cond){ passed++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

/* The same two calls AcademyRunner.liveCheck makes, with the same negation:
   a score is always from the side to move, so after the move it belongs to
   the opponent and has to be flipped back to the mover's view. */
async function live(eng, fen, uci){
  const pos = Rules.parse(fen);
  const mv = Rules.coerce(pos, uci);
  if (Rules.moves(pos, mv.from).indexOf(mv.to) < 0) throw new Error('illegal ' + uci + ' in ' + fen);
  const before = (await eng.analyse(fen, { depth:DEPTH }))[0];
  const after = (await eng.analyse(Rules.toFEN(Rules.apply(pos, mv)), { depth:DEPTH }))[0];
  const l = { cpBefore:before.cp, mateBefore:before.mate,
              cpAfter: after.cp == null ? null : -after.cp,
              mateAfter: after.mate == null ? null : -after.mate,
              best:before.move, depth:Math.min(before.depth, after.depth) };
  l.bestSan = Rules.san(pos, Rules.coerce(pos, l.best));
  return l;
}
const verdict = (ex, uci, r, l) => {
  const pos = Rules.parse(ex.fen);
  return A.judgeLive(A.judge(ex, pos, Rules.coerce(pos, uci), r), ex, r, l);
};

/* White queen on d2, a lone black knight on d5.
     Qxd5  wins the knight and the game        — the lesson's move
     Qd3   keeps everything, teaches nothing   — a sound try
     Qe3   hands the queen to the knight       — a blunder */
const FEN = '4k3/8/8/3n4/8/8/3Q4/4K3 w - - 0 1';
const EX = { id:'live-check', conceptId:'hanging-piece', fen:FEN, policy:'target',
             label:'Win the knight', prompt:'Win the knight.',
             candidates:[{ move:'d2d5', engineEval:900, conceptAlignment:1, feedback:'Yes — the knight was undefended.' }],
             fallback:{ feedback:'We are practising taking a free piece.' } };

(async () => {
  const eng = new Engine({ hash:64 });
  try {
    console.log('— live engine judgement (depth ' + DEPTH + ') —');

    const best = await live(eng, FEN, 'd2d5');
    const vBest = verdict(EX, 'd2d5', 900, best);
    ok(vBest.outcome === 'correct', 'the authored answer is still correct', vBest.san);
    ok(!vBest.live, 'an authored move is never re-judged live');

    const quiet = await live(eng, FEN, 'd2d3');
    const vQuiet = verdict(EX, 'd2d3', 900, quiet);
    ok(vQuiet.live && vQuiet.live.sound, 'the engine calls Qd3 sound', vQuiet.live && vQuiet.live.label);
    ok(vQuiet.outcome === 'retry', 'a sound unlisted move is a retry, not a failure', vQuiet.outcome);
    ok(/practising/.test(vQuiet.text), 'the authored line survives', vQuiet.text);

    const bad = await live(eng, FEN, 'd2e3');
    const vBad = verdict(EX, 'd2e3', 900, bad);
    ok(vBad.live && vBad.live.label === 'BLUNDER', 'the engine calls Qe3 a blunder',
       vBad.live && (vBad.live.label + ' drop ' + vBad.live.drop.toFixed(1) + '%'));
    ok(vBad.outcome === 'fail', 'and the learner is told it fails', vBad.outcome);
    ok(!/%/.test(vBad.text), 'no win percentages at 900', vBad.text);
    const vBadHigh = verdict(EX, 'd2e3', 1700, bad);
    ok(/%/.test(vBadHigh.text) || /%/.test(vBadHigh.liveNote || ''), 'percentages appear at 1700', vBadHigh.text);

    /* With the automatic hanging check standing down, the engine is the only
       thing left that can catch a move which meets the exercise's goal and
       still loses the game. */
    const goalEx = { id:'live-goal', conceptId:'hanging-piece', fen:FEN, policy:'target',
                     goal:{ type:'piece', piece:'q' }, ignoreHanging:true, candidates:[], fallback:{} };
    const pos = Rules.parse(FEN);
    const noEngine = A.judge(goalEx, pos, Rules.coerce(pos, 'd2e3'), 900);
    ok(noEngine.outcome === 'accepted', 'without the engine the blunder passes', noEngine.outcome);
    const vGoal = verdict(goalEx, 'd2e3', 900, bad);
    ok(vGoal.outcome === 'fail' && vGoal.category === 'TACTICAL_MISS',
       'a goal-meeting blunder is caught by the engine', vGoal.outcome + '/' + vGoal.category);
  } catch (e){
    failed++; console.log('  ✗ threw: ' + (e && e.stack || e));
  } finally {
    eng.quit();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
