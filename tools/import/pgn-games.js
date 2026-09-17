/* Import PGN master games into NDJSON, replaying every move through the
   app's Rules so illegal or unparseable games are rejected, not stored.

     node tools/import/pgn-games.js games.pgn --source-name "My OTB archive" \
          --source-url https://example.org/archive --license CC0-1.0

   The licence is YOUR statement about the file and is validated before
   import: a Research-Only or unknown licence is refused, and CC-BY style
   licences must pass --attribution. Game scores themselves are facts, but
   annotated collections usually are not — import the moves, not comments.

   Options: --out DIR (default data/games), --min-elo N, --limit N,
            --positions (also write one FEN per ply to positions.ndjson,
            ready for tools/import/engine-annotate.js) */
const path = require('path');
const C = require('./common.js');

const a = C.args(process.argv.slice(2));
const file = a._[0];
if (!file){ console.error('usage: pgn-games.js <file.pgn|-> --source-name NAME --source-url URL --license ID [options]'); process.exit(2); }
const out = a.out ? path.resolve(a.out) : path.join(C.DATA, 'games');
const provenance = C.requireValidProvenance({
  sourceType:'licensed-games', sourceName:a['source-name'] || '', sourceId:path.basename(file), sourceUrl:a['source-url'] || '',
  license:a.license || '', attributionRequired:!!a.attribution, retrievedAt:new Date().toISOString(),
  originalOrAdapted:'imported', humanReviewed:false, notes:a.notes || 'Moves and headers only; comments and variations stripped.'
});

const get = C.app();
const Rules = get('Rules');

/** SAN → move, by matching against the app's own SAN for every legal move. */
function sanToMove(pos, san){
  const clean = san.replace(/[+#!?]+$/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
  const promo = (/=([QRBN])$/i.exec(clean) || [])[1];
  for (const m of Rules.allMoves(pos)){
    if (promo) m.promo = promo.toLowerCase();
    if (Rules.san(pos, m).replace(/[+#]$/, '') === clean) return m;
  }
  return null;
}
function movetextTokens(text){
  return text.replace(/\{[^}]*\}/g, ' ')                     /* comments */
             .replace(/;[^\n]*/g, ' ')
             .replace(/\$\d+/g, ' ')                          /* NAGs */
             .split(/\s+/).filter(Boolean);
}
function stripVariations(text){
  let depth = 0, outText = '';
  for (const ch of text){ if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); else if (!depth) outText += ch; }
  return outText;
}
function parseGame(headers, moveText){
  const fen = headers.FEN || Rules.START;
  let pos = Rules.parse(fen);
  const uci = [], fens = [];
  for (const tok of movetextTokens(stripVariations(moveText))){
    if (/^\d+\.+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    const t = tok.replace(/^\d+\.+/, '');
    if (!t) continue;
    const m = sanToMove(pos, t);
    if (!m) return { error:'illegal or unparseable move "' + t + '" at ply ' + (uci.length + 1) };
    uci.push(Rules.name(m.from) + Rules.name(m.to) + (m.promo && /=/.test(t) ? m.promo : ''));
    fens.push(Rules.toFEN(pos));
    pos = Rules.apply(pos, m);
  }
  return { startFen:fen, uci, fens };
}

(async function(){
  const w = new C.ShardWriter(out);
  let headers = {}, moveText = '', games = 0, kept = 0, rejected = 0;
  const minElo = a['min-elo'] ? +a['min-elo'] : 0, limit = a.limit ? +a.limit : Infinity;
  const flush = () => {
    if (!moveText.trim() && !Object.keys(headers).length) return;
    games++;
    const elo = Math.min(+headers.WhiteElo || 0, +headers.BlackElo || 0);
    if (elo >= minElo && kept < limit){
      const g = parseGame(headers, moveText);
      if (g.error){ rejected++; }
      else {
        kept++;
        const id = (headers.Site || '') + '|' + (headers.Date || '') + '|' + (headers.White || '') + '|' + (headers.Black || '') + '|' + games;
        w.write('games', { id, headers, result:headers.Result || '*', startFen:g.startFen, uci:g.uci });
        if (a.positions) g.fens.forEach((fen, i) => w.write('positions', { fen, gameId:id, ply:i + 1, played:g.uci[i] }));
      }
    }
    headers = {}; moveText = '';
  };
  for await (const line of C.lines(file)){
    const h = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
    if (h){ if (moveText.trim()) flush(); headers[h[1]] = h[2]; }
    else moveText += ' ' + line;
  }
  flush();
  await w.close();
  C.writeJSON(path.join(out, 'manifest.json'), { kind:'games', provenance, games, kept, rejected, shards:w.counts, importedAt:new Date().toISOString() });
  console.log(games + ' games read, ' + kept + ' kept, ' + rejected + ' rejected (illegal/unparseable) → ' + out);
})();
