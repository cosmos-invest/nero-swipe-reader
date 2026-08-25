'use strict';

(function initializeNeroLocalAutomation() {
  const ALARM_NAME = 'nero-local-auto-v1';
  const BACKFILL_ALARM_NAME = 'nero-backfill-v1';
  const STATE_KEY = 'nero.localAuto.state.v1';
  const INTERVAL_MINUTES = 5;
  const MAX_MAGAZINE_PER_HOUR = 10;
  const LIKE_RETRY_MS = 60 * 60 * 1000;
  const BACKFILL_RETRY_MS = 60 * 60 * 1000;
  const BACKFILL_INTERVAL_MS = 12000;
  const BACKFILL_BATCH_SIZE = 5;
  const CREATOR_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
  const NOTE_DEDUPE_MS = 30 * 24 * 60 * 60 * 1000;
  const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
  const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
  const TARGET_MAGAZINE = 'ネロのお気に入り🌙';
  const TAGS = ['はじめてのnote', 'note初心者', '初投稿', '自己紹介', '挑戦', '日常', 'noteを楽しむ', '創作'];
  const BLOCKED = ['必ず稼げる', '爆益', '最短で稼', 'コピペだけ', 'フォロバ100', 'スキ返し100', '相互フォロー100', '競艇', '競馬', '競輪', 'パチンコ', 'スロット', 'カジノ'];

  function freshBackfill() {
    return {
      status: 'idle',
      queue: [],
      cursor: 0,
      total: 0,
      scannedPages: 0,
      added: 0,
      already: 0,
      failed: 0,
      startedAt: 0,
      updatedAt: 0,
      completedAt: 0,
      pauseReason: '',
      nextRetryAt: 0,
      resumeAutoAfterBackfill: false,
      lastItem: null
    };
  }

  function freshState() {
    return {
      version: 2,
      enabled: false,
      boundAccount: '',
      paused: false,
      pauseReason: '',
      likeBlockedUntil: 0,
      events: [],
      processedNotes: {},
      processedCreators: {},
      lastRun: null,
      backfill: freshBackfill()
    };
  }

  function normalizeBackfill(value) {
    const row = value && typeof value === 'object' ? value : {};
    const fresh = freshBackfill();
    const merged = { ...fresh, ...row };
    merged.queue = Array.isArray(row.queue) ? row.queue : [];
    merged.cursor = Math.max(0, Number(merged.cursor || 0));
    merged.total = Math.max(Number(merged.total || 0), merged.queue.length, merged.cursor);
    return merged;
  }

  async function loadState() {
    const row = await browser.storage.local.get(STATE_KEY);
    const value = row && row[STATE_KEY];
    if (!value || typeof value !== 'object') return freshState();
    return { ...freshState(), ...value, version: 2, backfill: normalizeBackfill(value.backfill) };
  }

  async function saveState(state) {
    state.version = 2;
    state.backfill = normalizeBackfill(state.backfill);
    pruneState(state);
    await browser.storage.local.set({ [STATE_KEY]: state });
  }

  function pruneState(state, now = Date.now()) {
    state.events = (Array.isArray(state.events) ? state.events : [])
      .filter((row) => now - Number(row.at || 0) < HISTORY_RETENTION_MS)
      .slice(-2000);
    for (const [key, at] of Object.entries(state.processedNotes || {})) if (now - Number(at || 0) >= NOTE_DEDUPE_MS) delete state.processedNotes[key];
    for (const [key, at] of Object.entries(state.processedCreators || {})) if (now - Number(at || 0) >= CREATOR_DEDUPE_MS) delete state.processedCreators[key];
  }

  function recordEvent(state, row) {
    state.events.push({ at: Date.now(), kind: 'magazine', mode: 'auto', result: 'added', ...row });
    pruneState(state);
  }

  function hourlyMagazineCount(state, now = Date.now()) {
    const cutoff = now - 60 * 60 * 1000;
    return (state.events || []).filter((row) => row.kind === 'magazine' && row.mode !== 'backfill' && Number(row.at || 0) > cutoff).length;
  }

  function extractItems(payload) {
    const data = payload && payload.data !== undefined ? payload.data : payload;
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['notes', 'contents', 'items', 'likes']) {
      if (Array.isArray(data[key])) return data[key];
      if (data[key] && typeof data[key] === 'object') {
        for (const nested of ['notes', 'contents', 'items', 'likes']) if (Array.isArray(data[key][nested])) return data[key][nested];
      }
    }
    return [];
  }

  function pageIsLast(payload) {
    const data = payload && payload.data !== undefined ? payload.data : payload;
    const candidates = [payload, data, data && data.meta, data && data.pagination].filter(Boolean);
    for (const row of candidates) {
      if (row.isLastPage === true || row.is_last_page === true) return true;
      if (row.nextPage === null || row.next_page === null) {
        if ('nextPage' in row || 'next_page' in row) return true;
      }
    }
    return false;
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

  function normalizeLikedEntry(entry) {
    const wrapper = entry && typeof entry === 'object' ? entry : {};
    const note = wrapper.note && typeof wrapper.note === 'object' ? wrapper.note : (wrapper.content && typeof wrapper.content === 'object' ? wrapper.content : wrapper);
    const urlname = candidateAuthor(note);
    const key = candidateKey(note);
    if (!/^[a-zA-Z0-9_-]+$/.test(urlname) || !/^n[a-zA-Z0-9_-]+$/.test(key)) return null;
    const rawLikedAt = wrapper.liked_at || wrapper.likedAt || wrapper.created_at || wrapper.createdAt || note.liked_at || note.likedAt || '';
    const likedAt = Date.parse(String(rawLikedAt || ''));
    return {
      key,
      urlname,
      title: String(note.name || note.title || ''),
      likedAt: Number.isFinite(likedAt) ? likedAt : 0,
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
    if (state.backfill && ['running', 'scanning'].includes(state.backfill.status)) return { ...summary, status: 'backfill_running' };
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
      recordEvent(state, {
        at: now,
        mode: 'auto',
        key: candidate.key,
        creator: candidate.urlname,
        title: candidate.title,
        result: magazineResult.already ? 'already' : 'added',
        like: summary.like && (summary.like.ok ? (summary.like.already ? 'already' : 'ok') : summary.like.code),
        sourceTag: candidate.sourceTag
      });
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

  async function fetchLikedPage(account, page) {
    const paths = [
      '/v2/creators/' + encodeURIComponent(account) + '/likes?page=' + page,
      '/v2/creators/info/likes?page=' + page
    ];
    let lastError = null;
    for (const path of paths) {
      try { return await noteGet(path, 10000); } catch (error) { lastError = error; }
    }
    throw lastError || new Error('liked_history_unavailable');
  }

  async function scanBackfill() {
    const state = await loadState();
    if (state.backfill.status === 'running') return { ok: false, code: 'backfill_running' };
    try {
      const account = await getBoundAccount(state);
      state.backfill = { ...freshBackfill(), status: 'scanning', updatedAt: Date.now() };
      await saveState(state);
      const seen = new Set();
      const queue = [];
      let page = 1;
      while (page <= 1000) {
        const payload = await fetchLikedPage(account, page);
        const rows = extractItems(payload);
        if (!rows.length) break;
        const beforeCount = seen.size;
        for (const row of rows) {
          const item = normalizeLikedEntry(row);
          if (!item || seen.has(item.key)) continue;
          seen.add(item.key);
          queue.push(item);
        }
        if (seen.size === beforeCount && page > 1) break;
        state.backfill.scannedPages = page;
        state.backfill.total = queue.length;
        state.backfill.updatedAt = Date.now();
        if (page % 5 === 0) await saveState(state);
        if (pageIsLast(payload)) break;
        page += 1;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      queue.sort((a, b) => (a.likedAt || Number.MAX_SAFE_INTEGER) - (b.likedAt || Number.MAX_SAFE_INTEGER));
      state.backfill.queue = queue;
      state.backfill.cursor = 0;
      state.backfill.total = queue.length;
      state.backfill.status = 'ready';
      state.backfill.updatedAt = Date.now();
      state.backfill.pauseReason = '';
      await saveState(state);
      return { ok: true, backfill: publicBackfill(state.backfill) };
    } catch (error) {
      state.backfill.status = 'failed';
      state.backfill.pauseReason = String(error && error.message || error || 'liked_history_unavailable');
      state.backfill.updatedAt = Date.now();
      await saveState(state);
      return { ok: false, code: state.backfill.pauseReason, backfill: publicBackfill(state.backfill) };
    }
  }

  async function scheduleBackfill(delayMinutes = 1) {
    if (!browser.alarms) return;
    try { await browser.alarms.clear(BACKFILL_ALARM_NAME); } catch (_) {}
    browser.alarms.create(BACKFILL_ALARM_NAME, { delayInMinutes: Math.max(1, Number(delayMinutes || 1)) });
  }

  async function processBackfillBatch(source = 'alarm') {
    const state = await loadState();
    const backfill = state.backfill;
    if (backfill.status !== 'running') return { ok: true, backfill: publicBackfill(backfill), source };
    const now = Date.now();
    if (backfill.nextRetryAt && backfill.nextRetryAt > now) {
      await scheduleBackfill(Math.ceil((backfill.nextRetryAt - now) / 60000));
      return { ok: true, backfill: publicBackfill(backfill), source };
    }
    try {
      const account = await getBoundAccount(state);
      const api = globalThis.NeroBackgroundTest;
      if (!api || typeof api.runDirectMagazineAddMutation !== 'function') throw new Error('background_api_unavailable');
      let completedInBatch = 0;
      while (backfill.cursor < backfill.queue.length && completedInBatch < BACKFILL_BATCH_SIZE) {
        const item = backfill.queue[backfill.cursor];
        const result = await api.runDirectMagazineAddMutation(item.articleUrl, { name: TARGET_MAGAZINE }, account);
        backfill.lastItem = { key: item.key, creator: item.urlname, title: item.title, at: Date.now() };
        if (!result || !result.ok) {
          const code = String(result && (result.code || result.message) || 'magazine_failed');
          backfill.failed += 1;
          backfill.status = 'paused';
          backfill.pauseReason = code;
          backfill.updatedAt = Date.now();
          if (Number(result && result.status) === 429 || /rate|limit|制限|上限|しばらく|時間をおいて/i.test(code + ' ' + String(result && result.message || ''))) {
            backfill.nextRetryAt = Date.now() + BACKFILL_RETRY_MS;
            await scheduleBackfill(60);
          }
          if (shouldPauseAll(result)) {
            state.paused = true;
            state.pauseReason = code;
          }
          recordEvent(state, { mode: 'backfill', key: item.key, creator: item.urlname, title: item.title, result: 'failed', code });
          await saveState(state);
          return { ok: false, code, backfill: publicBackfill(backfill), source };
        }
        backfill.cursor += 1;
        if (result.already) backfill.already += 1; else backfill.added += 1;
        backfill.updatedAt = Date.now();
        backfill.pauseReason = '';
        backfill.nextRetryAt = 0;
        recordEvent(state, {
          mode: 'backfill',
          key: item.key,
          creator: item.urlname,
          title: item.title,
          result: result.already ? 'already' : 'added',
          likedAt: item.likedAt || 0
        });
        await saveState(state);
        completedInBatch += 1;
        if (backfill.cursor < backfill.queue.length && completedInBatch < BACKFILL_BATCH_SIZE) {
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_INTERVAL_MS));
        }
      }

      if (backfill.cursor >= backfill.queue.length) {
        backfill.status = 'completed';
        backfill.completedAt = Date.now();
        backfill.updatedAt = backfill.completedAt;
        backfill.queue = [];
        state.enabled = Boolean(backfill.resumeAutoAfterBackfill);
        backfill.resumeAutoAfterBackfill = false;
        await saveState(state);
        if (state.enabled) await ensureAlarm();
        return { ok: true, completed: true, backfill: publicBackfill(backfill), source };
      }

      await saveState(state);
      await scheduleBackfill(1);
      return { ok: true, completed: false, backfill: publicBackfill(backfill), source };
    } catch (error) {
      const code = String(error && error.message || error || 'backfill_failed');
      backfill.status = 'paused';
      backfill.pauseReason = code;
      backfill.updatedAt = Date.now();
      await saveState(state);
      return { ok: false, code, backfill: publicBackfill(backfill), source };
    }
  }

  async function startBackfill() {
    const state = await loadState();
    if (!['ready', 'paused'].includes(state.backfill.status)) return { ok: false, code: 'backfill_not_ready', backfill: publicBackfill(state.backfill) };
    if (!state.backfill.total) return { ok: false, code: 'backfill_empty', backfill: publicBackfill(state.backfill) };
    try { await getBoundAccount(state); } catch (error) { return { ok: false, code: String(error && error.message || error) }; }
    if (state.backfill.status === 'ready') {
      state.backfill.resumeAutoAfterBackfill = Boolean(state.enabled);
      state.backfill.startedAt = Date.now();
    }
    state.enabled = false;
    state.backfill.status = 'running';
    state.backfill.pauseReason = '';
    state.backfill.nextRetryAt = 0;
    state.backfill.updatedAt = Date.now();
    await saveState(state);
    return processBackfillBatch('manual');
  }

  async function pauseBackfill() {
    const state = await loadState();
    if (state.backfill.status === 'running') {
      state.backfill.status = 'paused';
      state.backfill.pauseReason = 'user_paused';
      state.backfill.updatedAt = Date.now();
      await saveState(state);
    }
    try { await browser.alarms.clear(BACKFILL_ALARM_NAME); } catch (_) {}
    return { ok: true, backfill: publicBackfill(state.backfill) };
  }

  async function cancelBackfill() {
    const state = await loadState();
    const resume = Boolean(state.backfill.resumeAutoAfterBackfill);
    state.backfill = { ...freshBackfill(), status: 'cancelled', completedAt: Date.now(), updatedAt: Date.now() };
    state.enabled = resume;
    await saveState(state);
    try { await browser.alarms.clear(BACKFILL_ALARM_NAME); } catch (_) {}
    if (state.enabled) await ensureAlarm();
    return { ok: true, backfill: publicBackfill(state.backfill), state: publicState(state) };
  }

  function publicBackfill(backfill) {
    const row = normalizeBackfill(backfill);
    const processed = Math.min(row.total, row.cursor);
    return {
      status: row.status,
      total: row.total,
      processed,
      remaining: Math.max(0, row.total - processed),
      scannedPages: row.scannedPages,
      added: row.added,
      already: row.already,
      failed: row.failed,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      pauseReason: row.pauseReason,
      nextRetryAt: row.nextRetryAt,
      lastItem: row.lastItem || null
    };
  }

  function publicHistory(state) {
    return (Array.isArray(state.events) ? state.events : []).slice(-100).reverse().map((row) => ({
      at: Number(row.at || 0),
      kind: String(row.kind || 'magazine'),
      mode: String(row.mode || 'auto'),
      result: String(row.result || 'added'),
      key: String(row.key || ''),
      creator: String(row.creator || ''),
      title: String(row.title || ''),
      like: String(row.like || ''),
      code: String(row.code || ''),
      sourceTag: String(row.sourceTag || '')
    }));
  }

  async function ensureAlarm() {
    const existing = await browser.alarms.get(ALARM_NAME);
    if (!existing) browser.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: INTERVAL_MINUTES });
  }

  async function enableAutomation() {
    const state = await loadState();
    if (state.backfill && ['running', 'scanning'].includes(state.backfill.status)) return { ok: false, code: 'backfill_running' };
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
      lastRun: state.lastRun || null,
      backfill: publicBackfill(state.backfill),
      history: publicHistory(state)
    };
  }

  async function status() {
    return { ok: true, state: publicState(await loadState()) };
  }

  if (browser.alarms && browser.alarms.onAlarm) {
    browser.alarms.onAlarm.addListener((alarm) => {
      if (!alarm) return;
      if (alarm.name === ALARM_NAME) runOnce('alarm').catch(() => {});
      if (alarm.name === BACKFILL_ALARM_NAME) processBackfillBatch('alarm').catch(() => {});
    });
  }
  if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(() => {
    loadState().then(async (state) => {
      if (state.enabled) await ensureAlarm();
      if (state.backfill.status === 'running') await scheduleBackfill(1);
    }).catch(() => {});
  });
  if (browser.runtime.onInstalled) browser.runtime.onInstalled.addListener(() => {
    loadState().then(async (state) => {
      if (state.enabled) await ensureAlarm();
      if (state.backfill.status === 'running') await scheduleBackfill(1);
    }).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;
    if (message.type === 'NERO_AUTO_STATUS') return status();
    if (message.type === 'NERO_AUTO_ENABLE') return enableAutomation();
    if (message.type === 'NERO_AUTO_DISABLE') return disableAutomation();
    if (message.type === 'NERO_AUTO_RESUME') return resumeAutomation();
    if (message.type === 'NERO_AUTO_RUN_NOW') return runOnce('manual').then(async (summary) => ({ ok: true, summary, state: publicState(await loadState()) })).catch((error) => ({ ok: false, code: String(error && error.message || error) }));
    if (message.type === 'NERO_BACKFILL_STATUS') return loadState().then((state) => ({ ok: true, backfill: publicBackfill(state.backfill), state: publicState(state) }));
    if (message.type === 'NERO_BACKFILL_SCAN') return scanBackfill().then(async (result) => ({ ...result, state: publicState(await loadState()) }));
    if (message.type === 'NERO_BACKFILL_START' || message.type === 'NERO_BACKFILL_RESUME') return startBackfill().then(async (result) => ({ ...result, state: publicState(await loadState()) }));
    if (message.type === 'NERO_BACKFILL_PAUSE') return pauseBackfill().then(async (result) => ({ ...result, state: publicState(await loadState()) }));
    if (message.type === 'NERO_BACKFILL_CANCEL') return cancelBackfill();
    return undefined;
  });

  loadState().then(async (state) => {
    if (state.enabled) await ensureAlarm();
    if (state.backfill.status === 'running') await scheduleBackfill(1);
  }).catch(() => {});

  globalThis.NeroLocalAutoTest = {
    runOnce,
    scanBackfill,
    processBackfillBatch,
    startBackfill,
    pauseBackfill,
    hourlyMagazineCount,
    editorialScore,
    normalizeCandidate,
    normalizeLikedEntry,
    extractItems,
    pageIsLast,
    isLikeRateLimited,
    shouldPauseAll,
    publicState,
    publicBackfill,
    constants: { INTERVAL_MINUTES, MAX_MAGAZINE_PER_HOUR, LIKE_RETRY_MS, BACKFILL_INTERVAL_MS, BACKFILL_BATCH_SIZE, TARGET_MAGAZINE }
  };
})();
