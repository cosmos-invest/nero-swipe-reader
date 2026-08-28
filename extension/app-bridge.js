'use strict';

(function initializeNeroAppBridge() {
  const VERSION = '0.1.44';
  const PORT_NAME = 'NERO_APP_V2';
  let port = null;
  let reconnectTimer = 0;
  let reconnectStep = 0;
  let connected = false;
  const queue = [];

  function publishConnection(state, message = '') {
    connected = state === 'connected';
    document.documentElement.dataset.neroExtension = 'ready';
    document.documentElement.dataset.neroExtensionVersion = VERSION;
    document.documentElement.dataset.neroBridgeState = state;
    document.documentElement.dataset.neroBridgeMessage = String(message || '');
    document.dispatchEvent(new Event('nero-app-connection'));
  }

  function publishResult(requestId, result) {
    document.documentElement.dataset.neroAppResult = JSON.stringify({ requestId, result });
    document.dispatchEvent(new Event('nero-app-result'));
  }

  function publishProgress(requestId, progress) {
    document.documentElement.dataset.neroAppProgress = JSON.stringify({ requestId, progress });
    document.dispatchEvent(new Event('nero-app-progress'));
  }

  function post(request) {
    if (!port || !connected) {
      if (queue.length < 20) queue.push(request);
      return false;
    }
    try {
      port.postMessage(request);
      return true;
    } catch (_) {
      if (queue.length < 20) queue.push(request);
      scheduleReconnect('拡張との接続が切れました。');
      return false;
    }
  }

  function flushQueue() {
    while (connected && port && queue.length) {
      const request = queue.shift();
      try { port.postMessage(request); } catch (_) { queue.unshift(request); break; }
    }
  }

  function scheduleReconnect(message = '') {
    if (reconnectTimer) return;
    connected = false;
    publishConnection('reconnecting', message || 'Firefox拡張へ再接続しています…');
    const delays = [500, 1000, 2000, 5000, 10000];
    const delay = delays[Math.min(reconnectStep, delays.length - 1)];
    reconnectStep += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, delay);
  }

  function connect() {
    try {
      if (port) { try { port.disconnect(); } catch (_) {} }
      port = browser.runtime.connect({ name: PORT_NAME });
      publishConnection('connecting', 'Firefox拡張と接続しています…');
      port.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'hello') {
          reconnectStep = 0;
          publishConnection('connected', 'Firefox拡張との通信準備ができました。');
          flushQueue();
          return;
        }
        if (message.type === 'response') publishResult(String(message.requestId || ''), message.result || {});
        if (message.type === 'progress') publishProgress(String(message.requestId || ''), message.progress || {});
      });
      port.onDisconnect.addListener(() => {
        port = null;
        scheduleReconnect('Firefox拡張との接続が切れました。途中結果は端末に保存されています。');
      });
    } catch (_) {
      port = null;
      scheduleReconnect('Firefox拡張へ接続できませんでした。');
    }
  }

  async function localAutomationRequest(request) {
    const action = String(request.action || '');
    const args = request.args && typeof request.args === 'object' ? request.args : {};
    const autoMap = { enable:'NERO_AUTO_ENABLE', disable:'NERO_AUTO_DISABLE', resume:'NERO_AUTO_RESUME', run:'NERO_AUTO_RUN_NOW' };
    const backfillMap = { status:'NERO_BACKFILL_STATUS', scan:'NERO_BACKFILL_SCAN', start:'NERO_BACKFILL_START', pause:'NERO_BACKFILL_PAUSE', resume:'NERO_BACKFILL_RESUME', cancel:'NERO_BACKFILL_CANCEL' };
    const returnMap = { scan:'NERO_RETURN_LIKES_SCAN', start:'NERO_RETURN_LIKES_START', pause:'NERO_RETURN_LIKES_PAUSE', resume:'NERO_RETURN_LIKES_RESUME' };
    if (action === 'auto_status') return browser.runtime.sendMessage({ type:'NERO_AUTO_STATUS' });
    if (action === 'auto_control') return browser.runtime.sendMessage({ type:autoMap[String(args.control || '')] || 'NERO_AUTO_STATUS' });
    if (action === 'backfill_control') return browser.runtime.sendMessage({ type:backfillMap[String(args.control || 'status')] || 'NERO_BACKFILL_STATUS' });
    if (action === 'return_control') return browser.runtime.sendMessage({ type:returnMap[String(args.control || '')] || 'NERO_RETURN_LIKES_STATUS' });
    if (action === 'return_status') {
      const [state, targets] = await Promise.all([
        browser.runtime.sendMessage({ type:'NERO_RETURN_LIKES_STATUS' }),
        browser.runtime.sendMessage({ type:'NERO_RETURN_TARGETS_STATUS' }).catch(() => ({ ok:true, targets:[], returnIntervalMinutes:1 }))
      ]);
      return { ok:true, state:state && state.state || {}, returnLikes:state && state.returnLikes || {}, targets:Array.isArray(targets && targets.targets) ? targets.targets : [], returnIntervalMinutes:Number(targets && targets.returnIntervalMinutes || 1) };
    }
    return null;
  }

  function isLocalAutomationAction(action) {
    return ['auto_status','auto_control','backfill_control','return_status','return_control'].includes(String(action || ''));
  }

  document.addEventListener('nero-app-request', () => {
    let request = null;
    try { request = JSON.parse(document.documentElement.dataset.neroAppRequest || ''); } catch (_) {}
    if (!request || !request.requestId || !request.action) return;
    if (isLocalAutomationAction(request.action)) {
      localAutomationRequest(request)
        .then((result) => publishResult(String(request.requestId), result || { ok:false, message:'自動運転の応答がありませんでした。' }))
        .catch(() => publishResult(String(request.requestId), { ok:false, code:'automation_bridge_failed', message:'自動運転との通信に失敗しました。' }));
      return;
    }
    post({ type: 'request', requestId: String(request.requestId), action: String(request.action), args: request.args && typeof request.args === 'object' ? request.args : {} });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!port || !connected)) connect();
  });

  publishConnection('connecting', 'Firefox拡張を確認しています…');
  connect();

  globalThis.NeroAppBridgeTest = { constants: { VERSION, PORT_NAME } };
})();
