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
const returnLikeUrls = [];
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
    if (u.includes('graphql.note.com/graphql')) return { ok:true, json:async()=>({data:{noteLikesConnectionByUrlname:{edges:[
      {cursor:'c1',node:{note:{key:'nlike001',creator:{urlname:'writer_old1'},openContents:{title:'昔スキした記事1'}}}},
      {cursor:'c2',node:{note:{key:'nlike002',creator:{urlname:'writer_old2'},openContents:{title:'昔スキした記事2'}}}}
    ],pageInfo:{hasNextPage:false,endCursor:'c2'}}}}) };
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
    if (mode === 'return') {
      const articleUrl = String(arguments[0] || '');
      returnLikeUrls.push(articleUrl);
      return { ok:true, already:articleUrl.includes('writer_a') };
    }
    return { ok:false, code:'like_api_rejected', status:429, message:'スキの回数上限です' };
  },
  async runDirectMagazineAddMutation(articleUrl) {
    magazineCalls += 1;
    if (mode === 'backfill') return { ok:true, action:'magazine_add', already:articleUrl.includes('nlike002') };
    return { ok:true, action:'magazine_add', already:false };
  },
  async runArticleReactorsApi() {
    return {
      ok:true,
      owner:'nero_owner',
      creators:[
        {urlname:'Writer_A',nickname:'A',commented:true,liked:true,lastActionAt:'2026-08-27T01:00:00Z'},
        {urlname:'writer_b',nickname:'B',commented:false,liked:true,lastActionAt:'2026-08-27T00:00:00Z'},
        {urlname:'WRITER_DONE',nickname:'Done',commented:true,liked:false,lastActionAt:'2026-08-26T23:00:00Z'}
      ],
      stats:{creatorCount:3,commenterCount:2}
    };
  },
  async runCreatorLatestBatchApi(creators) {
    return {ok:true,items:creators.map(urlname=>({key:`latest_${String(urlname).toLowerCase()}`,name:`Latest ${urlname}`,urlname:String(urlname).toLowerCase(),publishAt:'2026-08-27T02:00:00Z',url:`https://note.com/${String(urlname).toLowerCase()}/n/latest_${String(urlname).toLowerCase()}`}))};
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

mode='return';
storage['nero.localAuto.state.v1'].likeBlockedUntil=0;
storage['nero.localAuto.state.v1'].returnedCreators={WRITER_DONE:{result:'liked',at:Date.now()-1000,key:'old_done'}};
const returnScanned=await t.scanReturnLikes();
assert.equal(returnScanned.ok,true,JSON.stringify(returnScanned));
assert.equal(returnScanned.returnLikes.status,'ready');
assert.equal(returnScanned.returnLikes.total,2);
assert.equal(returnScanned.returnLikes.previouslyReturned,1);
assert.equal(returnScanned.returnLikes.commenterCount,2);
const returnStarted=await t.startReturnLikes();
assert.equal(returnStarted.ok,true);
assert.equal(returnStarted.returnLikes.status,'completed');
assert.equal(returnStarted.returnLikes.processed,2);
assert.equal(returnStarted.returnLikes.already,1);
assert.equal(returnStarted.returnLikes.liked,1);
assert.equal(returnLikeUrls.length,2,'already-liked creator should skip immediately to the next creator');
assert.match(returnLikeUrls[0],/writer_a/);
assert.match(returnLikeUrls[1],/writer_b/);
const returnRescan=await t.scanReturnLikes();
assert.equal(returnRescan.returnLikes.total,0,'completed creators must not be queued twice');
assert.equal(returnRescan.returnLikes.previouslyReturned,3);
assert.equal(returnLikeUrls.length,2,'rescan must not send duplicate likes');

const now=Date.now();
const hourlyState={events:[...Array.from({length:10},(_,i)=>({kind:'magazine',mode:'auto',at:now-i*1000})),{kind:'magazine',mode:'backfill',at:now}]};
assert.equal(t.hourlyMagazineCount(hourlyState,now),10);
console.log('local-auto-check-ok');
