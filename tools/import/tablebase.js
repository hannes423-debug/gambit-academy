/* Look up ≤7-piece positions in the Lichess Syzygy tablebase API and cache
   the results. Rate-limited to one request per second by default — the API
   is a free public service. Results (win/draw/loss, DTZ, per-move outcome)
   are facts about chess and are stored as such; the provenance record names
   the service they came from.

     node tools/import/tablebase.js data/games/positions.ndjson --limit 200
     node tools/import/tablebase.js --fen "8/4k3/8/3K4/4P3/8/8/8 w - - 0 1" */
const fs = require('fs');
const path = require('path');
const C = require('./common.js');

const a = C.args(process.argv.slice(2));
const cacheFile = a.cache ? path.resolve(a.cache) : path.join(C.DATA, 'tablebase', 'tablebase.ndjson');
const delay = +(a.delay || 1000), limit = a.limit ? +a.limit : Infinity;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const provenance = C.requireValidProvenance({
  sourceType:'tablebase', sourceName:'Lichess tablebase API (Syzygy 7-piece)', sourceId:'tablebase.lichess.ovh',
  sourceUrl:'https://tablebase.lichess.ovh', license:'CC0-1.0', attributionRequired:false,
  retrievedAt:new Date().toISOString(), originalOrAdapted:'imported', humanReviewed:false,
  notes:'Endgame outcomes are mathematical facts; Syzygy tables by Ronald de Man, 7-piece generation by Bojun Guo.'
});

async function lookup(fen){
  for (let tries = 0; tries < 4; tries++){
    const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
    if (r.status === 429){ await sleep(60000); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  throw new Error('rate limited');
}

(async function(){
  const seen = new Set();
  if (fs.existsSync(cacheFile)) for await (const r of C.readNDJSON(cacheFile)) seen.add(r.fen);
  fs.mkdirSync(path.dirname(cacheFile), { recursive:true });
  const out = fs.createWriteStream(cacheFile, { flags:'a' });
  const fens = [];
  if (a.fen) fens.push(a.fen);
  else if (a._[0]) for await (const rec of C.readNDJSON(a._[0])) fens.push(rec.fen);
  else { console.error('usage: tablebase.js <positions.ndjson> | --fen FEN'); process.exit(2); }
  let n = 0;
  for (const fen of fens){
    const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
    const key = fen.split(' ').slice(0, 4).join(' ');
    if (pieces > 7 || seen.has(key)) continue;
    seen.add(key);
    const d = await lookup(fen);
    out.write(JSON.stringify({ fen:key, category:d.category, dtz:d.dtz, dtm:d.dtm,
      moves:(d.moves || []).map(m => ({ uci:m.uci, san:m.san, category:m.category, dtz:m.dtz })), source:provenance.sourceId }) + '\n');
    if (++n >= limit) break;
    await sleep(delay);
  }
  await new Promise(r => out.end(r));
  console.log(n + ' positions looked up → ' + cacheFile);
})();
