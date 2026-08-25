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
  let backfillPoll = 0;

  function bridgeReady(){ return document.documentElement.dataset.neroExtension === 'ready'; }
  function bridgeVersion(){ return document.documentElement.dataset.neroExtensionVersion || ''; }
  function versionAtLeast(min){
    const a=bridgeVersion().split('.').map(Number), b=min.split('.').map(Number);
    for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;
  }
  function notice(text,error=false){ const el=$('notice'); el.hidden=!text; el.textContent=text||''; el.classList.toggle('error',Boolean(error)); }
  function fmtDate(value){ if(!value)return''; try{return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(value));}catch(_){return'';} }
  function fmtTime(value){ if(!value)return''; try{return new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));}catch(_){return'';} }
  function fmtDateTime(value){ if(!value)return''; try{return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}catch(_){return'';} }

  function requestEvent(name,datasetKey,resultEvent,resultKey,payload,timeout=12000){
    return new Promise((resolve,reject)=>{
      const id=`page-${Date.now()}-${++requestSeq}`;
      const timer=setTimeout(()=>{cleanup();reject(new Error('Firefox拡張との通信がタイムアウトしました。'));},timeout);
      function cleanup(){clearTimeout(timer);document.removeEventListener(resultEvent,onResult);}
      function onResult(){let result=null;try{result=JSON.parse(document.documentElement.dataset[resultKey]||'');}catch(_){return;}if(!result||result.id!==id)return;cleanup();result.ok?resolve(result):reject(Object.assign(new Error(result.message||'処理できませんでした。'),{result}));}
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
    if(!bridgeReady()){ renderAuto({enabled:false,unavailable:true}); renderBackfill({},true); renderHistory([]); return; }
    try{
      const r=await requestEvent('nero-auto-status-request','neroAutoStatusRequest','nero-auto-status-result','neroAutoStatusResult',{});
      renderAuto(r.state||{});
      renderBackfill((r.state||{}).backfill||{},!versionAtLeast('0.1.33'));
      renderHistory((r.state||{}).history||[]);
    }catch(e){renderAuto({enabled:false,error:e.message});}
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
    if(state.unavailable){$('autoText').textContent='Firefox拡張機能を接続すると自動運転を管理できます。';return;}
    if(state.error){$('autoText').textContent=state.error;return;}
    const like=Number(state.likeBlockedUntil||0)>Date.now()?`スキ休止中（${fmtTime(state.likeBlockedUntil)}再確認）／マガジン継続`:'スキ稼働中';
    $('autoText').textContent=`${like}｜直近60分 ${count}/${max}件｜5分おき${state.boundAccount?`｜@${state.boundAccount}`:''}${state.pauseReason?`｜停止理由: ${state.pauseReason}`:''}`;
  }

  async function autoControl(action){
    try{const r=await requestEvent('nero-auto-control-request','neroAutoControlRequest','nero-auto-control-result','neroAutoControlResult',{action},30000);renderAuto(r.state||{});renderBackfill((r.state||{}).backfill||{},!versionAtLeast('0.1.33'));renderHistory((r.state||{}).history||[]);notice(action==='run'?'1件の自動処理を実行しました。':'自動運転を更新しました。');}
    catch(e){notice(e.message,true);}
  }

  function backfillLabel(status){
    return ({idle:'未確認',scanning:'確認中',ready:'準備完了',running:'同期中',paused:'一時停止',completed:'完了',cancelled:'中止',failed:'確認失敗'})[status]||'未確認';
  }

  function renderBackfill(backfill={},unsupported=false){
    const badge=$('backfillBadge');
    const status=String(backfill.status||'idle');
    badge.className='status-badge'+(status==='running'?' on':(status==='paused'||status==='failed'?' pause':(status==='completed'?' done':'')));
    badge.textContent=unsupported?'v0.1.33必要':backfillLabel(status);
    const total=Number(backfill.total||0), processed=Number(backfill.processed||0), added=Number(backfill.added||0), already=Number(backfill.already||0), remaining=Number(backfill.remaining||Math.max(0,total-processed));
    $('backfillTotal').textContent=unsupported?'—':String(total);
    $('backfillAdded').textContent=unsupported?'—':String(added);
    $('backfillAlready').textContent=unsupported?'—':String(already);
    $('backfillRemaining').textContent=unsupported?'—':String(remaining);
    $('backfillMeterBar').style.width=total?`${Math.min(100,processed/total*100)}%`:'0%';
    const scan=$('backfillScan'), start=$('backfillStart'), pause=$('backfillPause'), resume=$('backfillResume'), cancel=$('backfillCancel');
    [scan,start,pause,resume,cancel].forEach(b=>{b.hidden=true;b.disabled=unsupported;});
    if(unsupported){scan.hidden=false;$('backfillText').textContent='この機能はFirefox拡張 v0.1.33から利用できます。現在の自動運転はそのまま継続します。';stopBackfillPoll();return;}
    if(status==='idle'||status==='cancelled'||status==='failed'||status==='completed') scan.hidden=false;
    if(status==='ready') start.hidden=false;
    if(status==='running'){pause.hidden=false;cancel.hidden=false;startBackfillPoll();}
    else stopBackfillPoll();
    if(status==='paused'){resume.hidden=false;cancel.hidden=false;}
    let text='過去にスキした記事を全件確認し、「ネロのお気に入り🌙」へ追加します。すでに入っている記事は自動でスキップします。';
    if(status==='scanning') text=`過去のスキを確認中… ${Number(backfill.scannedPages||0)}ページ読み込みました。`;
    if(status==='ready') text=`過去スキ ${total}件を確認しました。同期を開始すると、追加済みを飛ばしながら順番に整理します。`;
    if(status==='running') text=`同期中です。${processed}/${total}件を確認済み。新規 ${added}件、すでに追加済み ${already}件。`;
    if(status==='paused') text=`同期を一時停止しています。${backfill.pauseReason&&backfill.pauseReason!=='user_paused'?`理由: ${backfill.pauseReason}。`:''}${backfill.nextRetryAt?`${fmtDateTime(backfill.nextRetryAt)}以降に再開できます。`:''}`;
    if(status==='completed') text=`整理完了。過去スキ ${total}件を確認し、新規 ${added}件を追加、${already}件はすでにマガジン入りでした。`;
    if(status==='failed') text=`過去スキの確認に失敗しました。${backfill.pauseReason||'noteのログイン状態を確認してください。'}`;
    $('backfillText').textContent=text;
  }

  async function backfillControl(action){
    if(!versionAtLeast('0.1.33')){notice('過去スキ整理はFirefox拡張 v0.1.33から利用できます。',true);return;}
    const timeout=action==='scan'?120000:(action==='start'||action==='resume'?90000:20000);
    try{
      const r=await requestEvent('nero-backfill-control-request','neroBackfillControlRequest','nero-backfill-control-result','neroBackfillControlResult',{action},timeout);
      const state=r.state||{};
      renderAuto(state);renderBackfill(r.backfill||state.backfill||{},false);renderHistory(state.history||[]);
      if(action==='scan')notice(`過去スキ ${Number((r.backfill||{}).total||0)}件を確認しました。`);
      else if(action==='start'||action==='resume')notice('過去スキの整理を開始しました。ページを閉じてもFirefox側で続きます。');
      else if(action==='pause')notice('過去スキ整理を一時停止しました。');
      else if(action==='cancel')notice('過去スキ整理を中止しました。');
    }catch(e){const r=e.result||{};if(r.state){renderAuto(r.state);renderBackfill(r.backfill||r.state.backfill||{},false);renderHistory(r.state.history||[]);}notice(e.message,true);}
  }

  function startBackfillPoll(){if(backfillPoll)return;backfillPoll=setInterval(()=>requestAutoStatus().catch(()=>{}),10000);}
  function stopBackfillPoll(){if(backfillPoll){clearInterval(backfillPoll);backfillPoll=0;}}

  function historyResultLabel(row){
    if(row.result==='failed')return '失敗';
    if(row.result==='already')return '追加済み';
    return row.mode==='backfill'?'過去スキ追加':'追加';
  }
  function likeLabel(value){
    if(!value)return'';
    if(value==='ok')return'スキ';
    if(value==='already')return'スキ済み';
    if(value==='like_cooldown')return'スキ休止';
    if(/rate|limit|rejected/.test(value))return'スキ制限';
    return'';
  }
  function renderHistory(history){
    const list=$('historyList');const rows=Array.isArray(history)?history.slice(0,30):[];
    $('historyCount').textContent=`${rows.length}件`;
    list.textContent='';
    if(!rows.length){const e=document.createElement('div');e.className='history-empty';e.textContent=versionAtLeast('0.1.33')?'まだ履歴がありません。':'v0.1.33へ更新すると自動処理履歴を表示できます。';list.appendChild(e);return;}
    rows.forEach(row=>{
      const item=document.createElement('div');item.className='history-item';
      const main=document.createElement('div');main.className='history-main';
      const title=document.createElement('div');title.className='history-title';title.textContent=row.title||row.key||'記事';
      const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[fmtDateTime(row.at),row.creator?`@${row.creator}`:'',row.mode==='backfill'?'過去スキ整理':'自動運転'].filter(Boolean).join(' · ');
      main.append(title,meta);
      const badges=document.createElement('div');badges.className='history-badges';
      const result=document.createElement('span');result.className=`history-tag ${row.result||'added'}`;result.textContent=historyResultLabel(row);badges.appendChild(result);
      const like=likeLabel(row.like);if(like){const b=document.createElement('span');b.className='history-tag';b.textContent=like;badges.appendChild(b);}
      item.append(main,badges);list.appendChild(item);
    });
  }

  async function search(query,page=1){
    const q=String(query||'').replace(/^#+/,'').trim();if(!q)return;
    if(!bridgeReady()){notice('Firefox拡張機能をインストールして、このページを再読み込みしてください。',true);return;}
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
    if(ready){const version=bridgeVersion();status.textContent=`Firefox連携中 v${version}`;status.classList.add('connected');requestAccount();requestAutoStatus();}
    else{status.textContent='Firefox未接続';status.classList.remove('connected');}
  }

  TAGS.forEach(tag=>{const b=document.createElement('button');b.className='chip';b.type='button';b.textContent=tag;b.addEventListener('click',()=>{ $('searchInput').value=tag;search(tag);});$('chips').appendChild(b);});
  $('searchButton').addEventListener('click',()=>search($('searchInput').value));$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')search(e.currentTarget.value);});
  $('prev').addEventListener('click',()=>move(-1));$('next').addEventListener('click',()=>move(1));$('magazine').addEventListener('click',addMagazine);
  $('autoToggle').addEventListener('click',()=>autoControl(autoEnabled?'disable':'enable'));$('autoResume').addEventListener('click',()=>autoControl('resume'));$('runNow').addEventListener('click',()=>autoControl('run'));
  $('backfillScan').addEventListener('click',()=>backfillControl('scan'));$('backfillStart').addEventListener('click',()=>backfillControl('start'));$('backfillPause').addEventListener('click',()=>backfillControl('pause'));$('backfillResume').addEventListener('click',()=>backfillControl('resume'));$('backfillCancel').addEventListener('click',()=>backfillControl('cancel'));
  $('card').addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0].clientX;},{passive:true});$('card').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(Math.abs(dx)>55)move(dx<0?1:-1);},{passive:true});
  document.addEventListener('nero-liked-status',()=>{const state=document.documentElement.dataset.neroCurrentLiked;if(state==='true'){$('like').textContent='♥ スキ済み';$('like').dataset.liked='true';}else $('like').textContent='♡ スキ';});
  const observer=new MutationObserver(syncBridge);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-nero-extension','data-nero-extension-version']});
  syncBridge();setTimeout(syncBridge,700);setTimeout(syncBridge,1800);
})();
