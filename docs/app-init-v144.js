(() => {
  'use strict';
  const A=globalThis.NeroApp,$=A.$,S=A.state;
  document.querySelectorAll('[data-view-link]').forEach(b=>b.addEventListener('click',()=>A.setView(b.dataset.viewLink)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.commentsTab)A.setCommentsTab(b.dataset.commentsTab);A.setView(b.dataset.go);}));
  document.querySelectorAll('[data-comments-tab-button]').forEach(b=>b.addEventListener('click',()=>A.setCommentsTab(b.dataset.commentsTabButton)));
  A.installReadChips();
  $('refreshDashboard').addEventListener('click',A.refreshDashboard);$('diagnose').addEventListener('click',()=>A.diagnose(true));$('diagnoseManage').addEventListener('click',()=>A.diagnose(true));
  $('inboxRefresh').addEventListener('click',()=>A.scanInbox(false));$('inboxCancel').addEventListener('click',()=>A.rpc('cancel_job',{kind:'inbox'}).catch(()=>{}));$('inboxMore').addEventListener('click',()=>{S.inboxVisible+=A.PAGE_SIZE;A.renderInbox();});
  $('priorityRefresh').addEventListener('click',()=>A.scanPriority(false));$('priorityCancel').addEventListener('click',()=>A.rpc('cancel_job',{kind:'priority'}).catch(()=>{}));$('priorityStart').addEventListener('click',()=>A.startReader(S.priority.slice(),0));$('priorityMore').addEventListener('click',()=>{S.priorityVisible+=A.PAGE_SIZE;A.renderPriority();});
  $('searchButton').addEventListener('click',()=>A.search($('searchInput').value));$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')A.search(e.currentTarget.value);});
  $('prevButton').addEventListener('click',()=>A.moveReader(-1));$('nextButton').addEventListener('click',()=>A.moveReader(1));$('likeButton').addEventListener('click',A.articleLike);$('favoriteButton').addEventListener('click',A.favoriteAdd);$('commentButton').addEventListener('click',A.openArticleComposer);$('followButton').addEventListener('click',A.followCurrent);
  $('returnScan').addEventListener('click',()=>A.returnControl('scan'));$('returnStart').addEventListener('click',()=>A.returnControl('start'));$('returnPause').addEventListener('click',()=>A.returnControl('pause'));$('returnResume').addEventListener('click',()=>A.returnControl('resume'));$('returnMore').addEventListener('click',()=>{S.returnVisible+=A.PAGE_SIZE;A.renderReturn();});
  $('autoToggle').addEventListener('click',()=>A.autoControl(S.autoState&&S.autoState.enabled?'disable':'enable'));$('autoRun').addEventListener('click',()=>A.autoControl('run'));$('autoResume').addEventListener('click',()=>A.autoControl('resume'));
  $('backfillScan').addEventListener('click',()=>A.backfillControl('scan'));$('backfillStart').addEventListener('click',()=>A.backfillControl('start'));$('backfillPause').addEventListener('click',()=>A.backfillControl('pause'));$('backfillResume').addEventListener('click',()=>A.backfillControl('resume'));$('backfillCancel').addEventListener('click',()=>A.backfillControl('cancel'));
  $('fullInboxScan').addEventListener('click',()=>{A.setCommentsTab('inbox');A.setView('comments');A.scanInbox(true);});$('fullPriorityScan').addEventListener('click',()=>{A.setCommentsTab('partners');A.setView('comments');A.scanPriority(true);});
  $('composerClose').addEventListener('click',A.closeComposer);$('composerCancel').addEventListener('click',A.closeComposer);$('composerSend').addEventListener('click',A.sendComposer);$('composer').addEventListener('click',e=>{if(e.target===$('composer'))A.closeComposer();});
  A.syncBridgeState();A.setView('home');A.setCommentsTab('inbox');setTimeout(()=>A.diagnose(false).then(ok=>{if(ok)A.refreshDashboard();}),500);
})();
