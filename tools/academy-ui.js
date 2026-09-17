/* Boots index.html in jsdom and drives the Academy like a learner: browse,
   open a topic, run a lesson by tapping squares, fail, retry, take hints, play
   a mini-game move, finish, then check the progress and the legacy lessons. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://local/' });
const { window } = dom;
if (!window.matchMedia) window.matchMedia = q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
window.addEventListener('error', e => errors.push('window error: ' + e.message));
window.fetch = () => Promise.reject(new Error('offline in tests'));

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => window.document.querySelector(s);
const $$ = s => [...window.document.querySelectorAll(s)];
const ev = c => window.eval(c);
const txt = s => { const e = $(s); return e ? e.textContent.trim().replace(/\s+/g, ' ') : '(missing)'; };
const t = (label, ok, extra) => { console.log((ok ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : '')); if (!ok) errors.push(label); };
const click = sel => { const e = $(sel); if (!e || e.disabled) { errors.push('cannot click ' + sel); return false; } e.click(); return true; };
const tap = sq => ev("Board.tap(Rules.idx('" + sq + "'))");
async function move(uci){ tap(uci.slice(0, 2)); await wait(30); tap(uci.slice(2, 4)); await wait(650); }
const step = () => ev('AcademyRunner.step()');
async function until(fn, ms){ const end = Date.now() + (ms || 3000); while (Date.now() < end){ if (fn()) return true; await wait(40); } return false; }

(async function(){
  await wait(300);
  console.log('— academy screen —');
  $('[data-nav="academy"]').click(); await wait(80);
  t('academy screen active', !!$('#screen-academy.is-active'));
  t('nav has six tabs', $$('.nav__btn').length === 6);
  t('hero shows an academy rating', /Academy rating/.test(txt('.ac-hero')), txt('.ac-hero__rating'));
  t('skill profile lists nine skills', $$('.ac-skill').length === 9);
  t('twelve branch filters plus All', $$('.ac-branch').length === 13);
  t('seeded topics render as cards', $$('.ac-topic').length >= 10, $$('.ac-topic').length + ' topics');
  t('planned topics are shown as planned', $$('.ac-topic--planned').length > 0);

  $('.ac-branch[data-id="endgames"]').click(); await wait(40);
  const endgameTopics = $$('.ac-topic .ac-topic__t').map(e => e.textContent);
  t('branch filter narrows the list', endgameTopics.indexOf('Opposition') >= 0 && endgameTopics.indexOf('The fork') < 0, endgameTopics.length + ' endgame topics');
  $('.ac-branch[data-id="all"]').click(); await wait(40);

  const collapsed = $('.ac-stage__head[aria-expanded="false"]');
  if (collapsed){ const band = collapsed.dataset.id; collapsed.click(); await wait(30);
    t('a collapsed stage opens', $('.ac-stage__head[data-id="' + band + '"]').getAttribute('aria-expanded') === 'true'); }

  ev("academyTopicSheet('deflection')"); await wait(40);
  t('topic sheet shows prerequisites', /Builds on/.test(txt('#sheetBody')) && /The fork/.test(txt('#sheetBody')));
  t('prerequisites never lock the lesson', !$('#sheetBody [data-act="ac-start"]').disabled);
  ev("Sheet.close()");
  ev("academyTopicSheet('philidor')"); await wait(40);
  t('a planned topic says it is not written yet', /not been written yet/.test(txt('#sheetBody')));
  ev("Sheet.close()");

  console.log('\n— placement —');
  ev("academyPlacementSheet()"); await wait(30);
  $('.ac-place__b[data-id="600"]').click(); await wait(60);
  t('placement changes the academy rating', ev("Academy.overall(AcademyStore.load())") === 600, String(ev("Academy.overall(AcademyStore.load())")));

  console.log('\n— fork lesson —');
  ev("AcademyRunner.start('academy-fork')"); await wait(120);
  t('lesson screen opens', !!$('#lesson.is-active') && /Academy/.test(txt('#lsCourse')), txt('#lsMission'));
  t('starts with the introduction', step().kind === 'intro' && /fork/.test(txt('#lsText')));
  click('#lsActions [data-act="ac-next"]'); await wait(80);
  t('demo frame 1 highlights targets', step().kind === 'demo' && $$('#board .sq.target').length === 2, $$('#board .sq.target').length + ' targets');
  click('#lsActions [data-act="ac-frame-next"]'); await wait(700);
  t('demo frame 2 animates Nf7+ and draws two arrows', ev("Board.pos.board[Rules.idx('f7')]") === 'N' && $$('#arrows line').length === 2);
  click('#lsActions [data-act="ac-frame-back"]'); await wait(80);
  t('rewind goes back a frame', ev("AcademyRunner.frame") === 0 && ev("Board.pos.board[Rules.idx('e5')]") === 'N');
  click('#lsActions [data-act="ac-frame-replay"]'); await wait(80);
  for (let k = 0; k < 4; k++){ click('#lsActions [data-act="ac-frame-next"]'); await wait(650); }
  t('guided exercise reached', step().kind === 'exercise' && step().ex.id === 'fork-knight-check', txt('#lsText').slice(0, 60));

  /* an illegal attempt is explained */
  tap('e5'); await wait(20); tap('e3'); await wait(80);
  t('illegal knight move is explained', /Knights move in an L/.test(txt('#lsText')), txt('#lsText').slice(0, 80));

  /* hints, three levels */
  click('#lsActions [data-act="ac-hint"]'); await wait(30);
  t('hint 1: forcing move', /forcing move/.test(txt('#lsText')));
  click('#lsActions [data-act="ac-hint"]'); await wait(30);
  t('hint 2: can you give check', /give check/.test(txt('#lsText')));

  /* a real miss: the rich failure sheet */
  await move('c2b3'); await wait(200);
  t('failure sheet opens with a category, never just "wrong"', $('#sheet.is-open') && /tactic was available/i.test(txt('#sheetBody')), txt('#sheetBody .verdict__label'));
  click('#sheetBody [data-act="ac-retry"]'); await wait(120);
  t('try again restores the position', ev("Board.pos.board[Rules.idx('c2')]") === 'B' && ev("Board.interactive"));

  await move('e5f7');
  t('correct move explains why', /Nf7\+/.test(txt('#lsText')) && /Pattern/.test(txt('#lsText')), txt('#lsText').slice(0, 70));
  const rec = ev("AcademyStore.load().concepts.fork");
  t('the miss was recorded once, with its category', rec && rec.attempts === 1 && rec.successes === 0 && rec.failures.TACTICAL_MISS === 1, JSON.stringify(rec && rec.failures));
  click('#lsActions [data-act="ac-next"]'); await wait(80);

  t('transfer: Black to move, board flipped', step().ex.id === 'fork-knight-black' && ev("Board.flip") === true);
  await move('d4e2');
  t('transfer solved first try', ev("AcademyStore.load().concepts.fork.successes") === 1);
  click('#lsActions [data-act="ac-next"]'); await wait(80);

  t('recognition prompt does not name the motif', step().ex.id === 'fork-pawn' && !/fork/i.test(txt('#lsText')), txt('#lsText'));
  await move('d4d5');
  click('#lsActions [data-act="ac-next"]'); await wait(80);

  t('defence exercise', step().ex.id === 'fork-prevent');
  await move('a2a3'); await wait(200);
  t('missed threat is named', /missed their threat/i.test(txt('#sheetBody')), txt('#sheetBody .verdict__label'));
  click('#sheetBody [data-act="ac-retry"]'); await wait(100);
  await move('e1d2');
  t('an alternative defence (Kd2) is accepted', /Good/.test(txt('#lsText')), txt('#lsText').slice(0, 50));
  click('#lsActions [data-act="ac-next"]'); await wait(80);

  console.log('\n— mini-game —');
  t('mini-game step', step().kind === 'minigame' && ev("Board.interactive") === true);
  await move('h2h4'); await until(() => ev("Board.interactive") === true || ev("AcademyRunner.game.over"), 4000);
  t('opponent replies with a legal move (offline fallback)', ev("AcademyRunner.game.plies") === 2, 'plies=' + ev("AcademyRunner.game.plies"));
  click('#lsActions [data-act="ac-next"]'); await wait(80);

  console.log('\n— mastery test —');
  const tests = ev("AcademyRunner.steps.filter(s => s.test).length");
  t('mastery test mixes the lesson among other ideas', tests === 5 && ev("AcademyRunner.steps.filter(s => s.test && s.ex.conceptId !== 'fork').length") === 2);
  t('test items carry no label', ev("AcademyRunner.steps.filter(s => s.test).every(s => s.ex.showLabel === false)"));
  for (let k = 0; k < tests; k++){
    const ex = step().ex;
    if (ex.kind === 'square'){ tap(ex.target); await wait(80); }
    else {
      const best = ev("AcademyRunner.best().move");
      await move(best);
    }
    const good = /is-good/.test($('#lsCoach').className);
    if (!good) errors.push('mastery item ' + ex.id + ' not accepted: ' + txt('#lsText').slice(0, 60));
    click('#lsActions [data-act="ac-next"]'); await wait(100);
  }
  t('summary overlay opens', $('#done.is-open') && /Lesson complete/.test(txt('#doneBody')), txt('.done__grade'));
  t('summary shows mastery change and review timing', /%\s*→\s*\d+%/.test(txt('#doneBody')) && /review/.test(txt('#doneBody')));
  const fork = ev("AcademyStore.load().concepts.fork");
  t('mastery is below "mastered" after one sitting', fork.mastery < ev("Academy.MASTERED"), (fork.mastery * 100).toFixed(0) + '%');
  t('lesson completion stored', !!ev("AcademyStore.load().lessons['academy-fork']"));
  t('skills moved: tactics estimate has evidence', ev("AcademyStore.load().skills.tactics.n") >= 5);
  click('[data-act="ac-done"]'); await wait(80);
  t('back on the academy screen', !!$('#screen-academy.is-active') && /Learning/.test(txt('#academyBody')));

  console.log('\n— coordinates (square taps) —');
  ev("AcademyRunner.start('academy-coordinates')"); await wait(80);
  click('#lsActions [data-act="ac-next"]'); await wait(60);
  for (let k = 0; k < 4; k++){ click('#lsActions [data-act="ac-frame-next"]'); await wait(80); }
  t('square exercise reached', step().ex.id === 'coord-e4');
  tap('d5'); await wait(60);
  t('swapped coordinates get a specific explanation', /swapped/.test(txt('#lsText')), txt('#lsText').slice(0, 60));
  tap('e4'); await wait(60);
  t('correct square accepted', /Correct — e4/.test(txt('#lsText')));

  console.log('\n— mixed review —');
  ev("(function(){ const s = AcademyStore.load(); Object.values(s.concepts).forEach(c => { c.nextReview = Date.now() - 1000; }); AcademyStore.save(); })()");
  ev("AcademyRunner.startReview()"); await wait(80);
  t('review session starts with unlabeled items', ev("AcademyRunner.mode") === 'review' && ev("AcademyRunner.steps.every(s => s.ex.showLabel === false)"), ev("AcademyRunner.steps.length") + ' items');
  t('review prompt is neutral', /What would you play|Tap/.test(txt('#lsText')), txt('#lsText').slice(0, 50));
  click('[data-act="exit-lesson"]'); await wait(80);
  t('leaving returns to the academy', !!$('#screen-academy.is-active'));

  console.log('\n— legacy lessons still work —');
  ev("Lesson.start('fk-1')"); await wait(120);
  t('board hooks were handed back', ev("Board.onSquare") === null && ev("Board.onIllegal") === null && ev("AcademyRunner.active") === false);
  click('#lsActions [data-act="next"]'); await wait(80);
  tap('g5'); await wait(20); tap('f7'); await wait(700);
  t('legacy mission accepts Nf7', /Correct/.test(txt('#lsText')), txt('#lsText').slice(0, 40));
  click('[data-act="exit-lesson"]'); await wait(60);

  console.log('\n' + (errors.length ? 'FAILURES:\n - ' + errors.join('\n - ') : 'ACADEMY UI PASS'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('FATAL', e && e.stack); process.exit(1); });
