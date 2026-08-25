import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const listeners = { message: [], alarm: [] };
const storage = {};
const browser = {
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(value) { Object.assign(storage, value); }
  } },
  alarms: {
    async get() { return null; },
    create() {},
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
const candidatePayload = {
  data: {
    notes: [{
      key: 'nabc123',
      name: 'note初心者です。はじめまして、日常を書きます',
      publish_at: new Date().toISOString(),
      user: { urlname: 'writer_one', nickname: 'Writer' }
    }]
  }
};
const context = {
  browser,
  globalThis: null,
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout() {},
  AbortController,
  URL,
  fetch: async (url) => {
    if (String(url).includes('/hashtags/')) return { ok: true, json: async () => candidatePayload };
    throw new Error('unexpected fetch ' + url);
  }
};
context.globalThis = context;
context.NeroBackgroundTest = {
  async runNoteOperation(message) {
    if (message.action === 'account') return { ok: true, urlname: 'nero_owner' };
    throw new Error('unexpected operation');
  },
  async runDirectArticleLikeMutation() {
    likeCalls += 1;
    return { ok: false, code: 'like_api_rejected', status: 429, message: 'スキの回数上限です' };
  },
  async runDirectMagazineAddMutation() {
    magazineCalls += 1;
    return { ok: true, action: 'magazine_add', already: false };
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../extension/local-auto.js', import.meta.url), 'utf8'), context);
const t = context.NeroLocalAutoTest;
assert.ok(t);
assert.equal(t.constants.INTERVAL_MINUTES, 5);
assert.equal(t.constants.MAX_MAGAZINE_PER_HOUR, 10);
assert.equal(t.constants.TARGET_MAGAZINE, 'ネロのお気に入り🌙');
assert.equal(t.isLikeRateLimited({ ok: false, status: 429 }), true);
assert.equal(t.isLikeRateLimited({ ok: false, code: 'like_api_rejected', message: 'スキの回数上限です' }), true);
assert.equal(t.isLikeRateLimited({ ok: false, status: 500, message: 'server error' }), false);
assert.equal(t.shouldPauseAll({ code: 'magazine_result_unknown' }), true);
assert.equal(t.shouldPauseAll({ code: 'like_api_rejected' }), false);
const now = Date.now();
const hourlyState = { events: Array.from({ length: 10 }, (_, i) => ({ kind: 'magazine', at: now - i * 5 * 60 * 1000 })) };
assert.equal(t.hourlyMagazineCount(hourlyState, now), 10);
assert.ok(t.editorialScore({ title: 'note初心者です。はじめまして、日常を書きます' }) >= 4);
assert.ok(t.editorialScore({ title: 'フォロバ100 相互フォロー100' }) < 0);

storage['nero.localAuto.state.v1'] = {
  version: 1,
  enabled: true,
  boundAccount: 'nero_owner',
  paused: false,
  pauseReason: '',
  likeBlockedUntil: 0,
  events: [],
  processedNotes: {},
  processedCreators: {},
  lastRun: null
};
const first = await t.runOnce('test');
assert.equal(first.status, 'magazine_added_like_rate_limited');
assert.equal(likeCalls, 1);
assert.equal(magazineCalls, 1);
assert.ok(storage['nero.localAuto.state.v1'].likeBlockedUntil > Date.now());

candidatePayload.data.notes[0].key = 'ndef456';
candidatePayload.data.notes[0].user.urlname = 'writer_two';
const second = await t.runOnce('test');
assert.equal(second.status, 'magazine_added_like_cooldown');
assert.equal(likeCalls, 1);
assert.equal(magazineCalls, 2);

storage['nero.localAuto.state.v1'].events = Array.from({ length: 10 }, (_, i) => ({ kind: 'magazine', at: Date.now() - i * 1000 }));
const capped = await t.runOnce('test');
assert.equal(capped.status, 'hourly_limit');
assert.equal(magazineCalls, 2);

console.log('local-auto-check-ok');
