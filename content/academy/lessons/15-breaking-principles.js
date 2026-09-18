/* Band 700, the last gap: when an opening principle may be broken. The three
   rules of thumb the Academy already stores as claims — knights before
   bishops, never play f3, no early queen — all have honest exceptions, and
   this lesson is where the learner meets one.
   Spec format: see tools/author/build.js. Text is original to Gambit Academy. */
const MISS = { outcome:'retry', category:'MISSED_OBJECTIVE' };

module.exports = [
{ id:'breaking-principles', title:'When principles may be broken', band:700, branch:'openings', durability:'MOSTLY_TIMELESS',
  skills:{ openings:.5, strategy:.5 }, prerequisites:['opening-development'], mastery:{ targetMs:45000 },
  claims:['early-queen','knights-before-bishops','never-play-f3'],
  intro:'Opening principles are summaries of what usually works, not rules. Break one when you have a <b>concrete reason</b> — a capture, a threat, a square you have to take right now — and never because you feel like it. The useful version of a principle is "this is the default; here is the evidence that overrules it".',
  demo:{ fen:'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', frames:[
    ['Black has broken a principle: the queen is out on move two, after 1.e4 d5 2.exd5 Qxd5.', { marks:'target:d5' }],
    ['The reason is concrete — she is recapturing a pawn, and no white piece can hit her yet.', { marks:'key:d5' }],
    ['But the principle still has teeth: Nc3 develops and gains a tempo on her, and Black has to spend a move going back.', { move:'b1c3', arrows:'c3-d5 red' }] ]},
  exercises:[
    { stage:'guided', fen:'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', label:'Punish the exception', prompt:'Black\'s queen came out early with a reason. Play the move that makes her pay for it anyway.',
      answer:'b1c3', claim:'early-queen',
      hints:['Develop a piece that attacks something.', 'Which knight can hit the queen on d5?', '@to'],
      success:'Nc3 — the engine\'s first choice, and a developing move with a threat. Breaking a principle for a concrete reason is fine; it still costs you time if your opponent knows what to do about it.' },
    { stage:'transfer', kind:'square', fen:'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', target:'d5',
      label:'The reason', prompt:'Tap the black queen — and notice what she is standing on.',
      hints:['She is on the square where a white pawn used to be.', '@target'],
      success:'d5. The queen came out to recapture, which is a reason. "I wanted to attack h7" is not one.' },
    { stage:'recognition', fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', quiet:true, prompt:'What would you play?',
      answer:['g1f3','b1c3','f1c4','d2d4'], policy:'sound',
      hints:['No captures, no threats, no reason to break anything.', 'Develop a piece towards the centre.'],
      success:'With no concrete reason on the board, the principles are the plan: develop a piece, prefer the centre, leave the queen at home. Defaults exist for the positions where nothing special is going on.',
      allowWorse:8, allowWorseWhy:'All four are standard second moves; the lesson is that no exception applies here.',
      notes:{ d1h5:Object.assign({ feedback:'Qh5 breaks the early-queen principle with no concrete reason: …Nf6 or …g6 gains time on her and you are behind.' }, MISS),
              f2f3:Object.assign({ feedback:'f3 takes your knight\'s best square and weakens the diagonal to your own king — the principle holds here.' }, MISS) } },
    { stage:'test', kind:'square', fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', target:'f3',
      label:'The square the rule protects', prompt:'Tap the square that "never play f3" is really about — the one your knight wants.',
      hints:['Where does the king-side knight belong?', '@target'],
      success:'f3 — the principle is not superstition about a pawn move, it is about the square. Every rule of thumb is shorthand for a concrete cost, and knowing the cost is what tells you when you can pay it.' } ] }
];
