'use strict';

(function initializePagesBridge() {
  const VERSION = '0.1.42';
  const ALLOWED = new Set([
    'P','DIV','BR','H1','H2','H3','H4','STRONG','B','EM','I','U','S',
    'UL','OL','LI','BLOCKQUOTE','A','IMG','FIGURE','FIGCAPTION','HR','CODE','PRE','SPAN'
  ]);
  let articleSequence = 0;

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

  function safeUrl(value, { image = false } = {}) {
    try {
      const url = new URL(String(value || ''), 'https://note.com/');
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (image && url.protocol !== 'https:') return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function appendPlainWithLinks(target, text) {
    const source = String(text || '');
    const re = /https?:\/\/[^\s<>]+/g;
    let cursor = 0;
    for (const match of source.matchAll(re)) {
      const position = match.index || 0;
      if (position > cursor) target.append(document.createTextNode(source.slice(cursor, position)));
      const href = safeUrl(match[0]);
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = match[0];
        target.append(link);
      } else {
        target.append(document.createTextNode(match[0]));
      }
      cursor = position + match[0].length;
    }
    if (cursor < source.length) target.append(document.createTextNode(source.slice(cursor)));
  }

  function sanitizeNode(source, target) {
    if (source.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(source.nodeValue || ''));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return;

    const tag = source.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;

    if (tag === 'IFRAME') {
      const href = safeUrl(source.getAttribute('src'));
      if (!href) return;
      const link = document.createElement('a');
      link.className = 'reader-embed-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '▶ 埋め込みコンテンツを開く ↗';
      target.append(link);
      return;
    }

    if (!ALLOWED.has(tag)) {
      [...source.childNodes].forEach((child) => sanitizeNode(child, target));
      return;
    }

    if (tag === 'IMG') {
      const src = safeUrl(
        source.getAttribute('src') || source.getAttribute('data-src') || source.getAttribute('data-original'),
        { image: true }
      );
      if (!src) return;
      const image = document.createElement('img');
      image.src = src;
      image.alt = String(source.getAttribute('alt') || '');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer-when-downgrade';
      target.append(image);
      return;
    }

    if (tag === 'A') {
      const href = safeUrl(source.getAttribute('href'));
      if (!href) {
        [...source.childNodes].forEach((child) => sanitizeNode(child, target));
        return;
      }
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      [...source.childNodes].forEach((child) => sanitizeNode(child, link));
      if (!link.textContent.trim() && !link.querySelector('img')) link.textContent = href;
      target.append(link);
      return;
    }

    const node = document.createElement(tag.toLowerCase());
    if (tag === 'CODE' || tag === 'PRE') node.className = 'reader-code';
    [...source.childNodes].forEach((child) => sanitizeNode(child, node));
    target.append(node);
  }

  function richBody(value) {
    const source = String(value || '').trim();
    const root = document.createDocumentFragment();
    if (!source) return root;

    if (!/[<>]/.test(source)) {
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        appendPlainWithLinks(root, line);
        if (index < lines.length - 1) root.append(document.createElement('br'));
      });
      return root;
    }

    const parsed = new DOMParser().parseFromString(source, 'text/html');
    [...parsed.body.childNodes].forEach((child) => sanitizeNode(child, root));
    return root;
  }

  function ensureRichBodyNode() {
    const current = document.getElementById('description');
    if (!current) return null;
    if (current.tagName === 'DIV') {
      current.classList.add('reader-rich-body');
      return current;
    }
    const body = document.createElement('div');
    body.id = 'description';
    body.className = 'reader-rich-body';
    body.textContent = current.textContent || '';
    current.replaceWith(body);
    return body;
  }

  function currentArticle() {
    const link = document.getElementById('openNote');
    const body = ensureRichBodyNode();
    if (!link || !body) return null;
    const match = String(link.href || '').match(/\/n\/([^/?#]+)/);
    if (!match) return null;
    return { key: match[1], body };
  }

  function installRichStyles() {
    if (document.getElementById('nero-rich-reader-style')) return;
    const style = document.createElement('style');
    style.id = 'nero-rich-reader-style';
    style.textContent = `
      #description.reader-rich-body{display:block!important;margin:0;color:#c7bdcc;font-size:15px;line-height:1.95;overflow:visible!important;-webkit-line-clamp:unset!important;-webkit-box-orient:unset!important;overflow-wrap:anywhere;word-break:break-word}
      #description.reader-rich-body p{margin:0 0 1.15em;color:#c7bdcc}
      #description.reader-rich-body h1,#description.reader-rich-body h2,#description.reader-rich-body h3,#description.reader-rich-body h4{margin:1.65em 0 .72em;color:#f4edf8;line-height:1.45;font-weight:900;letter-spacing:-.01em}
      #description.reader-rich-body h1{font-size:1.45em}#description.reader-rich-body h2{font-size:1.32em}#description.reader-rich-body h3{font-size:1.18em}#description.reader-rich-body h4{font-size:1.08em}
      #description.reader-rich-body img{display:block;width:100%;height:auto;max-width:100%;margin:1.1em 0;border-radius:16px;background:#120f16}
      #description.reader-rich-body figure{margin:1.25em 0}#description.reader-rich-body figure img{margin:0}
      #description.reader-rich-body figcaption{margin-top:.55em;color:#8e8495;font-size:11px;line-height:1.6}
      #description.reader-rich-body blockquote{margin:1.2em 0;padding:.8em 1em;border-left:4px solid #8f70b8;border-radius:0 12px 12px 0;background:#261f2d;color:#d7ccdd}
      #description.reader-rich-body a{color:#dfc4f5;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;overflow-wrap:anywhere}
      #description.reader-rich-body ul,#description.reader-rich-body ol{padding-left:1.55em;margin:1em 0}#description.reader-rich-body li{margin:.38em 0}
      #description.reader-rich-body pre{margin:1.1em 0;padding:12px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #393140;border-radius:12px;background:#141018;color:#ddd3e3}
      #description.reader-rich-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border-radius:5px;background:#141018;padding:.1em .28em;color:#e8dff0}
      #description.reader-rich-body .reader-embed-link{display:block;margin:1em 0;padding:11px 12px;border:1px solid #4a3d56;border-radius:12px;background:#292131;text-decoration:none!important;font-weight:900}
      #description.reader-rich-body hr{border:0;border-top:1px solid #3c3344;margin:1.6em 0}
      @media(max-width:600px){#description.reader-rich-body{font-size:14px;line-height:1.9}}
    `;
    document.head.appendChild(style);
  }

  async function hydrateArticle() {
    installRichStyles();
    const ctx = currentArticle();
    if (!ctx) return;
    const sequence = ++articleSequence;
    const fallback = ctx.body.textContent || '本文の概要はありません。noteで記事を開いてお読みください。';
    ctx.body.dataset.articleKey = ctx.key;
    ctx.body.textContent = '本文を読み込んでいます…';

    try {
      const payload = await browser.runtime.sendMessage({ type: 'NERO_ARTICLE_FETCH', key: ctx.key });
      const latest = currentArticle();
      if (sequence !== articleSequence || !latest || latest.key !== ctx.key) return;
      if (!payload || !payload.ok) {
        latest.body.textContent = fallback;
        return;
      }

      const fragment = richBody(payload.body || payload.description || fallback);
      latest.body.replaceChildren(fragment);
      latest.body.dataset.articleKey = ctx.key;

      const imageUrl = safeUrl(payload.imageUrl, { image: true });
      const cover = document.getElementById('cover');
      const coverFallback = document.getElementById('coverFallback');
      if (imageUrl && cover && cover.hidden) {
        cover.src = imageUrl;
        cover.hidden = false;
        if (coverFallback) coverFallback.hidden = true;
      }
      const likes = document.getElementById('likes');
      if (likes && Number(payload.likeCount || 0) > 0) likes.textContent = '♡ ' + Number(payload.likeCount || 0);
    } catch (_) {
      const latest = currentArticle();
      if (sequence === articleSequence && latest && latest.key === ctx.key) latest.body.textContent = fallback;
    }
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

  document.addEventListener('nero-article-shown', hydrateArticle);

  publishVersion();
  installRichStyles();
  document.addEventListener('DOMContentLoaded', () => {
    publishVersion();
    installRichStyles();
  }, { once: true });
  const observer = new MutationObserver(publishVersion);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nero-extension'] });
})();
