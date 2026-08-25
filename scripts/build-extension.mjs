import fs from 'node:fs';
import path from 'node:path';

const raw = process.env.READER_ORIGIN || '';
let origin;
try { origin = new URL(raw).origin; } catch { throw new Error('READER_ORIGIN must be an absolute https URL'); }
if (!origin.startsWith('https://')) throw new Error('READER_ORIGIN must use https');
if (origin === 'https://note.com' || origin === 'https://www.note.com') throw new Error('Refusing to use note.com as Reader origin');
if (!new URL(origin).hostname.toLowerCase().includes('nero')) throw new Error('Refusing to bind NERO Bridge to a non-NERO origin');

const source = path.resolve('extension');
const dest = path.resolve('dist/bridge');
fs.rmSync(dest,{recursive:true,force:true});
fs.mkdirSync(dest,{recursive:true});
function copyDir(dir,out){
  fs.mkdirSync(out,{recursive:true});
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const a=path.join(dir,ent.name),b=path.join(out,ent.name);
    if(ent.isDirectory()) copyDir(a,b);
    else {
      const buf=fs.readFileSync(a);
      if(/\.(js|json|html|css|md|svg)$/i.test(ent.name)) fs.writeFileSync(b,buf.toString('utf8').replaceAll('__READER_ORIGIN__',origin));
      else fs.writeFileSync(b,buf);
    }
  }
}
copyDir(source,dest);
const joined=fs.readdirSync(dest,{recursive:true}).filter(x=>typeof x==='string').map(x=>{const p=path.join(dest,x);try{return fs.statSync(p).isFile()?fs.readFileSync(p,'utf8'):''}catch{return ''}}).join('\n');
if(joined.includes('__READER_ORIGIN__')) throw new Error('Unresolved origin placeholder remains');
console.log(`Built NERO Bridge for ${origin}`);
