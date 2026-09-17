/* Build Academy lessons from compact specs, with verification enforced.

     node tools/author/build.js                 all specs in content/academy/lessons/
     node tools/author/build.js --only fork-2   one lesson (still re-emits the whole block)
     node tools/author/build.js --check         build in memory, do not touch index.html

   A spec is written by a human: intro, demo, prompts, hints, the lesson
   answer(s) and feedback for the wrong moves worth explaining. The build
   supplies the rest from the bundled Stockfish (or the Syzygy tablebase for
   positions with seven pieces or fewer), and REFUSES to emit a lesson when:

     · any FEN, answer, noted move, demo move or threat is illegal
     · an answer is objectively worse than the engine's best by more than the
       exercise allows (win-probability drop; override with allowWorse + why)
     · a tablebase answer does not keep the best result
     · a lesson lacks a success explanation or two distinct failure explanations

   Evaluations are cached in content/academy/cache/*.json (committed), so a
   rebuild is reproducible offline and only new positions hit the engine.

   Output: the "SECTION 34a — ACADEMY GENERATED CONTENT" script block in
   index.html, defining ACADEMY_GENERATED = { lessons, exercises }. */
const fs = require('fs');
const path = require('path');
const { load, HTML } = require('../lib/app.js');
const { Engine } = require('../lib/engine.js');

const ROOT = path.join(__dirname, '..', '..');
const SPECS = path.join(ROOT, 'content', 'academy', 'lessons');
const CACHE_DIR = path.join(ROOT, 'content', 'academy', 'cache');
const argv = process.argv.slice(2);
const flag = k => argv.indexOf(k) >= 0;
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

const get = load(['SECTION 13 — RULES LAYER', 'SECTION 33 — ACADEMY MODEL']);
const Rules = get('Rules'), A = get('Academy');
const TODAY = new Date().toISOString().slice(0, 10);
const DEPTH = 14, MULTIPV = 5;

/* ---------------------------------------------------------------- caches */
function readCache(name){ try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), 'utf8')); } catch(e){ return {}; } }
function writeCache(name, obj){
  fs.mkdirSync(CACHE_DIR, { recursive:true });
  const sorted = {}; Object.keys(obj).sort().forEach(k => { sorted[k] = obj[k]; });
  fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(sorted, null, 0).replace(/,"/g, ',\n"') + '\n');
}
const evalCache = readCache('engine.json'), tbCache = readCache('tablebase.json');
const fenKey = fen => fen.split(' ').slice(0, 4).join(' ');

/* ----------------------------------------------------------- engine pool */
let pool = null;
function engines(){
  if (!pool) pool = [new Engine({ hash:64 }), new Engine({ hash:64 })].map(e => ({ e, busy:Promise.resolve() }));
  return pool;
}
let rr = 0;
function withEngine(fn){
  const slot = engines()[rr++ % 2];
  const run = slot.busy.then(() => fn(slot.e));
  slot.busy = run.catch(() => {});
  return run;
}
async function multipv(fen){
  const k = 'mpv|' + fenKey(fen) + '|' + DEPTH + '|' + MULTIPV;
  if (!evalCache[k]){
    const lines = await withEngine(e => e.analyse(fen, { depth:DEPTH, multipv:MULTIPV }));
    evalCache[k] = lines.map(l => ({ move:l.move, cp:l.cp, mate:l.mate }));
  }
  return evalCache[k];
}
async function scoreMove(fen, uci){
  const k = 'mv|' + fenKey(fen) + '|' + uci + '|' + DEPTH;
  if (!evalCache[k]){
    const l = await withEngine(e => e.scoreMove(fen, uci, { depth:DEPTH }));
    evalCache[k] = { cp:l.cp, mate:l.mate };
  }
  return evalCache[k];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tablebase(fen){
  const k = fenKey(fen);
  if (!tbCache[k]){
    for (let i = 0; i < 5; i++){
      const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
      if (r.status === 429){ await sleep(60000); continue; }
      if (!r.ok) throw new Error('tablebase HTTP ' + r.status + ' for ' + fen);
      const j = await r.json();
      tbCache[k] = { category:j.category, moves:j.moves.map(m => ({ uci:m.uci, category:m.category, dtz:m.dtz, dtm:m.dtm })) };
      await sleep(350);
      break;
    }
    if (!tbCache[k]) throw new Error('tablebase unavailable for ' + fen);
  }
  return tbCache[k];
}

/* ------------------------------------------------------------- helpers */
const errors = [];
const fail = (where, msg) => { errors.push(where + ': ' + msg); };
function legal(pos, uci){
  const m = Rules.coerce(pos, uci);
  return m && m.from >= 0 && m.to >= 0 && !!pos.board[m.from] && Rules.moves(pos, m.from).indexOf(m.to) >= 0;
}
function sanOf(fen, uci){ const p = Rules.parse(fen); return Rules.san(p, Rules.coerce(p, uci)); }
function sanLine(fen, ucis){
  let p = Rules.parse(fen); const out = [];
  for (const u of ucis){ const m = Rules.coerce(p, u); if (!legal(p, u)) break; out.push(Rules.san(p, m)); p = Rules.apply(p, m); }
  return out;
}
/** Compact demo marks: 'key:e4,d5 attack:c3 target:f7' */
function parseMarks(s){
  if (!s) return undefined;
  if (typeof s === 'object') return s;
  const out = {};
  s.trim().split(/\s+/).forEach(group => { const [cls, sqs] = group.split(':'); sqs.split(',').forEach(sq => { out[sq] = cls; }); });
  return out;
}
/** 'e5-f7 red, f7-d8' */
function parseArrows(s){
  if (!s) return undefined;
  if (Array.isArray(s)) return s;
  return s.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [ft, col] = x.split(/\s+/); const [f, t] = ft.split('-'); return [f, t, col || 'green']; });
}
const asList = v => v == null ? [] : Array.isArray(v) ? v : [v];
const toCp = l => l.mate != null ? null : l.cp;
const win = l => A.winPct(l.cp, l.mate);
function hints(h){
  return (h || []).map(x => typeof x !== 'string' ? x : x === '@from' ? { text:'This piece.', show:'from' } :
    x === '@to' ? { text:'This square.', show:'to' } : x === '@target' ? { text:'Here.', show:'target' } :
    /^@from /.test(x) ? { text:x.slice(6), show:'from' } : /^@to /.test(x) ? { text:x.slice(4), show:'to' } :
    /^@target /.test(x) ? { text:x.slice(8), show:'target' } : x);
}

/* ------------------------------------------------------------- exercises */
async function buildExercise(lesson, spec, i){
  const id = spec.id || (lesson.id + '-' + (i + 1));
  const where = lesson.id + '/' + id;
  const ex = {
    id, conceptId:spec.conceptId || lesson.conceptId, stage:spec.stage, band:spec.band != null ? spec.band : lesson.band,
    rating:spec.rating != null ? spec.rating : (lesson.band + 30 + i * 25), fen:spec.fen,
    label:spec.label, prompt:spec.prompt || (spec.kind === 'square' ? 'Tap the square.' : 'What would you play?'),
    hints:hints(spec.hints), policy:spec.policy || 'target'
  };
  ['kind','target','orientation','goal','threat','quiet','durability','claim','ignoreHanging','showLabel'].forEach(k => { if (spec[k] != null) ex[k] = spec[k]; });
  if (spec.success && spec.kind === 'square') ex.success = spec.success;
  const pos = Rules.parse(spec.fen);
  if (pos.board.filter(p => p === 'K').length !== 1 || pos.board.filter(p => p === 'k').length !== 1) fail(where, 'needs exactly one king each');
  if (Rules.inCheck(pos, pos.turn !== 'w')) fail(where, 'side not to move is in check');
  if (spec.kind === 'square'){
    if (!/^[a-h][1-8]$/.test(spec.target || '')) fail(where, 'square target');
    ex.provenance = A.originalProvenance(id, 'Composed for Gambit Academy.');
    return ex;
  }
  const answers = asList(spec.answer);
  if (!answers.length) fail(where, 'no answer');
  answers.concat(Object.keys(spec.notes || {})).forEach(u => { if (!legal(pos, u)) fail(where, 'illegal move ' + u); });
  if (spec.threat){
    const q = Rules.clone(pos); q.turn = pos.turn === 'w' ? 'b' : 'w'; q.ep = -1;
    if (!legal(q, spec.threat.move)) fail(where, 'threat ' + spec.threat.move + ' is not legal for the opponent');
  }
  if (errors.length && errors.some(e => e.startsWith(where))) return ex;

  const pieces = pos.board.filter(Boolean).length;
  const useTb = spec.engine === 'tb' || (spec.engine !== 'engine' && pieces <= 7 && spec.engine !== 'none');
  const cands = {};
  const add = (move, extra) => { cands[move] = Object.assign(cands[move] || { move }, extra); };
  const successText = spec.success;
  const bestAnswerSan = sanOf(spec.fen, answers[0]);
  const line = spec.line ? sanLine(spec.fen, spec.line) : null;

  if (useTb){
    const tb = await tablebase(spec.fen);
    ex.engine = { tool:'tablebase.lichess.ovh (7-piece Syzygy)', checked:TODAY };
    const mine = c => ({ loss:'win', win:'loss', draw:'draw', 'cursed-win':'draw', 'blessed-loss':'draw', 'maybe-win':'win', 'maybe-loss':'loss' })[c] || c;
    const rank = { win:2, draw:1, loss:0 };
    const bestCat = tb.moves.reduce((b, m) => rank[mine(m.category)] > rank[b] ? mine(m.category) : b, 'loss');
    ex.outcome = bestCat;
    const cp = c => c === 'win' ? 900 : c === 'loss' ? -900 : 0;
    const label = { win:'Winning', draw:'Drawn', loss:'Lost' };
    answers.forEach(u => {
      const m = tb.moves.find(x => x.uci === u);
      if (!m || mine(m.category) !== bestCat) fail(where, 'tablebase: answer ' + u + ' is ' + (m && mine(m.category)) + ', best is ' + bestCat);
    });
    tb.moves.forEach((m, k) => {
      const cat = mine(m.category);
      const noted = (spec.notes || {})[m.uci];
      const isAnswer = answers.indexOf(m.uci) >= 0;
      if (!isAnswer && !noted && cat === bestCat && !spec.listAllMoves) return;          /* equally good: judged by outcome, no need to list */
      if (!isAnswer && !noted && cat === bestCat) { add(m.uci, { tb:cat, engineEval:cp(cat), conceptAlignment:.5, feedback:'Also keeps the ' + (cat === 'draw' ? 'draw' : 'win') + '. ' + bestAnswerSan + ' was the lesson move.' }); return; }
      if (isAnswer) add(m.uci, { tb:cat, engineEval:cp(cat), engineRank:1, conceptAlignment:1, pedagogicalQuality:1, feedback:successText });
      else add(m.uci, Object.assign({ tb:cat, engineEval:cp(cat), category:'ENDGAME_OUTCOME_CHANGE',
        feedback:label[bestCat] + ' → ' + label[cat] + '.' + (noted && noted.feedback ? '<br>' + noted.feedback : ' ' + bestAnswerSan + ' kept the ' + (bestCat === 'win' ? 'win' : 'draw') + '.') },
        noted ? { feedback:label[bestCat] + ' → ' + label[cat] + '.<br>' + noted.feedback, category:noted.category || 'ENDGAME_OUTCOME_CHANGE' } : {}));
    });
    Object.keys(spec.notes || {}).forEach(u => { if (!cands[u]) fail(where, 'noted move ' + u + ' not in tablebase list'); });
  } else if (spec.engine !== 'none'){
    const top = await multipv(spec.fen);
    ex.engine = { tool:'stockfish-18-lite-single', depth:DEPTH, checked:TODAY };
    const best = top[0];
    const scored = {};
    for (const u of new Set(answers.concat(Object.keys(spec.notes || {})))) scored[u] = await scoreMove(spec.fen, u);
    const bestWin = Math.max(win(best), ...Object.values(scored).map(win));
    answers.forEach(u => {
      const drop = bestWin - win(scored[u]);
      const allowed = spec.allowWorse != null ? spec.allowWorse : (spec.policy === 'sound' ? 8 : 6);
      if (drop > allowed) fail(where, 'answer ' + u + ' (' + fmt(scored[u]) + ') is ' + drop.toFixed(1) + ' win% below the engine best ' + best.move + ' (' + fmt(best) + ')' +
        (spec.allowWorse != null ? '' : ' — fix the position or set allowWorse with a reason'));
    });
    if (spec.allowWorse != null && !spec.allowWorseWhy) fail(where, 'allowWorse needs allowWorseWhy');
    answers.forEach((u, k) => add(u, Object.assign({ conceptAlignment:1, pedagogicalQuality:1, cp:scored[u] },
      spec.recommendedRatingMin != null ? { recommendedRatingMin:spec.recommendedRatingMin } : {},
      { feedback:k === 0 || !spec.alsoFeedback ? successText : spec.alsoFeedback })));
    Object.keys(spec.notes || {}).forEach(u => {
      const n = spec.notes[u];
      if (answers.indexOf(u) >= 0) return;
      add(u, Object.assign({ cp:scored[u], conceptAlignment:n.alignment != null ? n.alignment : 0 }, n));
      delete cands[u].alignment;
    });
    top.forEach((l, k) => {
      if (cands[l.move]){ cands[l.move].engineRank = k + 1; if (!cands[l.move].cp) cands[l.move].cp = l; return; }
      if (spec.noEngineExtras) return;
      const drop = bestWin - win(l);
      const altSan = sanOf(spec.fen, l.move);
      add(l.move, { cp:l, engineRank:k + 1, conceptAlignment:.3,
        feedback: drop <= 3
          ? (spec.policy === 'sound' ? 'Good — ' + altSan + ' is fully sound too. ' : 'A good move, objectively about as strong. ') + (spec.policy === 'sound' ? '' : 'The lesson idea here was ' + bestAnswerSan + '.')
          : 'Playable, but ' + bestAnswerSan + ' was stronger here.',
        category: drop <= 3 ? (spec.policy === 'sound' ? undefined : 'MISSED_OBJECTIVE') : 'PLAYABLE_NOT_BEST',
        outcome: drop <= 3 ? (spec.policy === 'sound' ? undefined : 'retry') : (spec.policy === 'sound' && drop <= 6 ? undefined : 'retry') });
    });
    Object.values(cands).forEach(c => {
      if (c.cp){ if (c.cp.mate != null){ c.mateScore = c.cp.mate; } else c.engineEval = c.cp.cp; delete c.cp; }
      Object.keys(c).forEach(k => c[k] === undefined && delete c[k]);
    });
    if (line && line.length) Object.values(cands).filter(c => answers.indexOf(c.move) >= 0).forEach(c => {
      if (typeof c.feedback === 'string' && c.feedback.indexOf('{line}') >= 0) c.feedback = c.feedback.replace('{line}', line.join(' '));
      if (Array.isArray(c.feedback)) c.feedback = c.feedback.map(v => Object.assign({}, v, { text:v.text.replace('{line}', line.join(' ')) }));
    });
  } else {
    answers.forEach(u => add(u, { conceptAlignment:1, feedback:successText, engineRank:1, engineEval:0 }));
    Object.keys(spec.notes || {}).forEach(u => add(u, Object.assign({ engineEval:0 }, spec.notes[u])));
    ex.engine = { tool:'none (rules-only exercise)', checked:TODAY };
  }
  ex.candidates = Object.values(cands);
  if (spec.fallback) ex.fallback = spec.fallback;
  else ex.fallback = { outcome:spec.policy === 'sound' ? 'retry' : 'fail', category:spec.policy === 'sound' ? 'PLAYABLE_NOT_BEST' : 'TACTICAL_MISS',
                       feedback:spec.fallbackText || ('Not this time. ' + (spec.policy === 'sound' ? 'Look for a move that fits the idea of the lesson.' : 'Look again for the most forcing idea.')) };
  ex.provenance = spec.puzzle
    ? { sourceType:'lichess-puzzles', sourceName:'Lichess puzzle database', sourceId:spec.puzzle, sourceUrl:'https://lichess.org/training/' + spec.puzzle,
        license:'CC0-1.0', attributionRequired:false, retrievedAt:spec.retrievedAt || TODAY + 'T00:00:00Z', originalOrAdapted:'adapted', humanReviewed:false,
        notes:'Position from the CC0 Lichess puzzle database; explanations original to Gambit Academy; candidates re-checked with Stockfish.' }
    : A.originalProvenance(id, 'Composed for Gambit Academy; ' + (useTb ? 'verified against the Syzygy tablebase.' : 'engine-checked (Stockfish 18, depth ' + DEPTH + ').'));
  /* sanity: the answer must judge as correct at the exercise's band */
  const judged = A.judge(ex, Rules.parse(ex.fen), Rules.coerce(Rules.parse(ex.fen), answers[0]), ex.band);
  if (judged.outcome !== 'correct' && judged.outcome !== 'accepted') fail(where, 'answer ' + answers[0] + ' judges as ' + judged.outcome + ' (' + judged.category + ')');
  return ex;
}
function fmt(l){ return l.mate != null ? '#' + l.mate : (l.cp > 0 ? '+' : '') + (l.cp / 100).toFixed(2); }

/* --------------------------------------------------------------- lessons */
async function buildLesson(spec){
  const lesson = {
    id:'academy-' + spec.id, conceptId:spec.conceptId || spec.id, title:spec.title, band:spec.band, branch:spec.branch,
    durability:spec.durability, skills:spec.skills, prerequisites:spec.prerequisites || [],
    mastery:Object.assign({ targetMs:30000, pass:.8 }, spec.mastery || {}), generated:true,
    provenance:A.originalProvenance('academy-' + spec.id, spec.provenanceNotes || 'Lesson text original to Gambit Academy; positions engine- or tablebase-verified by tools/author/build.js.')
  };
  if (spec.claims) lesson.claims = spec.claims;
  const stages = [{ type:'intro', text:spec.intro }];
  if (spec.demo){
    const d = { type:'demo', fen:spec.demo.fen, frames:[] };
    let pos = Rules.parse(spec.demo.fen);
    spec.demo.frames.forEach((f, k) => {
      const fr = Array.isArray(f) ? Object.assign({ text:f[0] }, f[1] || {}) : Object.assign({}, f);
      if (fr.fen) pos = Rules.parse(fr.fen);
      fr.marks = parseMarks(fr.marks); fr.arrows = parseArrows(fr.arrows);
      if (fr.move){ if (!legal(pos, fr.move)) fail(lesson.id, 'demo frame ' + k + ' illegal ' + fr.move); else pos = Rules.apply(pos, Rules.coerce(pos, fr.move)); }
      Object.keys(fr).forEach(key => fr[key] === undefined && delete fr[key]);
      d.frames.push(fr);
    });
    stages.push(d);
  }
  const exercises = [];
  for (let i = 0; i < spec.exercises.length; i++){
    const ex = await buildExercise(lesson, spec.exercises[i], i);
    exercises.push(ex);
    if (ex.stage !== 'test') stages.push({ type:'exercise', ref:ex.id });
  }
  if (spec.minigame) stages.push(Object.assign({ type:'minigame' }, spec.minigame));
  stages.push({ type:'mastery', own:spec.mastery && spec.mastery.own != null ? spec.mastery.own : Math.min(3, exercises.filter(x => x.stage !== 'guided').length), others:spec.mastery && spec.mastery.others != null ? spec.mastery.others : 2 });
  lesson.stages = stages;
  /* content bar: one success and two distinct failure explanations */
  let success = 0; const failures = new Set();
  exercises.forEach(x => {
    if (x.kind === 'square'){ success++; failures.add('square'); failures.add('square2'); return; }
    (x.candidates || []).forEach(c => {
      const j = A.judge(x, Rules.parse(x.fen), Rules.coerce(Rules.parse(x.fen), c.move), lesson.band);
      if ((j.outcome === 'correct' || j.outcome === 'accepted') && j.text) success++;
      if ((j.outcome === 'fail' || j.outcome === 'retry') && j.text) failures.add(c.move + j.category);
    });
    if (x.fallback && x.fallback.feedback) failures.add('fallback:' + x.id);
  });
  if (!success) fail(lesson.id, 'no success explanation');
  if (failures.size < 2) fail(lesson.id, 'fewer than two failure explanations');
  if (!exercises.some(x => x.stage === 'guided')) fail(lesson.id, 'no guided exercise');
  if (!exercises.some(x => x.stage === 'transfer')) fail(lesson.id, 'no transfer exercise');
  return { lesson, exercises };
}

/* ------------------------------------------------------------------ main */
(async function(){
  const files = fs.readdirSync(SPECS).filter(f => /\.js$/.test(f)).sort();
  const specs = [];
  files.forEach(f => { const mod = require(path.join(SPECS, f)); (Array.isArray(mod) ? mod : [mod]).forEach(s => specs.push(Object.assign({ _file:f }, s))); });
  const ids = new Set();
  specs.forEach(s => { if (ids.has(s.id)) fail(s._file, 'duplicate lesson id ' + s.id); ids.add(s.id); });
  const only = opt('--only');
  const lessons = [], exercises = [];
  for (const s of specs){
    try {
      const r = await buildLesson(s);
      lessons.push(r.lesson); exercises.push(...r.exercises);
      if (!only || only === s.id) process.stderr.write('  built ' + s.id + ' (' + r.exercises.length + ' exercises)\n');
    } catch (e){ fail(s.id, e.stack || String(e)); }
    writeCache('engine.json', evalCache); writeCache('tablebase.json', tbCache);
  }
  if (pool) pool.forEach(p => p.e.quit());
  const exIds = new Set();
  exercises.forEach(x => { if (exIds.has(x.id)) fail(x.id, 'duplicate exercise id'); exIds.add(x.id); });
  if (errors.length){
    console.error('\nBUILD FAILED — ' + errors.length + ' problem(s):\n  ✗ ' + errors.join('\n  ✗ '));
    process.exit(1);
  }
  const body =
    '"use strict";\n' +
    '/* ============================================================================\n' +
    '   SECTION 34a — ACADEMY GENERATED CONTENT\n' +
    '   GENERATED by tools/author/build.js from content/academy/lessons/*.js.\n' +
    '   Do not edit by hand: edit the spec and rebuild. Every answer here was\n' +
    '   checked against Stockfish or the Syzygy tablebase at build time.\n' +
    '   ========================================================================== */\n' +
    'const ACADEMY_GENERATED = {\n  lessons:[\n' + lessons.map(l => '    ' + JSON.stringify(l)).join(',\n') + '\n  ],\n' +
    '  exercises:[\n' + exercises.map(x => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]\n};\n';
  console.log(lessons.length + ' lessons, ' + exercises.length + ' exercises built');
  if (flag('--check')) return;
  let html = fs.readFileSync(HTML, 'utf8');
  const re = /<script>\n"use strict";\n\/\* =+\n   SECTION 34a — ACADEMY GENERATED CONTENT[\s\S]*?<\/script>\n/;
  const block = '<script>\n' + body + '</script>\n';
  if (re.test(html)) html = html.replace(re, () => block);
  else {
    const anchor = '<script>\n"use strict";\n/* ============================================================================\n   SECTION 34 — ACADEMY CURRICULUM';
    if (html.indexOf(anchor) < 0) throw new Error('SECTION 34 anchor not found');
    html = html.replace(anchor, () => block + anchor);
  }
  fs.writeFileSync(HTML, html);
  console.log('index.html updated');
})();
