# Gambit Academy

A chess training app in a single HTML file. It teaches an idea, asks you to play
it, and when you get it wrong it tells you *what kind* of wrong, shows you what
happens next, and gives you the chance to fight your way back.

No build step, no framework, no npm at runtime. `index.html` is the whole app.

> **Don't just tell me I made a bad move. Teach me why it was bad, show me what
> happened, and give me the chance to fight my way back.**

---

## Running it

The app needs an **http origin**, not `file://`. Web Workers and WebAssembly are
blocked on file URLs, so opening `index.html` by double-clicking will work for
the lessons but silently disable the engine.

**GitHub Pages** — Settings → Pages → deploy from `main` / root. Works on any
phone, serves over HTTPS, and the engine works. Easiest option.

**Acode on Android** — open the folder and use Preview. Acode runs its own local
server, which is exactly the origin you need.

**Anything else** — `npm run serve` (or any static server) and open
`http://localhost:8080`.

---

## What's in it

**The Academy.** A curriculum from absolute beginner to 2100+, arranged in
100-point *Academy rating* stages (an instructional stage, not a FIDE, Chess.com or
Lichess rating) across twelve branches. The ten seeded lessons are board
coordinates, the rook, check, hanging pieces, the fork, the pin, opening
development, the opposition, open files and deflection. Each one runs intro →
animated demo → guided exercise → transfer → unlabeled recognition → defence →
mini-game against the engine → mastery test. The judgement is human-aware:
Stockfish's first choice is not automatically "correct", a move 0.15 worse is
not automatically "wrong", and the same move gets different feedback at 600,
1200 and 1900. Mistakes are classified (hanging piece, missed threat, wrong move
order, *Winning → Drawn*, …), mastery needs spaced success over several days,
and the learner has nine separate skill estimates instead of one number. All
the design rules are in [`docs/ACADEMY.md`](docs/ACADEMY.md).

**Guided lessons.** 24 missions across Foundations, Openings (Italian,
Caro-Kann, Sicilian, Queen's Gambit), Tactics (forks, pins, skewers, discovered
attacks) and Endgames (king and pawn, opposition, the Lucena bridge). Guided
mode highlights the piece, the square and draws an arrow; hints reveal
progressively and cost you stars.

**Mistakes are classified, never just "wrong".** Playable alternative,
inaccuracy, mistake or blunder — each with its own explanation. *See why* plays
the punishment line out one move per tap. Then *All is not lost* offers a
recovery challenge from the worse position. Skipping it costs nothing.

**Performance is kept separate from mastery.** Stars are how you played today.
Mastery is what you'll still know next month, and it only moves when you get it
right again after time has passed. Spaced repetition brings missions back when
your memory of them decays.

**Opening tree.** All 3,810 named openings, navigable move by move, with live
master statistics. Because the tree is indexed by *position* and not by move
order, transpositions resolve correctly — `1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4` and
`1.e4 g6 2.d4 Bg7 3.c4 d6 4.Nc3` both know they are a King's Indian.

**Punishing mistakes.** Any continuation that the book doesn't name *and*
masters essentially never play gets a ⚡ button. Stockfish evaluates the
position before and after, converts the swing to centipawns lost, classifies it
and lays out the refutation. If the engine says a rare move is actually fine, it
says so instead of inventing a punishment.

**Practise** turns whatever line you've explored into a real mission on the
lesson engine.

**Puzzles.** Import the Lichess puzzle database and it sorts millions of rated,
themed puzzles into the same courses the app already teaches.

---

## Setting up the engine

The repository ships `stockfish-18-lite-single.js` and its `.wasm`. Keep them
next to `index.html` and the app finds them automatically. Tap **Engine** on the
Explore tab, or Settings → Engine, to connect.

Two things that cost people hours:

- **Use a `-single` build.** The multi-threaded builds need `Cross-Origin-Opener-Policy`
  and `Cross-Origin-Embedder-Policy` headers, which a static host like GitHub
  Pages cannot send. Without them the engine silently falls back to
  single-threaded with no error in the console, so you chase a ghost.
- **Workers need an http origin.** See above.

You can point at a different build in Settings → Engine, or delete the binaries
entirely — the app falls back to a jsDelivr copy when online, and works fully
without any engine at all.

---

## Importing puzzles

1. Download `lichess_db_puzzle.csv.zst` from <https://database.lichess.org/>
2. Decompress it (`zstd -d lichess_db_puzzle.csv.zst`)
3. Settings → Puzzles → pick the file

The CSV is around a gigabyte, so the app streams it in 2 MB slices rather than
loading it whole. It keeps a filtered slice: rating 800–2000, popular puzzles
only, capped per theme. Nothing leaves your device.

Two things about the `Moves` column that trip everyone up: the moves are UCI,
not SAN, and the **first move is the opponent's** — it is played for you, and
the position you actually solve is the one after it.

---

## Architecture

Everything lives in `index.html` in numbered sections. The seams that matter:

| Section | What it is |
|---|---|
| `Rules` | Self-contained move generator: legal moves, castling, en passant, promotion, SAN with disambiguation. Swap in chess.js by replacing this object only. |
| `CURRICULUM` | All lesson content as data. Adding lessons means adding objects, never touching the UI. |
| `analyzeMove(step, pos, mv)` | The single place a move is judged. Reads lesson data, and consults Stockfish when it's available. |
| `Book` | The opening trie plus a lazily built position index for transpositions. |
| `Explorer` / `Tablebase` | Lichess API calls. Both optional; the app degrades cleanly without a connection. |
| `Engine` | Stockfish over UCI in a Worker, with three fallback sources. |
| `makeBoard()` | Board renderer factory. The lesson and the explorer each own one. `onSquare` / `onIllegal` hooks let the Academy take raw taps and explain illegal moves. |
| `Academy` (§33) | Pure model: bands, skills, win-probability judgement, candidate analysis, illegal-move explanations, mastery, scheduling, mixed review, provenance validation, educational quality. No DOM, and loaded as-is by the Node tools. |
| `ACADEMY_*` (§34) | Curriculum spine, lessons, exercises, rules of thumb. Data only. |
| `AcademyRunner` (§35) | Academy view, topic sheets and the lesson runner. It borrows the lesson screen and gives it back. |

Board sizing is done in JavaScript, not CSS. Some Android WebViews don't clamp
an `aspect-ratio` box with `max-width`, which let the board size itself from the
available *height* and overflow the screen. `Board.fit()` measures the leftover
space and sets explicit pixels.

The pieces are original vector artwork on the standard 45×45 viewBox, so any
other set drops into `PIECES` unchanged. Text glyphs are deliberately not used:
iOS substitutes its own symbol font for U+265A–265F and ignores the CSS colour,
which renders white pieces as black ones.

---

## Tests

```
npm install        # jsdom, for the two browser harnesses
npm test
```

- **`tools/validate.js`** — replays every mission through the move generator.
  Every FEN, expected move, alternative, consequence line and recovery position
  is checked for legality and correct side to move, plus explicit assertions
  that the tactics actually work: that Qg8 is mate, that the skewer's every
  legal reply hangs the queen, that the full Lucena bridge line is legal.
  This harness caught five real chess errors during development, including that
  Bb5 does *not* pin the c6 knight while Black's d7 pawn is still home.
- **`tools/playthrough.js`** — boots the app in jsdom and plays a mission end to
  end: guided move, hint, mistake, consequence, recovery, completion, replay.
- **`tools/subsystems.js`** — the opening book, transposition index, explorer
  merge, engine UCI parsing, punish flow and puzzle import.
- **`tools/academy.test.js`** — curriculum loading, legal positions and
  solutions, the chess claims the lessons make, illegal-move explanations,
  failure categories, multiple acceptable moves, engine-best vs practical vs
  instructional best, feedback by rating, mastery, scheduling, prerequisites,
  skills, provenance and licences, educational quality.
- **`tools/import.test.js`** — puzzle and PGN importers on synthetic fixtures,
  including licence refusal.
- **`tools/academy-ui.js`** — boots the app in jsdom and takes a learner
  through a whole Academy lesson, then checks that the original missions still work.

Every harness exits non-zero on failure (`validate.js` used to print
`FAILURES` and exit 0).

`npm run verify:academy` re-scores every Academy candidate with the bundled
Stockfish and checks K+P positions against the Lichess tablebase. It takes
minutes and needs a connection for the tablebase, so it is not part of `npm test`.

`tools/build-openings.js` regenerates the embedded opening book from the lichess
TSVs. Put `a.tsv`–`e.tsv` in `tools/data/` first.

---

## Importing datasets

Large datasets never go into git. Importers stream their input, write NDJSON
shards and a `manifest.json` under `data/` (ignored), and validate the
provenance record before writing anything.

```
npm run import:puzzles -- lichess_db_puzzle.csv.zst --min-popularity 50
npm run query:puzzles -- --motif fork --rating 650-800 --quality 0.7 --length 1
npm run import:games -- games.pgn --source-name "…" --source-url … --license CC0-1.0 --positions
npm run import:evals -- data/games/positions.ndjson --depth 18 --multipv 5
npm run import:tablebase -- data/games/positions.ndjson --limit 200
```

Puzzles are sharded by 100-point band with a per-band theme index, and each one
gets an educational-quality estimate (clean motif, visual clarity, depth,
ambiguity, …), so "Fork I" can prefer a clean one-move fork over a same-rated
puzzle with four overlapping motifs. Queries filter by rating, motif, phase,
opening, solution length, popularity, plays, calculation depth and quality.
The PGN importer replays every move through the app's rules and rejects
illegal games. It refuses research-only licences, and CC-BY material without
`--attribution`.

## Credits

- **Opening names and lines** — [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  CC0. 3,810 openings across ECO volumes A–E. No attribution required; given
  anyway, because the curation is the valuable part.
- **Opening statistics** — the [Lichess opening explorer](https://explorer.lichess.ovh),
  queried live. Please keep requests reasonable (roughly one per second).
- **Endgame results** — the [Lichess tablebase](https://tablebase.lichess.ovh),
  7-piece Syzygy, thanks to Ronald de Man and Bojun Guo.
- **Puzzles** — the [Lichess puzzle database](https://database.lichess.org/), CC0.
  Imported by you; not distributed here.
- **Engine** — [Stockfish](https://github.com/official-stockfish/Stockfish),
  via [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js).
- Chess pieces and all UI artwork are original to this project.

Not affiliated with Lichess. It just has the best free chess infrastructure on
the internet, and it is generous enough to let anyone use it.

---

## Licence

**This repository as a whole is GPL-3.0-or-later**, because it distributes
Stockfish binaries, which are GPLv3. See [`LICENSE`](LICENSE).

**Bundled Stockfish:** version 18.0.8, the `lite-single` WebAssembly build,
NNUE net `nn-9067e33176e`, unmodified. Its licence is
[`STOCKFISH-COPYING.txt`](STOCKFISH-COPYING.txt). Corresponding source:

- Build: <https://github.com/nmrugg/stockfish.js> (npm package `stockfish@18.0.8`)
- Engine: <https://github.com/official-stockfish/Stockfish>

**The application code and artwork** — `index.html` and `tools/` — are
additionally offered under the [MIT licence](LICENSE-MIT) at your option, taken
on their own without the bundled engine binaries. That keeps the lesson engine,
the board renderer and the piece set reusable in projects that can't take GPL.

The opening data is CC0 and carries no obligations either way.
