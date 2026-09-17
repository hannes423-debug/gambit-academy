# The Academy

The Academy is Gambit Academy's curriculum layer: a path from absolute beginner
to roughly 2000+ strength, built on the same single-file app, board and rules
as the original missions. This document is for whoever writes the next lesson.

## The one rule

**Engine evaluation is verification, not pedagogy.**

A move has three qualities, and they are allowed to disagree:

| Quality | Question it answers | Where it lives |
|---|---|---|
| Objective | What does Stockfish think? | `engineEval`, `mateScore`, `engineRank` |
| Practical | What will a human *of this strength* get out of it? | `calculationDepth`, `onlyMoveRisk`, `positionVolatility`, … → `Academy.executionRisk()` |
| Instructional | What should *this lesson, at this level* teach? | `conceptAlignment`, `pedagogicalQuality`, `recommendedRatingMin/Max` |

So `Nxf7! +1.8` can be the engine's move, `O-O +1.3` the practical and
instructional move for a 600-rated learner, and Nxf7 the expected move for an
1800. `tools/academy.test.js` asserts exactly this case.

Moves are compared in **win probability**, not centipawns (the Lichess curve,
`Academy.winPct`). +7.8 vs +7.4 is no difference; +0.5 vs −0.5 is a real one.
Inside a decided position (both moves ≥ 80 % or ≤ 20 %) gaps shrink further.
How forgiving the labels are scales with rating (`Academy.tolerance`): 1.6× at
beginner, 1.0× at 1200, 0.55× at 2100+.

Evaluations are shown to learners only from Academy 1600 and only when the gap
is large enough to mean something (`Academy.evalVisible`).

## Academy rating

An internal instructional stage in 100-point bands (`Academy.BANDS`), never
presented as FIDE, Chess.com or Lichess. It is derived from **nine skill
estimates** (board vision, tactics, calculation, strategy, pawn play,
endgames, openings, defense, practical play). Each moves Elo-style against the
exercise's rating. The overall number blends the learner's chosen starting
stage until a skill has ten rated exercises behind it (`Academy.overall`).

Feedback is pitched at the rating of the exercise's main skill once it has
three data points, otherwise the overall rating (`Academy.ratingFor`).

Nothing is locked. Prerequisites and mastery decide what is **recommended**
(`Academy.recommended`, `Academy.conceptStatus`), not what is allowed.

## Placement

`AcademyRunner.startPlacement()` runs six to nine positions drawn from the
**existing exercise pool** — nothing is authored specially for it, so nothing
it asks is unverified. Guided items are skipped (their label gives the answer
away) and a concept is never asked twice while untouched concepts remain.

The estimate is a **fit, not a walk**: `Academy.placementFit` grid-searches the
rating that best explains the answers under the same logistic curve the skill
estimates use, with a weak prior (sigma 500) towards the starting guess. An Elo
walk was tried first and sat about 200 points high at the bottom of the range,
because its early steps are large and the pool has no items below 30.

- it stops early once the bracket (`lo`/`hi`) is within 200 points
- solving everything reports `ceiling` and names the hardest item, because the
  pool runs out before strong players do; missing everything reports `floor`
- **answers are not practice**: `recordAttempt` sends them to the session only,
  so a cold test leaves no mastery, no review debt and no skill evidence
- the result applies `AcademyStore.place()` and points at the highest written
  lesson at or below the stage — not the first unmet prerequisite, which with a
  cold profile would send a 1200 to board coordinates

`tools/academy.test.js` simulates learners of known strength against it, and
the jsdom harness runs the whole flow including "I don't know".

## Mastery and review

Per concept the store keeps attempts, successes, the last ten scores, failure
categories, hints, solve time, the days with a success, mastery, last review
and next review (`Academy.newConcept`).

- **Mastery** weights recent results most, and is capped at 45 % below three
  attempts and at 60 % until successes happen on two different days. One good
  session is never "learned".
- **Scheduling** is SM-2 flavoured: a miss returns in 10 minutes, clean
  successes go out 1 → 3 → interval × ease days, stretched further for
  well-mastered concepts, capped at 180 days.
- **Mixed review** (`Academy.buildReview`) puts overdue and weak concepts first,
  mixes in other known concepts and at least one *quiet* position per four
  items, never includes guided exercises, never shows a label, and avoids two
  items on the same motif back to back.
- **Mastery tests** (`Academy.buildMasteryTest`) hide the lesson's own items
  among exercises from other concepts at or below the lesson's band.

## Lessons

A lesson (`ACADEMY_LESSONS`) is a list of stages:

1. `intro`: two or three sentences, never a wall of text
2. `demo`: frames with `marks` (`key`, `attack`, `target`), coloured `arrows`, an optional `move` to animate, `fen` resets and `orientation`. Back, replay and next are built in.
3. `exercise` → `guided`: the label is shown ("Find the fork") and hints reveal progressively
4. `exercise` → `transfer`: the same concept in a visually different position, often the other colour
5. `exercise` → `recognition`: "What would you play?", with the motif never named
6. `exercise` → `defense`: stop the opponent's version of the idea
7. `minigame`: play the resulting position against Stockfish (tablebase or greedy fallback offline). Goals are `material`, `promote`, `hold` or `mate`.
8. `mastery`: `{ own, others }` items drawn at run time

## Exercises and candidate moves

```js
{ id, conceptId, stage, band, rating, fen, orientation?, label, prompt,
  kind?: 'square',            // coordinate exercises tap a square: target:'e4'
  policy: 'target' | 'sound', // one lesson move, or any sound move passes
  goal?: { type:'capture'|'check'|'safeCheck'|'mate'|'reach'|'safe'|'prevent'|'pin', … },
  threat?: { move, target? | mate:true, text },   // drives MISSED_THREAT
  quiet?: true,               // no tactic here: used against "puzzle brain"
  hints: [string | { text, show:'from'|'to'|'target' }],
  candidates: [CandidateMoveAnalysis],
  fallback: { outcome, category, feedback } }
```

A `CandidateMoveAnalysis` (`Academy.candidate` lists every field) needs only
what differs from the defaults. The ones that matter most:

- `engineEval` (centipawns, side to move) or `mateScore`, or `tb:'win'|'draw'|'loss'` for tablebase positions
- `feedback`: a string, or `[{ min, max?, text }]` variants by Academy rating
- `category`: failure category for a move that retries or fails
- `labelByRating` / `outcomeByRating`: pedagogical overrides ("fine at 600, inaccurate at 1900")
- `accept: true` / `outcome`: explicit authoring when the engine numbers would mislead
- `claim`: attach a rule of thumb from `ACADEMY_CLAIMS`
- `whyBetter`: shown to a learner who played something else, when useful

Moves that are not listed still get judged: hanging pieces
(`Academy.hangingAfter`), threats that still work (`Academy.threatStillWorks`),
unmet goals, and illegal attempts (`Academy.explainIllegal`, e.g. "Your king
cannot move to e2 because the bishop on b5 controls that square").

### Live engine judgement

Authored candidates cannot cover every legal move. When Stockfish is running
(`AcademyRunner.liveEnabled()`, Settings → Engine turns it off) an **unlisted**
move is scored before and after, both from the mover's side, and
`Academy.judgeLive` refines the verdict:

- a sound move that simply is not the lesson's idea becomes a **retry**, and
  keeps the authored line that says what the exercise practises
- a move that meets the exercise's goal but throws the position away
  **fails** — `TACTICAL_MISS` for a blunder, `POSITIONAL_INACCURACY` for a
  mistake
- an authored `fallback.outcome`, and any move that *is* in `candidates`, are
  never overridden
- win percentages appear in the text only where `evalVisible` allows them

The same rating tolerance and decided-position shrink apply as for authored
candidates, so at Academy 400 a 5 % slip is still "sound" and at 2100+ it is
not. The engine runs while the piece slides and is capped at 3.5 s; if it does
not answer, the authored verdict stands. `tools/live.test.js` runs this path
against the real engine (`npm run verify:academy`), and `tools/academy-ui.js`
drives it in the browser with a scripted worker.

### Failure categories

`ILLEGAL_MOVE` · `WRONG_SQUARE` · `HANGING_PIECE` · `MISSED_THREAT` ·
`TACTICAL_MISS` · `WRONG_MOVE_ORDER` · `RIGHT_PLAN_WRONG_EXECUTION` ·
`MISSED_DEFENSIVE_RESOURCE` · `POSITIONAL_INACCURACY` ·
`ENDGAME_OUTCOME_CHANGE` · `PLAYABLE_NOT_BEST` · `THEORY_MISUNDERSTANDING` ·
`MISSED_OBJECTIVE`

### Outcomes

`correct` and `accepted` pass. `retry` means a sound move that is not what the
exercise practises: no failure is recorded and the board resets. `fail` opens
the feedback sheet and is recorded once per exercise visit.

## Positions the build tool rejected

Worth knowing before authoring the next batch, because each of these looked
right on paper:

- **A "quiet" position where White was in check.** A bishop on b4 checks a king
  on e1 along b4–e1, so every quiet move in the exercise was illegal. The same
  bishop also made `Qd8` not mate, because it could interpose on f8.
- **Doubled rooks capture with the FRONT rook.** `Re1xe8` with your own rook on
  e2 is not a move. Three exercises and two demos had it backwards.
- **A defender that was not defending.** A knight on b4 still covers d5; a pawn
  on c5 no longer covers d5 but one on c6 does; a knight on c3 does not defend
  d2 but one on b3 does. Check the actual square, not the story.
- **A demo frame playing the wrong side's move.** A demo starts from the FEN's
  side to move, so `fen: '... w'` followed by a Black move fails.
- **Positions that were simply lost.** K+R against K+N+P with the pawn one step
  from promoting is a tablebase loss, so no "winning idea" exists to teach.
- **Squares the piece could not reach.** A queen on c3 cannot take on b5; a
  queen on d5 does not attack b4; a pawn on b2 cannot capture on c4.

## Avoiding puzzle brain

Every lesson from 400 up includes at least one `quiet` position where the
best move is development, a retreat, luft, a queen trade, a rook to the open
file, or where several moves are equally fine. Those positions feed mixed
review and mastery tests, so a learner cannot assume "there must be a tactic".

## Durability of knowledge

Every topic, lesson and exercise is tagged `TIMELESS`, `MOSTLY_TIMELESS`,
`THEORY_SENSITIVE` (revalidate every two years) or `CURRENT_THEORY` (yearly).
A 1970s lesson on opposition is timeless. A 1970s claim that a variation is
forced needs `node tools/verify-academy.js` again.

## Competing advice

`ACADEMY_CLAIMS` stores rules of thumb whose wording matures with the learner
(`ACADEMY.claimText(id, rating)`) and why teachers disagree:
`LEVEL_DEPENDENT`, `TIME_CONTROL_DEPENDENT`, `STYLE_OR_REPERTOIRE_CHOICE`,
`OUTDATED_THEORY`, `ENGINE_DEPTH_DIFFERENCE`, `PEDAGOGICAL_SIMPLIFICATION`,
`TINY_EVALUATION_DIFFERENCE`, `ACTUAL_ERROR`.

## Provenance

Every lesson, exercise, claim and import carries: `sourceType`, `sourceName`,
`sourceId`, `sourceUrl`, `license`, `attributionRequired`, `retrievedAt`,
`originalOrAdapted`, `humanReviewed`, `notes`. `Academy.validateProvenance`
refuses licences that do not permit redistribution, licences that need
attribution without `attributionRequired`, and anything *adapted* from
protected instruction (Chess.com, Chessable, YouTube, commercial books and
courses). Those sources may inform topic choice and sequencing. The shipped
text and positions are always original.

The workflow for a new idea is: **discover it → verify it independently →
find or compose positions → check them with the engine or tablebase → write
original explanations.**

## Keying a candidate move

`Academy.judge` looks a candidate up by `Rules.key(mv)` plus the promotion
letter **only when it is not a queen**, because a queen is the default. A spec
that authors `b7b8q` and stores it verbatim produces an exercise where the
right answer is unfindable, and the only symptom is every attempt judging as a
failure. `tools/author/build.js` now normalises every candidate key
(`keyOf`), and `academy.test.js` asserts each move exercise has a move that
judges as correct at its own band — which is what caught it.

## Authoring checklist

1. Compose the position and every candidate with `Rules`-legal moves.
2. Score each candidate with the bundled engine (depth ≥ 16), or with the tablebase for ≤ 7 pieces. Use `tools/lib/engine.js`.
3. Write feedback for at least one success and two distinct failures, with rating variants where the right message changes by level.
4. Run `npm test` (legality, categories, outcomes, provenance, UI).
5. Run `npm run verify:academy` (fresh engine and tablebase check, which exits 1 on drift).

Mistakes this process has already caught: `…Bg4` does not pin the f3 knight
while White's e2 pawn is still home. The original pawn-fork mission had White
already two pieces down, with `d5` losing to `…Bxd5`. And `Bf5` in the pin
lesson "attacks the queen" but is mate in one for Black, because it unblocks
the d-file.

## Imported review items

`tools/import/puzzle-exercises.js` turns the CC0 Lichess puzzle database into
Academy review items — the step between a raw import and something that can
teach. It writes `content/academy/imported/<concept>.json` (committed, small)
and regenerates **SECTION 34b** (`ACADEMY_IMPORTED`), which joins the pool
beside the hand-written exercises. The engine evaluations are cached next to
the JSON, so a rebuild needs neither the shards nor the engine:
`node tools/import/puzzle-exercises.js --rebuild`.

What it refuses to keep:

- a line longer than two solver moves, or one needing more than two moves of
  calculation — only the **first** answer move is judged
- any position where the puzzle's answer is not the engine's own first choice
  at depth 18, MultiPV 4
- any position where the runner-up is less than 10 win% worse: a review item
  with two right answers teaches nothing
- any position that does not actually show the motif, tested against the
  position itself (`Academy.pinsBy`, `attacksFrom`, `attackers`), not the
  puzzle's theme tags
- with `--variety`, a second example of the same shape (which piece does it,
  with or without check). Beginner fork puzzles are almost all knight checks;
  without this the batch is six of the same idea.

The explanation is generated from the verified position ("the knight attacks
the king on e7 and the rook on a7 at the same time"), never from the tags.
Provenance is `imported`, CC0, `humanReviewed:false`, with the puzzle's URL.

## Datasets

See [the README](../README.md#importing-datasets). Nothing large is committed.
Importers write NDJSON shards and a manifest under `data/`, which git ignores.
