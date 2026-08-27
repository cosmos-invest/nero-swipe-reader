import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const listeners = { change: [], message: [] };
const alarms = [];
const state = {
  returnLikes: {
    status: 'ready',
    updatedAt: 123,
    queue: [{
      urlname: 'Writer_A', nickname: 'A', commented: true, likedTarget: true,
      key: 'k1', title: '記事1', articleUrl: 'https://note.com/writer_a/n/k1'
    }],
    completedCreators: {}
  },
  returnedCreators: {}
};
const browser = {
  storage: {
    local: { async get() { return { 'nero.localAuto.state.v1': state }; } },
    onChanged: { addListener(fn) { listeners.change.push(fn); } }
  },
  alarms: { async create(name, opts) { alarms.push({ name, ...opts }); } },
  runtime: { onMessage: { addListener(fn) { listeners.message.push(fn); } } }
};
const context = {
  browser,
  globalThis: null,
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout() {}
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../extension/return-likes-v141.js', import.meta.url), 'utf8'), context);
const t = context.NeroReturnLikesV141Test;
assert.ok(t);
assert.equal(t.constants.FAST_INTERVAL_MINUTES, 1);
const result = await t.readTargets();
assert.equal(result.targets.length, 1);
assert.equal(result.targets[0].urlname, 'writer_a');
assert.equal(result.targets[0].commented, true);
state.returnLikes.status = 'running';
listeners.change[0]({ 'nero.localAuto.state.v1': { newValue: state } }, 'local');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(alarms.at(-1).name, 'nero-return-likes-v1');
assert.equal(alarms.at(-1).delayInMinutes, 1);
console.log('return-likes-v141-check-ok');
