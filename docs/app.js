(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TARGET_MAGAZINE = 'ネロのお気に入り🌙';
  const TAGS = ['#自己紹介','#note初心者','#初投稿','#挑戦','#日常','#noteを楽しむ','#創作'];
  let rows = [];
  let index = 0;
  let account = '';
  let autoEnabled = false;
  let searchSeq = 0;
  let requestSeq = 0;
  let touchStartX = 0;

  function bridgeReady(){ return document.documentElement.dataset.neroExtension === 'ready'; }
  function notice(text,error=false){ const el=$('notice'); el.hidden=!text; el.textContent=text||''; el.classList.toggle('error',Boolean(error)); }
  function fmtDate(value){ if(!value)return''; try{return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(value));}catch(_){return'';} }
  function fmtTime(value){ if(!value)return''; try{return new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));}catch(_){return'';} }

  function requestEvent(name,datasetKey,resultEvent,resultKey,payload,timeout=12000){
    return new Promise((resolve,reject)=>{
      const id=`page-${Date.now()}-${++requestSeq}`;
      const timer=setTimeout(()=>{cleanup();reject(new Error('Firefox拡張との通信がタイムアウトしました。'));},timeout);
      function cleanup(){clearTimeout(timer);document.removeEventListener(resultEvent,onResult);}
      function onResult(){let result=null;try{result=JSON.parse(document.documentElement.dataset[resultKey]||'');}catch(_){return;}if(!result||result.id!==id)return;cleanup();result.ok?resolve(result):reject(new Error(result.message||'処理できませんでした。'));}
      document.addEventListener(resultEvent,onResult);
      document.documentElement.dataset[datasetKey]=JSON.stringify({...payload,id});
      document.dispatchEvent(new Event(name));
    });
  }

  async function requestAccount(){
    if(!bridgeReady()){ $('account').textContent='拡張機能待ち'; return; }
    try{const r=await requestEvent('nero-account-request','neroAccountRequest','nero-account-result','neroAccountResult',{});account=String(r.urlname||'');$('account').textContent=account?`@${account}`:'未ログイン';}
    catch(e){$('account').textContent='確認失敗';notice(e.message,true);}
  }

  async function requestAutoStatus(){
    if(!bridgeReady()){ renderAuto({enabled:false,unavailable:true}); return; }
    try{const r=await requestEvent('nero-auto-status-request','neroAutoStatusRequest','nero-auto-status-result','neroAutoStatusResult',{});renderAuto(r.state||{});}catch(e){renderAuto({enabled:false,error:e.message});}
  }
  function renderAuto(state){
    autoEnabled=Boolean(state.enabled);
    const badge=$('autoBadge');
    badge.className='status-badge'+(state.paused?' pause':(autoEnabled?' on':''));
    badge.textContent=state.paused?'停止中':(autoEnabled?'ON':'OFF');
    $('autoToggle').textContent=autoEnabled?'自動運転をOFF':'自動運転をON';
    $('autoResume').hidden=!state.paused;
    const count=Number(state.hourlyMagazineCount||0), max=Number(state.maxMagazinePerHour||10);
    $('autoMeterBar').style.width=`${Math.min(100,Math.max(0,count/max*100))}%`;
    if(state.unavailable){$('autoText').textContent='Firefox拡張機能v0.1.32を接続すると自動運転を管理できます。';return;}
    if(state.error){$('autoText').textContent=state.error;return;}
    const like=Number(state.likeBlockedUntil||0)>Date.now()?`スキ休止中（${fmtTime(state.likeBlockedUntil)}再確認）／マガジン継続`:'スキ稼働中';
    $('autoText').textContent=`${like}｜直近60分 ${count}/${max}件｜5分おき${state.boundAccount?`｜@${state.boundAccount}`:''}${state.pauseReason?`｜停止理由: ${state.pauseReason}`:''}`;
  }
  async function autoControl(action){
    try{const r=await requestEvent('nero-auto-control-request','neroAutoControlRequest','nero-auto-control-result','neroAutoControlResult',{action},30000);renderAuto(r.state||{});notice(action==='run'?'1件の自動処理を実行しました。':'自動運転を更新しました。');}
    catch(e){notice(e.message,true);}
  }

  async function search(query,page=1){
    const q=String(query||'').replace(/^#+/,'').trim();if(!q)return;
    if(!bridgeReady()){notice('Firefox拡張機能v0.1.32をインストールして、このページを再読み込みしてください。',true);return;}
    notice('noteから記事を探しています…');$('searchButton').disabled=true;
    try{
      const id=`search-${Date.now()}-${++searchSeq}`;
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('検索がタイムアウトしました。'));},12000);
        function cleanup(){clearTimeout(timer);document.removeEventListener('nero-search-result',receive);}
        function receive(){let r=null;try{r=JSON.parse(document.documentElement.dataset.neroSearchResult||'');}catch(_){return;}if(!r||r.id!==id)return;cleanup();r.ok?resolve(r):reject(new Error(r.message||'検索できませんでした。'));}
        document.addEventListener('nero-search-result',receive);
        document.documentElement.dataset.neroSearchRequest=JSON.stringify({id,query:q,page});
        document.dispatchEvent(new Event('nero-search-request'));
      });
      rows=Array.isArray(result.items)?result.items:[];index=0;
      if(!rows.length){$('reader').hidden=true;$('empty').hidden=false;notice('該当する記事が見つかりませんでした。');return;}
      $('empty').hidden=true;$('reader').hidden=false;notice(`${rows.length}件見つかりました。`);render();
    }catch(e){notice(e.message,true);}finally{$('searchButton').disabled=false;}
  }

  function current(){return rows[index]||null;}
  function render(){
    const row=current();if(!row)return;
    $('title').textContent=row.name||'無題の記事';$('description').textContent=row.description||'本文の概要はありません。noteで記事を開いてお読みください。';$('author').textContent=row.nickname||row.urlname||'';$('published').textContent=[row.urlname?`@${row.urlname}`:'',fmtDate(row.publishAt)].filter(Boolean).join(' · ');$('position').textContent=`${index+1} / ${rows.length}`;$('likes').textContent=`♡ ${Number(row.likeCount||0)}`;$('comments').textContent=`コメント ${Number(row.commentCount||0)}`;
    const cover=$('cover');const fallback=$('coverFallback');if(row.eyecatch){cover.src=row.eyecatch;cover.hidden=false;fallback.hidden=true;}else{cover.hidden=true;fallback.hidden=false;}
    const avatar=$('avatar');if(row.userIcon){avatar.src=row.userIcon;avatar.hidden=false;}else avatar.hidden=true;
    $('like').href=row.url;$('comment').href=row.url;$('follow').dataset.articleUrl=row.url;$('openNote').href=row.url;
    delete $('like').dataset.liked;$('like').textContent='♡ 確認中…';
    document.dispatchEvent(new Event('nero-article-shown'));
  }
  function move(delta){if(!rows.length)return;index=(index+delta+rows.length)%rows.length;render();}

  async function addMagazine(){
    const row=current();if(!row)return;if(!account)await requestAccount();if(!account){notice('noteアカウントを確認できません。',true);return;}
    $('magazine').disabled=true;
    try{const r=await requestEvent('nero-magazine-add-request','neroMagazineAddRequest','nero-magazine-add-result','neroMagazineAddResult',{articleUrl:row.url,magazineName:TARGET_MAGAZINE,expectedAccount:account},30000);notice(r.already?'すでに「ネロのお気に入り🌙」に入っています。':'「ネロのお気に入り🌙」へ追加しました。');}
    catch(e){notice(e.message,true);}finally{$('magazine').disabled=false;}
  }

  function syncBridge(){
    const ready=bridgeReady(),status=$('neroExtensionStatus');
    if(ready){const version=document.documentElement.dataset.neroExtensionVersion||'';status.textContent=`Firefox連携中 v${version}`;status.classList.add('connected');requestAccount();requestAutoStatus();}
    else{status.textContent='Firefox未接続';status.classList.remove('connected');}
  }

  TAGS.forEach(tag=>{const b=document.createElement('button');b.className='chip';b.type='button';b.textContent=tag;b.addEventListener('click',()=>{ $('searchInput').value=tag;search(tag);});$('chips').appendChild(b);});
  $('searchButton').addEventListener('click',()=>search($('searchInput').value));$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')search(e.currentTarget.value);});
  $('prev').addEventListener('click',()=>move(-1));$('next').addEventListener('click',()=>move(1));$('magazine').addEventListener('click',addMagazine);
  $('autoToggle').addEventListener('click',()=>autoControl(autoEnabled?'disable':'enable'));$('autoResume').addEventListener('click',()=>autoControl('resume'));$('runNow').addEventListener('click',()=>autoControl('run'));
  $('card').addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0].clientX;},{passive:true});$('card').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(Math.abs(dx)>55)move(dx<0?1:-1);},{passive:true});
  document.addEventListener('nero-liked-status',()=>{const state=document.documentElement.dataset.neroCurrentLiked;if(state==='true'){$('like').textContent='♥ スキ済み';$('like').dataset.liked='true';}else if(state==='false')$('like').textContent='♡ スキ';else $('like').textContent='♡ スキ';});
  document.addEventListener('nero-account-result',()=>{});
  const observer=new MutationObserver(syncBridge);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-nero-extension','data-nero-extension-version']});
  syncBridge();setTimeout(syncBridge,700);setTimeout(syncBridge,1800);
})();