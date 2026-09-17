/* Academy model + curriculum tests. Loads the real script blocks from
   index.html (tools/lib/app.js) — nothing here re-implements app logic.
   Exits 1 on any failure, so `npm test` cannot pass with broken content. */
const { loadAcademy } = require('./lib/app.js');
const get = loadAcademy();
const Rules = get('Rules');
const A = get('Academy');
const AC = get('ACADEMY');
const LESSONS = get('ACADEMY_LESSONS');
const EXERCISES = get('ACADEMY_EXERCISES');
const SPINE = get('ACADEMY_SPINE');
const CLAIMS = get('ACADEMY_CLAIMS');

let failed = 0, passed = 0;
function test(name, fn){
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e){ failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
function ok(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg){ if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const section = s => console.log('\n— ' + s + ' —');

const play = (fen, ucis) => { let p = Rules.parse(fen); for (const u of ucis){ const m = Rules.coerce(p, u); if (Rules.moves(p, m.from).indexOf(m.to) < 0) throw new Error('illegal ' + u + ' in ' + Rules.toFEN(p)); p = Rules.apply(p, m); } return p; };
const legal = (pos, u) => { const m = Rules.coerce(pos, u); return !!pos.board[m.from] && Rules.moves(pos, m.from).indexOf(m.to) >= 0; };
const judgeUci = (ex, u, r) => { const pos = Rules.parse(ex.fen); return A.judge(ex, pos, Rules.coerce(pos, u), r); };
const X = id => { const x = AC.exercises[id]; if (!x) throw new Error('no exercise ' + id); return x; };
const DAY = A.DAY;

/* ======================================================================== */
section('curriculum loading');
test('spine covers every band from Absolute beginner to 2100+', () => {
  const bands = SPINE.map(b => b.band);
  eq(bands.length, 22);
  for (let r = 0; r <= 2100; r += 100) ok(bands.indexOf(r) >= 0, 'missing band ' + r);
  eq(A.bandLabel(0), 'Beginner'); eq(A.bandLabel(1234), '1200'); eq(A.bandLabel(2400), '2100+');
});
test('concept ids are unique and use known branches + durability classes', () => {
  const ids = SPINE.flatMap(b => b.topics.map(t => t[0]));
  eq(new Set(ids).size, ids.length, 'duplicate concept id');
  const branches = A.BRANCHES.map(b => b.id);
  SPINE.forEach(b => b.topics.forEach(t => {
    ok(branches.indexOf(t[2]) >= 0, t[0] + ' unknown branch ' + t[2]);
    ok(A.DURABILITY[t[3]], t[0] + ' unknown durability ' + t[3]);
  }));
});
test('all 12 academy branches are defined', () => {
  ['Fundamentals','Board Vision','Tactics','Calculation','Checkmates','Openings','Strategy','Pawn Play','Endgames','Defense','Practical Play','Analysis']
    .forEach(n => ok(A.BRANCHES.some(b => b.name === n), 'missing branch ' + n));
});
test('the ten required seed lessons exist and are wired to the spine', () => {
  const required = ['coordinates','rook-movement','check','hanging-pieces','fork','pin','opening-development','opposition','open-files','deflection'];
  required.forEach(c => {
    const l = AC.lessonFor(c); ok(l, 'no lesson for ' + c);
    eq(AC.concepts[c].lessonId, l.id, 'spine does not point at lesson for ' + c);
  });
});
test('every lesson has intro, demo, guided + transfer exercises, mastery metadata', () => {
  LESSONS.forEach(l => {
    const types = l.stages.map(s => s.type);
    ok(types[0] === 'intro', l.id + ' must start with intro');
    ok(types.indexOf('demo') >= 0, l.id + ' has no demo');
    const exs = l.stages.filter(s => s.type === 'exercise').map(s => AC.exercises[s.ref]);
    ok(exs.every(Boolean), l.id + ' references a missing exercise');
    ok(exs.some(x => x.stage === 'guided'), l.id + ' has no guided exercise');
    ok(exs.some(x => x.stage === 'transfer'), l.id + ' has no transfer exercise');
    ok(types.indexOf('mastery') >= 0, l.id + ' has no mastery test stage');
    ok(l.mastery && l.mastery.targetMs > 0 && l.mastery.pass > 0, l.id + ' mastery metadata');
    ok(A.DURABILITY[l.durability], l.id + ' durability');
    ok(Object.keys(l.skills).every(k => A.SKILLS.some(s => s.id === k)), l.id + ' unknown skill');
    (l.prerequisites || []).forEach(p => ok(AC.concepts[p], l.id + ' prerequisite ' + p + ' not in spine'));
  });
});
test('every lesson explains success and at least two distinct failures', () => {
  LESSONS.forEach(l => {
    const exs = l.stages.filter(s => s.type === 'exercise').map(s => AC.exercises[s.ref]);
    let success = 0; const failures = new Set();
    exs.forEach(x => {
      if (x.kind === 'square'){ if (x.success) success++; failures.add('WRONG_SQUARE'); failures.add('WRONG_SQUARE:auto'); return; }
      (x.candidates || []).forEach(c => {
        const j = judgeUci(x, c.move, l.band);
        if ((j.outcome === 'correct' || j.outcome === 'accepted') && j.text) success++;
        if ((j.outcome === 'fail' || j.outcome === 'retry') && j.text) failures.add(c.move + ':' + j.category);
      });
    });
    ok(success >= 1, l.id + ' has no success explanation');
    ok(failures.size >= 2, l.id + ' has fewer than two failure explanations');
  });
});
test('every lesson demo frame is legal in sequence', () => {
  LESSONS.forEach(l => l.stages.filter(s => s.type === 'demo').forEach(d => {
    let pos = Rules.parse(d.fen);
    d.frames.forEach((f, i) => {
      if (f.fen) pos = Rules.parse(f.fen);
      Object.keys(f.marks || {}).forEach(sq => ok(/^[a-h][1-8]$/.test(sq), l.id + ' frame ' + i + ' bad mark ' + sq));
      (f.arrows || []).forEach(a => ok(/^[a-h][1-8]$/.test(a[0]) && /^[a-h][1-8]$/.test(a[1]), l.id + ' bad arrow'));
      if (f.move){ ok(legal(pos, f.move), l.id + ' demo frame ' + i + ' illegal ' + f.move); pos = Rules.apply(pos, Rules.coerce(pos, f.move)); }
    });
  }));
});

/* ======================================================================== */
section('legal positions and solution moves');
test('every exercise FEN is a legal position with two kings', () => {
  EXERCISES.forEach(x => {
    const p = Rules.parse(x.fen);
    eq(p.board.filter(q => q === 'K').length, 1, x.id + ' white kings');
    eq(p.board.filter(q => q === 'k').length, 1, x.id + ' black kings');
    ok(!Rules.inCheck(p, p.turn !== 'w'), x.id + ': side not to move is in check');
    ok(!p.board.slice(0, 8).concat(p.board.slice(56)).some(q => q === 'P' || q === 'p'), x.id + ': pawn on back rank');
    ok(Rules.toFEN(p).split(' ')[0] === x.fen.split(' ')[0], x.id + ': FEN does not round-trip');
  });
});
test('every candidate move is legal and unique', () => {
  EXERCISES.filter(x => x.kind !== 'square').forEach(x => {
    const p = Rules.parse(x.fen);
    const seen = new Set();
    (x.candidates || []).forEach(c => {
      ok(legal(p, c.move), x.id + ': illegal candidate ' + c.move);
      ok(!seen.has(c.move), x.id + ': duplicate candidate ' + c.move); seen.add(c.move);
      if (c.category) ok(A.FAILURES[c.category], x.id + ': unknown category ' + c.category);
      (c.labelByRating || []).forEach(o => ok(A.LABELS[o.label], x.id + ': unknown label ' + o.label));
    });
  });
});
test('every threat is a legal move for the opponent', () => {
  EXERCISES.filter(x => x.threat).forEach(x => {
    const p = Rules.parse(x.fen);
    const q = Rules.clone(p); q.turn = p.turn === 'w' ? 'b' : 'w'; q.ep = -1;
    ok(legal(q, x.threat.move), x.id + ': threat ' + x.threat.move + ' is not legal for the opponent');
  });
});
test('every move exercise has a correct answer at its own band', () => {
  EXERCISES.filter(x => x.kind !== 'square').forEach(x => {
    ok((x.candidates || []).some(c => judgeUci(x, c.move, x.band).outcome === 'correct'), x.id + ' has no correct move at ' + x.band);
  });
});
test('square exercises name real squares', () => {
  EXERCISES.filter(x => x.kind === 'square').forEach(x => ok(/^[a-h][1-8]$/.test(x.target), x.id));
});
test('mini-games start from legal positions for the right side', () => {
  LESSONS.forEach(l => l.stages.filter(s => s.type === 'minigame').forEach(g => {
    const p = Rules.parse(g.fen);
    ok(Rules.allMoves(p).length > 0, l.id + ' minigame has no legal moves');
    ok(g.side === 'w' || g.side === 'b', l.id + ' minigame side');
    ok(['material','promote','hold','mate'].indexOf(g.goal.type) >= 0, l.id + ' minigame goal');
  }));
});

/* ======================================================================== */
section('chess claims the lessons make');
test('fork: Nf7+ is check and attacks the queen on d8', () => {
  const a = play(X('fork-knight-check').fen, ['e5f7']);
  ok(Rules.inCheck(a, false)); ok(A.attacksFrom(a.board, Rules.idx('f7')).indexOf(Rules.idx('d8')) >= 0);
});
test('fork (Black): …Ne2+ checks g1 and attacks c1', () => {
  const a = play(X('fork-knight-black').fen, ['d4e2']);
  ok(Rules.inCheck(a, true)); ok(A.attacksFrom(a.board, Rules.idx('e2')).indexOf(Rules.idx('c1')) >= 0);
});
test('fork move order: Qxd8+ forces Kxd8, then Nxf7+ forks king and h8 rook', () => {
  const p = play(X('fork-move-order').fen, ['d1d8']);
  eq(Rules.allMoves(p).length, 1, 'only one reply to Qxd8+');
  const q = play(X('fork-move-order').fen, ['d1d8', 'e8d8', 'e5f7']);
  ok(Rules.inCheck(q, false)); ok(A.attacksFrom(q.board, Rules.idx('f7')).indexOf(Rules.idx('h8')) >= 0);
});
test('pin: Bb5 pins the queen, so …Qxd1 is illegal although the d-file opened', () => {
  const x = X('pin-queen');
  const a = play(x.fen, ['d3b5']);
  const pins = A.pinsBy(a, Rules.idx('b5'));
  ok(pins.some(p => Rules.name(p.pinned) === 'd7' && p.absolute), 'queen not absolutely pinned');
  ok(!legal(a, 'd7d1'), '…Qxd1 should be illegal');
});
test('pin: Bf5?? really is mate in one for Black', () => {
  const a = play(X('pin-queen').fen, ['d3f5', 'd7d1']);
  ok(Rules.inCheck(a, true) && Rules.allMoves(a).length === 0);
});
test('pin transfer: …Bg4 pins only once e2 has moved (regression)', () => {
  ok(A.goalMet({ type:'pin' }, Rules.parse(X('pin-knight-to-queen').fen), Rules.coerce(Rules.parse(X('pin-knight-to-queen').fen), 'c8g4')), 'Bg4 should pin with e3 played');
  const e2home = Rules.parse('rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 2 3');
  ok(!A.goalMet({ type:'pin' }, e2home, Rules.coerce(e2home, 'c8g4')), 'with the e2 pawn home, Bg4 pins nothing');
});
test('deflection: Rd8+ Rxd8 cxd8=Q is mate (both colours)', () => {
  const a = play(X('defl-promote').fen, ['d1d8', 'c8d8', 'c7d8q']);
  ok(Rules.inCheck(a, false) && Rules.allMoves(a).length === 0);
  const b = play(X('defl-promote-black').fen, ['d8d1', 'c1d1', 'c2d1q']);
  ok(Rules.inCheck(b, true) && Rules.allMoves(b).length === 0);
});
test('Petrov: 3…Nxe4 4.Qe2 Nf6?? 5.Nc6+ is a discovered check hitting the queen', () => {
  const a = play(X('dev-petrov-order').fen, ['f6e4', 'd1e2', 'e4f6', 'e5c6']);
  ok(Rules.inCheck(a, false)); ok(A.attacksFrom(a.board, Rules.idx('c6')).indexOf(Rules.idx('d8')) >= 0);
});
test('queen trade: Qc5?? and Qd1?? both allow mate on the back rank', () => {
  ['c1c5', 'c1d1'].forEach(u => {
    const a = play(X('files-queen-trade').fen, [u, 'd6d1']);
    ok(Rules.inCheck(a, true) && Rules.allMoves(a).length === 0, u);
  });
});
test('hanging demo: d5 bishop has two attackers and no defenders', () => {
  const p = Rules.parse(X('hang-free-bishop').fen);
  eq(A.attackers(p.board, Rules.idx('d5'), true).length, 2);
  eq(A.attackers(p.board, Rules.idx('d5'), false).length, 0);
});
test('opposition exercises are pure K+P vs K', () => {
  EXERCISES.filter(x => x.conceptId === 'opposition').forEach(x => {
    eq(Rules.parse(x.fen).board.filter(Boolean).sort().join(''), 'KPk'.split('').sort().join(''), x.id);
  });
});

/* ======================================================================== */
section('illegal-move explanations');
test('king into a controlled square names the controlling piece', () => {
  const p = Rules.parse('4k3/8/8/1b6/8/8/8/4K3 w - - 0 1');
  const t = A.explainIllegal(p, Rules.idx('e1'), Rules.idx('e2'));
  ok(/cannot move to e2 because the bishop on b5 controls that square/.test(t), t);
});
test('rook moving diagonally', () => {
  const t = A.explainIllegal(Rules.parse(X('rook-capture-knight').fen), Rules.idx('d2'), Rules.idx('e3'));
  ok(/straight lines/.test(t), t);
});
test('ignoring check', () => {
  const t = A.explainIllegal(Rules.parse(X('check-escape').fen), Rules.idx('h2'), Rules.idx('h3'));
  ok(/in check from the rook on e8/.test(t), t);
});
test('pinned piece', () => {
  const p = Rules.parse('4k3/8/8/8/1b6/2N5/8/4K3 w - - 0 1');
  const t = A.explainIllegal(p, Rules.idx('c3'), Rules.idx('e4'));
  ok(/pinned/.test(t) && /bishop on b4/.test(t), t);
});
test('castling through an attacked square', () => {
  const p = Rules.parse('4k3/8/8/8/8/8/5r2/4K2R w K - 0 1');
  const t = A.explainIllegal(p, Rules.idx('e1'), Rules.idx('g1'));
  ok(/castle/.test(t), t);
});
test('blocked slider and pawn capturing straight ahead', () => {
  const t1 = A.explainIllegal(Rules.parse('4k3/8/8/8/8/8/3P4/3RK3 w - - 0 1'), Rules.idx('d1'), Rules.idx('d5'));
  ok(/in the way/.test(t1), t1);
  const t2 = A.explainIllegal(Rules.parse('4k3/8/8/8/4p3/4P3/8/4K3 w - - 0 1'), Rules.idx('e3'), Rules.idx('e4'));
  ok(/cannot capture straight ahead/.test(t2), t2);
});
test('legal moves have no explanation', () => {
  eq(A.explainIllegal(Rules.parse(Rules.START), Rules.idx('e2'), Rules.idx('e4')), null);
});

/* ======================================================================== */
section('failure categories');
test('hanging piece is detected without authoring (unknown Nxh7)', () => {
  const x = Object.assign({}, X('fork-knight-check'), { candidates:[X('fork-knight-check').candidates[0]], fallback:null });
  const j = judgeUci(x, 'e5d7', 600);
  eq(j.category, 'HANGING_PIECE'); ok(/knight on d7/.test(j.text), j.text);
});
test('missed threat is detected for an unlisted move', () => {
  const j = judgeUci(X('fork-prevent'), 'g2g3', 700);
  eq(j.outcome, 'fail'); eq(j.category, 'MISSED_THREAT');
  const k = judgeUci(X('hang-defend-e5'), 'a7a6', 500);
  eq(k.category, 'MISSED_THREAT');
});
test('a defended pawn that only looks free is HANGING_PIECE', () => {
  eq(judgeUci(X('hang-defended-pawn'), 'f3e5', 500).category, 'HANGING_PIECE');
});
test('wrong move order, outcome change and theory misunderstanding keep their categories', () => {
  eq(judgeUci(X('fork-move-order'), 'e5f7', 900).category, 'WRONG_MOVE_ORDER');
  eq(judgeUci(X('opp-take-it'), 'e4e5', 950).category, 'ENDGAME_OUTCOME_CHANGE');
  ok(/Winning → Drawn/.test(judgeUci(X('opp-take-it'), 'e4e5', 950).text));
  eq(judgeUci(X('dev-petrov-order'), 'f6e4', 1300).category, 'THEORY_MISUNDERSTANDING');
});
test('coordinate mistakes are explained, not just marked wrong', () => {
  const x = X('coord-e4');
  const swapped = A.judgeSquare(x, Rules.idx('d5'));
  ok(/swapped/.test(swapped.text), swapped.text);
  const rank = A.judgeSquare(x, Rules.idx('e5'));
  ok(/Right file, wrong rank/.test(rank.text), rank.text);
  eq(A.judgeSquare(x, Rules.idx('e4')).outcome, 'correct');
});

/* ======================================================================== */
section('multiple acceptable moves');
test('saving the rook: every safe square passes, the two diagonals fail', () => {
  const x = X('rook-save-rook');
  ['a1a8','a1a3','a1c1','a1a6','a1b1'].forEach(u => ok(['correct','accepted'].indexOf(judgeUci(x, u, 150).outcome) >= 0, u));
  ['a1e1','a1a5'].forEach(u => eq(judgeUci(x, u, 150).outcome, 'fail', u));
  ok(['correct','accepted'].indexOf(judgeUci(x, 'a1a2', 150).outcome) >= 0, 'unlisted safe square a2 should pass via goal');
});
test('preventing the fork: four different ideas all pass', () => {
  const x = X('fork-prevent');
  ['e1c1','f1b5','a1d1','e1d2'].forEach(u => ok(['correct','accepted'].indexOf(judgeUci(x, u, 600).outcome) >= 0, u));
});
test('development: Nf3, Nc3 and Bc4 all pass for a 700 player', () => {
  const x = X('dev-second-move');
  ['g1f3','b1c3','f1c4'].forEach(u => ok(['correct','accepted'].indexOf(judgeUci(x, u, 700).outcome) >= 0, u));
  eq(judgeUci(x, 'e1e2', 700).outcome, 'fail');
});
test('a move 0.15 worse than the engine is not failed', () => {
  const x = X('dev-castle-or-not');                 /* d3 +0.18, d4 +0.15 */
  [600, 1200, 2000].forEach(r => ok(['correct','accepted'].indexOf(judgeUci(x, 'd2d4', r).outcome) >= 0, 'd4 at ' + r));
});

/* ======================================================================== */
section('engine best vs practical vs instructional');
test('check lesson: the engine move Qd6 is praised but is not the exercise answer', () => {
  const j = judgeUci(X('check-safe-check'), 'd2d6', 340);
  ok(j.labels.indexOf('ENGINE_BEST') >= 0, 'Qd6 should be ENGINE_BEST');
  eq(j.outcome, 'retry');
  ok(/strong move/i.test(j.text), j.text);
});
test('pin transfer: …c5 is engine best, …Bg4 is instructional best', () => {
  const a = A.analysePosition(X('pin-knight-to-queen'), 650);
  eq(a.engineBest.move, 'c7c5'); eq(a.instructionalBest.move, 'c8g4');
  eq(judgeUci(X('pin-knight-to-queen'), 'c8g4', 650).outcome, 'correct');
});
test('Nxf7 vs O-O: practical and instructional choice depend on rating', () => {
  const ex = { fen:'r1bqk2r/pppp1ppp/2n2n2/2b1p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 1', policy:'sound', candidates:[
    { move:'g5f7', engineRank:1, engineEval:180, calculationDepth:7, onlyMoveRisk:.7, positionVolatility:.9, tacticalComplexity:.9,
      forcingness:.9, failEval:-150, conceptAlignment:.9, recommendedRatingMin:1300 },
    { move:'e1g1', engineRank:2, engineEval:130, calculationDepth:1, conceptAlignment:.8, pedagogicalQuality:.9 } ] };
  const low = A.analysePosition(ex, 600), mid = A.analysePosition(ex, 1200), high = A.analysePosition(ex, 1800);
  eq(low.engineBest.move, 'g5f7');
  eq(low.practicalBest.move, 'e1g1', '600: practical');
  eq(low.instructionalBest.move, 'e1g1', '600: instructional');
  eq(mid.practicalBest.move, 'e1g1', '1200: practical');
  eq(high.instructionalBest.move, 'g5f7', '1800: instructional');
  /* the 1200 player who plays O-O passes and is shown the stronger tactic */
  const j = judgeUci(ex, 'e1g1', 1200);
  ok(j.outcome === 'correct' || j.outcome === 'accepted');
  ok(j.stronger && j.stronger.move === 'g5f7', '1200 should be shown Nxf7 as stronger');
  /* the 600 player who finds Nxf7 is never punished for the better move */
  eq(judgeUci(ex, 'g5f7', 600).outcome, 'correct');
});
test('tiny evaluation differences are hidden from low-rated learners', () => {
  ok(!A.evalVisible(700, 3)); ok(A.evalVisible(1800, 3)); ok(!A.evalVisible(1800, .5));
});
test('win-probability: +7.8 vs +7.4 is no difference, +0.5 vs -0.5 is a real one', () => {
  ok(A.winPct(778) - A.winPct(743) < 1);
  ok(A.winPct(50) - A.winPct(-50) > 8);
});

/* ======================================================================== */
section('different feedback by academy rating');
test('h3 instead of Rfd1: three levels, three messages, never failed', () => {
  const x = X('files-take-d');
  const at = r => judgeUci(x, 'h2h3', r);
  ok(/^Good move/.test(at(600).text), at(600).text);
  ok(/Good practical move/.test(at(1200).text), at(1200).text);
  ok(/slightly inaccurate/.test(at(1900).text), at(1900).text);
  [600, 1200, 1900].forEach(r => ok(['correct','accepted'].indexOf(at(r).outcome) >= 0, 'h3 failed at ' + r));
  eq(at(600).labels.indexOf('STRONG_ALTERNATIVE') >= 0, true, '600 label');
  eq(at(1900).labels.indexOf('STRONG_ALTERNATIVE') >= 0, false, '1900 label');
});
test('castling into …Nxe4: fine at 700, inaccurate at 1900', () => {
  const x = X('dev-castle-or-not');
  ok(['correct','accepted'].indexOf(judgeUci(x, 'e1g1', 700).outcome) >= 0);
  eq(judgeUci(x, 'e1g1', 1900).outcome, 'fail');
  ok(judgeUci(x, 'e1g1', 700).text !== judgeUci(x, 'e1g1', 1900).text);
});
test('early queen: inaccurate for a 700 learner, playable for a 1400 learner', () => {
  const x = X('dev-second-move');
  eq(judgeUci(x, 'd1h5', 700).outcome, 'fail');
  eq(judgeUci(x, 'd1h5', 1400).outcome, 'accepted');
});
test('claims mature with the learner', () => {
  eq(AC.claimText('trade-when-ahead', 400), 'When you are ahead in material, trading pieces is usually helpful.');
  ok(/preserves your advantage/.test(AC.claimText('trade-when-ahead', 1500)));
  ok(/objectively/.test(AC.claimText('trade-when-ahead', 2000)));
  CLAIMS.forEach(c => c.kinds.forEach(k => ok(A.DISAGREEMENTS[k], c.id + ' unknown kind ' + k)));
});
test('opening education changes shape by level', () => {
  eq(AC.openingStage(500).focus, 'Principles');
  ok(/families/.test(AC.openingStage(800).focus));
  ok(/repertoire/.test(AC.openingStage(1200).focus));
  ok(/preparation/i.test(AC.openingStage(2000).focus));
});

/* ======================================================================== */
section('mastery');
test('one success never marks a concept learned', () => {
  const s = A.newState(400); const t0 = Date.UTC(2026, 0, 1);
  A.record(s, 'fork', { success:true, now:t0 });
  ok(s.concepts.fork.mastery <= .45, 'mastery ' + s.concepts.fork.mastery);
  for (let i = 1; i < 6; i++) A.record(s, 'fork', { success:true, now:t0 + i * 60000 });
  ok(s.concepts.fork.mastery <= .6, 'same-day cap: ' + s.concepts.fork.mastery);
});
test('successes spread over days build mastery past the mastered threshold', () => {
  const s = A.newState(400); const t0 = Date.UTC(2026, 0, 1);
  for (let d = 0; d < 5; d++) for (let i = 0; i < 2; i++) A.record(s, 'fork', { success:true, now:t0 + d * DAY + i * 60000 });
  ok(s.concepts.fork.mastery >= A.MASTERED, 'mastery ' + s.concepts.fork.mastery);
});
test('failures and hints lower mastery; failure categories are counted', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const clean = A.newState(400), hinted = A.newState(400), mixed = A.newState(400);
  for (let d = 0; d < 4; d++){
    A.record(clean, 'pin', { success:true, now:t0 + d * DAY });
    A.record(hinted, 'pin', { success:true, hints:2, now:t0 + d * DAY });
    A.record(mixed, 'pin', { success:d % 2 === 0, category:d % 2 ? 'TACTICAL_MISS' : null, now:t0 + d * DAY });
  }
  ok(hinted.concepts.pin.mastery < clean.concepts.pin.mastery, 'hints');
  ok(mixed.concepts.pin.mastery < hinted.concepts.pin.mastery, 'failures');
  eq(mixed.concepts.pin.failures.TACTICAL_MISS, 2);
  eq(clean.concepts.pin.attempts, 4); eq(clean.concepts.pin.successes, 4);
});
test('solve time and hint totals are tracked', () => {
  const s = A.newState(0);
  A.record(s, 'check', { success:true, hints:1, timeMs:9000, targetMs:20000 });
  A.record(s, 'check', { success:false, hints:2, timeMs:30000, targetMs:20000 });
  eq(s.concepts.check.hintsUsed, 3); eq(s.concepts.check.totalTimeMs, 39000);
  ok(s.concepts.check.lastReviewed > 0 && s.concepts.check.nextReview > 0);
});

section('spaced review scheduling');
test('a miss comes back within minutes', () => {
  const s = A.newState(400), now = Date.UTC(2026, 0, 1);
  A.record(s, 'fork', { success:false, now });
  eq(s.concepts.fork.nextReview, now + A.RELEARN_MS);
  ok(A.isDue(s.concepts.fork, now + A.RELEARN_MS));
  ok(!A.isDue(s.concepts.fork, now + 60000));
});
test('intervals grow with each clean success', () => {
  const s = A.newState(400); let now = Date.UTC(2026, 0, 1); const gaps = [];
  for (let i = 0; i < 5; i++){ A.record(s, 'fork', { success:true, now }); gaps.push(s.concepts.fork.interval); now = s.concepts.fork.nextReview; }
  for (let i = 1; i < gaps.length; i++) ok(gaps[i] >= gaps[i-1], 'intervals ' + gaps.join(','));
  ok(gaps[gaps.length - 1] > gaps[0] * 3, 'intervals ' + gaps.join(','));
});
test('well-mastered concepts return later than shaky ones', () => {
  let now = Date.UTC(2026, 0, 1);
  const good = A.newState(400), shaky = A.newState(400);
  for (let i = 0; i < 4; i++){
    A.record(good, 'pin', { success:true, now });
    A.record(shaky, 'pin', { success:true, hints:2, now });
    if (i === 1) A.record(shaky, 'pin', { success:false, now:now + 1000 });
    now += 3 * DAY;
  }
  ok(good.concepts.pin.interval > shaky.concepts.pin.interval, good.concepts.pin.interval + ' vs ' + shaky.concepts.pin.interval);
});
test('mixed review: due concepts first, unlabeled, interleaved, no guided items', () => {
  const s = A.newState(700), t0 = Date.UTC(2026, 0, 1);
  A.record(s, 'fork', { success:false, now:t0 });
  A.record(s, 'pin', { success:true, now:t0 });
  A.record(s, 'check', { success:true, now:t0 });
  const items = A.buildReview(s, AC.pool(), { now:t0 + 2 * DAY, size:6, seed:3 });
  ok(items.length >= 4, 'size ' + items.length);
  ok(items.some(x => x.conceptId === 'fork'), 'due fork missing');
  ok(items.every(x => x.stage !== 'guided'), 'guided item in review');
  ok(items.every(x => x.showLabel === false), 'labels must be hidden');
  ok(items.some(x => x.quiet), 'no quiet position in review');
  for (let i = 1; i < items.length; i++) ok(items[i].conceptId !== items[i-1].conceptId || items.every(x => x.conceptId === items[0].conceptId), 'back-to-back ' + items[i].conceptId);
});
test('mastery test hides the lesson motif among lower-band items', () => {
  const lesson = AC.lessons['academy-fork'];
  const items = A.buildMasteryTest(lesson, AC.pool(), { own:3, others:2, seed:9 });
  eq(items.length, 5);
  ok(items.filter(x => x.conceptId === 'fork').length === 3);
  ok(items.every(x => x.showLabel === false && x.stage !== 'guided'));
  ok(items.filter(x => x.conceptId !== 'fork').every(x => (x.band || 0) <= lesson.band + 100), 'distractors above the lesson band');
  const coords = A.buildMasteryTest(AC.lessons['academy-coordinates'], AC.pool(), { own:3, others:0, seed:1 });
  ok(coords.every(x => x.kind === 'square'), 'beginner test must not contain chess positions');
});

/* ======================================================================== */
section('prerequisites and skill profile');
test('deflection is "ahead" until fork and pin are half-mastered, then "ready"', () => {
  const s = A.newState(1100), t0 = Date.UTC(2026, 0, 1);
  const c = AC.concepts.deflection;
  eq(A.conceptStatus(s, c, t0), 'ahead'); ok(!A.prereqsMet(s, c));
  for (let d = 0; d < 3; d++) ['fork','pin'].forEach(id => { A.record(s, id, { success:true, now:t0 + d * DAY }); A.record(s, id, { success:true, now:t0 + d * DAY + 1000 }); });
  ok(A.prereqsMet(s, c), 'fork ' + s.concepts.fork.mastery + ' pin ' + s.concepts.pin.mastery);
  eq(A.conceptStatus(s, c, t0 + 2 * DAY + 5000), 'ready');
});
test('topics without a lesson are "planned", and material above your rating is never locked', () => {
  const s = A.newState(0);
  eq(A.conceptStatus(s, AC.concepts.philidor), 'planned');
  ok(['ready','ahead'].indexOf(A.conceptStatus(s, AC.concepts.opposition)) >= 0);
});
test('skills move independently and the overall rating blends in placement', () => {
  const s = A.newState(800);
  for (let i = 0; i < 12; i++) A.updateSkills(s, { tactics:1 }, 1400, 1);
  ok(s.skills.tactics.rating > 1000, 'tactics ' + s.skills.tactics.rating);
  eq(s.skills.endgames.rating, 800);
  const o = A.overall(s);
  ok(o > 800 && o < s.skills.tactics.rating, 'overall ' + o);
  eq(A.skillRating(s, 'endgames'), o, 'unproven skill falls back to overall');
});
test('recording an exercise updates the skills it trains', () => {
  const s = A.newState(500);
  A.record(s, 'fork', { success:true, exerciseRating:700, skills:{ tactics:.8, calculation:.2 } });
  ok(s.skills.tactics.rating > 500 && s.skills.calculation.rating > 500 && s.skills.endgames.rating === 500);
});

/* ======================================================================== */
section('provenance and licences');
test('every lesson, exercise and claim has valid provenance', () => {
  LESSONS.concat(EXERCISES).concat(CLAIMS).forEach(r => {
    const errs = A.validateProvenance(r.provenance);
    ok(!errs.length, (r.id) + ': ' + errs.join('; '));
  });
});
test('licence rules are enforced', () => {
  const base = { sourceType:'lichess-puzzles', sourceName:'Lichess puzzle database', sourceId:'00sHx', sourceUrl:'https://database.lichess.org/',
    license:'CC0-1.0', attributionRequired:false, retrievedAt:'2026-09-17T00:00:00Z', originalOrAdapted:'imported', humanReviewed:false, notes:'' };
  eq(A.validateProvenance(base).length, 0, 'valid CC0 import');
  ok(A.validateProvenance(Object.assign({}, base, { license:'CC-BY-4.0' })).some(e => /attributionRequired/.test(e)));
  ok(A.validateProvenance(Object.assign({}, base, { license:'Research-Only' })).some(e => /does not permit/.test(e)));
  ok(A.validateProvenance(Object.assign({}, base, { license:'WTFPL' })).some(e => /unknown license/.test(e)));
  ok(A.validateProvenance(Object.assign({}, base, { sourceUrl:'' })).some(e => /sourceUrl/.test(e)));
  ok(A.validateProvenance(Object.assign({}, base, { sourceName:'Chessable course', originalOrAdapted:'adapted' })).some(e => /research only/.test(e)));
  const missing = Object.assign({}, base); delete missing.humanReviewed;
  ok(A.validateProvenance(missing).some(e => /humanReviewed/.test(e)));
});
test('every exercise records how its evaluations were verified', () => {
  EXERCISES.filter(x => x.kind !== 'square').forEach(x => ok(x.engine && x.engine.tool && x.engine.checked, x.id));
});

/* ======================================================================== */
section('educational quality + puzzle queries');
test('a clean one-motif puzzle outscores a messy one at the same rating', () => {
  const clean = A.EduQuality.fromLichess({ fen:'r2q3k/6pp/8/6N1/8/8/5PPP/6K1 w - - 0 1', moves:['h2h3','g5f7','h8g8','f7d8'], themes:['fork','short'], rating:734, ratingDeviation:75, popularity:95 });
  const messy = A.EduQuality.fromLichess({ fen:'r1b2rk1/pp1nqppp/2p1pn2/3p4/2PP4/2NBPN2/PPQ2PPP/R3K2R w KQ - 0 1', moves:['a1a2','c4d5','e6d5','c3d5','f6d5','d3h7','g8h7','c2h7'], themes:['fork','pin','deflection','sacrifice','long'], rating:734, ratingDeviation:130, popularity:40 });
  ok(clean.score > messy.score + .15, clean.score + ' vs ' + messy.score);
  eq(clean.calculationDepth, 2);
  A.EduQuality.FIELDS.forEach(f => ok(f in clean, 'missing ' + f));
});
test('puzzle query filters by rating, motif, phase, length, popularity and quality', () => {
  const p = { rating:734, themes:['fork','middlegame'], openingTags:['Italian_Game'], moves:['a','b','c','d'], popularity:95, nbPlays:900, quality:{ score:.8, calculationDepth:2 } };
  ok(A.PuzzleQuery.matches(p, { ratingMin:700, ratingMax:800, motif:'fork', phase:'middlegame', solutionLength:2, popularityMin:90, playsMin:500, qualityMin:.7, opening:'Italian_Game', calculationDepthMax:2 }));
  ok(!A.PuzzleQuery.matches(p, { motif:'pin' }));
  ok(!A.PuzzleQuery.matches(p, { ratingMin:800 }));
  ok(!A.PuzzleQuery.matches(p, { qualityMin:.9 }));
});

/* ======================================================================== */
section('live engine judgement');
/* Scores are handed in, so these tests never need the engine itself; what
   they pin down is what the numbers are allowed to change. */
const CAP = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
const liveOf = (o) => Object.assign({ cpBefore:0, mateBefore:null, cpAfter:0, mateAfter:null, best:null, bestSan:null }, o);
const judgeLiveUci = (ex, u, r, live) => {
  const pos = Rules.parse(ex.fen);
  const res = A.judge(ex, pos, Rules.coerce(pos, u), r);
  return A.judgeLive(res, ex, r, live);
};

test('an unlisted sound move becomes a retry instead of a failure', () => {
  const ex = { id:'t-live-1', conceptId:'fork', fen:CAP, policy:'target',
               candidates:[{ move:'e1e2', engineEval:20 }],
               fallback:{ feedback:'We are practising the capture.' } };
  const plain = judgeUci(ex, 'e1d2', 900);
  eq(plain.outcome, 'fail', 'without the engine it is a failure');
  const live = judgeLiveUci(ex, 'e1d2', 900, liveOf({ cpBefore:60, cpAfter:55, best:'e4d5', bestSan:'exd5' }));
  eq(live.outcome, 'retry');
  eq(live.category, 'PLAYABLE_NOT_BEST');
  ok(/^The engine /.test(live.text), live.text);
  ok(/practising the capture/.test(live.text), 'keeps the authored line: ' + live.text);
});
test('an authored fallback outcome is never overridden by the engine', () => {
  const ex = { id:'t-live-2', conceptId:'fork', fen:CAP, policy:'target',
               candidates:[{ move:'e4d5', engineEval:120 }],
               fallback:{ outcome:'fail', category:'MISSED_OBJECTIVE', feedback:'Take the pawn.' } };
  const res = judgeLiveUci(ex, 'e1d2', 900, liveOf({ cpBefore:60, cpAfter:58 }));
  eq(res.outcome, 'fail');
  eq(res.category, 'MISSED_OBJECTIVE');
  ok(res.liveNote && /^The engine /.test(res.liveNote), res.liveNote);
});
test('a goal-meeting move that throws the game away still fails', () => {
  const ex = { id:'t-live-3', conceptId:'fork', fen:CAP, policy:'target',
               goal:{ type:'capture' }, candidates:[], fallback:{} };
  const pass = judgeUci(ex, 'e4d5', 900);
  ok(pass.outcome === 'accepted', 'the goal alone accepts it: ' + pass.outcome);
  const res = judgeLiveUci(ex, 'e4d5', 900, liveOf({ cpBefore:300, cpAfter:-400, best:'e1e2', bestSan:'Ke2' }));
  eq(res.outcome, 'fail');
  eq(res.category, 'TACTICAL_MISS');
  ok(/blunder/.test(res.text) && /Ke2/.test(res.text), res.text);
});
test('a mistake-sized cost on a passing move fails as a positional inaccuracy', () => {
  const ex = { id:'t-live-4', conceptId:'fork', fen:CAP, policy:'target',
               goal:{ type:'capture' }, candidates:[], fallback:{} };
  const res = judgeLiveUci(ex, 'e4d5', 1200, liveOf({ cpBefore:120, cpAfter:-60, best:'e1e2', bestSan:'Ke2' }));
  eq(res.outcome, 'fail');
  eq(res.category, 'POSITIONAL_INACCURACY');
});
test('authored candidates are left alone', () => {
  const ex = { id:'t-live-5', conceptId:'fork', fen:CAP, policy:'target',
               candidates:[{ move:'e4d5', engineEval:120, feedback:'Yes — the pawn is free.' }], fallback:{} };
  const res = judgeLiveUci(ex, 'e4d5', 900, liveOf({ cpBefore:300, cpAfter:-400 }));
  eq(res.outcome, 'correct');
  ok(!res.live, 'no live verdict on an authored move');
});
test('inside a decided position a small drop is not a blunder', () => {
  const sc = A.liveScore(liveOf({ cpBefore:900, cpAfter:600 }), 1200);
  ok(sc.sound, sc.label + ' drop ' + sc.drop.toFixed(1));
  const real = A.liveScore(liveOf({ cpBefore:100, cpAfter:-400 }), 1200);
  eq(real.label, 'BLUNDER');
});
test('tolerance still scales with rating', () => {
  const live = liveOf({ cpBefore:60, cpAfter:0 });
  ok(A.liveScore(live, 400).sound, 'forgiving at 400: ' + A.liveScore(live, 400).label);
  ok(!A.liveScore(live, 2100).sound, 'strict at 2100: ' + A.liveScore(live, 2100).label);
});
test('win percentages are shown from 1600 and hidden below it', () => {
  const sc = A.liveScore(liveOf({ cpBefore:100, cpAfter:-400 }), 1600);
  ok(/%/.test(A.liveText(sc, 1600)), A.liveText(sc, 1600));
  ok(!/%/.test(A.liveText(sc, 900)), A.liveText(sc, 900));
});
test('a missing or half-missing score changes nothing', () => {
  const ex = { id:'t-live-6', conceptId:'fork', fen:CAP, policy:'target',
               candidates:[{ move:'e4d5', engineEval:120 }], fallback:{} };
  ['none', 'half'].forEach(k => {
    const live = k === 'none' ? liveOf({ cpBefore:null, cpAfter:null }) : liveOf({ cpBefore:60, cpAfter:null });
    const res = judgeLiveUci(ex, 'e1d2', 900, live);
    eq(res.outcome, 'fail', k);
    ok(!res.live, k + ': no live verdict');
  });
  eq(A.judgeLive(null, ex, 900, liveOf({})), null);
});

/* ======================================================================== */
section('placement test');
const POOL = AC.pool();
/* A simulated learner: solves an item with the same logistic curve the
   estimator assumes, deterministically per seed. */
function simulate(truth, seed, opts){
  const s = A.placementStart(Object.assign({ seed }, opts || {}));
  let ex, k = 0;
  while ((ex = A.placementNext(s, POOL))){
    const r = A.exerciseRating(ex);
    const p = 1 / (1 + Math.pow(10, (r - truth) / 400));
    A.placementAnswer(s, ex, ((seed * 137 + (k++) * 41) % 100) / 100 < p);
  }
  return { s, res:A.placementResult(s) };
}
test('a placement lands near a simulated learner of known strength', () => {
  [[200, 350], [500, 350], [900, 300]].forEach(([truth, slack]) => {
    for (let seed = 1; seed <= 5; seed++){
      const { res } = simulate(truth, seed);
      ok(Math.abs(res.rating - truth) <= slack, 'truth ' + truth + ' seed ' + seed + ' gave ' + res.rating);
    }
  });
});
test('it asks between min and size questions and stops early on a tight bracket', () => {
  const { s } = simulate(900, 3);
  ok(s.asked.length >= A.PLACEMENT.min && s.asked.length <= A.PLACEMENT.size, s.asked.length + ' asked');
  ok(s.done, 'session finished');
  const long = simulate(900, 3, { min:9, size:9 });
  eq(long.s.asked.length, 9);
});
test('no item is repeated, and guided items are never used', () => {
  const { s } = simulate(700, 2, { size:9, min:9 });
  eq(new Set(s.asked).size, s.asked.length, 'repeated item');
  s.asked.forEach(id => ok(AC.exercises[id].stage !== 'guided', id + ' is a guided item'));
});
test('a concept is not asked twice while untouched concepts remain', () => {
  const { s } = simulate(700, 4, { size:9, min:9 });
  const concepts = s.answers.map(a => a.conceptId);
  const pool = new Set(POOL.filter(x => x.stage !== 'guided').map(x => x.conceptId));
  if (concepts.length <= pool.size) eq(new Set(concepts).size, concepts.length, concepts.join(','));
});
test('solving everything reports a ceiling instead of certainty', () => {
  const s = A.placementStart({ seed:9 });
  let ex;
  while ((ex = A.placementNext(s, POOL))) A.placementAnswer(s, ex, true);
  const res = A.placementResult(s);
  ok(res.ceiling && !res.floor, JSON.stringify({ c:res.ceiling, f:res.floor }));
  ok(res.rating >= res.hardest - 50, res.rating + ' vs hardest ' + res.hardest);
  eq(res.solved, res.asked);
});
test('missing everything places the learner at the very beginning', () => {
  const s = A.placementStart({ seed:9 });
  let ex;
  while ((ex = A.placementNext(s, POOL))) A.placementAnswer(s, ex, false);
  const res = A.placementResult(s);
  ok(res.floor && !res.ceiling);
  eq(res.rating, 0);
  eq(res.band.rating, 0);
});
test('one lucky answer cannot swing the estimate across the range', () => {
  const s = A.placementStart({ seed:5, start:700 });
  const hard = POOL.filter(x => x.stage !== 'guided').sort((a, b) => A.exerciseRating(b) - A.exerciseRating(a))[0];
  A.placementAnswer(s, hard, true);
  ok(A.placementResult(s).rating <= A.exerciseRating(hard) + 200, String(A.placementResult(s).rating));
});
test('the result tallies which skills it actually saw', () => {
  const { s, res } = simulate(900, 1);
  const seen = {};
  s.answers.forEach(a => Object.keys(a.skills).forEach(k => { seen[k] = (seen[k] || 0) + 1; }));
  Object.keys(seen).forEach(k => eq(res.skills[k].n, seen[k], k));
  Object.keys(res.skills).forEach(k => ok(res.skills[k].hit <= res.skills[k].n, k));
});
test('the fit is a real maximum, not a walk that depends on order', () => {
  const answers = [{ rating:200, success:true }, { rating:600, success:true }, { rating:900, success:false }];
  const fit = A.placementFit(answers, 700);
  const reversed = A.placementFit(answers.slice().reverse(), 700);
  eq(fit, reversed, 'order changed the estimate');
  ok(fit > 200 && fit < 900, String(fit));
});

/* ======================================================================== */
section('imported review items');
const IMPORTED = EXERCISES.filter(x => /^pz-/.test(x.id));
test('imported items exist and belong to concepts the lessons teach', () => {
  ok(IMPORTED.length >= 6, IMPORTED.length + ' imported');
  IMPORTED.forEach(x => ok(!!AC.lessonFor(x.conceptId), x.id + ' has no lesson for ' + x.conceptId));
});
test('every imported answer is legal and is the item it claims to be', () => {
  IMPORTED.forEach(x => {
    const pos = Rules.parse(x.fen);
    x.candidates.forEach(c => ok(legal(pos, c.move), x.id + ': illegal candidate ' + c.move));
    const best = x.candidates[0];
    eq(best.engineRank, 1, x.id + ' first candidate is not the engine move');
    const res = A.judge(x, pos, Rules.coerce(pos, best.move), x.rating);
    eq(res.outcome, 'correct', x.id + ': ' + res.text);
  });
});
test('an imported item names the motif from the position, in squares that exist', () => {
  IMPORTED.forEach(x => {
    const pos = Rules.parse(x.fen);
    const squares = (x.success.match(/\b[a-h][1-8]\b/g) || []);
    ok(squares.length >= 1, x.id + ': the explanation names no square');
    squares.forEach(s => {
      if (s === Rules.name(Rules.coerce(pos, x.candidates[0].move).to)) return;
      ok(!!Rules.apply(pos, Rules.coerce(pos, x.candidates[0].move)).board[Rules.idx(s)],
         x.id + ': ' + x.success + ' names empty square ' + s);
    });
  });
});
test('a second-best move is not also accepted', () => {
  IMPORTED.forEach(x => {
    const pos = Rules.parse(x.fen);
    x.candidates.slice(1).forEach(c => {
      const res = A.judge(x, pos, Rules.coerce(pos, c.move), x.rating);
      ok(res.outcome !== 'correct' && res.outcome !== 'accepted', x.id + ': ' + c.move + ' passed as ' + res.outcome);
    });
  });
});
test('imported provenance is CC0, links the source and is not claimed as original', () => {
  IMPORTED.forEach(x => {
    eq(A.validateProvenance(x.provenance).length, 0, x.id + ': ' + A.validateProvenance(x.provenance).join('; '));
    eq(x.provenance.license, 'CC0-1.0', x.id);
    eq(x.provenance.originalOrAdapted, 'imported', x.id);
    eq(x.provenance.humanReviewed, false, x.id);
    ok(/lichess\.org/.test(x.provenance.sourceUrl), x.id + ': ' + x.provenance.sourceUrl);
    ok(x.engine && x.engine.depth >= 16 && x.engine.multipv >= 2, x.id + ': ' + JSON.stringify(x.engine));
  });
});
test('imported items reach mixed review but never pose as guided lessons', () => {
  IMPORTED.forEach(x => ok(x.stage !== 'guided', x.id));
  const state = A.newState(800);
  IMPORTED.forEach(x => { A.record(state, x.conceptId, { success:false, category:'TACTICAL_MISS', hints:0, timeMs:9000, targetMs:30000, exerciseRating:x.rating, skills:x.skills }); });
  const items = A.buildReview(state, AC.pool(), { size:6, now:Date.now() + 20 * 60 * 1000, seed:3 });
  ok(items.length > 0, 'review built nothing');
  ok(items.every(i => i.showLabel === false || i.showLabel === undefined), 'a review item carried a label');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
