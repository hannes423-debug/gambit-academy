/* Re-verify every Academy exercise against the engine (and the tablebase for
   K+P positions). Slow — minutes, not seconds — so it is not part of npm test.

     node tools/verify-academy.js            engine check, depth 16
     node tools/verify-academy.js --depth 20
     node tools/verify-academy.js --tb       also query tablebase.lichess.ovh
     node tools/verify-academy.js --only fork-pawn,pin-queen
     node tools/verify-academy.js --legacy   also audit the original missions' expected moves

   What counts as drift: the authored eval and the fresh eval disagree by more
   than --tolerance win-percentage points (default 8), or a mate flips sign.
   That is deliberately loose — this guards against wrong CLAIMS, not against
   depth-to-depth noise. Exits 1 on drift. */
const { loadAcademy } = require('./lib/app.js');
const { Engine } = require('./lib/engine.js');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] || true) : null; };
const depth = +(opt('--depth') || 16), tolerance = +(opt('--tolerance') || 8);
const only = opt('--only') ? String(opt('--only')).split(',') : null;

const get = loadAcademy();
const Rules = get('Rules'), A = get('Academy'), EXERCISES = get('ACADEMY_EXERCISES');

const fmt = l => l ? (l.mate != null ? '#' + l.mate : (l.cp > 0 ? '+' : '') + (l.cp / 100).toFixed(2)) : '?';
const winOf = l => A.winPct(l.cp, l.mate);

(async function(){
  const engine = new Engine({ hash:64 });
  let drift = 0, checked = 0;
  for (const x of EXERCISES){
    if (x.kind === 'square' || (only && only.indexOf(x.id) < 0)) continue;
    const pos = Rules.parse(x.fen);
    const pieces = pos.board.filter(Boolean).length;
    const tb = args.indexOf('--tb') >= 0 && pieces <= 7;
    let tbData = null;
    if (tb){
      try { tbData = await (await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(x.fen))).json(); }
      catch (e){ console.log('  ! tablebase unreachable for ' + x.id); }
    }
    console.log('\n' + x.id + '  (' + x.fen + ')');
    for (const c of x.candidates || []){
      checked++;
      if (c.tb){
        if (!tbData){ console.log('    ' + c.move.padEnd(6) + ' tb:' + c.tb + '  (skipped — run with --tb)'); continue; }
        const m = tbData.moves.find(mm => mm.uci === c.move);
        /* tablebase move categories are from the OPPONENT's view after the move */
        const mine = m ? ({ loss:'win', win:'loss', draw:'draw' })[m.category] || m.category : null;
        const bad = mine !== c.tb;
        if (bad) drift++;
        console.log('    ' + (bad ? '✗ ' : '✓ ') + c.move.padEnd(6) + ' authored ' + c.tb + '  tablebase ' + mine);
        continue;
      }
      const line = await engine.scoreMove(x.fen, c.move, { depth });
      const authored = { cp:c.mateScore != null ? null : c.engineEval, mate:c.mateScore != null ? c.mateScore : null };
      const dWin = Math.abs(winOf(line) - A.winPct(authored.cp, authored.mate));
      /* a mate the search did not reach at this depth is fine if the score is still decisive the same way */
      const decisive = line.mate != null ? Math.sign(line.mate) : (Math.abs(line.cp) >= 1000 ? Math.sign(line.cp) : 0);
      const mateFlip = authored.mate != null && decisive !== Math.sign(authored.mate);
      const bad = dWin > tolerance || mateFlip;
      if (bad) drift++;
      console.log('    ' + (bad ? '✗ ' : '✓ ') + c.move.padEnd(6) + ' authored ' + fmt(authored).padStart(7) + '  engine ' + fmt(line).padStart(7) +
        '  Δwin ' + dWin.toFixed(1));
    }
    /* is anything missing? the engine's own top move should be a listed candidate */
    const top = (await engine.analyse(x.fen, { depth, multipv:1 }))[0];
    if (top && !(x.candidates || []).some(c => c.move === top.move) && !x.goal && x.policy !== 'sound')
      console.log('    ! engine top move ' + top.move + ' (' + fmt(top) + ') is not a listed candidate');
  }

  if (args.indexOf('--legacy') >= 0){
    console.log('\n— legacy missions: expected move vs engine best —');
    const CURRICULUM = get('CURRICULUM');
    for (const d of CURRICULUM) for (const course of d.courses || []) for (const m of course.missions || []){
      let pos = Rules.parse(Rules.START);
      for (const st of m.steps || []){
        if (st.fen) pos = Rules.parse(st.fen);
        if (st.type === 'teach'){ if (st.move) pos = Rules.apply(pos, Rules.coerce(pos, st.move)); continue; }
        const fen = Rules.toFEN(pos);
        const best = (await engine.analyse(fen, { depth, multipv:1 }))[0];
        const mine = await engine.scoreMove(fen, st.expect, { depth });
        const loss = winOf(best) - winOf(mine);
        const flag = loss > 10 ? '✗' : loss > 5 ? '~' : '✓';
        if (flag !== '✓') console.log('  ' + flag + ' ' + m.id + ' expects ' + st.expect + ' ' + fmt(mine) + '  engine ' + best.move + ' ' + fmt(best) + '  Δwin ' + loss.toFixed(1) + '  ' + fen);
        pos = Rules.apply(pos, Rules.coerce(pos, st.expect));
        if (st.reply) pos = Rules.apply(pos, Rules.coerce(pos, st.reply.move));
      }
    }
  }
  engine.quit();
  console.log('\n' + checked + ' candidates checked, ' + drift + ' drifted');
  process.exit(drift ? 1 : 0);
})();
