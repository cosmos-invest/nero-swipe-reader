'use strict';

(function initializeNeroReturnLikesV141() {
  const VERSION = '0.1.41';
  const STATE_KEY = 'nero.localAuto.state.v1';
  const RETURN_LIKES_ALARM_NAME = 'nero-return-likes-v1';
  const FAST_INTERVAL_MINUTES = 1;
  let accelerateTimer = 0;

  function creatorKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function completionResult(value) {
    const result = String(value && typeof value === 'object' ? value.result : value || '');
    return ['liked', 'already', 'skipped'].includes(result) ? result : '';
  }

  function scheduleAcceleration(state) {
    if (!state || !state.returnLikes || state.returnLikes.status !== 'running') return;
    if (accelerateTimer) clearTimeout(accelerateTimer);
    accelerateTimer = setTimeout(async () => {
      accelerateTimer = 0;
      try {
        const row = await browser.storage.local.get(STATE_KEY);
        const latest = row && row[STATE_KEY];
        if (!latest || !latest.returnLikes || latest.returnLikes.status !== 'running') return;
        await browser.alarms.create(RETURN_LIKES_ALARM_NAME, { delayInMinutes: FAST_INTERVAL_MINUTES });
      } catch (_) {}
    }, 600);
  }

  async function readTargets() {
    const stored = await browser.storage.local.get(STATE_KEY);
    const state = stored && stored[STATE_KEY] && typeof stored[STATE_KEY] === 'object' ? stored[STATE_KEY] : {};
    const task = state.returnLikes && typeof state.returnLikes === 'object' ? state.returnLikes : {};
    const completed = task.completedCreators && typeof task.completedCreators === 'object' ? task.completedCreators : {};
    const returned = state.returnedCreators && typeof state.returnedCreators === 'object' ? state.returnedCreators : {};
    const queue = Array.isArray(task.queue) ? task.queue : [];
    const targets = queue.slice(0, 300).map((item) => {
      const urlname = creatorKey(item && item.urlname);
      const result = completionResult(completed[urlname] || returned[urlname]);
      return {
        urlname,
        nickname: String(item && (item.nickname || item.urlname) || ''),
        commented: Boolean(item && item.commented),
        likedTarget: Boolean(item && item.likedTarget),
        reactionAt: String(item && item.reactionAt || ''),
        key: String(item && item.key || ''),
        title: String(item && item.title || ''),
        publishAt: String(item && item.publishAt || ''),
        articleUrl: String(item && item.articleUrl || ''),
        done: Boolean(result),
        result
      };
    });
    return {
      ok: true,
      version: VERSION,
      status: String(task.status || 'idle'),
      targetArticle: String(task.targetArticle || 'https://note.com/nero_notelover/n/ne4843208abbe'),
      updatedAt: Number(task.updatedAt || 0),
      targets,
      returnIntervalMinutes: FAST_INTERVAL_MINUTES
    };
  }

  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes || !changes[STATE_KEY]) return;
      const next = changes[STATE_KEY].newValue;
      scheduleAcceleration(next);
    });
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    if (message.type === 'NERO_RETURN_TARGETS_STATUS') return readTargets();
    if (message.type === 'NERO_RETURN_LIKES_ACCELERATE') {
      return browser.storage.local.get(STATE_KEY).then((row) => {
        scheduleAcceleration(row && row[STATE_KEY]);
        return { ok: true, intervalMinutes: FAST_INTERVAL_MINUTES };
      });
    }
    return undefined;
  });

  browser.storage.local.get(STATE_KEY).then((row) => scheduleAcceleration(row && row[STATE_KEY])).catch(() => {});

  globalThis.NeroReturnLikesV141Test = {
    creatorKey,
    completionResult,
    readTargets,
    constants: { VERSION, STATE_KEY, RETURN_LIKES_ALARM_NAME, FAST_INTERVAL_MINUTES }
  };
})();
