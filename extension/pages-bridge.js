'use strict';

(function initializePagesBridge() {
  const VERSION = '0.1.39';

  function publishVersion() {
    document.documentElement.dataset.neroExtensionVersion = VERSION;
    const status = document.getElementById('neroExtensionStatus');
    if (status && document.documentElement.dataset.neroExtension === 'ready') {
      status.textContent = '連携中 v' + VERSION;
      status.title = 'Firefox拡張機能 v' + VERSION + ' と連携中';
      status.classList.add('connected');
    }
  }

  async function relay(requestDataset, resultDataset, resultEvent, message) {
    let request = null;
    try { request = JSON.parse(document.documentElement.dataset[requestDataset] || ''); } catch (_) {}
    if (!request || !request.id) return;
    let result;
    try {
      const response = await browser.runtime.sendMessage(message(request));
      result = response && response.ok
        ? { id: request.id, ok: true, ...response }
        : { id: request.id, ok: false, message: response && (response.message || response.code) ? String(response.message || response.code) : '処理できませんでした。', ...(response || {}) };
    } catch (_) {
      result = { id: request.id, ok: false, message: 'Firefox拡張機能との通信に失敗しました。' };
    }
    document.documentElement.dataset[resultDataset] = JSON.stringify(result);
    document.dispatchEvent(new Event(resultEvent));
  }

  document.addEventListener('nero-auto-status-request', () => relay(
    'neroAutoStatusRequest', 'neroAutoStatusResult', 'nero-auto-status-result',
    () => ({ type: 'NERO_AUTO_STATUS' })
  ));

  document.addEventListener('nero-auto-control-request', () => relay(
    'neroAutoControlRequest', 'neroAutoControlResult', 'nero-auto-control-result',
    (request) => {
      const typeByAction = {
        enable: 'NERO_AUTO_ENABLE',
        disable: 'NERO_AUTO_DISABLE',
        resume: 'NERO_AUTO_RESUME',
        run: 'NERO_AUTO_RUN_NOW'
      };
      return { type: typeByAction[String(request.action || '')] || 'NERO_AUTO_STATUS' };
    }
  ));

  document.addEventListener('nero-backfill-control-request', () => relay(
    'neroBackfillControlRequest', 'neroBackfillControlResult', 'nero-backfill-control-result',
    (request) => {
      const typeByAction = {
        status: 'NERO_BACKFILL_STATUS',
        scan: 'NERO_BACKFILL_SCAN',
        start: 'NERO_BACKFILL_START',
        pause: 'NERO_BACKFILL_PAUSE',
        resume: 'NERO_BACKFILL_RESUME',
        cancel: 'NERO_BACKFILL_CANCEL'
      };
      return { type: typeByAction[String(request.action || '')] || 'NERO_BACKFILL_STATUS' };
    }
  ));

  document.addEventListener('nero-return-likes-control-request', () => relay(
    'neroReturnLikesControlRequest', 'neroReturnLikesControlResult', 'nero-return-likes-control-result',
    (request) => {
      const typeByAction = {
        status: 'NERO_RETURN_LIKES_STATUS',
        scan: 'NERO_RETURN_LIKES_SCAN',
        start: 'NERO_RETURN_LIKES_START',
        pause: 'NERO_RETURN_LIKES_PAUSE',
        resume: 'NERO_RETURN_LIKES_RESUME'
      };
      return { type: typeByAction[String(request.action || '')] || 'NERO_RETURN_LIKES_STATUS' };
    }
  ));

  publishVersion();
  document.addEventListener('DOMContentLoaded', publishVersion, { once: true });
  const observer = new MutationObserver(publishVersion);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nero-extension'] });
})();
