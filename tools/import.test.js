/* Dataset importers against small synthetic fixtures. No network, no engine. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { query } = require('./import/query-puzzles.js');

let failed = 0;
const t = (label, ok, extra) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-import-'));
const node = (script, args) => spawnSync(process.execPath, [path.join(__dirname, 'import', script)].concat(args), { encoding:'utf8' });
const fx = f => path.join(__dirname, 'fixtures', f);

(async function(){
  console.log('— lichess puzzles —');
  const out = path.join(tmp, 'puzzles');
  const r = node('lichess-puzzles.js', [fx('puzzles-sample.csv'), '--out', out, '--validate']);
  t('importer runs', r.status === 0, (r.stdout || r.stderr).trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  t('manifest carries CC0 provenance', manifest.provenance.license === 'CC0-1.0' && manifest.provenance.sourceType === 'lichess-puzzles');
  t('malformed and illegal rows are rejected', manifest.kept === 4 && manifest.malformed === 2, 'kept ' + manifest.kept + ', rejected ' + manifest.malformed);
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  t('sharded by 100-point band', !!index.r0700 && index.r0700.count === 3 && !!index.r1100, Object.keys(index).join(','));
  t('index counts themes per band', index.r0700.themes.fork === 3);
  const line = JSON.parse(fs.readFileSync(path.join(out, 'r0700.ndjson'), 'utf8').split('\n')[0]);
  t('every puzzle carries an educational-quality estimate', line.quality && typeof line.quality.score === 'number' && 'cleanMotif' in line.quality);

  const q = await query(out, { ratingMin:700, ratingMax:799, motif:'fork' }, 10);
  t('query reads only the shards in range', q.scannedShards.join() === 'r0700', q.scannedShards.join());
  t('query ranks the clean one-motif fork above the messy one', q.results[0].id === 'syn001' && q.results[q.results.length - 1].id === 'syn002',
    q.results.map(p => p.id + ':' + p.quality.score.toFixed(2)).join(' '));
  const pop = await query(out, { motif:'fork', popularityMin:50 }, 10);
  t('popularity filter', pop.results.every(p => p.popularity >= 50) && pop.total === 1);
  const len = await query(out, { solutionLength:1 }, 10);
  t('solution-length filter (moves after the opponent\'s)', len.results.map(p => p.id).join() === 'syn006');
  const open = await query(out, { opening:'Damiano_Defense' }, 10);
  t('opening filter', open.total === 1);
  const qual = await query(out, { qualityMin:.75 }, 10);
  t('quality filter drops the messy puzzle', qual.results.every(p => p.id !== 'syn002'));

  console.log('\n— PGN games —');
  const gout = path.join(tmp, 'games');
  const g = node('pgn-games.js', [fx('games-sample.pgn'), '--out', gout, '--source-name', 'Synthetic fixture', '--source-url', 'https://example.org/fixture', '--license', 'CC0-1.0', '--positions']);
  t('PGN importer runs', g.status === 0, (g.stdout || g.stderr).trim());
  const gm = JSON.parse(fs.readFileSync(path.join(gout, 'manifest.json'), 'utf8'));
  t('illegal game rejected, legal games kept', gm.kept === 2 && gm.rejected === 1);
  const games = fs.readFileSync(path.join(gout, 'games.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  t('variations and comments stripped, castling parsed', games[0].uci.length === 19 && games[0].uci.indexOf('e1g1') >= 0, games[0].uci.length + ' plies');
  t('mate in the second game is kept', games[1].uci.join(' ') === 'f2f3 e7e5 g2g4 d8h4');
  const positions = fs.readFileSync(path.join(gout, 'positions.ndjson'), 'utf8').trim().split('\n');
  t('one position per ply for engine annotation', positions.length === 23);

  const refused = node('pgn-games.js', [fx('games-sample.pgn'), '--out', path.join(tmp, 'refused'), '--source-name', 'Paid course', '--source-url', 'https://example.org', '--license', 'Research-Only']);
  t('a research-only licence is refused before import', refused.status === 3 && !fs.existsSync(path.join(tmp, 'refused', 'games.ndjson')), refused.stderr.split('\n')[1]);
  const noAttr = node('pgn-games.js', [fx('games-sample.pgn'), '--out', path.join(tmp, 'attr'), '--source-name', 'CC-BY archive', '--source-url', 'https://example.org', '--license', 'CC-BY-4.0']);
  t('CC-BY requires --attribution', noAttr.status === 3);

  fs.rmSync(tmp, { recursive:true, force:true });
  console.log('\n' + (failed ? 'FAILURES: ' + failed : 'IMPORTERS PASS'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FATAL', e.stack); process.exit(1); });
