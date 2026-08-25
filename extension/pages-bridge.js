'use strict';

(function initializePagesBridge() {
  const VERSION = '0.1.32';

  function publishVersion() {
    document.documentElement.dataset.neroExtensionVersion = VERSION;
    const status = document.getElementById('neroExtensionStatus');
    if (status && document.documentElement.dataset.neroExtension === 'ready') {
      status.textContent = '連携中 v' + VERSION;
      status.title = 'Firefox拡張機能 v' + VERSION + ' と連携中';
      status.classList.add('connected');
    }
  }

  document.addEventListener('nero-auto-status-request', async () => {
    let request = null;
    try { request = JSON.parse(document.documentElement.dataset.neroAutoStatusRequest || ''); } catch (_) {}
    if (!request || !request.id) return;
    let result;
    try {
      const response = await browser.runtime.sendMessage({ type: 'NERO_AUTO_STATUS' });
      result = response && response.ok
        ? { id: request.id, ok: true, state: response.state || {} }
        : { id: request.id, ok: false, message: '自動運転の状態を確認できませんでした。' };
    } catch (_) {
      result = { id: request.id, ok: false, message: 'Firefox拡張機能との通信に失敗しました。' };
    }
    document.documentElement.dataset.neroAutoStatusResult = JSON.stringify(result);
    document.dispatchEvent(new Event('nero-auto-status-result'));
  });

  document.addEventListener('nero-auto-control-request', async () => {
    let request = null;
    try { request = JSON.parse(document.documentElement.dataset.neroAutoControlRequest || ''); } catch (_) {}
    if (!request || !request.id) return;
    const typeByAction = {
      enable: 'NERO_AUTO_ENABLE',
      disable: 'NERO_AUTO_DISABLE',
      resume: 'NERO_AUTO_RESUME',
      run: 'NERO_AUTO_RUN_NOW'
    };
    const messageType = typeByAction[String(request.action || '')];
    if (!messageType) return;
    let result;
    try {
      const response = await browser.runtime.sendMessage({ type: messageType });
      result = response && response.ok
        ? { id: request.id, ok: true, state: response.state || {}, summary: response.summary || null }
        : { id: request.id, ok: false, message: response && response.code ? String(response.code) : '自動運転を変更できませんでした。' };
    } catch (_) {
      result = { id: request.id, ok: false, message: 'Firefox拡張機能との通信に失敗しました。' };
    }
    document.documentElement.dataset.neroAutoControlResult = JSON.stringify(result);
    document.dispatchEvent(new Event('nero-auto-control-result'));
  });

  publishVersion();
  document.addEventListener('DOMContentLoaded', publishVersion, { once: true });
  const observer = new MutationObserver(publishVersion);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nero-extension'] });
})();
