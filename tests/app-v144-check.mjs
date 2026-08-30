import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const storage={};
const browser={
  storage:{local:{async get(key){return{[key]:storage[key]};},async set(v){Object.assign(storage,v);}}},
  runtime:{onConnect:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>({ok:true})}
};
const context={browser,globalThis:null,console,setTimeout,clearTimeout,AbortController,URL,fetch:async()=>{throw new Error('unexpected fetch');}};
context.globalThis=context;
context.NeroBackgroundTest={
  async runNoteOperation(message){
    if(message.action==='account')return{ok:true,urlname:'nero_owner'};
    if(message.action==='creator_articles')return{ok:true,items:[]};
    if(message.action==='creator_latest_batch')return{ok:true,items:[]};
    if(message.action==='status_batch')return{ok:true,results:[]};
    return{ok:true};
  },
  async runDirectCommentMutation(){return{ok:true};}
};
vm.createContext(context);
for(const name of ['app-api-core.js','app-api-inbox.js','app-api-priority.js','app-api-router.js']){
  vm.runInContext(fs.readFileSync(new URL('../extension/'+name,import.meta.url),'utf8'),context);
}
const t=context.NeroAppApiTest;
assert.ok(t);
assert.equal(t.constants.VERSION,'0.1.44');
const comments=[
  {key:'c1',threadIndex:0,authorUrlname:'reader_a',creatorLiked:true,body:'liked but unanswered'},
  {key:'c2',threadIndex:1,authorUrlname:'reader_b',body:'question'},
  {key:'c3',threadIndex:1,authorUrlname:'nero_owner',body:'answered'},
  {key:'c4',threadIndex:2,authorUrlname:'nero_owner',body:'earlier owner comment'},
  {key:'c5',threadIndex:2,authorUrlname:'reader_c',body:'new reply'}
];
const unresolved=t.unresolvedReplyComments(comments,'nero_owner');
assert.deepEqual(Array.from(unresolved,x=>x.key),['c1','c5'],'comment likes must never count as a reply');

const manifest=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.version,'0.1.44');
const readerScript=manifest.content_scripts.find(x=>x.matches.includes('__READER_MATCH__'));
assert.deepEqual(readerScript.js,['app-bridge.js'],'Reader must load one content bridge only');
for(const file of ['app-api-core.js','app-api-inbox.js','app-api-priority.js','app-api-router.js'])assert.ok(manifest.background.scripts.includes(file));
const bridge=fs.readFileSync(new URL('../extension/app-bridge.js',import.meta.url),'utf8');
assert.match(bridge,/NERO_APP_V2/);
assert.match(bridge,/nero-app-request/);
assert.doesNotMatch(bridge,/MutationObserver/);
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const view of ['home','comments','read','return','manage'])assert.match(html,new RegExp(`data-view="${view}"`));
assert.match(html,/返信できていないコメント/);
assert.match(html,/app-comments-v144\.js/);
const commentsUi=fs.readFileSync(new URL('../docs/app-comments-v144.js',import.meta.url),'utf8');
assert.match(commentsUi,/inbox_scan/);
assert.match(commentsUi,/priority_scan/);
assert.match(commentsUi,/reply_comment/);
assert.match(commentsUi,/inboxShowLiked/);
assert.match(commentsUi,/スキ済みも表示/);
assert.match(commentsUi,/S\.inbox\.filter\(item=>!Boolean\(item&&item\.comment&&item\.comment\.creatorLiked\)\)/);
assert.match(commentsUi,/localStorage\.setItem\(INBOX_FILTER_KEY/);
assert.match(commentsUi,/item\.comment\.creatorLiked=true/);
assert.match(commentsUi,/PRIORITY_FILTER_KEY='nero\.priority\.showLiked\.v1'/);
assert.match(commentsUi,/saved===null\?false/,'comment-partner liked articles should be hidden by default');
assert.match(commentsUi,/noteAction:'status_batch'/);
assert.match(commentsUi,/A\.filteredPriority/);
assert.match(commentsUi,/A\.startPriorityReader/);
assert.match(commentsUi,/未スキの最新記事はありません/);
const init=fs.readFileSync(new URL('../docs/app-init-v144.js',import.meta.url),'utf8');
assert.match(init,/A\.startPriorityReader\(\)/);
const reader=fs.readFileSync(new URL('../docs/app-reader-v144.js',import.meta.url),'utf8');
assert.match(reader,/A\.markPriorityLiked\(row\.url,status\.liked\)/);
assert.match(reader,/A\.markPriorityLiked\(row\.url,true\)/);
console.log('app-v144-check-ok');
