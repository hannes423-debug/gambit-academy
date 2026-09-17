/* Query an imported puzzle store. Reads only the shards the rating range
   touches, filters with the app's own Academy.PuzzleQuery, ranks by
   educational quality (then popularity).

     node tools/import/query-puzzles.js --motif fork --rating 650-800 --quality 0.7 --length 1 --limit 10
     node tools/import/query-puzzles.js --motif pin --phase middlegame --opening Italian_Game --json

   Options: --dir, --rating MIN-MAX, --motif, --phase, --opening, --length N (moves),
            --popularity N, --plays N, --depth N (max calc depth), --quality 0..1,
            --limit N (default 20), --json */
const fs = require('fs');
const path = require('path');
const C = require('./common.js');

async function query(dir, q, limit){
  const A = C.app()('Academy');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const lo = q.ratingMin == null ? 0 : q.ratingMin, hi = q.ratingMax == null ? 9999 : q.ratingMax;
  const shards = Object.keys(index).filter(b => {
    const r = +b.slice(1);
    return r + 99 >= lo && r <= hi && (!q.motif || index[b].themes[q.motif]);
  }).sort();
  const hits = [];
  for (const b of shards){
    for await (const p of C.readNDJSON(path.join(dir, b + '.ndjson'))) if (A.PuzzleQuery.matches(p, q)) hits.push(p);
  }
  hits.sort((x, y) => (y.quality.score - x.quality.score) || (y.popularity - x.popularity));
  return { scannedShards:shards, total:hits.length, results:hits.slice(0, limit) };
}

if (require.main === module){
  const a = C.args(process.argv.slice(2));
  const dir = a.dir ? path.resolve(a.dir) : path.join(C.DATA, 'puzzles');
  const [rmin, rmax] = a.rating ? String(a.rating).split('-').map(Number) : [null, null];
  const q = { ratingMin:rmin, ratingMax:rmax, motif:a.motif || null, phase:a.phase || null, opening:a.opening || null,
    solutionLength:a.length ? +a.length : null, popularityMin:a.popularity ? +a.popularity : null, playsMin:a.plays ? +a.plays : null,
    calculationDepthMax:a.depth ? +a.depth : null, qualityMin:a.quality ? +a.quality : null };
  query(dir, q, a.limit ? +a.limit : 20).then(r => {
    if (a.json) return console.log(JSON.stringify(r, null, 2));
    console.log(r.total + ' matches in ' + r.scannedShards.length + ' shard(s)');
    r.results.forEach(p => console.log('  ' + p.id.padEnd(7) + ' ' + String(p.rating).padStart(4) + '  q=' + p.quality.score.toFixed(2) +
      '  depth ' + p.quality.calculationDepth + '  ' + p.themes.join(' ')));
  });
}
module.exports = { query };
