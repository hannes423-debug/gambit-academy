const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local/' });
const { window } = dom;
if (!window.matchMedia) window.matchMedia = q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
window.addEventListener('error', e => errors.push('window error: ' + e.message));

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => window.document.querySelector(s);
const txt = s => { const e = $(s); return e ? e.textContent.trim().replace(/\s+/g, ' ') : '(missing)'; };
const click = s => { const e = $(s); if (!e || e.disabled) { errors.push('cannot click: ' + s); return false; } e.click(); return true; };
const ev = code => window.eval(code);
const tap = sq => ev("Board.tap(Rules.idx('" + sq + "'))");
const btn = () => { const b = $('#lsActions .btn:not([disabled])'); return b ? { act: b.dataset.act, label: b.textContent.trim() } : null; };

/** Press whatever the single lesson button currently is, and report it. */
async function press(expectAct){
  const b = $('#lsActions .btn:not([disabled])');
  if (!b) { errors.push('no enabled lesson button (expected ' + expectAct + ')'); return { act:null, label:'' }; }
  const act = b.dataset.act, label = b.textContent.trim();
  if (expectAct && act !== expectAct) errors.push('expected "' + expectAct + '", found "' + act + '"');
  b.click();
  await wait(800);
  return { act, label };
}

(async function(){
  await wait(300);
  console.log('— boot —');
  console.log('path nodes:', window.document.querySelectorAll('.node').length,
              '| hero:', txt('#pathHero .hero__title'), '| xp:', txt('#xpChip'));
  for (const s of ['learn','review','profile']) { ev("show('" + s + "')"); await wait(60); }
  console.log('learn:', window.document.querySelectorAll('#learnBody .subject').length,
              'cards | review:', window.document.querySelectorAll('#reviewBody .rev').length,
              '| profile rows:', window.document.querySelectorAll('#profileBody .mrow2').length);

  console.log('\n— Caro-Kann mission 1, one tap per beat —');
  ev("Lesson.start('ck-1')"); await wait(150);
  console.log('1.', txt('#lsText').slice(0, 50) + '…  [' + btn().label + ']');
  await press('next');
  console.log('2.', txt('#lsText').slice(0, 50) + '…  [' + btn().label + ']');
  await press('next');

  console.log('3. prompt:', txt('#lsText'), '| arrow:', $('#arrows').innerHTML.includes('line'));
  click('#lsActions [data-act="hint"]'); await wait(60);
  console.log('4. hint:', txt('#lsText').slice(0, 44) + '…');
  tap('c7'); await wait(40); tap('c6'); await wait(700);
  console.log('5. success:', txt('#lsText').slice(0, 48) + '…  [' + btn().label + ']');
  await press('reply');
  console.log('6. reply:', txt('#lsText').slice(0, 48) + '…  [' + btn().label + ']');
  await press('next');

  console.log('\n— mistake → consequence, stepped —');
  tap('a7'); await wait(40); tap('a6'); await wait(1200);
  console.log('verdict:', txt('#sheetBody .verdict__label'), '|', txt('#sheetBody .verdict__move'));
  click('#sheetBody [data-act="see-why"]'); await wait(900);
  let guard = 0;
  while ($('#lsActions [data-act="line-next"]') && guard++ < 8){
    const before = txt('#lsText').slice(0, 42);
    const b = await press('line-next');
    console.log('   ' + before + '…  → [' + b.label + ']');
  }
  console.log('rescue:', txt('#sheetBody .rescue h4'), '| items:',
              window.document.querySelectorAll('#sheetBody .consequence li').length,
              '| coach:', txt('#lsText').slice(0, 42) + '…');

  click('#sheetBody [data-act="recover"]'); await wait(500);
  console.log('\n— recovery —');
  console.log('prompt:', txt('#lsText').slice(0, 58) + '…');
  tap('h7'); await wait(40); tap('h6'); await wait(1600);
  console.log('wrong try:', txt('#lsText').slice(0, 42) + '…');
  tap('c6'); await wait(40); tap('c5'); await wait(1100);
  console.log('solved:', ev("Lesson.stats.recovery"), '| defence:', Math.round(ev("P.mastery.defence") * 100) + '%');
  await press('rec-done');

  console.log('\n— finish the mission —');
  tap('d7'); await wait(40); tap('d5'); await wait(800);
  await press('reply'); await press('next');
  tap('d5'); await wait(40); tap('e4'); await wait(800);
  await press('reply'); await press('next');
  console.log('final teach:', txt('#lsText').slice(0, 44) + '…');
  await press('next');

  console.log('\n— complete —');
  console.log('open:', $('#done').classList.contains('is-open'), '| grade:', txt('.done__grade'),
              '| stars:', window.document.querySelectorAll('#doneStars .lit').length);
  await wait(1000);
  console.log('tiles:', [...window.document.querySelectorAll('.tile')].map(t => t.textContent.trim().replace(/\s+/g, ':')).join(' '));
  console.log('record:', JSON.stringify(ev("P.missions['ck-1']")), '| xp:', ev("P.xp"));

  click('[data-act="replay"]'); await wait(300);
  console.log('replay at step', ev("Lesson.i"));
  click('[data-act="exit-lesson"]'); await wait(200);

  ev("show('review')"); await wait(60);
  click('[data-act="start-review"]'); await wait(400);
  console.log('\nreview:', ev("Lesson.m.id"), '| mode:', ev("Lesson.mode"), '| step:', ev("Lesson.step().type"));

  console.log('\n— booting every mission —');
  const ids = Object.values(ev("IDX.mission")).filter(m => m.playable).map(m => m.id);
  for (const id of ids){
    try {
      ev("Lesson.start('" + id + "')"); await wait(70);
      const pieces = window.document.querySelectorAll('.pc').length;
      process.stdout.write(pieces > 0 && btn() ? '·' : ('[' + id + ' broken]'));
    } catch(e){ errors.push(id + ': ' + e.message); }
  }
  console.log('  (' + ids.length + ' missions)');

  ev("show('profile')"); await wait(50);
  click('[data-act="open-settings"]'); await wait(80);
  click('[data-act="reset-zero"]'); await wait(150);
  console.log('\nreset: xp', ev("P.xp"), '| missions', Object.keys(ev("P.missions")).length);

  console.log('\n' + (errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO RUNTIME ERRORS'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('FATAL', e); process.exit(1); });
