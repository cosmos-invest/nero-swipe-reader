'use strict';

(function initializeNeroReturnLikesUi() {
  const VERSION = '0.1.41';
  let latest = null;
  let refreshTimer = 0;

  function publishVersion() {
    if (document.documentElement.dataset.neroExtensionVersion !== VERSION) {
      document.documentElement.dataset.neroExtensionVersion = VERSION;
    }
    const status = document.getElementById('neroExtensionStatus');
    if (status && document.documentElement.dataset.neroExtension === 'ready') {
      status.textContent = '連携中 v' + VERSION;
      status.title = 'Firefox拡張機能 v' + VERSION + ' と連携中';
      status.classList.add('connected');
    }
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''), 'https://note.com/');
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function fmt(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    } catch (_) {
      return '';
    }
  }

  function installStyles() {
    if (document.getElementById('nero-return-targets-v141-style')) return;
    const style = document.createElement('style');
    style.id = 'nero-return-targets-v141-style';
    style.textContent = `
      .nero-return-targets-v141{margin:14px 0 12px;padding:12px;border:1px solid #3a3142;border-radius:14px;background:#17131d}
      .nero-return-targets-v141-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}
      .nero-return-targets-v141-head strong{font-size:13px;color:#f3eafa}.nero-return-targets-v141-head span{font-size:11px;color:#948a9b}
      .nero-return-targets-v141-list{display:grid;gap:7px;max-height:420px;overflow:auto}
      .nero-return-target-v141{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;padding:10px 11px;border:1px solid #302837;border-radius:11px;background:#211a27;text-decoration:none!important}
      .nero-return-target-v141:hover{border-color:#665277}.nero-return-target-v141.done{opacity:.58}
      .nero-return-target-v141-title{min-width:0;color:#eee5f2;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nero-return-target-v141-user{min-width:0;color:#aaa0b0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nero-return-target-v141-badges{grid-row:1/3;grid-column:2;display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end}
      .nero-return-target-v141-badge{padding:3px 6px;border-radius:999px;background:#34283d;color:#d9c8e2;font-size:10px;font-weight:800;white-space:nowrap}
      .nero-return-target-v141-empty{padding:10px;color:#8f8496;font-size:12px;text-align:center}
      @media(max-width:600px){.nero-return-targets-v141-list{max-height:360px}.nero-return-target-v141{grid-template-columns:minmax(0,1fr)}.nero-return-target-v141-badges{grid-row:auto;grid-column:auto;justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function ensureBox() {
    const panel = document.querySelector('.return-likes.panel');
    if (!panel) return null;
    const note = panel.querySelector('.tiny');
    if (note && note.textContent.includes('新しいスキだけ5分間隔')) {
      for (const node of note.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.includes('新しいスキだけ5分間隔')) {
          node.nodeValue = node.nodeValue.replace('新しいスキだけ5分間隔', '新しいスキだけ1分間隔');
        }
      }
    }
    let box = document.getElementById('neroReturnTargetsV141');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'neroReturnTargetsV141';
    box.className = 'nero-return-targets-v141';
    box.innerHTML = '<div class="nero-return-targets-v141-head"><strong>返礼する対象記事</strong><span id="neroReturnTargetsV141Updated">未取得</span></div><div id="neroReturnTargetsV141List" class="nero-return-targets-v141-list"><div class="nero-return-targets-v141-empty">「反応した人を確認」で対象記事を取得します。</div></div>';
    const row = panel.querySelector('.button-row');
    if (row) panel.insertBefore(box, row);
    else panel.appendChild(box);
    return box;
  }

  function syncButton() {
    const button = document.getElementById('returnLikesScan');
    if (!button) return;
    const status = String(latest && latest.status || '');
    if (['ready', 'paused', 'completed', 'failed'].includes(status)) {
      button.hidden = false;
      button.disabled = false;
      button.textContent = '対象記事一覧を更新';
      button.title = '新しく反応した人と、その人の最新記事を再取得します。返礼済み履歴は保持します。';
    } else if (status === 'idle') {
      button.textContent = '反応した人を確認';
    }
  }

  function render(data) {
    latest = data && typeof data === 'object' ? data : latest;
    installStyles();
    ensureBox();
    syncButton();
    if (!latest) return;
    const list = document.getElementById('neroReturnTargetsV141List');
    const updated = document.getElementById('neroReturnTargetsV141Updated');
    if (!list || !updated) return;
    const targets = Array.isArray(latest.targets) ? latest.targets : [];
    updated.textContent = `${targets.length}件${latest.updatedAt ? ` · ${fmt(latest.updatedAt)}更新` : ''}`;
    list.textContent = '';
    if (!targets.length) {
      const empty = document.createElement('div');
      empty.className = 'nero-return-targets-v141-empty';
      empty.textContent = latest.status === 'scanning' ? '対象記事を更新しています…' : '現在の未返礼対象はありません。';
      list.appendChild(empty);
      return;
    }
    targets.forEach((item) => {
      const href = safeUrl(item.articleUrl);
      const row = document.createElement(href ? 'a' : 'div');
      row.className = 'nero-return-target-v141' + (item.done ? ' done' : '');
      if (href) {
        row.href = href;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
      }
      const title = document.createElement('span');
      title.className = 'nero-return-target-v141-title';
      title.textContent = String(item.title || '無題の記事');
      const user = document.createElement('span');
      user.className = 'nero-return-target-v141-user';
      user.textContent = `${item.nickname || '@' + item.urlname}${item.publishAt ? ` · ${fmt(item.publishAt)}` : ''}`;
      const badges = document.createElement('span');
      badges.className = 'nero-return-target-v141-badges';
      const labels = [];
      if (item.commented) labels.push('💬 コメント');
      if (item.likedTarget) labels.push('♡ スキ');
      if (item.done) labels.push('✓ 返礼済');
      labels.forEach((label) => {
        const badge = document.createElement('span');
        badge.className = 'nero-return-target-v141-badge';
        badge.textContent = label;
        badges.appendChild(badge);
      });
      row.append(title, user, badges);
      list.appendChild(row);
    });
  }

  async function refresh() {
    if (!document.documentElement.dataset.neroExtension) return;
    try {
      const result = await browser.runtime.sendMessage({ type: 'NERO_RETURN_TARGETS_STATUS' });
      if (result && result.ok) render(result);
    } catch (_) {}
  }

  function requestRefresh(delay = 0) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, delay);
  }

  function install() {
    publishVersion();
    installStyles();
    ensureBox();
    syncButton();
    requestRefresh(0);
    const panel = document.querySelector('.return-likes.panel');
    if (panel && !panel.dataset.neroReturnV141Observed) {
      panel.dataset.neroReturnV141Observed = '1';
      new MutationObserver(() => syncButton()).observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    }
  }

  document.addEventListener('nero-auto-status-result', () => requestRefresh(0));
  document.addEventListener('nero-return-likes-control-result', () => {
    requestRefresh(0);
    requestRefresh(250);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  const versionObserver = new MutationObserver(() => {
    publishVersion();
    if (!document.getElementById('neroReturnTargetsV141')) install();
  });
  versionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nero-extension', 'data-nero-extension-version'] });
})();
