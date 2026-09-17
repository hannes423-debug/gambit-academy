/* Shared plumbing for the dataset importers.

   Big datasets never go into git. Every importer writes under data/ (ignored)
   as NDJSON shards plus a manifest.json that carries the provenance record
   for the whole import. The provenance is validated with the SAME function
   the app uses (Academy.validateProvenance) before a single line is written. */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { loadAcademy } = require('../lib/app.js');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');

let _app = null;
const app = () => _app || (_app = loadAcademy());

function args(argv){
  const out = { _:[] };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a.startsWith('--')){
      const k = a.slice(2), v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}

/** Line stream from a file, a .zst file (via the zstd binary) or stdin ('-'). */
function lines(file){
  let input;
  if (!file || file === '-') input = process.stdin;
  else if (/\.zst$/.test(file)){
    const z = spawn('zstd', ['-dc', file], { stdio:['ignore', 'pipe', 'inherit'] });
    z.on('error', () => { console.error('zstd not found — decompress first: zstd -d ' + file); process.exit(2); });
    input = z.stdout;
  } else input = fs.createReadStream(file);
  return readline.createInterface({ input, crlfDelay:Infinity });
}

function requireValidProvenance(p){
  const errs = app()('Academy').validateProvenance(p);
  if (errs.length){
    console.error('Refusing to import — provenance is not acceptable:\n  - ' + errs.join('\n  - '));
    process.exit(3);
  }
  return p;
}

/** Keeps one append stream per shard file open, closes them all at the end. */
class ShardWriter {
  constructor(dir){ this.dir = dir; this.streams = {}; this.counts = {}; fs.mkdirSync(dir, { recursive:true }); }
  write(shard, obj){
    if (!this.streams[shard]){
      this.streams[shard] = fs.createWriteStream(path.join(this.dir, shard + '.ndjson'));
      this.counts[shard] = 0;
    }
    this.counts[shard]++;
    return this.streams[shard].write(JSON.stringify(obj) + '\n');
  }
  async close(){
    await Promise.all(Object.values(this.streams).map(s => new Promise(r => s.end(r))));
  }
}

function writeJSON(file, obj){
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

async function* readNDJSON(file){
  const rl = readline.createInterface({ input:fs.createReadStream(file), crlfDelay:Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

module.exports = { ROOT, DATA, app, args, lines, requireValidProvenance, ShardWriter, writeJSON, readNDJSON };
