/* Turn imported Lichess puzzles into Academy review exercises.

   The importers in this folder produce raw puzzle rows. This tool is the step
   that makes them usable as teaching material. Only the first answer move is
   judged, so a kept line is at most two solver moves long:

     1. query the shards for one motif, band and quality floor
     2. rebuild the position the learner actually sees (a Lichess puzzle's FEN
        is BEFORE the opponent's move: moves[0] is theirs, moves[1] is the
        answer)
     3. re-score it with the bundled engine at MultiPV, and keep it only if the
        puzzle's answer is the engine's own first choice by a clear margin, so
        a review item never has two right answers
     4. describe the motif from the position itself — which pieces the answer
        attacks, what a pin is pinning — so the feedback states facts that were
        checked, not a guess
     5. write the verified items to content/academy/imported/<motif>.json and
        regenerate the SECTION 34b block in index.html

   Everything is cached in content/academy/imported/cache.json, so a rebuild
   needs neither the 2 GB of shards nor the engine.

     node tools/import/puzzle-exercises.js --motif fork --concept fork \
          --rating 500-800 --count 4
     node tools/import/puzzle-exercises.js --rebuild        # from the JSON only

   Options: --motif, --concept, --rating MIN-MAX, --count N, --scan N,
            --quality 0..1, --popularity N, --depth N, --stage, --nocheck, --variety,
            --rebuild, --check (do not touch index.html) */
const fs = require('fs');
const path = require('path');
const { load, HTML } = require('../lib/app.js');
const { Engine } = require('../lib/engine.js');
const { query } = require('./query-puzzles.js');
const C = require('./common.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'content', 'academy', 'imported');
const argv = process.argv.slice(2);
const flag = k => argv.indexOf(k) >= 0;
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const get = load(['SECTION 13 — RULES LAYER', 'SECTION 33 — ACADEMY MODEL']);
const Rules = get('Rules'), A = get('Academy');
const DEPTH = +opt('--depth', 18), MULTIPV = 4;
const TODAY = new Date().toISOString().slice(0, 10);

const NAMES = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };
const typeOf = p => p.toLowerCase();
const isW = p => p === p.toUpperCase();
const sq = i => Rules.name(i);

/* ------------------------------------------------------------------ cache */
const CACHE = path.join(OUT, 'cache.json');
function readJSON(p, d){ try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e){ return d; } }
const cache = readJSON(CACHE, {});
function writeCache(){
  fs.mkdirSync(OUT, { recursive:true });
  const sorted = {}; Object.keys(cache).sort().forEach(k => { sorted[k] = cache[k]; });
  fs.writeFileSync(CACHE, JSON.stringify(sorted, null, 0).replace(/,"/g, ',\n"') + '\n');
}

let engine = null;
async function multipv(fen){
  const key = 'mpv|' + fen.split(' ').slice(0, 4).join(' ') + '|' + DEPTH + '|' + MULTIPV;
  if (!cache[key]){
    if (!engine) engine = new Engine({ hash:64 });
    const lines = await engine.analyse(fen, { depth:DEPTH, multipv:MULTIPV });
    cache[key] = lines.map(l => ({ move:l.move, cp:l.cp, mate:l.mate }));
  }
  return cache[key];
}

/* ------------------------------------------------- describing the position */
/** Enemy pieces the piece that just moved now attacks, worst first. Facts
    only: what the board says after the move. */
function targets(pos, mv){
  const after = Rules.apply(pos, mv);
  const mover = after.board[mv.to];
  if (!mover) return [];
  const white = isW(mover);
  return A.attacksFrom(after.board, mv.to)
    .filter(i => after.board[i] && isW(after.board[i]) !== white)
    .map(i => ({ sq:i, piece:typeOf(after.board[i]), name:NAMES[typeOf(after.board[i])],
                 value:A.VALUE[typeOf(after.board[i])],
                 defended: A.attackers(after.board, i, !white).length > 0 }))
    .sort((a, b) => b.value - a.value);
}
const list = xs => xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/** One sentence about what the answer does, or null when the position does
    not actually show the motif — in which case the puzzle is dropped. */
function describe(motif, pos, mv){
  const after = Rules.apply(pos, mv);
  const mover = after.board[mv.to], moverName = NAMES[typeOf(mover)];
  const hit = targets(pos, mv);
  const inCheck = Rules.inCheck(after, after.turn === 'w');
  if (motif === 'fork'){
    const real = hit.filter(t => t.piece === 'k' || !t.defended || t.value > A.VALUE[typeOf(mover)]);
    if (real.length < 2) return null;
    return 'The ' + moverName + ' attacks ' +
           list(real.slice(0, 3).map(t => 'the ' + t.name + ' on ' + sq(t.sq))) +
           ' at the same time' + (inCheck ? ', and the check has to be answered first' : '') + '.';
  }
  if (motif === 'pin'){
    const pins = A.pinsBy(after, mv.to);
    if (!pins.length) return null;
    const p = pins[0];
    return 'The ' + NAMES[typeOf(after.board[p.pinned])] + ' on ' + sq(p.pinned) + ' cannot move without exposing the ' +
           NAMES[typeOf(after.board[p.behind])] + ' on ' + sq(p.behind) + ' behind it' +
           (p.absolute ? ', and against the king that is not even legal' : '') + '.';
  }
  if (motif === 'hangingPiece'){
    const taken = pos.board[mv.to];
    if (!taken) return null;
    return 'The ' + NAMES[typeOf(taken)] + ' on ' + sq(mv.to) + ' was not defended, so it costs nothing to take it.';
  }
  return hit.length ? 'The ' + moverName + ' now attacks the ' + hit[0].name + ' on ' + sq(hit[0].sq) + '.' : null;
}

const LABEL = { fork:'Find the fork', pin:'Find the pin', hangingPiece:'Win the loose piece' };
const HINTS = {
  fork: [{ text:'One move creates two threats at once. Which piece can hit two things from one square?' },
         { text:'The piece that does it starts here.', show:'from' }],
  pin:  [{ text:'Look for an enemy piece standing in front of something more valuable.' },
         { text:'The piece that does the pinning starts here.', show:'from' }],
  hangingPiece: [{ text:'Something is loose. Count the defenders before you count the attackers.' },
                 { text:'It starts here.', show:'from' }]
};

/* ------------------------------------------------------------ verification */
const winPct = l => A.winPct(l.cp == null ? null : l.cp, l.mate == null ? null : l.mate);

async function verify(p, o){
  const start = Rules.parse(p.fen);
  const setup = Rules.coerce(start, p.moves[0]);
  if (!setup || Rules.moves(start, setup.from).indexOf(setup.to) < 0) return { skip:'setup move illegal' };
  const pos = Rules.apply(start, setup);
  const fen = Rules.toFEN(pos);
  const answer = Rules.coerce(pos, p.moves[1]);
  if (!answer || Rules.moves(pos, answer.from).indexOf(answer.to) < 0) return { skip:'answer illegal' };
  const afterAnswer = Rules.apply(pos, answer);
  const check = Rules.inCheck(afterAnswer, afterAnswer.turn === 'w');
  /* the shape of the tactic: which piece does it, and with or without check.
     Beginner fork puzzles are overwhelmingly knight checks, so --variety keeps
     one of each shape instead of six of the same one. */
  const shape = typeOf(pos.board[answer.from]) + (check ? '+' : '');

  /* variety: a knight check that forks the king is the one shape the fork
     lesson already drills, so --nocheck asks for the other kind. Checked
     before the engine call, which is the expensive part. */
  if (o.noCheck && check) return { skip:'answer is a check' };
  if (o.variety && o.shapes[shape]) return { skip:'already have a ' + shape.replace('+', ' check') + ' example' };

  const lines = await multipv(fen);
  if (!lines.length || !lines[0].move) return { skip:'no engine lines' };
  if (lines[0].move !== p.moves[1]) return { skip:'engine prefers ' + lines[0].move };
  const gap = lines[1] ? winPct(lines[0]) - winPct(lines[1]) : 100;
  if (gap < (o.gap == null ? 10 : o.gap)) return { skip:'second move only ' + gap.toFixed(1) + '% worse' };

  const motifText = describe(o.motif, pos, answer);
  if (!motifText) return { skip:'position does not show the ' + o.motif };

  const san = Rules.san(pos, answer);
  const alts = lines.slice(1, 3).filter(l => {
    const m = Rules.coerce(pos, l.move);
    return m && Rules.moves(pos, m.from).indexOf(m.to) >= 0;
  }).map(l => {
    const m = Rules.coerce(pos, l.move);
    return { move:l.move, engineRank:l.rank || null, engineEval:l.cp == null ? null : l.cp, mateScore:l.mate,
             san:Rules.san(pos, m), drop:winPct(lines[0]) - winPct(l) };
  });

  return { fen, pos, answer, san, lines, alts, motifText, gap, shape };
}

/* -------------------------------------------------------- exercise objects */
function toExercise(p, v, o){
  const best = v.lines[0];
  const cands = [{
    move:p.moves[1], engineRank:1,
    engineEval: best.cp == null ? null : best.cp, mateScore: best.mate == null ? null : best.mate,
    conceptAlignment:1, pedagogicalQuality: p.quality.score,
    calculationDepth: p.quality.calculationDepth || 1,
    feedback:'Correct — ' + v.san + '. ' + v.motifText
  }];
  v.alts.forEach(a => cands.push({
    move:a.move, engineRank:a.engineRank,
    engineEval: a.engineEval, mateScore: a.mateScore == null ? null : a.mateScore,
    conceptAlignment:0,
    category:'TACTICAL_MISS',
    feedback:'Not ' + a.san + '. It is a legal move, but it lets the position go: ' + v.san +
             ' was there, and ' + v.motifText.charAt(0).toLowerCase() + v.motifText.slice(1),
    whyBetter:v.san + ' wins material on the spot.'
  }));
  return {
    id:'pz-' + o.concept + '-' + p.id,
    conceptId:o.concept, stage:o.stage, band:Math.round(p.rating / 100) * 100, rating:p.rating,
    fen:v.fen, orientation:v.pos.turn === 'w' ? 'white' : 'black',
    label:LABEL[o.motif] || 'Find the best move',
    prompt:(v.pos.turn === 'w' ? 'White' : 'Black') + ' to move. What would you play?',
    policy:'target',
    hints:HINTS[o.motif] || [{ text:'Look at every capture and every check first.' }],
    candidates:cands,
    success:'Correct — ' + v.san + '. ' + v.motifText,
    fallback:{ outcome:'fail', category:'TACTICAL_MISS',
               feedback:'There is a move here that wins material outright. Look at every capture and every check first.' },
    provenance:{
      sourceType:'lichess-puzzles', sourceName:'Lichess puzzle database', sourceId:p.id,
      sourceUrl:p.gameUrl || 'https://lichess.org/training/' + p.id,
      license:'CC0-1.0', attributionRequired:false, retrievedAt:TODAY,
      originalOrAdapted:'imported', humanReviewed:false,
      notes:'Position from the CC0 Lichess puzzle database. Re-scored here at depth ' + DEPTH +
            ' (MultiPV ' + MULTIPV + '); kept only because the puzzle answer is the engine\'s first choice and the ' +
            'runner-up is ' + v.gap.toFixed(0) + ' win% worse. The explanation is generated from the position itself.'
    },
    engine:{ tool:'stockfish-18-lite-single', depth:DEPTH, multipv:MULTIPV, checked:TODAY },
    source:{ puzzleId:p.id, rating:p.rating, themes:p.themes, quality:p.quality.score, popularity:p.popularity }
  };
}

/* ------------------------------------------------------------------- emit */
function emit(all){
  const body =
    '"use strict";\n' +
    '/* ============================================================================\n' +
    '   SECTION 34b — IMPORTED REVIEW ITEMS\n' +
    '   GENERATED by tools/import/puzzle-exercises.js from the CC0 Lichess puzzle\n' +
    '   database (content/academy/imported/*.json). Do not edit by hand.\n' +
    '   Every position was re-scored with the bundled engine and kept only where\n' +
    '   the puzzle\'s answer is the engine\'s own first choice by a clear margin.\n' +
    '   ========================================================================== */\n' +
    'const ACADEMY_IMPORTED = [\n' + all.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n];\n';
  const block = '<script>\n' + body + '</script>\n';
  let html = fs.readFileSync(HTML, 'utf8');
  const re = /<script>\n"use strict";\n\/\* =+\n   SECTION 34b — IMPORTED REVIEW ITEMS[\s\S]*?<\/script>\n/;
  if (re.test(html)) html = html.replace(re, () => block);
  else {
    const anchor = '<script>\n"use strict";\n/* ============================================================================\n   SECTION 34 — ACADEMY CURRICULUM';
    if (html.indexOf(anchor) < 0) throw new Error('SECTION 34 anchor not found');
    html = html.replace(anchor, () => block + anchor);
  }
  fs.writeFileSync(HTML, html);
}

function collect(){
  fs.mkdirSync(OUT, { recursive:true });
  return fs.readdirSync(OUT).filter(f => f.endsWith('.json') && f !== 'cache.json')
    .sort()
    .flatMap(f => readJSON(path.join(OUT, f), { exercises:[] }).exercises || []);
}

(async () => {
  if (flag('--rebuild')){
    const all = collect();
    console.log(all.length + ' imported exercises');
    if (!flag('--check')) emit(all);
    return console.log('index.html updated');
  }
  const motif = opt('--motif', 'fork');
  const o = { motif, concept:opt('--concept', motif), stage:opt('--stage', 'review'),
              count:+opt('--count', 4), gap: opt('--gap') ? +opt('--gap') : 10,
              noCheck:flag('--nocheck'), variety:flag('--variety'), shapes:{} };
  const [rmin, rmax] = String(opt('--rating', '500-800')).split('-').map(Number);
  const q = { ratingMin:rmin, ratingMax:rmax, motif, popularityMin:+opt('--popularity', 90),
              qualityMin:+opt('--quality', .8), playsMin:500 };
  const dir = path.join(C.DATA, 'puzzles');
  console.log('querying ' + motif + ' ' + rmin + '-' + rmax + ' …');
  const hits = await query(dir, q, +opt('--scan', 60));
  console.log('  ' + hits.total + ' candidates, checking the top ' + hits.results.length + ' with the engine');

  const kept = [], skipped = {};
  for (const p of hits.results){
    if (kept.length >= o.count) break;
    /* Only the first answer move is judged, so the whole line has to be
       short: two solver moves at most, and no deep calculation. */
    if (p.moves.length < 2 || p.moves.length > 4){ skipped['line too long to judge one move'] = (skipped['line too long to judge one move'] || 0) + 1; continue; }
    if ((p.quality.calculationDepth || 1) > 2){ skipped['needs more than two moves of calculation'] = (skipped['needs more than two moves of calculation'] || 0) + 1; continue; }
    if (p.themes.indexOf('mate') >= 0 && motif !== 'mate'){ skipped['mate, not material'] = (skipped['mate, not material'] || 0) + 1; continue; }
    let v;
    try { v = await verify(p, o); }
    catch (e){ skipped['threw: ' + e.message] = (skipped['threw: ' + e.message] || 0) + 1; continue; }
    if (v.skip){ skipped[v.skip.replace(/[a-h][1-8][a-h][1-8]/, 'another move')] = (skipped[v.skip.replace(/[a-h][1-8][a-h][1-8]/, 'another move')] || 0) + 1; continue; }
    const ex = toExercise(p, v, o);
    o.shapes[v.shape] = true;
    kept.push(ex);
    console.log('  ✓ ' + ex.id + '  ' + p.rating + '  ' + v.san + ' — ' + v.motifText);
  }
  writeCache();
  if (engine) engine.quit();
  Object.keys(skipped).sort().forEach(k => console.log('  · skipped ' + skipped[k] + ': ' + k));
  if (!kept.length) return console.log('nothing kept');

  const file = path.join(OUT, o.concept + '.json');
  const prev = readJSON(file, { exercises:[] });
  const byId = {};
  (prev.exercises || []).concat(kept).forEach(x => { byId[x.id] = x; });
  const exercises = Object.keys(byId).sort().map(k => byId[k]);
  fs.writeFileSync(file, JSON.stringify({ motif, concept:o.concept, generated:TODAY, exercises }, null, 1) + '\n');
  console.log(kept.length + ' new, ' + exercises.length + ' total in ' + path.relative(ROOT, file));
  if (!flag('--check')){ emit(collect()); console.log('index.html updated'); }
})();
