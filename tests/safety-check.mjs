import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function assert(value,message){if(!value)throw new Error(message)}
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
assert(manifest.name==='NERO Swipe Reader Bridge','unexpected extension name');
assert(manifest.version==='0.1.32','unexpected extension version');
assert(manifest.permissions.includes('__READER_MATCH__'),'reader match placeholder missing');
assert(manifest.browser_specific_settings.gecko.id==='nero-swipe-reader@local.invalid','extension id is not isolated');
assert(!manifest.permissions.includes('__READER_ORIGIN__/*'),'legacy origin-only reader permission remains');

const worker=fs.readFileSync(path.join(root,'src/worker.js'),'utf8');
assert(worker.includes("var NERO_TARGET='ネロのお気に入り🌙'"),'target magazine changed');
assert(worker.includes('setTimeout(resolve,12000)'),'12-second queue interval missing');
assert(worker.includes('neroAutoStopped=true'),'failure-stop behavior missing');
assert(worker.includes('var DEFAULT_CREATORS=[];'),'unexpected default creator identity');

const localAuto=fs.readFileSync(path.join(root,'extension/local-auto.js'),'utf8');
assert(manifest.permissions.includes('alarms'),'Firefox alarms permission missing');
assert(manifest.background.scripts.includes('local-auto.js'),'local automation background script missing');
assert(localAuto.includes("const TARGET_MAGAZINE = 'ネロのお気に入り🌙'"),'local automation magazine target changed');
assert(localAuto.includes('const INTERVAL_MINUTES = 5'),'local automation interval changed');
assert(localAuto.includes('const MAX_MAGAZINE_PER_HOUR = 10'),'local automation hourly cap changed');
assert(localAuto.includes('state.likeBlockedUntil = now + LIKE_RETRY_MS'),'like cooldown behavior missing');
assert(localAuto.includes("'magazine_added_like_rate_limited'"),'rate-limit magazine continuation missing');
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
