'use strict';

(function initializeNeroArticleReader() {
  const cache = new Map();

  function validKey(value) {
    return /^n[a-zA-Z0-9_-]+$/.test(String(value || ''));
  }

  function unwrap(payload) {
    let data = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    if (data && data.note && typeof data.note === 'object') data = data.note;
    return data && typeof data === 'object' ? data : {};
  }

  function firstString(row, keys) {
    for (const key of keys) {
      const value = row && row[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  }

  function firstImage(row) {
    return firstString(row, ['eyecatch', 'eyecatchUrl', 'eyecatch_url', 'thumbnail_url', 'image_url']);
  }

  function normalizeArticle(payload, key) {
    const row = unwrap(payload);
    return {
      ok: true,
      key,
      title: firstString(row, ['name', 'title']),
      body: firstString(row, ['body', 'bodyText', 'body_text', 'contentText']),
      description: firstString(row, ['description']),
      imageUrl: firstImage(row),
      likeCount: Number(row.like_count || row.likeCount || row.likes_count || 0)
    };
  }

  async function fetchArticle(key) {
    if (!validKey(key)) return { ok: false, code: 'invalid_article_key', message: '記事IDを確認できませんでした。' };
    if (cache.has(key)) return cache.get(key);

    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('https://note.com/api/v3/notes/' + encodeURIComponent(key), {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) {
          return { ok: false, code: 'article_fetch_' + response.status, status: response.status, message: '記事本文を取得できませんでした。' };
        }
        return normalizeArticle(await response.json(), key);
      } catch (error) {
        return { ok: false, code: 'article_fetch_failed', message: error && error.name === 'AbortError' ? '記事本文の取得がタイムアウトしました。' : '記事本文を取得できませんでした。' };
      } finally {
        clearTimeout(timer);
      }
    })();

    cache.set(key, promise);
    const result = await promise;
    if (!result.ok) cache.delete(key);
    return result;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object' || message.type !== 'NERO_ARTICLE_FETCH') return undefined;
    return fetchArticle(String(message.key || ''));
  });

  globalThis.NeroArticleReaderTest = { validKey, unwrap, normalizeArticle, fetchArticle };
})();
