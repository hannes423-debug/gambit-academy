const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://local/' });
const { window } = dom;
if (!window.matchMedia) window.matchMedia = q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
window.addEventListener('error', e => errors.push('window error: ' + e.message));

const wait = ms => new Promise(r => setTimeout(r, ms));
const ev = c => window.eval(c);
const $ = s => window.document.querySelector(s);
const txt = s => { const e = $(s); return e ? e.textContent.trim().replace(/\s+/g,' ') : '(missing)'; };
const t = (label, ok, extra) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : '')); if (!ok) errors.push(label); };

/* ---------- fake Stockfish: emits real-shaped UCI output ---------- */
const FAKE = { calls:[] };
window.Worker = class {
  constructor(url){ FAKE.calls.push(String(url)); this.onmessage = null; this.onerror = null; }
  postMessage(cmd){
    const send = m => setTimeout(() => this.onmessage && this.onmessage({ data:m }), 5);
    if (cmd === 'uci'){ send('id name Stockfish 18'); send('uciok'); }
    else if (cmd === 'isready') send('readyok');
    else if (/^position/.test(cmd)) this.fen = cmd.slice(13);
    else if (/^go/.test(cmd)){
      /* White is nearly winning when it is White to move (i.e. after Black
         blundered); roughly level when Black is to move. Emit a *legal* pv by
         asking the app's own rules for real moves. */
      const R = window.eval('Rules');
      let pos, pv = [];
      try {
        pos = R.parse(this.fen);
        for (let i = 0; i < 4; i++){
          const ms = R.allMoves(pos); if (!ms.length) break;
          const m = ms[i % ms.length];
          pv.push(R.name(m.from) + R.name(m.to));
          pos = R.apply(pos, m);
        }
      } catch(e){ pv = ['e2e4']; }
      const whiteToMove = / w /.test(this.fen || '');
      const cp = whiteToMove ? 350 : -30;
      send('info depth 12 multipv 1 score cp ' + cp + ' nodes 90000 pv ' + pv.slice(0,3).join(' '));
      send('info depth 16 multipv 1 score cp ' + cp + ' nodes 400000 pv ' + pv.join(' '));
      send('bestmove ' + (pv[0] || 'e2e4'));
    }
  }
  terminate(){}
};
window.URL.createObjectURL = () => 'blob:fake';
window.Blob = class { constructor(a){ this.a = a; } };

(async function(){
  await wait(400);
  console.log('— opening book —');
  const bookSize = ev("OPENING_BOOK.t[2].length");
  t('book loaded, ' + bookSize + ' first moves', bookSize === 20, '(all 20 legal first moves)');

  // index builds
  ev("Book.buildIndex()");
  let waited = 0;
  while (!ev("Book.ready()") && waited < 12000){ await wait(200); waited += 200; }
  t('transposition index built', ev("Book.ready()"), ev("Book.size()") + ' positions');

  // the exact case that failed with a path-only lookup
  const ck = ev(`(function(){
    let pos = Rules.parse(Rules.START);
    for (const u of ['e2e4','c7c6','d2d4','d7d5','b1c3','d5e4','c3e4','c8f5']) pos = Rules.apply(pos, Rules.coerce(pos,u));
    const n = Book.nameOf(pos); return n ? n.name + ' [' + n.eco + ']' : null; })()`);
  t('Caro-Kann Classical found by position', !!ck, ck || '(null)');

  // transposition: two move orders, same King's Indian
  const kid = ev(`(function(){
    const walk = ms => { let p = Rules.parse(Rules.START); for (const u of ms) p = Rules.apply(p, Rules.coerce(p,u)); return Book.nameOf(p); };
    const a = walk(['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4','d7d6']);
    const b = walk(['e2e4','g7g6','d2d4','f8g7','c2c4','d7d6','b1c3','g8f6']);
    return [a && a.name, b && b.name]; })()`);
  t('same position via two move orders gets the same name',
    kid[0] && kid[0] === kid[1], kid[0] + ' == ' + kid[1]);

  // deep real line
  const naj = ev(`(function(){
    let p = Rules.parse(Rules.START);
    for (const u of ['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6','b1c3','a7a6']) p = Rules.apply(p, Rules.coerce(p,u));
    const n = Book.nameOf(p); return n ? n.name + ' [' + n.eco + ']' : null; })()`);
  t('Najdorf named', /Najdorf/.test(naj || ''), naj || '(null)');

  console.log('\n— explorer screen —');
  ev("Tree.open()");
  await wait(500);
  t('explore screen active', !!$('#screen-explore.is-active'));
  const rows = window.document.querySelectorAll('#tRows .trow').length;
  t('continuations listed from the book', rows === 20, rows + ' rows at the start position');
  t('start position labelled', /Starting position/.test(txt('#tName')), txt('#tName'));

  // play 1.e4 c6 2.d4 and check the name updates
  ev("Tree.play(Rules.coerce(Tree.pos,'e2e4'))"); await wait(400);
  ev("Tree.play(Rules.coerce(Tree.pos,'c7c6'))"); await wait(400);
  t('name follows the line', /Caro-Kann/.test(txt('#tName')), txt('#tName'));
  t('move list rendered', txt('#tMoves').includes('e4') && txt('#tMoves').includes('c6'), txt('#tMoves'));

  const kids = ev("Tree.rows().length");
  t('Caro-Kann has book continuations', kids > 5, kids + ' continuations');
  const named = ev("Tree.rows().filter(r=>r.name).length");
  t('continuations carry opening names', named > 3, named + ' named');

  // back navigation
  ev("Tree.back(1)"); await wait(300);
  t('back one move works', ev("Tree.path.length") === 1 && ev("Tree.sans.join('')") === 'e4');

  console.log('\n— engine wrapper —');
  const booted = await ev("Engine.boot()");
  t('engine boots and handshakes uciok', booted === true, 'tried: ' + FAKE.calls.length + ' source(s)');
  const res = await ev("Engine.analyse(Rules.parse(Rules.START), {movetime:100})");
  t('parses depth/score/pv/bestmove', res && res.depth === 16 && res.cp === 350 && !!res.best,
    'depth=' + (res && res.depth) + ' cp=' + (res && res.cp) + ' best=' + (res && res.best));
  t('pv captured', res && res.pv.length === 4, (res && res.pv.join(' ')) || '');
  const wsW = ev("Engine.whiteScore({cp:35,mate:null},'w')");
  const wsB = ev("Engine.whiteScore({cp:35,mate:null},'b')");
  t('score normalised to White', wsW === 35 && wsB === -35, wsW + ' / ' + wsB);
  t('mate formatting', ev("Engine.fmt({mate:3,cp:null},'w')") === '#3', ev("Engine.fmt({mate:3,cp:null},'w')"));

  console.log('\n— punish flow —');
  ev("Tree.reset(); Tree.back(0)"); await wait(200);
  ev("Tree.play(Rules.coerce(Tree.pos,'e2e4'))"); await wait(400);
  await ev("Tree.punish('f7f6')");            // a genuinely terrible reply
  await wait(400);
  const sheet = txt('#sheetBody');
  t('punish sheet classifies the move', /Blunder|Mistake|Inaccuracy|Nothing to punish/.test(sheet), sheet.slice(0, 74) + '…');
  t('refutation line rendered', window.document.querySelectorAll('#sheetBody .consequence li').length > 0,
    window.document.querySelectorAll('#sheetBody .consequence li').length + ' moves');
  t('punish state stored', !!ev("Tree.punishing"), ev("Tree.punishing && Tree.punishing.san"));

  console.log('\n— practise a line —');
  ev("Tree.reset(); Tree.back(0)"); await wait(150);
  for (const u of ['e2e4','c7c6','d2d4','d7d5']){ ev("Tree.play(Rules.coerce(Tree.pos,'" + u + "'))"); await wait(350); }
  ev("Tree.practise()"); await wait(400);
  const m = ev("IDX.mission['custom-line']");
  t('mission generated from the explored line', !!m, m ? m.title + ' · ' + m.steps.length + ' steps, side ' + m.side : '');
  t('generated mission is playable', !!$('#lesson.is-active') && window.document.querySelectorAll('#board .pc').length > 0);
  const legal = ev(`(function(){
    const m = IDX.mission['custom-line']; let pos = Rules.parse(Rules.START); let ok = true;
    for (const st of m.steps){
      if (st.fen) pos = Rules.parse(st.fen);
      if (st.move){ const mv = Rules.coerce(pos, st.move); if(!Rules.moves(pos,mv.from).includes(mv.to)) ok=false; pos = Rules.apply(pos,mv); }
      if (st.type==='move'){ const mv = Rules.coerce(pos, st.expect);
        if(!mv || !Rules.moves(pos,mv.from).includes(mv.to)) ok=false; else pos = Rules.apply(pos,mv);
        if (st.reply){ const r = Rules.coerce(pos, st.reply.move); if(!r||!Rules.moves(pos,r.from).includes(r.to)) ok=false; else pos=Rules.apply(pos,r); } }
    } return ok; })()`);
  t('every move in the generated mission is legal', legal);

  console.log('\n— puzzles —');
  const csv = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags\n' +
    '00sHx,r2q3k/6pp/8/6N1/8/8/5PPP/6K1 w - - 0 1,g5f7 h8g8 f7d8,1200,75,95,500,fork advantage,https://x,\n' +
    '00abc,6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1,a1a8,900,70,92,300,backRankMate mateIn1,https://x,\n' +
    '00low,4k3/8/4K3/8/8/8/8/6Q1 w - - 0 1,g1g8,2500,70,95,300,mateIn2 endgame,https://x,\n' +
    '00pop,4k3/8/4K3/8/8/8/8/6Q1 w - - 0 1,g1g8,1500,70,10,300,skewer,https://x,\n';
  window.__file = { size: csv.length, slice: (a, b) => ({ _t: csv.slice(a, b) }) };
  window.FileReader = class { readAsText(blob){ this.result = blob._t; setTimeout(() => this.onload && this.onload(), 1); } };
  const imported = await new Promise(res => {
    window.__cb = (n, scanned) => res([n, scanned]);
    ev("Puzzles.importFile(window.__file, {}, null, window.__cb)");
    setTimeout(() => res(null), 4000);
  });
  t('CSV streamed, filtered by rating and popularity', imported && imported[0] === 2,
    imported ? 'kept ' + imported[0] + ' of ' + imported[1] + ' (2500-rated and unpopular excluded)' : 'timed out');
  const themes = ev("Puzzles.themesPresent().map(t=>t.id).join(',')");
  t('themes mapped onto this app\'s courses', /fork/.test(themes) && /backRankMate/.test(themes), themes);
  ev("Puzzles.play('fork')"); await wait(500);
  t('puzzle runs on the lesson engine', !!$('#lesson.is-active') && /Puzzle/.test(txt('#lsMission')), txt('#lsMission'));
  const pk = ev("Object.keys(IDX.mission).filter(k=>k.indexOf('puzzle-')===0)[0]");
  const pm = ev("IDX.mission['" + pk + "']");
  t('opponent move played first, then you solve',
    pm && pm.steps[0].type === 'teach' && pm.steps[1] && pm.steps[1].type === 'move',
    pm ? pm.steps.map(x => x.type).join(' → ') : '');
  const pLegal = ev(`(function(){ const m = IDX.mission['` + pk + `'];
    let pos = Rules.parse(m.steps[0].fen); let ok = true;
    const mv0 = Rules.coerce(pos, m.steps[0].move);
    if (!Rules.moves(pos, mv0.from).includes(mv0.to)) ok = false; else pos = Rules.apply(pos, mv0);
    for (let i=1;i<m.steps.length;i++){ const st=m.steps[i];
      const mv = Rules.coerce(pos, st.expect);
      if (!mv || !Rules.moves(pos,mv.from).includes(mv.to)) { ok=false; break; }
      pos = Rules.apply(pos,mv);
      if (st.reply){ const r=Rules.coerce(pos,st.reply.move);
        if(!r||!Rules.moves(pos,r.from).includes(r.to)){ok=false;break;} pos=Rules.apply(pos,r); } }
    return ok; })()`);
  t('every puzzle move is legal in sequence', pLegal);

  console.log('\n' + (errors.length ? 'FAILURES:\n - ' + errors.join('\n - ') : 'ALL NEW SUBSYSTEMS PASS'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('FATAL', e.stack); process.exit(1); });
