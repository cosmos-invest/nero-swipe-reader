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

  document.addEventListener('nero-app-request', () => {
    let request = null;
    try { request = JSON.parse(document.documentElement.dataset.neroAppRequest || ''); } catch (_) {}
    if (!request || !request.requestId || !request.action) return;
    post({ type: 'request', requestId: String(request.requestId), action: String(request.action), args: request.args && typeof request.args === 'object' ? request.args : {} });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!port || !connected)) connect();
  });

  publishConnection('connecting', 'Firefox拡張を確認しています…');
  connect();

  globalThis.NeroAppBridgeTest = { constants: { VERSION, PORT_NAME } };
})();
