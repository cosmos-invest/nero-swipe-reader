import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_READER_URL = 'https://cosmos-invest.github.io/nero-swipe-reader/';
const raw = String(process.env.READER_URL || process.env.READER_ORIGIN || DEFAULT_READER_URL).trim();
let parsed;
try { parsed = new URL(raw); } catch { throw new Error('READER_URL must be an absolute https URL'); }
if (parsed.protocol !== 'https:') throw new Error('READER_URL must use https');
if (parsed.origin === 'https://note.com' || parsed.origin === 'https://www.note.com') {
  throw new Error('Refusing to use note.com as Reader URL');
}
parsed.search = '';
parsed.hash = '';
let pathname = parsed.pathname || '/';
if (!pathname.endsWith('/')) pathname += '/';
const host = parsed.hostname.toLowerCase();
const fullPath = pathname.toLowerCase();
if (!host.includes('nero') && !fullPath.includes('nero-swipe-reader')) {
  throw new Error('Refusing to bind NERO Bridge to a non-NERO Reader URL');
}
const origin = parsed.origin;
const baseUrl = origin + pathname;
const matchPattern = baseUrl + '*';

const source = path.resolve('extension');
const dest = path.resolve('dist/bridge');
fs.rmSync(dest, {recursive:true, force:true});
fs.mkdirSync(dest, {recursive:true});

function replacePlaceholders(text) {
  return text
    .replaceAll('__READER_ORIGIN__', origin)
    .replaceAll('__READER_BASE__', baseUrl)
    .replaceAll('__READER_MATCH__', matchPattern);
}
function copyDir(dir, out) {
  fs.mkdirSync(out, {recursive:true});
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const a=path.join(dir, ent.name), b=path.join(out, ent.name);
    if (ent.isDirectory()) copyDir(a,b);
    else {
      const buf=fs.readFileSync(a);
      if (/\.(js|json|html|css|md|svg)$/i.test(ent.name)) fs.writeFileSync(b,replacePlaceholders(buf.toString('utf8')));
      else fs.writeFileSync(b,buf);
    }
  }
}
copyDir(source,dest);

const joined = fs.readdirSync(dest,{recursive:true}).filter(x=>typeof x==='string').map(x=>{
  const p=path.join(dest,x); try {return fs.statSync(p).isFile()?fs.readFileSync(p,'utf8'):''} catch {return ''}
}).join('\n');
for (const marker of ['__READER_ORIGIN__','__READER_BASE__','__READER_MATCH__']) {
  if (joined.includes(marker)) throw new Error(`Unresolved placeholder remains: ${marker}`);
}
console.log(`Built NERO Bridge for ${baseUrl}`);
