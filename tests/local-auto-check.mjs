import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const listeners = { message: [], alarm: [] };
const storage = {};
const alarms = new Map();
const browser = {
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(value) { Object.assign(storage, value); }
  } },
  alarms: {
    async get(name) { return alarms.get(name) || null; },
    create(name, opts) { alarms.set(name, { name, ...opts }); },
    async clear(name) { return alarms.delete(name); },
    onAlarm: { addListener(fn) { listeners.alarm.push(fn); } }
  },
  runtime: {
    onMessage: { addListener(fn) { listeners.message.push(fn); } },
    onStartup: { addListener() {} },
    onInstalled: { addListener() {} }
  }
};
let likeCalls = 0;
let magazineCalls = 0;
let mode = 'auto';
const candidatePayload = {
  data: { notes: [{ key:'nabc123', name:'note初心者です。はじめまして、日常を書きます', publish_at:new Date().toISOString(), user:{urlname:'writer_one',nickname:'Writer'} }] }
};
const likedPayload = {
  data: {
    contents: [
      { created_at:'2026-01-01T00:00:00+09:00', note:{key:'nlike001',name:'昔スキした記事1',user:{urlname:'writer_old1'}} },
      { created_at:'2026-01-02T00:00:00+09:00', note:{key:'nlike002',name:'昔スキした記事2',user:{urlname:'writer_old2'}} }
    ],
    isLastPage: true
  }
};
const context = {
  browser,
  globalThis: null,
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout() {},
  setInterval: () => 1,
  clearInterval() {},
  AbortController,
  URL,
  fetch: async (url) => {
    const u=String(url);
    if (u.includes('/hashtags/')) return { ok:true, json:async()=>candidatePayload };
    if (u.includes('/creators/nero_owner/likes')) return { ok:true, json:async()=>likedPayload };
    throw new Error('unexpected fetch ' + url);
  }
};
context.globalThis = context;
context.NeroBackgroundTest = {
  async runNoteOperation(message) {
    if (message.action === 'account') return { ok:true, urlname:'nero_owner' };
    throw new Error('unexpected operation');
  },
  async runDirectArticleLikeMutation() {
    likeCalls += 1;
    return { ok:false, code:'like_api_rejected', status:429, message:'スキの回数上限です' };
  },
  async runDirectMagazineAddMutation(articleUrl) {
    magazineCalls += 1;
    if (mode === 'backfill') return { ok:true, action:'magazine_add', already:articleUrl.includes('nlike002') };
    return { ok:true, action:'magazine_add', already:false };
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../extension/local-auto.js', import.meta.url), 'utf8'), context);
const t = context.NeroLocalAutoTest;
assert.ok(t);
assert.equal(t.constants.INTERVAL_MINUTES,5);
assert.equal(t.constants.MAX_MAGAZINE_PER_HOUR,10);
assert.equal(t.constants.BACKFILL_INTERVAL_MS,12000);
assert.equal(t.constants.TARGET_MAGAZINE,'ネロのお気に入り🌙');
assert.equal(t.isLikeRateLimited({ok:false,status:429}),true);
assert.equal(t.shouldPauseAll({code:'magazine_result_unknown'}),true);
assert.equal(t.normalizeLikedEntry(likedPayload.data.contents[0]).key,'nlike001');
assert.equal(t.pageIsLast(likedPayload),true);

storage['nero.localAuto.state.v1'] = {
  version:1,
  enabled:true,
  boundAccount:'nero_owner',
  paused:false,
  pauseReason:'',
  likeBlockedUntil:0,
  events:[{at:Date.now()-1000,kind:'magazine',key:'nfirst001',creator:'first_writer',like:'ok'}],
  processedNotes:{},processedCreators:{},lastRun:null
};
const first=await t.runOnce('test');
assert.equal(first.status,'magazine_added_like_rate_limited');
assert.equal(likeCalls,1);assert.equal(magazineCalls,1);
assert.ok(storage['nero.localAuto.state.v1'].likeBlockedUntil>Date.now());

candidatePayload.data.notes[0].key='ndef456';candidatePayload.data.notes[0].user.urlname='writer_two';
const second=await t.runOnce('test');
assert.equal(second.status,'magazine_added_like_cooldown');
assert.equal(likeCalls,1);assert.equal(magazineCalls,2);

let state=t.publicState(storage['nero.localAuto.state.v1']);
assert.ok(state.history.some(x=>x.key==='nfirst001'));

mode='backfill';
const scanned=await t.scanBackfill();
assert.equal(scanned.ok,true);assert.equal(scanned.backfill.total,2);assert.equal(scanned.backfill.status,'ready');
const synced=await t.startBackfill();
assert.equal(synced.ok,true);assert.equal(synced.backfill.status,'completed');
assert.equal(synced.backfill.added,1);assert.equal(synced.backfill.already,1);assert.equal(synced.backfill.remaining,0);
state=t.publicState(storage['nero.localAuto.state.v1']);
assert.equal(state.enabled,true,'normal auto resumes after backfill');
assert.ok(state.history.some(x=>x.mode==='backfill'&&x.key==='nlike001'&&x.result==='added'));
assert.ok(state.history.some(x=>x.mode==='backfill'&&x.key==='nlike002'&&x.result==='already'));

const now=Date.now();
const hourlyState={events:[...Array.from({length:10},(_,i)=>({kind:'magazine',mode:'auto',at:now-i*1000})),{kind:'magazine',mode:'backfill',at:now}]};
assert.equal(t.hourlyMagazineCount(hourlyState,now),10);
console.log('local-auto-check-ok');
