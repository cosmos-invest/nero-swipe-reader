(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TARGET_MAGAZINE = 'ネロのお気に入り🌙';
  const COMMENT_PRIORITY_STORAGE = 'nero.reader.commentPriority.v1';
  const COMMENT_PRIORITY_REFRESH_MS = 6 * 60 * 60 * 1000;
  const TAGS = ['#自己紹介','#note初心者','#初投稿','#挑戦','#日常','#noteを楽しむ','#創作'];
  let rows = [];
  let index = 0;
  let account = '';
  let autoEnabled = false;
  let searchSeq = 0;
  let requestSeq = 0;
  let touchStartX = 0;
  let backfillPoll = 0;
  let returnLikesPoll = 0;
  let commentPriorityRows = [];
  let commentPriorityRefreshing = false;
  let commentPriorityAutoTried = false;

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

  function readCommentPriorityCache(){
    try{const value=JSON.parse(localStorage.getItem(COMMENT_PRIORITY_STORAGE)||'null');return value&&value.version===1&&Array.isArray(value.rows)?value:null;}catch(_){return null;}
  }
  function saveCommentPriorityCache(value){
    try{localStorage.setItem(COMMENT_PRIORITY_STORAGE,JSON.stringify(value));}catch(_){}
  }
  function restoreCommentPriorityCache(){
    const cache=readCommentPriorityCache();
    if(!cache||(account&&cache.owner&&cache.owner!==account)){commentPriorityRows=[];renderCommentPriority();return null;}
    commentPriorityRows=cache.rows.slice(0,200);
    renderCommentPriority(cache.updatedAt);
    return cache;
  }

  function renderCommentPriority(updatedAt=0){
    const badge=$('commentPriorityBadge'),list=$('commentPriorityList'),start=$('commentPriorityStart');
    badge.className='status-badge'+(commentPriorityRows.length?' on':'');
    badge.textContent=commentPriorityRefreshing?'更新中':(commentPriorityRows.length?`${commentPriorityRows.length}人`:'未設定');
    start.hidden=!commentPriorityRows.length;
    $('commentPriorityRefresh').disabled=commentPriorityRefreshing;
    $('commentPriorityText').textContent=commentPriorityRefreshing
      ?'コメント履歴と、その人たちの最新記事を確認しています。'
      :(commentPriorityRows.length
        ?`${commentPriorityRows.length}人の最新記事を最優先に設定済み${updatedAt?`（${fmtDateTime(updatedAt)}更新）`:''}。`
        :'最近コメントをくれた人を自動で見つけ、1人1件の最新記事を最優先リストにします。');
    list.textContent='';
    if(!commentPriorityRows.length){const empty=document.createElement('div');empty.className='history-empty';empty.textContent=commentPriorityRefreshing?'取得しています…':'まだ最新記事を取得していません。';list.appendChild(empty);return;}
    commentPriorityRows.forEach((row,i)=>{
      const item=document.createElement('a');item.className='priority-item';item.href=row.url;item.target='_blank';item.rel='noopener';
      const rank=document.createElement('span');rank.className='priority-rank';rank.textContent=String(i+1);
      const copy=document.createElement('span');copy.className='priority-copy';
      const title=document.createElement('span');title.className='priority-title';title.textContent=row.name||'無題の記事';
      const meta=document.createElement('span');meta.className='priority-meta';meta.textContent=[row.nickname||`@${row.urlname}`,fmtDate(row.publishAt),row.lastCommentAt?`最終コメント ${fmtDateTime(row.lastCommentAt)}`:''].filter(Boolean).join(' · ');
      const comments=document.createElement('span');comments.className='priority-comment';comments.textContent=`💬${Number(row.commentCount||0)}`;
      copy.append(title,meta);item.append(rank,copy,comments);list.appendChild(item);
    });
  }

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
    try{const r=await requestEvent('nero-account-request','neroAccountRequest','nero-account-result','neroAccountResult',{});account=String(r.urlname||'');$('account').textContent=account?`@${account}`:'未ログイン';const cache=restoreCommentPriorityCache();if(cache&&cache.enabled&&Date.now()-Number(cache.updatedAt||0)>=COMMENT_PRIORITY_REFRESH_MS&&!commentPriorityAutoTried){commentPriorityAutoTried=true;refreshCommentPriority(true);}}
    catch(e){$('account').textContent='確認失敗';notice(e.message,true);}
  }

  async function requestEngagement(days=30){
    return requestEvent('nero-engagement-request','neroEngagementRequest','nero-engagement-result','neroEngagementResult',{days},300000);
  }

  async function requestCreatorLatest(creators){
    const items=[];const failed=[];
    for(let offset=0;offset<creators.length;offset+=200){
      const r=await requestEvent('nero-creator-latest-request','neroCreatorLatestRequest','nero-creator-latest-result','neroCreatorLatestResult',{creators:creators.slice(offset,offset+200)},60000);
      items.push(...(Array.isArray(r.items)?r.items:[]));failed.push(...(Array.isArray(r.failed)?r.failed:[]));
    }
    return {items,failed};
  }

  async function refreshCommentPriority(silent=false){
    if(commentPriorityRefreshing)return;
    if(!versionAtLeast('0.1.39')){if(!silent)notice('コメント最優先リストはFirefox拡張 v0.1.39から利用できます。',true);return;}
    commentPriorityRefreshing=true;renderCommentPriority();
    if(!silent)notice('コメントをくれた人と最新記事を確認しています…');
    try{
      const engagement=await requestEngagement(30);
      const commenters=(Array.isArray(engagement.creators)?engagement.creators:[]).filter(row=>Number(row.commentCount||0)>0&&row.urlname);
      const latest=await requestCreatorLatest(commenters.map(row=>row.urlname));
      const byCreator=new Map(commenters.map(row=>[String(row.urlname).toLowerCase(),row]));
      commentPriorityRows=latest.items.map(item=>{
        const relation=byCreator.get(String(item.urlname||'').toLowerCase());
        if(!relation||!item.url)return null;
        return {...item,nickname:relation.nickname||item.nickname||item.urlname,commentCount:Number(relation.commentCount||0),lastCommentAt:relation.lastActionAt||''};
      }).filter(Boolean).sort((a,b)=>{
        const commentTime=(Date.parse(b.lastCommentAt||'')||0)-(Date.parse(a.lastCommentAt||'')||0);if(commentTime)return commentTime;
        return (Date.parse(b.publishAt||'')||0)-(Date.parse(a.publishAt||'')||0);
      }).slice(0,200);
      const updatedAt=Date.now();
      saveCommentPriorityCache({version:1,enabled:true,owner:engagement.owner||account,updatedAt,rows:commentPriorityRows});
      renderCommentPriority(updatedAt);
      if(!silent)notice(commentPriorityRows.length?`${commentPriorityRows.length}人の最新記事を最優先に設定しました。`:'直近30日にコメントをくれた人の記事は見つかりませんでした。');
    }catch(e){restoreCommentPriorityCache();if(!silent)notice(e.message,true);}
    finally{commentPriorityRefreshing=false;const cache=readCommentPriorityCache();renderCommentPriority(cache&&cache.updatedAt);}
  }

  function startCommentPriority(){
    if(!commentPriorityRows.length)return;
    rows=commentPriorityRows.slice();index=0;$('empty').hidden=true;$('reader').hidden=false;render();notice(`コメントをくれた${rows.length}人の最新記事を、最優先で表示しています。`);$('reader').scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function requestAutoStatus(){
    if(!bridgeReady()){ renderAuto({enabled:false,unavailable:true}); renderReturnLikes({},true); renderBackfill({},true); renderHistory([]); return; }
    try{
      const r=await requestEvent('nero-auto-status-request','neroAutoStatusRequest','nero-auto-status-result','neroAutoStatusResult',{});
      renderAuto(r.state||{});
      renderReturnLikes((r.state||{}).returnLikes||{},!versionAtLeast('0.1.39'));
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
    try{const r=await requestEvent('nero-auto-control-request','neroAutoControlRequest','nero-auto-control-result','neroAutoControlResult',{action},30000);renderAuto(r.state||{});renderReturnLikes((r.state||{}).returnLikes||{},!versionAtLeast('0.1.39'));renderBackfill((r.state||{}).backfill||{},!versionAtLeast('0.1.33'));renderHistory((r.state||{}).history||[]);notice(action==='run'?'1件の自動処理を実行しました。':'自動運転を更新しました。');}
    catch(e){notice(e.message,true);}
  }

  function returnLikesLabel(status){
    return ({idle:'未確認',scanning:'確認中',ready:'準備完了',running:'返礼中',paused:'一時停止',completed:'完了',failed:'確認失敗'})[status]||'未確認';
  }

  function renderReturnLikes(task={},unsupported=false){
    const status=String(task.status||'idle'),badge=$('returnLikesBadge');
    badge.className='status-badge'+(status==='running'?' on':(status==='paused'||status==='failed'?' pause':(status==='completed'?' done':'')));
    badge.textContent=unsupported?'v0.1.39必要':returnLikesLabel(status);
    const total=Number(task.total||0),processed=Number(task.processed||0),remaining=Number(task.remaining||Math.max(0,total-processed));
    $('returnLikesDiscovered').textContent=unsupported?'—':String(Number(task.discovered||0));
    $('returnLikesProcessed').textContent=unsupported?'—':String(processed);
    $('returnLikesPrevious').textContent=unsupported?'—':String(Number(task.previouslyReturned||0));
    $('returnLikesRemaining').textContent=unsupported?'—':String(remaining);
    $('returnLikesMeterBar').style.width=total?`${Math.min(100,processed/total*100)}%`:(status==='completed'?'100%':'0%');
    const scan=$('returnLikesScan'),start=$('returnLikesStart'),pause=$('returnLikesPause'),resume=$('returnLikesResume');
    [scan,start,pause,resume].forEach(button=>{button.hidden=true;button.disabled=unsupported;});
    if(unsupported){scan.hidden=false;$('returnLikesText').textContent='この機能はFirefox拡張 v0.1.39から利用できます。';stopReturnLikesPoll();return;}
    if(['idle','failed','completed'].includes(status))scan.hidden=false;
    if(status==='ready')start.hidden=false;
    if(status==='running'){pause.hidden=false;startReturnLikesPoll();}else stopReturnLikesPoll();
    if(status==='paused'){resume.hidden=false;scan.hidden=false;if(task.nextRetryAt)startReturnLikesPoll();}
    let text='指定記事にスキやコメントをくれた人を確認し、その人の最新記事へ1人1回だけスキを返します。';
    if(status==='scanning')text='反応した人と、その人たちの最新記事を確認しています。';
    if(status==='ready')text=`未返礼 ${total}人を確認しました。コメントをくれた人から先に返します。`;
    if(status==='running')text=`スキ返し中です。${processed}/${total}人が完了、残り${remaining}人。`;
    if(status==='paused')text=`一時停止中です。${task.pauseMessage||''}${task.nextRetryAt?` ${fmtDateTime(task.nextRetryAt)}以降に自動再開します。`:''}`;
    if(status==='completed')text=total?`返礼完了。今回${processed}人、過去分${Number(task.previouslyReturned||0)}人は重複せず除外しました。`:`全員返礼済みです。過去分${Number(task.previouslyReturned||0)}人を重複せず除外しました。`;
    if(status==='failed')text=`確認に失敗しました。${task.pauseMessage||task.pauseReason||'noteのログイン状態を確認してください。'}`;
    $('returnLikesText').textContent=text;
  }

  async function returnLikesControl(action){
    if(!versionAtLeast('0.1.39')){notice('スキ返しはFirefox拡張 v0.1.39から利用できます。',true);return;}
    const timeout=action==='scan'?120000:(action==='start'||action==='resume'?90000:20000);
    try{
      const r=await requestEvent('nero-return-likes-control-request','neroReturnLikesControlRequest','nero-return-likes-control-result','neroReturnLikesControlResult',{action},timeout);
      const state=r.state||{};renderAuto(state);renderReturnLikes(r.returnLikes||state.returnLikes||{},false);renderBackfill(state.backfill||{},!versionAtLeast('0.1.33'));renderHistory(state.history||[]);
      if(action==='scan')notice(`未返礼 ${Number((r.returnLikes||{}).total||0)}人を確認しました。`);
      else if(action==='start'||action==='resume')notice('スキ返しを開始しました。ページを閉じてもFirefox側で続きます。');
      else if(action==='pause')notice('スキ返しを一時停止しました。');
    }catch(e){const r=e.result||{};if(r.state){renderAuto(r.state);renderReturnLikes(r.returnLikes||r.state.returnLikes||{},false);renderBackfill(r.state.backfill||{},!versionAtLeast('0.1.33'));renderHistory(r.state.history||[]);}notice(e.message,true);}
  }

  function startReturnLikesPoll(){if(returnLikesPoll)return;returnLikesPoll=setInterval(()=>requestAutoStatus().catch(()=>{}),10000);}
  function stopReturnLikesPoll(){if(returnLikesPoll){clearInterval(returnLikesPoll);returnLikesPoll=0;}}

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
      renderAuto(state);renderReturnLikes(state.returnLikes||{},!versionAtLeast('0.1.39'));renderBackfill(r.backfill||state.backfill||{},false);renderHistory(state.history||[]);
      if(action==='scan')notice(`過去スキ ${Number((r.backfill||{}).total||0)}件を確認しました。`);
      else if(action==='start'||action==='resume')notice('過去スキの整理を開始しました。ページを閉じてもFirefox側で続きます。');
      else if(action==='pause')notice('過去スキ整理を一時停止しました。');
      else if(action==='cancel')notice('過去スキ整理を中止しました。');
    }catch(e){const r=e.result||{};if(r.state){renderAuto(r.state);renderReturnLikes(r.state.returnLikes||{},!versionAtLeast('0.1.39'));renderBackfill(r.backfill||r.state.backfill||{},false);renderHistory(r.state.history||[]);}notice(e.message,true);}
  }

  function startBackfillPoll(){if(backfillPoll)return;backfillPoll=setInterval(()=>requestAutoStatus().catch(()=>{}),10000);}
  function stopBackfillPoll(){if(backfillPoll){clearInterval(backfillPoll);backfillPoll=0;}}

  function historyResultLabel(row){
    if(row.result==='failed')return '失敗';
    if(row.mode==='return'&&row.result==='liked')return 'スキ返し';
    if(row.mode==='return'&&row.result==='already')return 'スキ済み';
    if(row.result==='already')return '追加済み';
    return row.mode==='backfill'?'過去スキ追加':'追加';
  }
  function likeLabel(value){
    if(!value)return'';
    if(value==='ok')return'スキ';
    if(value==='liked')return'スキ返し';
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
      const meta=document.createElement('div');meta.className='history-meta';meta.textContent=[fmtDateTime(row.at),row.creator?`@${row.creator}`:'',row.mode==='backfill'?'過去スキ整理':(row.mode==='return'?'スキ返し':'自動運転')].filter(Boolean).join(' · ');
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
  $('commentPriorityRefresh').addEventListener('click',()=>refreshCommentPriority(false));$('commentPriorityStart').addEventListener('click',startCommentPriority);
  $('returnLikesScan').addEventListener('click',()=>returnLikesControl('scan'));$('returnLikesStart').addEventListener('click',()=>returnLikesControl('start'));$('returnLikesPause').addEventListener('click',()=>returnLikesControl('pause'));$('returnLikesResume').addEventListener('click',()=>returnLikesControl('resume'));
  $('backfillScan').addEventListener('click',()=>backfillControl('scan'));$('backfillStart').addEventListener('click',()=>backfillControl('start'));$('backfillPause').addEventListener('click',()=>backfillControl('pause'));$('backfillResume').addEventListener('click',()=>backfillControl('resume'));$('backfillCancel').addEventListener('click',()=>backfillControl('cancel'));
  $('card').addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0].clientX;},{passive:true});$('card').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(Math.abs(dx)>55)move(dx<0?1:-1);},{passive:true});
  document.addEventListener('nero-liked-status',()=>{const state=document.documentElement.dataset.neroCurrentLiked;if(state==='true'){$('like').textContent='♥ スキ済み';$('like').dataset.liked='true';}else $('like').textContent='♡ スキ';});
  const observer=new MutationObserver(syncBridge);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-nero-extension','data-nero-extension-version']});
  restoreCommentPriorityCache();syncBridge();setTimeout(syncBridge,700);setTimeout(syncBridge,1800);
})();
