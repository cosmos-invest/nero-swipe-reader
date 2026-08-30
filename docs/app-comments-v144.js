(() => {
  'use strict';
  const A=globalThis.NeroApp,$=A.$,S=A.state;
  const INBOX_FILTER_KEY='nero.inbox.showLiked.v1';
  const PRIORITY_FILTER_KEY='nero.priority.showLiked.v1';
  const PRIORITY_LIKE_TTL_MS=5*60*1000;

  if(typeof S.inboxShowLiked!=='boolean'){
    try{const saved=localStorage.getItem(INBOX_FILTER_KEY);S.inboxShowLiked=saved===null?true:saved!=='0';}
    catch(_){S.inboxShowLiked=true;}
  }
  if(typeof S.priorityShowLiked!=='boolean'){
    try{const saved=localStorage.getItem(PRIORITY_FILTER_KEY);S.priorityShowLiked=saved===null?false:saved==='1';}
    catch(_){S.priorityShowLiked=false;}
  }
  if(!(S.priorityLikeMap instanceof Map))S.priorityLikeMap=new Map();
  S.priorityLikeSignature=String(S.priorityLikeSignature||'');
  S.priorityLikeCheckedAt=Number(S.priorityLikeCheckedAt||0);
  S.priorityLikesLoading=Boolean(S.priorityLikesLoading);

  A.filteredInbox=()=>S.inboxShowLiked?S.inbox:S.inbox.filter(item=>!Boolean(item&&item.comment&&item.comment.creatorLiked));
  A.priorityLiked=row=>{
    if(row&&typeof row.liked==='boolean')return row.liked;
    if(row&&S.priorityLikeMap.has(row.url))return S.priorityLikeMap.get(row.url);
    return null;
  };
  A.filteredPriority=()=>S.priorityShowLiked?S.priority:S.priority.filter(row=>A.priorityLiked(row)!==true);
  A.applyPriorityLikeCache=()=>{
    S.priority.forEach(row=>{
      if(row&&row.url&&S.priorityLikeMap.has(row.url))row.liked=S.priorityLikeMap.get(row.url);
    });
  };
  A.markPriorityLiked=(url,liked=true)=>{
    const key=String(url||'').split('#')[0];
    if(!key)return;
    S.priorityLikeMap.set(key,Boolean(liked));
    S.priority.forEach(row=>{if(String(row&&row.url||'').split('#')[0]===key)row.liked=Boolean(liked);});
  };

  A.installInboxFilter=()=>{
    if($('inboxLikedFilter'))return;
    const refresh=$('inboxRefresh'),toolbar=refresh&&refresh.closest('.toolbar');
    if(!toolbar)return;
    const label=document.createElement('label');
    label.id='inboxLikedFilter';label.className='secondary';
    Object.assign(label.style,{display:'inline-flex',alignItems:'center',gap:'7px',cursor:'pointer',userSelect:'none'});
    const input=document.createElement('input');
    input.id='inboxShowLiked';input.type='checkbox';input.checked=S.inboxShowLiked;
    input.setAttribute('aria-label','スキ済みの返信待ちも表示');
    const text=document.createElement('span');text.textContent='スキ済みも表示';
    input.addEventListener('change',()=>{
      S.inboxShowLiked=input.checked;
      try{localStorage.setItem(INBOX_FILTER_KEY,S.inboxShowLiked?'1':'0');}catch(_){}
      S.inboxVisible=A.PAGE_SIZE;A.renderInbox();
    });
    label.append(input,text);
    const count=document.createElement('span');count.id='inboxFilterCount';
    Object.assign(count.style,{color:'var(--muted)',fontSize:'12px'});
    const updated=$('inboxUpdated');toolbar.insertBefore(label,updated||null);toolbar.insertBefore(count,updated||null);
  };

  A.installPriorityFilter=()=>{
    if($('priorityLikedFilter'))return;
    const refresh=$('priorityRefresh'),toolbar=refresh&&refresh.closest('.toolbar');
    if(!toolbar)return;
    const label=document.createElement('label');
    label.id='priorityLikedFilter';label.className='secondary';
    Object.assign(label.style,{display:'inline-flex',alignItems:'center',gap:'7px',cursor:'pointer',userSelect:'none'});
    const input=document.createElement('input');
    input.id='priorityShowLiked';input.type='checkbox';input.checked=S.priorityShowLiked;
    input.setAttribute('aria-label','スキ済みの最新記事も表示');
    const text=document.createElement('span');text.textContent='スキ済みも表示';
    input.addEventListener('change',()=>{
      S.priorityShowLiked=input.checked;
      try{localStorage.setItem(PRIORITY_FILTER_KEY,S.priorityShowLiked?'1':'0');}catch(_){}
      S.priorityVisible=A.PAGE_SIZE;A.renderPriority();
    });
    label.append(input,text);
    const count=document.createElement('span');count.id='priorityFilterCount';
    Object.assign(count.style,{color:'var(--muted)',fontSize:'12px'});
    const updated=$('priorityUpdated');toolbar.insertBefore(label,updated||null);toolbar.insertBefore(count,updated||null);
  };

  A.hydratePriorityLikes=async(force=false)=>{
    const rows=S.priority.filter(row=>row&&row.url);
    if(!rows.length){S.priorityLikesLoading=false;A.renderPriority();return;}
    const signature=rows.map(row=>String(row.url).split('#')[0]).join('|');
    const fresh=!force&&signature===S.priorityLikeSignature&&Date.now()-S.priorityLikeCheckedAt<PRIORITY_LIKE_TTL_MS;
    if(fresh){A.applyPriorityLikeCache();A.renderPriority();return;}
    S.priorityLikesLoading=true;A.renderPriority();
    try{
      for(let start=0;start<rows.length;start+=30){
        const chunk=rows.slice(start,start+30),urls=chunk.map(row=>String(row.url).split('#')[0]);
        try{
          const r=await A.rpc('note_action',{noteAction:'status_batch',urls},{timeout:60000});
          (Array.isArray(r.results)?r.results:[]).forEach(result=>{
            if(!result||!result.url||!result.ok)return;
            const url=String(result.url).split('#')[0];
            S.priorityLikeMap.set(url,Boolean(result.liked));
          });
          A.applyPriorityLikeCache();A.renderPriority();
        }catch(_){}
      }
      S.priorityLikeSignature=signature;S.priorityLikeCheckedAt=Date.now();
    }finally{
      S.priorityLikesLoading=false;A.applyPriorityLikeCache();A.renderPriority();
    }
  };

  A.loadCommentsStatus=()=>Promise.allSettled([A.loadInboxStatus(),A.loadPriorityStatus()]);
  A.loadInboxStatus=async()=>{
    try{
      const r=await A.rpc('inbox_status',{}, {timeout:15000});
      S.inbox=Array.isArray(r.items)?r.items:[];S.inboxVisible=A.PAGE_SIZE;
      A.installInboxFilter();A.renderInbox();
      $('inboxStatusBadge').textContent=S.inbox.length?`${S.inbox.length}件`:'0件';
      $('inboxStatusBadge').className='status-badge '+(S.inbox.length?'warn':'ok');
      $('inboxUpdated').textContent=r.completedAt?`前回確認 ${A.fmt(r.completedAt)}・全${Number(r.totalArticles||0)}記事`:'まだ全記事確認は完了していません。';
      A.renderHomeCounts();
    }catch(_){}
  };
  A.loadPriorityStatus=async()=>{
    try{
      const r=await A.rpc('priority_status',{}, {timeout:15000});
      S.priority=Array.isArray(r.rows)?r.rows:[];S.priorityVisible=A.PAGE_SIZE;
      A.applyPriorityLikeCache();A.installPriorityFilter();A.renderPriority();
      $('priorityStatusBadge').textContent=S.priority.length?`${S.priority.length}人`:'0人';
      $('priorityStatusBadge').className='status-badge '+(S.priority.length?'ok':'');
      $('priorityUpdated').textContent=r.completedAt?`前回更新 ${A.fmt(r.completedAt)}`:'まだ取得していません。';
      A.renderHomeCounts();
      A.hydratePriorityLikes(false).catch(()=>{});
    }catch(_){}
  };

  const progress=(kind,p)=>{
    const box=$(kind+'Progress');box.hidden=false;$(kind+'ProgressText').textContent=p.message||'確認中…';
    const done=Number(p.completed||0),total=Number(p.total||0);$(kind+'ProgressCount').textContent=total?`${done}/${total}`:'';
    $(kind+'ProgressBar').style.width=total?`${Math.min(100,done/total*100)}%`:'8%';
  };
  A.scanInbox=async(force=false)=>{
    if(S.runningScan.inbox)return;S.runningScan.inbox=true;$('inboxRefresh').disabled=true;$('inboxCancel').hidden=false;$('inboxStatusBadge').textContent='更新中';
    try{
      const r=await A.rpc('inbox_scan',{force},{timeout:600000,onProgress:p=>progress('inbox',p)});
      S.inbox=Array.isArray(r.items)?r.items:[];S.inboxVisible=A.PAGE_SIZE;A.renderInbox();
      A.notice(r.cancelled?'返信待ち確認を中断しました。途中結果は保存済みです。':`返信待ちを更新しました。現在${S.inbox.length}件です。`,r.cancelled?'':'ok');
    }catch(e){A.notice(e.message);}
    finally{S.runningScan.inbox=false;$('inboxRefresh').disabled=false;$('inboxCancel').hidden=true;$('inboxProgress').hidden=true;await A.loadInboxStatus();}
  };
  A.scanPriority=async(force=false)=>{
    if(S.runningScan.priority)return;S.runningScan.priority=true;$('priorityRefresh').disabled=true;$('priorityCancel').hidden=false;$('priorityStatusBadge').textContent='更新中';
    try{
      const r=await A.rpc('priority_scan',{force},{timeout:600000,onProgress:p=>progress('priority',p)});
      S.priority=Array.isArray(r.rows)?r.rows:[];S.priorityVisible=A.PAGE_SIZE;S.priorityLikeSignature='';
      A.applyPriorityLikeCache();A.renderPriority();
      if(!r.cancelled)await A.hydratePriorityLikes(true);
      A.notice(r.cancelled?'コメント相手の確認を中断しました。途中結果は保存済みです。':`${S.priority.length}人の最新記事を更新しました。`,r.cancelled?'':'ok');
    }catch(e){A.notice(e.message);}
    finally{S.runningScan.priority=false;$('priorityRefresh').disabled=false;$('priorityCancel').hidden=true;$('priorityProgress').hidden=true;await A.loadPriorityStatus();}
  };

  A.renderInbox=()=>{
    A.installInboxFilter();
    const list=$('inboxList'),rows=A.filteredInbox(),likedCount=S.inbox.filter(item=>Boolean(item&&item.comment&&item.comment.creatorLiked)).length,count=$('inboxFilterCount');
    if(count)count.textContent=S.inboxShowLiked?`表示 ${rows.length}件（スキ済み ${likedCount}件）`:`未スキ ${rows.length}件 / 全${S.inbox.length}件`;
    list.textContent='';
    if(!rows.length){
      list.innerHTML=S.inbox.length&&!S.inboxShowLiked?'<div class="empty-card">未スキの返信待ちはありません。スキ済みを表示すると確認できます。</div>':'<div class="empty-card">現在、返信待ちのコメントはありません。</div>';
      $('inboxMore').hidden=true;return;
    }
    rows.slice(0,S.inboxVisible).forEach(item=>{
      const c=item.comment||{},card=document.createElement('article');card.className='comment-card';
      const top=document.createElement('div');top.className='card-top';const person=document.createElement('div');person.className='person';
      const av=document.createElement('img');av.className='avatar';av.alt='';if(c.avatar)av.src=c.avatar;
      const pc=document.createElement('div');pc.className='person-copy';const name=document.createElement('strong');name.textContent=c.authorName||'@'+c.authorUrlname;
      const meta=document.createElement('small');meta.textContent=[c.authorUrlname?'@'+c.authorUrlname:'',A.fmt(c.publishedAt)].filter(Boolean).join(' · ');pc.append(name,meta);person.append(av,pc);
      const st=document.createElement('span');st.className='badge';st.textContent='返信待ち';top.append(person,st);
      const art=document.createElement('a');art.className='card-article';art.href=item.articleUrl;art.target='_blank';art.rel='noopener';art.textContent='記事：'+(item.articleTitle||'記事を開く');
      const body=document.createElement('p');body.className='comment-body';body.textContent=c.body||'';
      const acts=document.createElement('div');acts.className='card-actions';const reply=document.createElement('button');reply.textContent='返信する';reply.onclick=()=>A.openReplyComposer(item);
      const like=document.createElement('button');like.textContent=c.creatorLiked?'♥ スキ済み':'♡ コメントにスキ';like.disabled=Boolean(c.creatorLiked);like.onclick=()=>A.likeInboxComment(item,like);
      const open=document.createElement('a');open.href=item.articleUrl;open.target='_blank';open.rel='noopener';open.textContent='記事を開く ↗';acts.append(reply,like,open);card.append(top,art,body,acts);list.append(card);
    });
    $('inboxMore').hidden=S.inboxVisible>=rows.length;
  };
  A.likeInboxComment=async(item,button)=>{
    button.disabled=true;
    try{
      await A.rpc('note_action',{noteAction:'comment_like',articleUrl:item.articleUrl,replyTarget:item.comment&&item.comment.replyTarget||item.comment},{timeout:45000});
      if(item.comment)item.comment.creatorLiked=true;A.renderInbox();
      A.notice(S.inboxShowLiked?'コメントにスキしました。返信待ち一覧には残します。':'コメントにスキしました。スキ済み非表示のため一覧から隠しました。','ok');
    }catch(e){button.disabled=false;A.notice(e.message);}
  };

  A.renderPriority=()=>{
    A.installPriorityFilter();
    const list=$('priorityList'),rows=A.filteredPriority(),likedCount=S.priority.filter(row=>A.priorityLiked(row)===true).length,unknownCount=S.priority.filter(row=>A.priorityLiked(row)===null).length,count=$('priorityFilterCount');
    if(count){
      if(S.priorityLikesLoading)count.textContent=`スキ状態確認中… ${likedCount}/${S.priority.length}件判定`;
      else count.textContent=S.priorityShowLiked?`表示 ${rows.length}件（スキ済み ${likedCount}件）`:`未スキ ${rows.length}件 / 全${S.priority.length}件${unknownCount?`・未確認 ${unknownCount}件`:''}`;
    }
    list.textContent='';
    if(!rows.length){
      list.innerHTML=S.priority.length&&!S.priorityShowLiked?'<div class="empty-card">未スキの最新記事はありません。スキ済みも表示すると確認できます。</div>':'<div class="empty-card">コメント相手の最新記事はまだありません。</div>';
      $('priorityMore').hidden=true;$('priorityStart').hidden=true;return;
    }
    rows.slice(0,S.priorityVisible).forEach(row=>{
      const card=document.createElement('article');card.className='priority-card';const top=document.createElement('div');top.className='card-top';
      const copy=document.createElement('div');copy.style.minWidth='0';const title=document.createElement('strong');title.className='card-title';title.textContent=row.name||'無題の記事';
      const meta=document.createElement('span');meta.className='card-meta';meta.textContent=[row.nickname||'@'+row.urlname,A.fmt(row.publishAt,false),row.lastCommentAt?'最終コメント '+A.fmt(row.lastCommentAt):''].filter(Boolean).join(' · ');copy.append(title,meta);
      const b=document.createElement('span');b.className='badge';const liked=A.priorityLiked(row);b.textContent=liked===true?`💬${Number(row.commentCount||0)} · ♥ スキ済み`:`💬${Number(row.commentCount||0)}`;top.append(copy,b);
      const acts=document.createElement('div');acts.className='card-actions';const read=document.createElement('button');read.textContent='Readerで読む';read.onclick=()=>A.startReader&&A.startReader([row],0);
      const open=document.createElement('a');open.href=row.url;open.target='_blank';open.rel='noopener';open.textContent='noteで開く ↗';acts.append(read,open);card.append(top,acts);list.append(card);
    });
    $('priorityMore').hidden=S.priorityVisible>=rows.length;$('priorityStart').hidden=!rows.length;
  };
  A.startPriorityReader=()=>{const rows=A.filteredPriority();if(rows.length)A.startReader(rows.slice(),0);};

  A.openReplyComposer=item=>{S.composer={mode:'reply',item};$('composerEyebrow').textContent='REPLY';$('composerTitle').textContent='返信する';$('composerContext').textContent=`${item.comment.authorName||'@'+item.comment.authorUrlname}｜${item.articleTitle||''}\n${item.comment.body||''}`;$('composerText').value='';$('composerText').placeholder='返信を書いてください';$('composer').hidden=false;setTimeout(()=>$('composerText').focus(),50);};
  A.openArticleComposer=()=>{const row=S.readerRows[S.readerIndex];if(!row)return;S.composer={mode:'comment',row};$('composerEyebrow').textContent='COMMENT';$('composerTitle').textContent='コメントする';$('composerContext').textContent=row.name||'この記事にコメント';$('composerText').value='';$('composerText').placeholder='記事を読んで感じたことを書いてください';$('composer').hidden=false;setTimeout(()=>$('composerText').focus(),50);};
  A.closeComposer=()=>{S.composer=null;$('composer').hidden=true;};
  A.sendComposer=async()=>{
    const text=$('composerText').value.trim(),ctx=S.composer;if(!text||!ctx){A.notice('コメントを入力してください。');return;}$('composerSend').disabled=true;
    try{
      if(ctx.mode==='reply'){
        await A.rpc('reply_comment',{owner:S.health&&S.health.owner||'',inboxKey:ctx.item.key,articleUrl:ctx.item.articleUrl,comment:text,replyTarget:ctx.item.comment.replyTarget||ctx.item.comment},{timeout:60000});
        A.notice('返信しました。','ok');A.closeComposer();await A.loadInboxStatus();
      }else{
        await A.rpc('note_action',{noteAction:'comment',articleUrl:ctx.row.url,comment:text},{timeout:60000});A.notice('コメントを送りました。','ok');A.closeComposer();
      }
    }catch(e){A.notice(e.message);}finally{$('composerSend').disabled=false;}
  };
})();
