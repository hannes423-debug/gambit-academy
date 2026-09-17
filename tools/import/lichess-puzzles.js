/* Import the Lichess puzzle database (CC0) into rating-band shards with an
   educational-quality estimate on every puzzle.

     node tools/import/lichess-puzzles.js lichess_db_puzzle.csv.zst
     node tools/import/lichess-puzzles.js puzzles.csv --min-rating 400 --max-rating 2400 --min-popularity 50
     zstd -dc lichess_db_puzzle.csv.zst | node tools/import/lichess-puzzles.js -

   Options
     --out DIR            default data/puzzles
     --min-rating N       default 0          --max-rating N     default 3500
     --min-popularity N   default -100       --min-plays N      default 0
     --themes a,b         keep only puzzles with one of these themes
     --limit N            stop after keeping N (for trial runs)
     --validate           replay every solution through the app's Rules (slower)

   Output
     data/puzzles/r0700.ndjson …   one file per 100-point band
     data/puzzles/index.json       counts per band × theme, for fast queries
     data/puzzles/manifest.json    provenance + filters + totals

   CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,
   Themes,GameUrl,OpeningTags. Moves are UCI and the FIRST move is the
   opponent's — the position to solve is the one after it. */
const path = require('path');
const C = require('./common.js');

const a = C.args(process.argv.slice(2));
const file = a._[0];
if (!file){ console.error('usage: lichess-puzzles.js <file.csv|file.csv.zst|->  [options]'); process.exit(2); }

const out = a.out ? path.resolve(a.out) : path.join(C.DATA, 'puzzles');
const f = {
  minRating: +(a['min-rating'] || 0), maxRating: +(a['max-rating'] || 3500),
  minPopularity: +(a['min-popularity'] != null ? a['min-popularity'] : -100), minPlays: +(a['min-plays'] || 0),
  themes: a.themes ? String(a.themes).split(',') : null, limit: a.limit ? +a.limit : Infinity, validate: !!a.validate
};

const provenance = C.requireValidProvenance({
  sourceType:'lichess-puzzles', sourceName:'Lichess puzzle database', sourceId:'lichess_db_puzzle',
  sourceUrl:'https://database.lichess.org/#puzzles', license:'CC0-1.0', attributionRequired:false,
  retrievedAt:new Date().toISOString(), originalOrAdapted:'imported', humanReviewed:false,
  notes:'Quality fields are heuristic estimates (Academy.EduQuality.fromLichess), not human review.'
});

const get = C.app();
const A = get('Academy'), Rules = get('Rules');
const band = r => 'r' + String(Math.max(0, Math.floor(r / 100) * 100)).padStart(4, '0');

function solutionLegal(fen, moves){
  try {
    let p = Rules.parse(fen);
    for (const u of moves){
      const m = Rules.coerce(p, u);
      if (!p.board[m.from] || Rules.moves(p, m.from).indexOf(m.to) < 0) return false;
      p = Rules.apply(p, m);
    }
    return true;
  } catch (e){ return false; }
}

(async function(){
  const w = new C.ShardWriter(out);
  const index = {};
  let rows = 0, kept = 0, bad = 0, header = true;
  for await (const line of C.lines(file)){
    if (header){ header = false; if (/^PuzzleId/i.test(line)) continue; }
    if (!line) continue;
    rows++;
    const c = line.split(',');
    if (c.length < 8){ bad++; continue; }
    const p = { id:c[0], fen:c[1], moves:c[2].split(' '), rating:+c[3], ratingDeviation:+c[4], popularity:+c[5], nbPlays:+c[6],
                themes:c[7] ? c[7].split(' ') : [], gameUrl:c[8] || '', openingTags:c[9] ? c[9].split(' ') : [] };
    if (!(p.rating >= f.minRating && p.rating <= f.maxRating)) continue;
    if (p.popularity < f.minPopularity || p.nbPlays < f.minPlays) continue;
    if (f.themes && !p.themes.some(t => f.themes.indexOf(t) >= 0)) continue;
    if (f.validate && !solutionLegal(p.fen, p.moves)){ bad++; continue; }
    p.quality = A.EduQuality.fromLichess(p);
    const b = band(p.rating);
    w.write(b, p);
    const ix = index[b] || (index[b] = { count:0, themes:{} });
    ix.count++;
    p.themes.forEach(t => { ix.themes[t] = (ix.themes[t] || 0) + 1; });
    if (++kept >= f.limit) break;
    if (rows % 250000 === 0) process.stderr.write('  ' + rows.toLocaleString() + ' rows, kept ' + kept.toLocaleString() + '\n');
  }
  await w.close();
  C.writeJSON(path.join(out, 'index.json'), index);
  C.writeJSON(path.join(out, 'manifest.json'), { kind:'puzzles', provenance, filters:f, rows, kept, malformed:bad, shards:w.counts,
    importedAt:new Date().toISOString(), schema:'id,fen,moves[],rating,ratingDeviation,popularity,nbPlays,themes[],gameUrl,openingTags[],quality{}' });
  console.log('scanned ' + rows.toLocaleString() + ' rows, kept ' + kept.toLocaleString() + ' (' + bad + ' malformed/illegal) → ' + out);
})();
