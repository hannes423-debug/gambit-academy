/* Stockfish as a Node subprocess.
   The bundled stockfish-18-lite-single.js has a Node CLI mode: spawn it and
   speak UCI on stdin. (Its in-process addMessageListener API does not exist.)

   Two traps worth knowing:
     · an engine silently IGNORES an illegal move in `position ... moves` and
       analyses the earlier position — always validate moves with Rules first;
     · scores are from the side to move. analyse() returns them that way and
       also as `white` for comparisons across positions. */
const { spawn } = require('child_process');
const path = require('path');

class Engine {
  constructor(opts){
    opts = opts || {};
    this.bin = opts.bin || path.join(__dirname, '..', '..', 'stockfish-18-lite-single.js');
    this.proc = spawn(process.execPath, [this.bin], { stdio:['pipe','pipe','ignore'] });
    this.buf = '';
    this.listeners = [];
    this.proc.stdout.on('data', d => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0){
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.listeners.slice().forEach(fn => fn(line));
      }
    });
    this.send('uci');
    this.ready = this.waitFor(l => l === 'uciok').then(() => {
      if (opts.hash) this.send('setoption name Hash value ' + opts.hash);
      this.send('isready');
      return this.waitFor(l => l === 'readyok');
    });
  }
  send(cmd){ this.proc.stdin.write(cmd + '\n'); }
  waitFor(pred){
    return new Promise(resolve => {
      const fn = line => { if (pred(line)){ this.listeners.splice(this.listeners.indexOf(fn), 1); resolve(line); } };
      this.listeners.push(fn);
    });
  }
  /** MultiPV analysis. Returns lines sorted by rank:
      [{ rank, move, cp, mate, pv:[uci], depth }]  (scores from side to move) */
  async analyse(fen, opts){
    opts = opts || {};
    await this.ready;
    const multipv = opts.multipv || 1;
    this.send('setoption name MultiPV value ' + multipv);
    this.send('ucinewgame');
    this.send('isready');
    await this.waitFor(l => l === 'readyok');
    const lines = {};
    const collect = line => {
      if (line.indexOf('info ') !== 0 || line.indexOf(' pv ') < 0) return;
      const g = re => { const m = re.exec(line); return m ? m[1] : null; };
      const rank = +(g(/\bmultipv (\d+)/) || 1);
      const cp = g(/\bscore cp (-?\d+)/), mate = g(/\bscore mate (-?\d+)/);
      if (/\b(lowerbound|upperbound)\b/.test(line)) return;
      lines[rank] = { rank, depth:+g(/\bdepth (\d+)/), cp: cp == null ? null : +cp, mate: mate == null ? null : +mate,
                      pv: g(/\bpv (.+)$/).trim().split(/\s+/) };
      lines[rank].move = lines[rank].pv[0];
    };
    this.listeners.push(collect);
    this.send('position fen ' + fen);
    const go = opts.searchmoves ? ' searchmoves ' + opts.searchmoves.join(' ') : '';
    this.send((opts.movetime ? 'go movetime ' + opts.movetime : 'go depth ' + (opts.depth || 18)) + go);
    await this.waitFor(l => l.indexOf('bestmove') === 0);
    this.listeners.splice(this.listeners.indexOf(collect), 1);
    return Object.values(lines).sort((a, b) => a.rank - b.rank);
  }
  /** Score of one specific move (searchmoves), side-to-move view. */
  async scoreMove(fen, uci, opts){
    const r = await this.analyse(fen, Object.assign({}, opts, { multipv:1, searchmoves:[uci] }));
    return r[0] || null;
  }
  quit(){ try { this.send('quit'); } catch(e){} setTimeout(() => { try { this.proc.kill(); } catch(e){} }, 200); }
}

/** A single comparable number: centipawns, mates mapped far outside cp range. */
function scoreOf(line){
  if (!line) return null;
  if (line.mate != null) return line.mate > 0 ? 100000 - line.mate * 100 : -100000 - line.mate * 100;
  return line.cp;
}

module.exports = { Engine, scoreOf };
