import assert from 'node:assert/strict';
import { __test } from '../automation/worker.js';

assert.equal(__test.fitScore({title:'はじめまして。自己紹介します'},'日常'),5);
assert.equal(__test.fitScore({title:'今日から新しい挑戦を始めます'},'挑戦'),4);
assert.equal(__test.isBlocked({title:'フォロバ100％です'}),true);
assert.equal(__test.noteNumericId({data:{note:{id:321}}}),321);
assert.deepEqual(__test.normalizeMagazine({key:'m123',name:'ネロのお気に入り🌙',price:0}),{key:'m123',name:'ネロのお気に入り🌙',index:0,available:true});
assert.equal(__test.jstHour(new Date('2026-08-25T02:00:00Z')),11);

class KV {
  constructor(){this.map=new Map();}
  async get(key){return this.map.get(key)||null;}
  async put(key,value){this.map.set(key,String(value));}
}

function makeEnv(){
  return {
    STATE:new KV(),
    STATE_ENCRYPTION_KEY:Buffer.from(Uint8Array.from({length:32},(_,i)=>i+1)).toString('base64'),
    NOTE_SESSION_COOKIE:'test-session',
    NERO_URLNAME:'nero_test',
    ADMIN_TOKEN:'admin-test',
    AUTO_ENABLED:'true'
  };
}

function row(){return {key:'nabc123',name:'はじめまして。note初心者です',publish_at:'2026-08-25T01:30:00Z',like_count:0,user:{urlname:'writer_one',nickname:'Writer'}};}
function detail(){return {data:{note:{id:321,key:'nabc123',name:'はじめまして。note初心者です',like_count:0,user:{urlname:'writer_one'}}}};}

async function successCase(){
  const env=makeEnv();
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),method:init.method||'GET',body:init.body||''});
    const u=String(url);
    if(u.endsWith('/api/v1/current_user'))return Response.json({data:{urlname:'nero_test'}});
    if(u.endsWith('/api/v1/my/magazines'))return Response.json({data:{magazines:[{key:'m123',name:'ネロのお気に入り🌙',price:0}]}});
    if(u.includes('/api/v3/hashtags/'))return Response.json({data:{notes:[row()]}});
    if(u.endsWith('/api/v3/notes/nabc123')&&(!init.method||init.method==='GET'))return Response.json(detail());
    if(u==='https://note.com/writer_one/n/nabc123')return new Response('<html></html>',{status:200});
    if(u.endsWith('/api/v3/notes/nabc123/likes')&&init.method==='POST')return new Response('',{status:201});
    if(u.endsWith('/api/v1/our/magazines/m123/notes')&&init.method==='POST')return Response.json({data:{status:'success'}},{status:201});
    throw new Error(`unexpected ${init.method||'GET'} ${u}`);
  };
  const result=await __test.run(env,'test',new Date('2026-08-25T02:00:00Z'),{sleep:async()=>{}});
  assert.equal(result.status,'success');
  assert.equal(result.completed,1);
  assert.equal(result.results[0].status,'complete');
  assert.equal(calls.filter(c=>c.method==='POST'&&c.url.endsWith('/likes')).length,1);
  const mag=calls.find(c=>c.method==='POST'&&c.url.endsWith('/our/magazines/m123/notes'));
  assert.ok(mag);
  assert.deepEqual(JSON.parse(mag.body),{note_id:321});
  const state=JSON.parse(await env.STATE.get('nero-engagement-state-v1'));
  assert.equal(state.paused,false);
  assert.equal(state.events.length,1);
}

async function failureCase(){
  const env=makeEnv();
  globalThis.fetch=async(url,init={})=>{
    const u=String(url);
    if(u.endsWith('/api/v1/current_user'))return Response.json({data:{urlname:'nero_test'}});
    if(u.endsWith('/api/v1/my/magazines'))return Response.json({data:{magazines:[{key:'m123',name:'ネロのお気に入り🌙',price:0}]}});
    if(u.includes('/api/v3/hashtags/'))return Response.json({data:{notes:[row()]}});
    if(u.endsWith('/api/v3/notes/nabc123')&&(!init.method||init.method==='GET'))return Response.json(detail());
    if(u==='https://note.com/writer_one/n/nabc123')return new Response('',{status:200});
    if(u.endsWith('/api/v3/notes/nabc123/likes')&&init.method==='POST')return new Response('',{status:201});
    if(u.endsWith('/api/v1/our/magazines/m123/notes')&&init.method==='POST')return Response.json({error:'rejected'},{status:500});
    throw new Error(`unexpected ${init.method||'GET'} ${u}`);
  };
  const result=await __test.run(env,'test',new Date('2026-08-25T02:00:00Z'),{sleep:async()=>{}});
  assert.equal(result.status,'circuit_breaker');
  const state=JSON.parse(await env.STATE.get('nero-engagement-state-v1'));
  assert.equal(state.paused,true);
  assert.match(state.pause_reason,/magazine_post_500/);
}

await successCase();
await failureCase();
console.log('automation-check-ok');
