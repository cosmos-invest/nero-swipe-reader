import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'packed/manifest.json'),'utf8'));
for(const [target,meta] of Object.entries(manifest)){
  const joined=meta.parts.map(name=>fs.readFileSync(path.join(root,'packed',name),'utf8').trim()).join('');
  const raw=zlib.gunzipSync(Buffer.from(joined,'base64'));
  const hash=crypto.createHash('sha256').update(raw).digest('hex');
  if(hash!==meta.sha256) throw new Error(`source integrity mismatch: ${target}`);
  if(raw.length!==meta.bytes) throw new Error(`source size mismatch: ${target}`);
  const dest=path.join(root,target);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,raw);
  console.log(`materialized ${target} (${raw.length} bytes)`);
}
