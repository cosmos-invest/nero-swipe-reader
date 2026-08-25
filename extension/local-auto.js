'use strict';

(function initializeNeroLocalAutomation() {
  const ALARM_NAME = 'nero-local-auto-v1';
  const STATE_KEY = 'nero.localAuto.state.v1';
  const INTERVAL_MINUTES = 5;
  const MAX_MAGAZINE_PER_HOUR = 10;
  const LIKE_RETRY_MS = 60 * 60 * 1000;
  const CREATOR_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
  const NOTE_DEDUPE_MS = 30 * 24 * 60 * 60 * 1000;
  const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
  const TARGET_MAGAZINE = 'ネロのお気に入り🌙';
  const TAGS = ['はじめてのnote', 'note初心者', '初投稿', '自己紹介', '挑戦', '日常', 'noteを楽しむ', '創作'];
  const BLOCKED = ['必ず稼げる', '爆益', '最短で稼', 'コピペだけ', 'フォロバ100', 'スキ返し100', '相互フォロー100', '競艇', '競馬', '競輪', 'パチンコ', 'スロット', 'カジノ'];

  function freshState() {
    return {
      version: 1,
      enabled: false,
      boundAccount: '',
      paused: false,
      pauseReason: '',
      likeBlockedUntil: 0,
      events: [],
      processedNotes: {},
      processedCreators: {},
      lastRun: null
    };
  }

  async function loadState() {
    const row = await browser.storage.local.get(STATE_KEY);
    const value = row && row[STATE_KEY];
    return value && typeof value === 'object' ? { ...freshState(), ...value } : freshState();
  }

  async function saveState(state) {
    pruneState(state);
    await browser.storage.local.set({ [STATE_KEY]: state });
  }

  function pruneState(state, now = Date.now()) {
    state.events = (Array.isArray(state.events) ? state.events : []).filter((row) => now - Number(row.at || 0) < NOTE_DEDUPE_MS).slice(-500);
    for (const [key, at] of Object.entries(state.processedNotes || {})) if (now - Number(at || 0) >= NOTE_DEDUPE_MS) delete state.processedNotes[key];
    for (const [key, at] of Object.entries(state.processedCreators || {})) if (now - Number(at || 0) >= CREATOR_DEDUPE_MS) delete state.processedCreators[key];
  }

  function hourlyMagazineCount(state, now = Date.now()) {
    const cutoff = now - 60 * 60 * 1000;
    return (state.events || []).filter((row) => row.kind === 'magazine' && Number(row.at || 0) > cutoff).length;
  }

  function extractItems(payload) {
    const data = payload && payload.data !== undefined ? payload.data : payload;
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['notes', 'contents', 'items']) {
      if (Array.isArray(data[key])) return data[key];
      if (data[key] && typeof data[key] === 'object') {
        for (const nested of ['notes', 'contents', 'items']) if (Array.isArray(data[key][nested])) return data[key][nested];
      }
    }
    return [];
  }

  async function noteGet(path, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('https://note.com/api' + path, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error('note API returned ' + response.status);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function candidateAuthor(row) {
    const user = row && row.user && typeof row.user === 'object' ? row.user : (row && row.creator && typeof row.creator === 'object' ? row.creator : {});
    return String(user.urlname || '');
  }

  function candidateKey(row) {
    return String(row && (row.key || row.noteKey || row.id) || '');
  }

  function candidatePublished(row) {
    const raw = row && (row.publish_at || row.publishAt || row.published_at || row.publishedAt || row.created_at || row.createdAt);
    const time = Date.parse(String(raw || ''));
    return Number.isFinite(time) ? time : 0;
  }

  function candidateText(row) {
    const user = row && row.user && typeof row.user === 'object' ? row.user : {};
    const tags = Array.isArray(row && row.hashtags) ? row.hashtags.map((x) => typeof x === 'string' ? x : x && (x.name || x.hashtag || '')).join(' ') : '';
    return [row && (row.name || row.title), row && row.description, user.nickname, user.name, user.profile, tags].map((x) => String(x || '').toLowerCase()).join(' ');
  }

  function editorialScore(row) {
    const text = candidateText(row);
    if (BLOCKED.some((term) => text.includes(term.toLowerCase()))) return -999;
    let score = 0;
    if (/自己紹介|はじめまして|初投稿|note初心者|はじめてのnote|note始めました/.test(text)) score += 5;
    if (/挑戦|やってみた|始めてみた|学び|勉強|成長/.test(text)) score += 4;
    if (/交流|つなが|コメント|仲間|出会|noteを楽し/.test(text)) score += 5;
    if (/日常|暮らし|今日|休日|家族|仕事|子ども|散歩|ごはん/.test(text)) score += 4;
    if (/創作|小説|イラスト|写真|エッセイ|詩/.test(text)) score += 3;
    return score;
  }

  function normalizeCandidate(row, sourceTag) {
    const urlname = candidateAuthor(row);
    const key = candidateKey(row);
    if (!/^[a-zA-Z0-9_-]+$/.test(urlname) || !/^n[a-zA-Z0-9_-]+$/.test(key)) return null;
    const publishedAt = candidatePublished(row);
    return {
      key,
      urlname,
      title: String(row && (row.name || row.title) || ''),
      publishedAt,
      score: editorialScore(row),
      sourceTag,
      articleUrl: 'https://note.com/' + encodeURIComponent(urlname) + '/n/' + encodeURIComponent(key)
    };
  }

  async function discoverCandidate(state, account, now = Date.now()) {
    const tagOffset = Math.floor(now / (5 * 60 * 1000)) % TAGS.length;
    const tags = [...TAGS.slice(tagOffset), ...TAGS.slice(0, tagOffset)];
    const candidates = [];
    for (const tag of tags.slice(0, 3)) {
      let rows = [];
      try {
        rows = extractItems(await noteGet('/v3/hashtags/' + encodeURIComponent(tag) + '/notes?order=new&page=1&paid_only=false'));
      } catch (_) {
        continue;
      }
      for (const row of rows) {
        const candidate = normalizeCandidate(row, tag);
        if (!candidate || candidate.urlname === account || candidate.score < 4) continue;
        if (!candidate.publishedAt || now - candidate.publishedAt > LOOKBACK_MS || candidate.publishedAt > now + 10 * 60 * 1000) continue;
        if (state.processedNotes[candidate.key] && now - state.processedNotes[candidate.key] < NOTE_DEDUPE_MS) continue;
        if (state.processedCreators[candidate.urlname] && now - state.processedCreators[candidate.urlname] < CREATOR_DEDUPE_MS) continue;
        candidates.push(candidate);
      }
      if (candidates.length >= 8) break;
    }
    candidates.sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
    return candidates[0] || null;
  }

  function isLikeRateLimited(result) {
    if (!result || result.ok) return false;
    if (Number(result.status) === 429) return true;
    const text = [result.code, result.message].map((x) => String(x || '').toLowerCase()).join(' ');
    return /rate.?limit|too many|制限|上限|回数|時間をおいて|しばらく/.test(text);
  }

  function shouldPauseAll(result) {
    const code = String(result && result.code || '');
    return ['login_required', 'account_mismatch', 'magazine_ambiguous', 'magazine_missing', 'magazine_unavailable', 'magazine_result_unknown', 'magazine_api_unavailable'].includes(code);
  }

  async function getBoundAccount(state) {
    const api = globalThis.NeroBackgroundTest;
    if (!api || typeof api.runNoteOperation !== 'function') throw new Error('background_api_unavailable');
    const account = await api.runNoteOperation({ action: 'account' }, null);
    if (!account || !account.ok || !account.urlname) throw new Error(account && account.code || 'account_unavailable');
    const actual = String(account.urlname);
    if (!state.boundAccount) state.boundAccount = actual;
    if (state.boundAccount !== actual) {
      const error = new Error('account_mismatch');
      error.actual = actual;
      throw error;
    }
    return actual;
  }

  async function runOnce(source = 'alarm') {
    const state = await loadState();
    const now = Date.now();
    const summary = { at: now, source, status: 'pending', hourlyMagazineCount: hourlyMagazineCount(state, now), candidate: null, like: null, magazine: null };
    if (!state.enabled) return { ...summary, status: 'disabled' };
    if (state.paused) return { ...summary, status: 'paused', reason: state.pauseReason };
    if (summary.hourlyMagazineCount >= MAX_MAGAZINE_PER_HOUR) return { ...summary, status: 'hourly_limit' };

    try {
      const account = await getBoundAccount(state);
      const candidate = await discoverCandidate(state, account, now);
      if (!candidate) {
        summary.status = 'no_candidate';
        state.lastRun = summary;
        await saveState(state);
        return summary;
      }
      summary.candidate = { key: candidate.key, urlname: candidate.urlname, title: candidate.title, score: candidate.score, sourceTag: candidate.sourceTag };

      const api = globalThis.NeroBackgroundTest;
      let continueToMagazine = true;
      if (Number(state.likeBlockedUntil || 0) > now) {
        summary.like = { ok: false, skipped: true, code: 'like_cooldown', until: state.likeBlockedUntil };
      } else {
        const likeResult = await api.runDirectArticleLikeMutation(candidate.articleUrl);
        summary.like = likeResult || { ok: false, code: 'like_unknown' };
        if (isLikeRateLimited(likeResult)) {
          state.likeBlockedUntil = now + LIKE_RETRY_MS;
          summary.like.rateLimited = true;
          continueToMagazine = true;
        } else if (!likeResult || !likeResult.ok) {
          continueToMagazine = false;
        } else {
          state.likeBlockedUntil = 0;
        }
      }

      if (!continueToMagazine) {
        summary.status = 'like_failed';
        state.lastRun = summary;
        await saveState(state);
        return summary;
      }

      if (summary.like && !summary.like.skipped) await new Promise((resolve) => setTimeout(resolve, 12000));
      const magazineResult = await api.runDirectMagazineAddMutation(candidate.articleUrl, { name: TARGET_MAGAZINE }, account);
      summary.magazine = magazineResult || { ok: false, code: 'magazine_unknown' };
      if (!magazineResult || !magazineResult.ok) {
        if (shouldPauseAll(magazineResult)) {
          state.paused = true;
          state.pauseReason = String(magazineResult && (magazineResult.code || magazineResult.message) || 'magazine_failed');
          summary.status = 'paused_on_magazine_error';
        } else {
          summary.status = 'magazine_failed';
        }
        state.lastRun = summary;
        await saveState(state);
        return summary;
      }

      state.processedNotes[candidate.key] = now;
      state.processedCreators[candidate.urlname] = now;
      state.events.push({ at: now, kind: 'magazine', key: candidate.key, creator: candidate.urlname, like: summary.like && (summary.like.ok ? 'ok' : summary.like.code) });
      summary.hourlyMagazineCount = hourlyMagazineCount(state, now);
      summary.status = summary.like && summary.like.rateLimited ? 'magazine_added_like_rate_limited' : (summary.like && summary.like.skipped ? 'magazine_added_like_cooldown' : 'success');
      state.lastRun = summary;
      await saveState(state);
      return summary;
    } catch (error) {
      const code = String(error && error.message || error || 'automation_failed');
      if (code === 'account_mismatch' || code === 'login_required' || code === 'account_unavailable') {
        state.paused = true;
        state.pauseReason = code;
      }
      summary.status = state.paused ? 'paused_on_auth_error' : 'failed';
      summary.error = code;
      state.lastRun = summary;
      await saveState(state);
      return summary;
    }
  }

  async function ensureAlarm() {
    const existing = await browser.alarms.get(ALARM_NAME);
    if (!existing) browser.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: INTERVAL_MINUTES });
  }

  async function enableAutomation() {
    const state = await loadState();
    try {
      await getBoundAccount(state);
    } catch (error) {
      return { ok: false, code: String(error && error.message || 'account_unavailable') };
    }
    state.enabled = true;
    state.paused = false;
    state.pauseReason = '';
    await saveState(state);
    await ensureAlarm();
    return { ok: true, state: publicState(state) };
  }

  async function disableAutomation() {
    const state = await loadState();
    state.enabled = false;
    await saveState(state);
    return { ok: true, state: publicState(state) };
  }

  async function resumeAutomation() {
    const state = await loadState();
    state.paused = false;
    state.pauseReason = '';
    await saveState(state);
    await ensureAlarm();
    return { ok: true, state: publicState(state) };
  }

  function publicState(state) {
    return {
      enabled: Boolean(state.enabled),
      paused: Boolean(state.paused),
      pauseReason: String(state.pauseReason || ''),
      boundAccount: String(state.boundAccount || ''),
      likeBlockedUntil: Number(state.likeBlockedUntil || 0),
      hourlyMagazineCount: hourlyMagazineCount(state),
      maxMagazinePerHour: MAX_MAGAZINE_PER_HOUR,
      intervalMinutes: INTERVAL_MINUTES,
      targetMagazine: TARGET_MAGAZINE,
      lastRun: state.lastRun || null
    };
  }

  async function status() {
    return { ok: true, state: publicState(await loadState()) };
  }

  if (browser.alarms && browser.alarms.onAlarm) {
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === ALARM_NAME) runOnce('alarm').catch(() => {});
    });
  }
  if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(() => { loadState().then((state) => state.enabled ? ensureAlarm() : null).catch(() => {}); });
  if (browser.runtime.onInstalled) browser.runtime.onInstalled.addListener(() => { loadState().then((state) => state.enabled ? ensureAlarm() : null).catch(() => {}); });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    if (message.type === 'NERO_AUTO_STATUS') return status();
    if (message.type === 'NERO_AUTO_ENABLE') return enableAutomation();
    if (message.type === 'NERO_AUTO_DISABLE') return disableAutomation();
    if (message.type === 'NERO_AUTO_RESUME') return resumeAutomation();
    if (message.type === 'NERO_AUTO_RUN_NOW') return runOnce('manual').then(async (summary) => ({ ok: true, summary, state: publicState(await loadState()) })).catch((error) => ({ ok: false, code: String(error && error.message || error) }));
    return undefined;
  });

  loadState().then((state) => state.enabled ? ensureAlarm() : null).catch(() => {});

  globalThis.NeroLocalAutoTest = {
    runOnce,
    hourlyMagazineCount,
    editorialScore,
    normalizeCandidate,
    isLikeRateLimited,
    shouldPauseAll,
    extractItems,
    publicState,
    constants: { INTERVAL_MINUTES, MAX_MAGAZINE_PER_HOUR, LIKE_RETRY_MS, TARGET_MAGAZINE }
  };
})();
