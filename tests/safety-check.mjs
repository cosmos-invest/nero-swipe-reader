import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function assert(value,message){if(!value)throw new Error(message)}
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
assert(manifest.name==='NERO Swipe Reader Bridge','unexpected extension name');
assert(manifest.browser_specific_settings.gecko.id==='nero-swipe-reader@local.invalid','extension id is not isolated');
assert(!JSON.stringify(manifest).includes('__READER_ORIGIN__') || manifest.permissions.includes('__READER_ORIGIN__/*'),'origin placeholder contract changed unexpectedly');

const worker=fs.readFileSync(path.join(root,'src/worker.js'),'utf8');
assert(worker.includes("var NERO_TARGET='ネロのお気に入り🌙'"),'target magazine changed');
assert(worker.includes('setTimeout(resolve,12000)'),'12-second queue interval missing');
assert(worker.includes('neroAutoStopped=true'),'failure-stop behavior missing');
assert(worker.includes('var DEFAULT_CREATORS=[];'),'unexpected default creator identity');

const automation=fs.readFileSync(path.join(root,'automation/worker.js'),'utf8');
assert(automation.includes("const MAGAZINE_NAME='ネロのお気に入り🌙'"),'automation magazine target changed');
assert(automation.includes('const WAIT_MS=12000'),'automation wait interval changed');
assert(automation.includes('const MAX_PER_RUN=1'),'automation per-run cap changed');
assert(automation.includes('const DAILY_CAP=15'),'automation daily cap changed');
assert(automation.includes('state.paused=true'),'automation circuit breaker missing');
assert(automation.includes('async scheduled(event,env,ctx)'),'automation cron handler missing');
assert(!fs.existsSync(path.join(root,'.github','workflows')),'GitHub Actions workflows are not allowed');

const tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const forbiddenNames=['.env','.dev.vars'];
for(const file of tracked){
  const base=path.basename(file);
  assert(!forbiddenNames.includes(base),`secret-bearing file tracked: ${file}`);
  const text=fs.readFileSync(path.join(root,file));
  if(text.includes(0)) continue;
  const s=text.toString('utf8');
  assert(!/(_note_session|NOTE_SESSION_COOKIE|CLOUDFLARE_API_TOKEN)\s*[=:]\s*[^\s$<{]/i.test(s),`possible credential embedded in ${file}`);
}
console.log('safety-check-ok');
