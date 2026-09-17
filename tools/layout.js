/* Layout probe, run through tools/cdp.py at a real emulated viewport.

   Note the bare identifiers: the app's objects are `const` inside script
   blocks, so they are NOT properties of window — but they are in scope for
   anything evaluated afterwards, which is what Runtime.evaluate does.

     python3 tools/cdp.py tools/layout.js --size 390x844 --mobile --shot /tmp/phone.png
     python3 tools/cdp.py tools/layout.js --size 1440x900 --shot /tmp/desktop.png

   It measures rather than eyeballs, because every layout bug this app has had
   was invisible in a screenshot until something was measured: a sibling screen
   that was never hidden ate half the flex column, a clamp floor fought an
   overflow:hidden, and an icon with no width rule rendered at 300px. Returns
   JSON; anything in `problems` is a real finding. */
const R = [];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const box = el => { const r = el.getBoundingClientRect(); return { w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y) }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const vw = window.innerWidth, vh = window.innerHeight;
const problems = [];
const note = (cond, msg) => { if (!cond) problems.push(msg); };

/* --- every screen, one at a time, measured after it is actually active --- */
async function screen(nav){
  const btn = document.querySelector('[data-nav="' + nav + '"]');
  if (!btn) return { nav, missing:true };
  btn.click();
  await wait(220);
  const sc = $('#screen-' + nav + '.is-active') || $('#screen-' + nav);
  const doc = document.documentElement;
  const out = { nav, active:!!$('#screen-' + nav + '.is-active'),
                pageScrollW:doc.scrollWidth, overflowX:doc.scrollWidth - vw,
                app:box($('.app') || doc), screen:box(sc) };
  /* a screen that is not active must not be taking up space */
  const ghosts = $$('.screen').filter(s => !s.classList.contains('is-active') && s.getBoundingClientRect().height > 1)
    .map(s => s.id + ' ' + box(s).h + 'px');
  out.ghostScreens = ghosts;
  note(!ghosts.length, nav + ': inactive screens still occupy space — ' + ghosts.join(', '));
  note(out.overflowX <= 0, nav + ': page scrolls sideways by ' + out.overflowX + 'px');
  return out;
}

const out = { viewport:{ w:vw, h:vh, dpr:window.devicePixelRatio }, screens:[] };
for (const nav of ['path', 'academy', 'learn', 'explore', 'review', 'profile']) out.screens.push(await screen(nav));

/* --- the six-tab nav has to fit, and stay tappable --- */
const nav = $('.nav');
const btns = $$('.nav__btn').map(b => box(b));
out.nav = { box:box(nav), buttons:btns.length, widest:Math.max(...btns.map(b => b.w)),
            shortest:Math.min(...btns.map(b => b.h)), wraps:btns.some(b => b.y !== btns[0].y),
            overflow:nav.scrollWidth - nav.clientWidth };
note(!out.nav.wraps, 'the nav wraps onto a second row');
note(out.nav.overflow <= 1, 'the nav scrolls horizontally by ' + out.nav.overflow + 'px');
note(out.nav.shortest >= 40, 'a nav button is only ' + out.nav.shortest + 'px tall');
/* icons inside a nav button: an icon holder with no size rule renders at its
   intrinsic size, which is how a 300px crown once burst out of the app bar */
out.bigIcons = $$('svg').map(s => ({ w:Math.round(s.getBoundingClientRect().width), cls:(s.parentElement || {}).className || '' }))
  .filter(s => s.w > 120);
note(!out.bigIcons.length, 'an svg renders wider than 120px: ' + JSON.stringify(out.bigIcons));

/* --- the Academy screen --- */
$('[data-nav="academy"]').click(); await wait(250);
out.academy = { hero:box($('.ac-hero')), topics:$$('.ac-topic').length, skills:$$('.ac-skill').length,
                branches:$$('.ac-branch').length };
note(out.academy.hero.w <= vw, 'the academy hero is wider than the viewport');
note(out.academy.topics > 0, 'no topic cards rendered');

/* --- the placement sheet, which is new --- */
/* 450ms, not 220: the sheet slides in over 300ms, and measuring mid-transition
   reported it hanging 11px below the fold when it does not. */
academyPlacementSheet(); await wait(450);
const sheet = $('#sheet');
const place = $$('#sheetBody .ac-place__b').map(box);
out.placement = { sheet:box(sheet), test:!!$('#sheetBody [data-act="ac-placement-test"]'),
                  stages:place.length, shortest:place.length ? Math.min(...place.map(b => b.h)) : 0,
                  bodyScroll:$('#sheetBody') ? $('#sheetBody').scrollHeight - $('#sheetBody').clientHeight : 0 };
note(out.placement.test, 'the placement sheet has no test button');
note(!place.length || out.placement.shortest >= 36, 'a placement stage button is only ' + out.placement.shortest + 'px tall');
note(box(sheet).y + box(sheet).h <= vh + 2, 'the open sheet hangs below the viewport');
Sheet.close(); await wait(200);

/* --- a lesson: the board is the thing that has broken before --- */
AcademyRunner.start('academy-fork'); await wait(300);
const nextBtn = () => $('#lsActions [data-act="ac-next"]') || $('#lsActions [data-act="ac-frame-next"]');
for (let i = 0; i < 8 && !(AcademyRunner.step() && AcademyRunner.step().kind === 'exercise'); i++){
  const b = nextBtn(); if (!b || b.disabled) break;
  b.click(); await wait(320);
}
/* There are two lesson boards in the markup (the legacy screen and this one),
   and querySelector returns the first — which is inside a hidden screen and
   measures 0x0. Take the one that is actually laid out. */
const vis = sel => $$(sel).find(el => el.getBoundingClientRect().height > 1) || $(sel);
const area = vis('.boardarea'), wrap = vis('.boardwrap'), board = vis('.board');
out.lesson = { step:(AcademyRunner.step() || {}).kind, area:box(area), wrap:box(wrap), board:box(board),
               sq:getComputedStyle(document.documentElement).getPropertyValue('--sqsize').trim(),
               coach:box($('#lsCoach')), actions:box($('#lsActions')), boards:$$('.boardarea').length,
               boardShareOfWidth:+(box(board).w / vw).toFixed(2) };
/* the 2026-08-25 bug in one line: a wrap taller than its area means a clamp
   floor is fighting overflow:hidden, and half the board is sliced off */
note(box(wrap).h <= box(area).h + 1, 'the board wrap (' + box(wrap).h + 'px) is taller than its area (' + box(area).h + 'px)');
note(box(board).w >= 240, 'the board is only ' + box(board).w + 'px wide');
note(box(board).w <= vw, 'the board is wider than the viewport');
note(box($('#lsActions')).y + box($('#lsActions')).h <= vh + 2, 'the lesson buttons sit below the fold');
note(document.documentElement.scrollWidth <= vw, 'the lesson screen scrolls sideways');

out.problems = problems;
return out;
