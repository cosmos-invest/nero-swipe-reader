'use strict';

(function initializeNeroLocalAutomation() {
  const ALARM_NAME = 'nero-local-auto-v1';
  const BACKFILL_ALARM_NAME = 'nero-backfill-v1';
  const RETURN_LIKES_ALARM_NAME = 'nero-return-likes-v1';
  const STATE_KEY = 'nero.localAuto.state.v1';
  const INTERVAL_MINUTES = 5;
  const MAX_MAGAZINE_PER_HOUR = 10;
  const MAX_ALL_MAGAZINE_ADDS_PER_HOUR = 45;
  const MAGAZINE_ADD_WINDOW_MS = 60 * 60 * 1000;
  const MAGAZINE_COOLDOWN_BUFFER_MS = 60 * 1000;
  const LIKE_RETRY_MS = 60 * 60 * 1000;
  const BACKFILL_RETRY_MS = 60 * 60 * 1000;
  const BACKFILL_INTERVAL_MS = 12000;
  const BACKFILL_SKIP_INTERVAL_MS = 1000;
  const BACKFILL_BATCH_SIZE = 5;
  const BACKFILL_MAX_ATTEMPTS_PER_BATCH = 50;
  const CREATOR_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
  const NOTE_DEDUPE_MS = 30 * 24 * 60 * 60 * 1000;
  const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
  const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
  const LIKES_PAGE_SIZE = 50;
  const NOTE_GRAPHQL_URL = 'https://graphql.note.com/graphql';
  const TARGET_MAGAZINE = 'ネロのお気に入り🌙';
  const RETURN_TARGET_ARTICLE = 'https://note.com/nero_notelover/n/ne4843208abbe';
  const RETURN_INTERVAL_MINUTES = 5;
  const TAGS = ['はじめてのnote', 'note初心者', '初投稿', '自己紹介', '挑戦', '日常', 'noteを楽しむ', '創作'];
  const BLOCKED = ['必ず稼げる', '爆益', '最短で稼', 'コピペだけ', 'フォロバ100', 'スキ返し100', '相互フォロー100', '競艇', '競馬', '競輪', 'パチンコ', 'スロット', 'カジノ'];
  let activeBackfillTask = null;
  let activeReturnLikesTask = null;
  let backfillStopRequested = false;

  function freshReturnLikes() {
    return {
      status: 'idle',
      targetArticle: RETURN_TARGET_ARTICLE,
      queue: [],
      cursor: 0,
      total: 0,
      liked: 0,
      already: 0,
      skipped: 0,
      failed: 0,
      discovered: 0,
      commenterCount: 0,
      previouslyReturned: 0,
      unavailable: 0,
      startedAt: 0,
      updatedAt: 0,
      completedAt: 0,
      pauseReason: '',
      pauseMessage: '',
      nextRetryAt: 0,
      lastItem: null,
      completedCreators: {}
    };
  }

  function creatorKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeCreatorMap(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;
    for (const [urlname, completion] of Object.entries(value)) {
      const key = creatorKey(urlname);
      if (key) normalized[key] = completion;
    }
    return normalized;
  }

  function freshBackfill() {
    return {
      status: 'idle',
      queue: [],
      cursor: 0,
      total: 0,
      scannedPages: 0,
      added: 0,
      already: 0,
      skipped: 0,
      failed: 0,
      startedAt: 0,
      updatedAt: 0,
      completedAt: 0,
      scanStartedAt: 0,
      pauseReason: '',
      pauseMessage: '',
      nextRetryAt: 0,
      rateLimitStrikes: 0,
      resumeAutoAfterBackfill: false,
      lastItem: null,
      completedKeys: {}
    };
  }

  function freshState() {
    return {
      version: 3,
      enabled: false,
      boundAccount: '',
      paused: false,
      pauseReason: '',
      likeBlockedUntil: 0,
      events: [],
      processedNotes: {},
      processedCreators: {},
      returnedCreators: {},
      lastRun: null,
      backfill: freshBackfill(),
      returnLikes: freshReturnLikes()
    };
  }

  function normalizeReturnLikes(value) {
    const row = value && typeof value === 'object' ? value : {};
    const merged = { ...freshReturnLikes(), ...row, targetArticle: RETURN_TARGET_ARTICLE };
    merged.queue = Array.isArray(row.queue) ? row.queue.map((item) => ({ ...item, urlname: creatorKey(item && item.urlname) })).filter((item) => item.urlname) : [];
    merged.completedCreators = normalizeCreatorMap(row.completedCreators);
    merged.cursor = Math.max(0, Number(merged.cursor || 0));
    merged.total = Math.max(Number(merged.total || 0), merged.queue.length, merged.cursor);
    return merged;
  }

  function returnCompletionResult(value) {
    const result = String(value && typeof value === 'object' ? value.result : value || '');
    return ['liked', 'already', 'skipped'].includes(result) ? result : '';
  }

  function reconcileReturnLikeCompletions(state) {
    const task = state.returnLikes;
    for (const item of task.queue) {
      const key = creatorKey(item.urlname);
      const persistent = state.returnedCreators[key];
      if (!returnCompletionResult(task.completedCreators[key]) && persistent) {
        task.completedCreators[key] = {
          result: String(persistent.result || 'liked'),
          at: Number(persistent.at || 0),
          key: String(persistent.key || item.key || '')
        };
      }
    }
    let liked = 0;
    let already = 0;
    let skipped = 0;
    for (const item of task.queue) {
      const result = returnCompletionResult(task.completedCreators[creatorKey(item.urlname)]);
      if (result === 'liked') liked += 1;
      if (result === 'already') already += 1;
      if (result === 'skipped') skipped += 1;
    }
    task.liked = liked;
    task.already = already;
    task.skipped = skipped;
    while (task.cursor < task.queue.length && returnCompletionResult(task.completedCreators[creatorKey(task.queue[task.cursor].urlname)])) task.cursor += 1;
    return task;
  }

  function normalizeBackfill(value) {
    const row = value && typeof value === 'object' ? value : {};
    const fresh = freshBackfill();
    const merged = { ...fresh, ...row };
    merged.queue = Array.isArray(row.queue) ? row.queue : [];
    merged.completedKeys = row.completedKeys && typeof row.completedKeys === 'object' && !Array.isArray(row.completedKeys) ? { ...row.completedKeys } : {};
    merged.cursor = Math.max(0, Number(merged.cursor || 0));
    merged.total = Math.max(Number(merged.total || 0), merged.queue.length, merged.cursor);
    return merged;
  }

  function completionResult(value) {
    const result = String(value && typeof value === 'object' ? value.result : value || '');
    return ['added', 'already', 'skipped'].includes(result) ? result : '';
  }

  function reconcileBackfillCompletions(state) {
    const backfill = state.backfill;
    const cutoff = Number(backfill.startedAt || backfill.scanStartedAt || 0);
    for (const event of Array.isArray(state.events) ? state.events : []) {
      if (event.mode !== 'backfill' || !event.key || Number(event.at || 0) < cutoff) continue;
      const result = completionResult(event.result);
      if (!result) continue;
      const previous = completionResult(backfill.completedKeys[event.key]);
      if (!previous || result === 'added' || (result === 'already' && previous === 'skipped')) {
        backfill.completedKeys[event.key] = { result, at: Number(event.at || 0) };
      }
    }
    let added = 0;
    let already = 0;
    let skipped = 0;
    for (const item of backfill.queue) {
      const result = completionResult(backfill.completedKeys[item.key]);
      if (result === 'added') added += 1;
      if (result === 'already') already += 1;
      if (result === 'skipped') skipped += 1;
    }
    backfill.added = added;
    backfill.already = already;
    backfill.skipped = skipped;
    while (backfill.cursor < backfill.queue.length && completionResult(backfill.completedKeys[backfill.queue[backfill.cursor].key])) {
      backfill.cursor += 1;
    }
    return backfill;
  }

  function completeBackfillItem(backfill, item, result, at = Date.now()) {
    const completedResult = result.skipped ? 'skipped' : (result.already ? 'already' : 'added');
    backfill.completedKeys[item.key] = { result: completedResult, at };
    return completedResult;
  }

  async function loadState() {
    const row = await browser.storage.local.get(STATE_KEY);
    const value = row && row[STATE_KEY];
    if (!value || typeof value !== 'object') return freshState();
    const state = {
      ...freshState(),
      ...value,
      version: 3,
      returnedCreators: normalizeCreatorMap(value.returnedCreators),
      backfill: normalizeBackfill(value.backfill),
      returnLikes: normalizeReturnLikes(value.returnLikes)
    };
    reconcileBackfillCompletions(state);
    reconcileReturnLikeCompletions(state);
    return state;
  }

  async function saveState(state) {
    state.version = 3;
    state.backfill = normalizeBackfill(state.backfill);
    state.returnLikes = normalizeReturnLikes(state.returnLikes);
    reconcileReturnLikeCompletions(state);
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
    return (state.events || []).filter((row) => row.kind === 'magazine' && row.mode !== 'backfill' && row.result !== 'skipped' && Number(row.at || 0) > cutoff).length;
  }

  function recentMagazineAdds(state, now = Date.now()) {
    const cutoff = now - MAGAZINE_ADD_WINDOW_MS;
    return (state.events || [])
      .filter((row) => row.kind === 'magazine' && row.result === 'added' && Number(row.at || 0) > cutoff)
      .map((row) => Number(row.at || 0))
      .sort((a, b) => a - b);
  }

  function magazineSafetyCooldownUntil(state, now = Date.now()) {
    const additions = recentMagazineAdds(state, now);
    if (additions.length < MAX_ALL_MAGAZINE_ADDS_PER_HOUR) return 0;
    return additions[additions.length - MAX_ALL_MAGAZINE_ADDS_PER_HOUR] + MAGAZINE_ADD_WINDOW_MS + MAGAZINE_COOLDOWN_BUFFER_MS;
  }

  function isMagazineRateLimited(result) {
    if (!result || result.ok) return false;
    if (Number(result.status) === 429 || String(result.code || '') === 'magazine_rate_limited') return true;
    const text = [result.code, result.message].map((value) => String(value || '')).join(' ');
    return /rate.?limit|too many|回数制限|操作制限|時間をおいて|しばらく/.test(text);
  }

  async function pauseBackfillForCooldown(state, code, message, nextRetryAt) {
    state.backfill.status = 'paused';
    state.backfill.pauseReason = code;
    state.backfill.pauseMessage = message;
    state.backfill.nextRetryAt = Math.max(Date.now() + 60000, Number(nextRetryAt || 0));
    state.backfill.updatedAt = Date.now();
    await saveState(state);
    await scheduleBackfill(Math.ceil((state.backfill.nextRetryAt - Date.now()) / 60000));
    return { ok: true, cooldown: true, code, backfill: publicBackfill(state.backfill) };
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
    const commonCreator = row && row.common && row.common.creator && typeof row.common.creator === 'object' ? row.common.creator : null;
    const user = row && row.user && typeof row.user === 'object' ? row.user : (row && row.creator && typeof row.creator === 'object' ? row.creator : (commonCreator || {}));
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
    const node = wrapper.node && typeof wrapper.node === 'object' ? wrapper.node : wrapper;
    const note = node.note && typeof node.note === 'object' ? node.note : (wrapper.note && typeof wrapper.note === 'object' ? wrapper.note : (wrapper.content && typeof wrapper.content === 'object' ? wrapper.content : wrapper));
    const urlname = candidateAuthor(note);
    const key = candidateKey(note);
    if (!/^[a-zA-Z0-9_-]+$/.test(urlname) || !/^n[a-zA-Z0-9_-]+$/.test(key)) return null;
    const rawLikedAt = wrapper.liked_at || wrapper.likedAt || wrapper.created_at || wrapper.createdAt || node.liked_at || node.likedAt || note.liked_at || note.likedAt || '';
    const likedAt = Date.parse(String(rawLikedAt || ''));
    const openContents = note.openContents && typeof note.openContents === 'object' ? note.openContents : {};
    return {
      key,
      urlname,
      title: String(note.name || note.title || openContents.title || ''),
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
    if (state.returnLikes && (['running', 'scanning'].includes(state.returnLikes.status) || (state.returnLikes.status === 'paused' && Number(state.returnLikes.nextRetryAt || 0) > now))) {
      return { ...summary, status: 'return_likes_priority' };
    }
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
        result: magazineResult.skipped ? 'skipped' : (magazineResult.already ? 'already' : 'added'),
        code: String(magazineResult.code || ''),
        message: String(magazineResult.message || ''),
        like: summary.like && (summary.like.ok ? (summary.like.already ? 'already' : 'ok') : summary.like.code),
        sourceTag: candidate.sourceTag
      });
      summary.hourlyMagazineCount = hourlyMagazineCount(state, now);
      summary.status = magazineResult.skipped ? 'magazine_skipped' : (summary.like && summary.like.rateLimited ? 'magazine_added_like_rate_limited' : (summary.like && summary.like.skipped ? 'magazine_added_like_cooldown' : 'success'));
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

  async function fetchLikedPage(account, after = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(NOTE_GRAPHQL_URL, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/graphql-response+json, application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operationName: 'CreatorLikesBackfillQuery',
          variables: { urlname: account, first: LIKES_PAGE_SIZE, after: after || null },
          query: 'query CreatorLikesBackfillQuery($urlname: Urlname!, $first: Int!, $after: String) { noteLikesConnectionByUrlname(urlname: $urlname, first: $first, after: $after) { edges { cursor node { id note { id key creator { __typename ... on Creator { urlname displayName } } openContents { __typename ... on NoteTextOpenContents { title } } } } } pageInfo { hasNextPage endCursor } } }'
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error('note likes API returned ' + response.status);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (Array.isArray(payload && payload.errors) && payload.errors.length) {
        throw new Error(String(payload.errors[0] && payload.errors[0].message || 'liked_history_unavailable'));
      }
      const connection = payload && payload.data && payload.data.noteLikesConnectionByUrlname;
      if (!connection || !Array.isArray(connection.edges) || !connection.pageInfo) throw new Error('liked_history_unavailable');
      return {
        data: {
          contents: connection.edges,
          isLastPage: !connection.pageInfo.hasNextPage,
          nextCursor: String(connection.pageInfo.endCursor || '')
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function scanBackfill() {
    const state = await loadState();
    if (state.backfill.status === 'running') return { ok: false, code: 'backfill_running' };
    try {
      const account = await getBoundAccount(state);
      state.backfill = { ...freshBackfill(), status: 'scanning', scanStartedAt: Date.now(), updatedAt: Date.now() };
      await saveState(state);
      const seen = new Set();
      const queue = [];
      let page = 1;
      let cursor = null;
      while (page <= 1000) {
        const payload = await fetchLikedPage(account, cursor);
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
        const nextCursor = String(payload && payload.data && payload.data.nextCursor || '');
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
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
      state.backfill.pauseMessage = '';
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

  async function runBackfillBatch(source = 'alarm') {
    let state = await loadState();
    let backfill = state.backfill;
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
      let additionsInBatch = 0;
      let attemptsInBatch = 0;
      while (backfill.cursor < backfill.queue.length && additionsInBatch < BACKFILL_BATCH_SIZE && attemptsInBatch < BACKFILL_MAX_ATTEMPTS_PER_BATCH) {
        if (backfillStopRequested) return { ok: true, backfill: publicBackfill((await loadState()).backfill), source };
        if (attemptsInBatch) {
          state = await loadState();
          backfill = state.backfill;
          if (backfill.status !== 'running') return { ok: true, backfill: publicBackfill(backfill), source };
          if (backfill.cursor >= backfill.queue.length) break;
        }
        const safetyCooldownUntil = magazineSafetyCooldownUntil(state);
        if (safetyCooldownUntil > Date.now()) {
          const cooldown = await pauseBackfillForCooldown(
            state,
            'magazine_safety_cooldown',
            'noteのマガジン追加制限を避けるため、安全枠が空くまで自動待機しています。',
            safetyCooldownUntil
          );
          return { ...cooldown, source };
        }
        const item = backfill.queue[backfill.cursor];
        attemptsInBatch += 1;
        const result = await api.runDirectMagazineAddMutation(item.articleUrl, { name: TARGET_MAGAZINE }, account);
        state = await loadState();
        backfill = state.backfill;
        const existingResult = completionResult(backfill.completedKeys[item.key]);
        if (existingResult) continue;
        if (backfill.status === 'cancelled') return { ok: true, backfill: publicBackfill(backfill), source };
        backfill.lastItem = { key: item.key, creator: item.urlname, title: item.title, at: Date.now() };
        if (!result || !result.ok) {
          if (backfill.status !== 'running' || backfillStopRequested) return { ok: true, backfill: publicBackfill(backfill), source };
          const rateLimited = isMagazineRateLimited(result);
          const code = rateLimited ? 'magazine_rate_limited' : String(result && (result.code || result.message) || 'magazine_failed');
          if (rateLimited) {
            const strikes = Math.max(1, Number(backfill.rateLimitStrikes || 0) + 1);
            backfill.rateLimitStrikes = strikes;
            const serverRetryMs = Math.max(0, Number(result && result.retryAfterMs || 0));
            const fallbackRetryMs = Math.min(24 * 60 * 60 * 1000, BACKFILL_RETRY_MS * (2 ** Math.min(4, strikes - 1)));
            const nextRetryAt = Date.now() + Math.max(serverRetryMs, fallbackRetryMs);
            recordEvent(state, {
              mode: 'backfill', key: item.key, creator: item.urlname, title: item.title,
              result: 'deferred', code, message: String(result && result.message || 'noteのマガジン追加制限を検知しました。')
            });
            const cooldown = await pauseBackfillForCooldown(
              state,
              code,
              'noteのマガジン追加制限を検知しました。待機時間後に自動で再開します。',
              nextRetryAt
            );
            return { ...cooldown, source };
          }
          backfill.failed += 1;
          backfill.status = 'paused';
          backfill.pauseReason = code;
          backfill.pauseMessage = String(result && result.message || '');
          backfill.updatedAt = Date.now();
          if (shouldPauseAll(result)) {
            state.paused = true;
            state.pauseReason = code;
          }
          recordEvent(state, { mode: 'backfill', key: item.key, creator: item.urlname, title: item.title, result: 'failed', code, message: backfill.pauseMessage });
          await saveState(state);
          return { ok: false, code, backfill: publicBackfill(backfill), source };
        }
        const completedResult = completeBackfillItem(backfill, item, result);
        if (completedResult === 'added') backfill.rateLimitStrikes = 0;
        reconcileBackfillCompletions(state);
        backfill.updatedAt = Date.now();
        backfill.pauseReason = '';
        backfill.pauseMessage = '';
        backfill.nextRetryAt = 0;
        recordEvent(state, {
          mode: 'backfill',
          key: item.key,
          creator: item.urlname,
          title: item.title,
          result: completedResult,
          code: String(result.code || ''),
          message: String(result.message || ''),
          likedAt: item.likedAt || 0
        });
        await saveState(state);
        if (completedResult === 'added') additionsInBatch += 1;
        if (backfillStopRequested || backfill.status !== 'running') return { ok: true, backfill: publicBackfill((await loadState()).backfill), source };
        if (completedResult === 'added' && backfill.cursor < backfill.queue.length && additionsInBatch < BACKFILL_BATCH_SIZE) {
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_INTERVAL_MS));
        } else if (backfill.cursor < backfill.queue.length && attemptsInBatch < BACKFILL_MAX_ATTEMPTS_PER_BATCH) {
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_SKIP_INTERVAL_MS));
        }
      }

      state = await loadState();
      backfill = state.backfill;
      reconcileBackfillCompletions(state);
      if (backfill.cursor >= backfill.queue.length) {
        backfill.status = 'completed';
        backfill.completedAt = Date.now();
        backfill.updatedAt = backfill.completedAt;
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
      if (backfillStopRequested) return { ok: true, backfill: publicBackfill((await loadState()).backfill), source };
      const code = String(error && error.message || error || 'backfill_failed');
      backfill.status = 'paused';
      backfill.pauseReason = code;
      backfill.pauseMessage = String(error && error.message || '');
      backfill.updatedAt = Date.now();
      await saveState(state);
      return { ok: false, code, backfill: publicBackfill(backfill), source };
    }
  }

  function processBackfillBatch(source = 'alarm') {
    if (activeBackfillTask) return activeBackfillTask;
    activeBackfillTask = runBackfillBatch(source).finally(() => {
      activeBackfillTask = null;
    });
    return activeBackfillTask;
  }

  async function scheduleReturnLikes(delayMinutes = RETURN_INTERVAL_MINUTES) {
    const delay = Math.max(1, Number(delayMinutes) || 1);
    await browser.alarms.create(RETURN_LIKES_ALARM_NAME, { delayInMinutes: delay });
  }

  async function scanReturnLikes() {
    const state = await loadState();
    if (state.returnLikes.status === 'running') return { ok: false, code: 'return_likes_running', returnLikes: publicReturnLikes(state.returnLikes) };
    if (state.backfill && ['running', 'scanning'].includes(state.backfill.status)) {
      return { ok: false, code: 'backfill_running', message: '過去スキ整理が終わってから確認してください。', returnLikes: publicReturnLikes(state.returnLikes) };
    }
    let account;
    try { account = await getBoundAccount(state); } catch (error) {
      return { ok: false, code: String(error && error.message || error || 'account_unavailable') };
    }
    const api = globalThis.NeroBackgroundTest;
    if (!api || typeof api.runArticleReactorsApi !== 'function' || typeof api.runCreatorLatestBatchApi !== 'function') {
      return { ok: false, code: 'background_api_unavailable' };
    }
    state.returnLikes = { ...freshReturnLikes(), status: 'scanning', updatedAt: Date.now() };
    await saveState(state);
    const reactors = await api.runArticleReactorsApi(RETURN_TARGET_ARTICLE);
    if (!reactors || !reactors.ok) {
      state.returnLikes.status = 'failed';
      state.returnLikes.pauseReason = String(reactors && (reactors.code || reactors.message) || 'article_reactors_failed');
      state.returnLikes.pauseMessage = String(reactors && reactors.message || '反応者を取得できませんでした。');
      state.returnLikes.updatedAt = Date.now();
      await saveState(state);
      return { ok: false, code: state.returnLikes.pauseReason, message: state.returnLikes.pauseMessage, returnLikes: publicReturnLikes(state.returnLikes) };
    }
    if (reactors.owner && reactors.owner !== account) {
      state.returnLikes.status = 'failed';
      state.returnLikes.pauseReason = 'account_mismatch';
      state.returnLikes.pauseMessage = '現在のnoteログインは @' + reactors.owner + ' です。';
      await saveState(state);
      return { ok: false, code: 'account_mismatch', message: state.returnLikes.pauseMessage, returnLikes: publicReturnLikes(state.returnLikes) };
    }
    const allCreators = (Array.isArray(reactors.creators) ? reactors.creators : [])
      .filter((creator) => creatorKey(creator && creator.urlname));
    const previouslyReturned = allCreators.filter((creator) => state.returnedCreators[creatorKey(creator.urlname)]).length;
    const candidates = allCreators.filter((creator) => !state.returnedCreators[creatorKey(creator.urlname)]);
    const latestItems = [];
    for (let offset = 0; offset < candidates.length; offset += 200) {
      const latest = await api.runCreatorLatestBatchApi(candidates.slice(offset, offset + 200).map((creator) => creator.urlname));
      if (!latest || !latest.ok) {
        state.returnLikes.status = 'failed';
        state.returnLikes.pauseReason = 'creator_latest_failed';
        state.returnLikes.pauseMessage = '返礼先の最新記事を取得できませんでした。';
        await saveState(state);
        return { ok: false, code: state.returnLikes.pauseReason, message: state.returnLikes.pauseMessage, returnLikes: publicReturnLikes(state.returnLikes) };
      }
      latestItems.push(...(latest.items || []));
    }
    const byCreator = new Map(latestItems.map((item) => [String(item.urlname || '').toLowerCase(), item]));
    const queue = candidates.map((creator) => {
      const item = byCreator.get(String(creator.urlname).toLowerCase());
      if (!item) return null;
      return {
        urlname: creatorKey(creator.urlname),
        nickname: creator.nickname || creator.urlname,
        commented: Boolean(creator.commented),
        likedTarget: Boolean(creator.liked),
        reactionAt: creator.lastActionAt || '',
        key: item.key,
        title: item.name || item.title || '',
        publishAt: item.publishAt || '',
        articleUrl: item.url
      };
    }).filter(Boolean);
    state.returnLikes = {
      ...freshReturnLikes(),
      status: queue.length ? 'ready' : 'completed',
      queue,
      total: queue.length,
      discovered: Number(reactors.stats && reactors.stats.creatorCount || allCreators.length),
      commenterCount: Number(reactors.stats && reactors.stats.commenterCount || 0),
      previouslyReturned,
      unavailable: Math.max(0, candidates.length - queue.length),
      completedAt: queue.length ? 0 : Date.now(),
      updatedAt: Date.now()
    };
    await saveState(state);
    return { ok: true, returnLikes: publicReturnLikes(state.returnLikes), state: publicState(state) };
  }

  async function runReturnLikesBatch(source = 'alarm') {
    let state = await loadState();
    let task = state.returnLikes;
    if (!['running', 'paused'].includes(task.status)) return { ok: true, returnLikes: publicReturnLikes(task), source };
    if (task.status === 'paused' && Number(task.nextRetryAt || 0) > Date.now()) {
      await scheduleReturnLikes(Math.ceil((task.nextRetryAt - Date.now()) / 60000));
      return { ok: true, cooldown: true, returnLikes: publicReturnLikes(task), source };
    }
    if (state.backfill && ['running', 'scanning'].includes(state.backfill.status)) {
      task.status = 'paused';
      task.pauseReason = 'backfill_running';
      task.pauseMessage = '過去スキ整理の完了後に自動で続けます。';
      task.nextRetryAt = Date.now() + 5 * 60 * 1000;
      await saveState(state);
      await scheduleReturnLikes(5);
      return { ok: true, cooldown: true, returnLikes: publicReturnLikes(task), source };
    }
    task.status = 'running';
    task.pauseReason = '';
    task.pauseMessage = '';
    task.nextRetryAt = 0;
    const api = globalThis.NeroBackgroundTest;
    let checks = 0;
    while (task.cursor < task.queue.length && checks < 20) {
      const item = task.queue[task.cursor];
      const key = creatorKey(item.urlname);
      checks += 1;
      if (state.returnedCreators[key]) {
        task.completedCreators[key] = state.returnedCreators[key];
        reconcileReturnLikeCompletions(state);
        continue;
      }
      if (Number(state.likeBlockedUntil || 0) > Date.now()) {
        task.status = 'paused';
        task.pauseReason = 'like_cooldown';
        task.pauseMessage = 'noteのスキ制限解除を待っています。';
        task.nextRetryAt = state.likeBlockedUntil;
        task.updatedAt = Date.now();
        await saveState(state);
        await scheduleReturnLikes(Math.ceil((task.nextRetryAt - Date.now()) / 60000));
        return { ok: true, cooldown: true, returnLikes: publicReturnLikes(task), source };
      }
      const result = await api.runDirectArticleLikeMutation(item.articleUrl);
      state = await loadState();
      task = state.returnLikes;
      if (!result || !result.ok) {
        if (isLikeRateLimited(result)) {
          state.likeBlockedUntil = Date.now() + LIKE_RETRY_MS;
          task.status = 'paused';
          task.pauseReason = 'like_rate_limited';
          task.pauseMessage = 'noteのスキ制限を検知しました。解除後に自動で再開します。';
          task.nextRetryAt = state.likeBlockedUntil;
          task.updatedAt = Date.now();
          await saveState(state);
          await scheduleReturnLikes(Math.ceil(LIKE_RETRY_MS / 60000));
          return { ok: true, cooldown: true, returnLikes: publicReturnLikes(task), source };
        }
        task.failed += 1;
        task.status = 'paused';
        task.pauseReason = String(result && (result.code || result.message) || 'like_failed');
        task.pauseMessage = String(result && result.message || 'スキの結果を確認できませんでした。');
        task.lastItem = { ...item, at: Date.now() };
        task.updatedAt = Date.now();
        recordEvent(state, { kind: 'like_return', mode: 'return', key: item.key, creator: item.urlname, title: item.title, result: 'failed', code: task.pauseReason, message: task.pauseMessage });
        await saveState(state);
        return { ok: false, code: task.pauseReason, returnLikes: publicReturnLikes(task), source };
      }
      const completedResult = result.already ? 'already' : 'liked';
      const completion = { result: completedResult, at: Date.now(), key: item.key };
      state.returnedCreators[key] = completion;
      task.completedCreators[key] = completion;
      task.lastItem = { ...item, result: completedResult, at: completion.at };
      task.updatedAt = completion.at;
      state.likeBlockedUntil = 0;
      reconcileReturnLikeCompletions(state);
      recordEvent(state, { kind: 'like_return', mode: 'return', key: item.key, creator: item.urlname, title: item.title, result: completedResult, like: completedResult });
      await saveState(state);
      if (completedResult === 'liked') break;
      state = await loadState();
      task = state.returnLikes;
    }
    state = await loadState();
    task = state.returnLikes;
    reconcileReturnLikeCompletions(state);
    if (task.cursor >= task.queue.length) {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.updatedAt = task.completedAt;
      task.nextRetryAt = 0;
      await saveState(state);
      try { await browser.alarms.clear(RETURN_LIKES_ALARM_NAME); } catch (_) {}
      return { ok: true, completed: true, returnLikes: publicReturnLikes(task), source };
    }
    task.status = 'running';
    task.updatedAt = Date.now();
    await saveState(state);
    await scheduleReturnLikes(RETURN_INTERVAL_MINUTES);
    return { ok: true, completed: false, returnLikes: publicReturnLikes(task), source };
  }

  function processReturnLikesBatch(source = 'alarm') {
    if (activeReturnLikesTask) return activeReturnLikesTask;
    activeReturnLikesTask = runReturnLikesBatch(source).finally(() => { activeReturnLikesTask = null; });
    return activeReturnLikesTask;
  }

  async function startReturnLikes() {
    const state = await loadState();
    if (!['ready', 'paused'].includes(state.returnLikes.status)) return { ok: false, code: 'return_likes_not_ready', returnLikes: publicReturnLikes(state.returnLikes) };
    if (!state.returnLikes.total) return { ok: false, code: 'return_likes_empty', returnLikes: publicReturnLikes(state.returnLikes) };
    if (!state.returnLikes.startedAt) state.returnLikes.startedAt = Date.now();
    state.returnLikes.status = 'running';
    state.returnLikes.pauseReason = '';
    state.returnLikes.pauseMessage = '';
    state.returnLikes.nextRetryAt = 0;
    state.returnLikes.updatedAt = Date.now();
    await saveState(state);
    return processReturnLikesBatch('manual');
  }

  async function pauseReturnLikes() {
    const state = await loadState();
    if (state.returnLikes.status === 'running') {
      state.returnLikes.status = 'paused';
      state.returnLikes.pauseReason = 'user_paused';
      state.returnLikes.pauseMessage = '';
      state.returnLikes.nextRetryAt = 0;
      state.returnLikes.updatedAt = Date.now();
      await saveState(state);
    }
    try { await browser.alarms.clear(RETURN_LIKES_ALARM_NAME); } catch (_) {}
    return { ok: true, returnLikes: publicReturnLikes(state.returnLikes), state: publicState(state) };
  }

  async function resumeBackfillAfterCooldown(source = 'alarm') {
    const state = await loadState();
    const backfill = state.backfill;
    if (backfill.status === 'running') return processBackfillBatch(source);
    if (backfill.status !== 'paused' || !backfill.nextRetryAt) {
      return { ok: true, backfill: publicBackfill(backfill), source };
    }
    const nextRetryAt = Math.max(Number(backfill.nextRetryAt || 0), magazineSafetyCooldownUntil(state));
    if (nextRetryAt > Date.now()) {
      backfill.nextRetryAt = nextRetryAt;
      await saveState(state);
      await scheduleBackfill(Math.ceil((nextRetryAt - Date.now()) / 60000));
      return { ok: true, cooldown: true, code: 'backfill_cooldown', backfill: publicBackfill(backfill), source };
    }
    backfillStopRequested = false;
    backfill.status = 'running';
    backfill.pauseReason = '';
    backfill.pauseMessage = '';
    backfill.nextRetryAt = 0;
    backfill.updatedAt = Date.now();
    await saveState(state);
    return processBackfillBatch(source);
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
    const nextRetryAt = Math.max(Number(state.backfill.nextRetryAt || 0), magazineSafetyCooldownUntil(state));
    if (nextRetryAt > Date.now()) {
      await pauseBackfillForCooldown(
        state,
        state.backfill.pauseReason || 'magazine_safety_cooldown',
        state.backfill.pauseMessage || 'noteのマガジン追加制限を避けるため、安全枠が空くまで自動待機しています。',
        nextRetryAt
      );
      return {
        ok: false,
        code: 'backfill_cooldown',
        message: 'マガジン追加は待機中です。表示時刻になると自動で再開します。',
        backfill: publicBackfill(state.backfill)
      };
    }
    backfillStopRequested = false;
    state.backfill.status = 'running';
    state.backfill.pauseReason = '';
    state.backfill.pauseMessage = '';
    state.backfill.nextRetryAt = 0;
    state.backfill.updatedAt = Date.now();
    await saveState(state);
    return processBackfillBatch('manual');
  }

  async function pauseBackfill() {
    backfillStopRequested = true;
    const state = await loadState();
    if (state.backfill.status === 'running') {
      state.backfill.status = 'paused';
      state.backfill.pauseReason = 'user_paused';
      state.backfill.pauseMessage = '';
      state.backfill.updatedAt = Date.now();
      await saveState(state);
    }
    try { await browser.alarms.clear(BACKFILL_ALARM_NAME); } catch (_) {}
    return { ok: true, backfill: publicBackfill(state.backfill) };
  }

  async function cancelBackfill() {
    backfillStopRequested = true;
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
    const completedCount = row.queue.reduce((count, item) => count + (completionResult(row.completedKeys[item.key]) ? 1 : 0), 0);
    const processed = Math.min(row.total, Math.max(row.cursor, completedCount));
    return {
      status: row.status,
      total: row.total,
      processed,
      remaining: Math.max(0, row.total - processed),
      scannedPages: row.scannedPages,
      added: row.added,
      already: row.already,
      skipped: row.skipped,
      failed: row.failed,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      pauseReason: row.pauseReason,
      pauseMessage: row.pauseMessage,
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
      message: String(row.message || ''),
      sourceTag: String(row.sourceTag || '')
    }));
  }

  function publicReturnLikes(value) {
    const row = normalizeReturnLikes(value);
    const processed = row.queue.reduce((count, item) => count + (returnCompletionResult(row.completedCreators[creatorKey(item.urlname)]) ? 1 : 0), 0);
    return {
      status: row.status,
      targetArticle: RETURN_TARGET_ARTICLE,
      total: row.total,
      processed,
      remaining: Math.max(0, row.total - processed),
      liked: row.liked,
      already: row.already,
      skipped: row.skipped,
      failed: row.failed,
      discovered: row.discovered,
      commenterCount: row.commenterCount,
      previouslyReturned: Number(row.previouslyReturned || 0),
      unavailable: Number(row.unavailable || 0),
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      pauseReason: row.pauseReason,
      pauseMessage: row.pauseMessage,
      nextRetryAt: row.nextRetryAt,
      lastItem: row.lastItem || null
    };
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
      returnLikes: publicReturnLikes(state.returnLikes),
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
      if (alarm.name === BACKFILL_ALARM_NAME) resumeBackfillAfterCooldown('alarm').catch(() => {});
      if (alarm.name === RETURN_LIKES_ALARM_NAME) processReturnLikesBatch('alarm').catch(() => {});
    });
  }
  if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(() => {
    loadState().then(async (state) => {
      if (state.enabled) await ensureAlarm();
      if (state.backfill.status === 'running') await scheduleBackfill(1);
      if (state.backfill.status === 'paused' && state.backfill.nextRetryAt) await scheduleBackfill(Math.ceil((state.backfill.nextRetryAt - Date.now()) / 60000));
      if (state.returnLikes.status === 'running') await scheduleReturnLikes(1);
      if (state.returnLikes.status === 'paused' && state.returnLikes.nextRetryAt) await scheduleReturnLikes(Math.ceil((state.returnLikes.nextRetryAt - Date.now()) / 60000));
    }).catch(() => {});
  });
  if (browser.runtime.onInstalled) browser.runtime.onInstalled.addListener(() => {
    loadState().then(async (state) => {
      if (state.enabled) await ensureAlarm();
      if (state.backfill.status === 'running') await scheduleBackfill(1);
      if (state.backfill.status === 'paused' && state.backfill.nextRetryAt) await scheduleBackfill(Math.ceil((state.backfill.nextRetryAt - Date.now()) / 60000));
      if (state.returnLikes.status === 'running') await scheduleReturnLikes(1);
      if (state.returnLikes.status === 'paused' && state.returnLikes.nextRetryAt) await scheduleReturnLikes(Math.ceil((state.returnLikes.nextRetryAt - Date.now()) / 60000));
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
    if (message.type === 'NERO_RETURN_LIKES_STATUS') return loadState().then((state) => ({ ok: true, returnLikes: publicReturnLikes(state.returnLikes), state: publicState(state) }));
    if (message.type === 'NERO_RETURN_LIKES_SCAN') return scanReturnLikes().then(async (result) => ({ ...result, state: publicState(await loadState()) }));
    if (message.type === 'NERO_RETURN_LIKES_START' || message.type === 'NERO_RETURN_LIKES_RESUME') return startReturnLikes().then(async (result) => ({ ...result, state: publicState(await loadState()) }));
    if (message.type === 'NERO_RETURN_LIKES_PAUSE') return pauseReturnLikes();
    return undefined;
  });

  loadState().then(async (state) => {
    if (state.enabled) await ensureAlarm();
    if (state.backfill.status === 'running') await scheduleBackfill(1);
    if (state.backfill.status === 'paused' && state.backfill.nextRetryAt) await scheduleBackfill(Math.ceil((state.backfill.nextRetryAt - Date.now()) / 60000));
    if (state.returnLikes.status === 'running') await scheduleReturnLikes(1);
    if (state.returnLikes.status === 'paused' && state.returnLikes.nextRetryAt) await scheduleReturnLikes(Math.ceil((state.returnLikes.nextRetryAt - Date.now()) / 60000));
  }).catch(() => {});

  globalThis.NeroLocalAutoTest = {
    runOnce,
    scanBackfill,
    processBackfillBatch,
    resumeBackfillAfterCooldown,
    startBackfill,
    pauseBackfill,
    scanReturnLikes,
    processReturnLikesBatch,
    startReturnLikes,
    pauseReturnLikes,
    hourlyMagazineCount,
    editorialScore,
    normalizeCandidate,
    normalizeLikedEntry,
    extractItems,
    pageIsLast,
    isLikeRateLimited,
    isMagazineRateLimited,
    shouldPauseAll,
    publicState,
    publicBackfill,
    publicReturnLikes,
    constants: { INTERVAL_MINUTES, MAX_MAGAZINE_PER_HOUR, MAX_ALL_MAGAZINE_ADDS_PER_HOUR, MAGAZINE_ADD_WINDOW_MS, LIKE_RETRY_MS, BACKFILL_INTERVAL_MS, BACKFILL_SKIP_INTERVAL_MS, BACKFILL_BATCH_SIZE, BACKFILL_MAX_ATTEMPTS_PER_BATCH, LIKES_PAGE_SIZE, NOTE_GRAPHQL_URL, TARGET_MAGAZINE, RETURN_TARGET_ARTICLE, RETURN_INTERVAL_MINUTES }
  };
})();
