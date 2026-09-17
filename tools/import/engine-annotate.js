/* Annotate positions with Stockfish MultiPV evaluations, cached by FEN, so a
   position is never analysed twice across imports.

     node tools/import/engine-annotate.js data/games/positions.ndjson --depth 18 --multipv 5
     node tools/import/engine-annotate.js data/puzzles/r0700.ndjson --puzzles --limit 500

   --puzzles analyses the position AFTER the opponent's first move (the one the
   learner solves). Output: data/evals/evals.ndjson, one line per FEN:
     { fen, depth, multipv, lines:[{ rank, move, cp, mate, pv }], engine, analysedAt }
   Scores are from the side to move. */
const fs = require('fs');
const path = require('path');
const C = require('./common.js');
const { Engine } = require('../lib/engine.js');

const a = C.args(process.argv.slice(2));
const file = a._[0];
if (!file){ console.error('usage: engine-annotate.js <positions.ndjson> [--depth N] [--multipv N] [--puzzles] [--limit N]'); process.exit(2); }
const depth = +(a.depth || 18), multipv = +(a.multipv || 5), limit = a.limit ? +a.limit : Infinity;
const cacheFile = a.cache ? path.resolve(a.cache) : path.join(C.DATA, 'evals', 'evals.ndjson');
const Rules = C.app()('Rules');

(async function(){
  const seen = new Set();
  if (fs.existsSync(cacheFile)) for await (const r of C.readNDJSON(cacheFile)) if (r.depth >= depth) seen.add(r.fen);
  fs.mkdirSync(path.dirname(cacheFile), { recursive:true });
  const outStream = fs.createWriteStream(cacheFile, { flags:'a' });
  const engine = new Engine({ hash:128 });
  let done = 0, skipped = 0;
  for await (const rec of C.readNDJSON(file)){
    let fen = rec.fen;
    if (a.puzzles){ const p = Rules.parse(rec.fen); fen = Rules.toFEN(Rules.apply(p, Rules.coerce(p, rec.moves[0]))); }
    const key = fen.split(' ').slice(0, 4).join(' ');
    if (seen.has(key) || seen.has(fen)){ skipped++; continue; }
    seen.add(key);
    const lines = await engine.analyse(fen, { depth, multipv });
    outStream.write(JSON.stringify({ fen:key, depth, multipv, lines, engine:'stockfish-18-lite-single', analysedAt:new Date().toISOString() }) + '\n');
    if (++done >= limit) break;
    if (done % 50 === 0) process.stderr.write('  ' + done + ' analysed\n');
  }
  engine.quit();
  await new Promise(r => outStream.end(r));
  console.log(done + ' analysed, ' + skipped + ' already cached → ' + cacheFile);
})();
