'use strict';

(function initializeEngagementCore(root) {
  function nullableBoolean(value) {
    return typeof value === 'boolean' ? value : null;
  }
  function mergeRelationship(previous, next) {
    return typeof next === 'boolean' ? next : nullableBoolean(previous);
  }
  function actionTime(row) {
    const raw = row && (row.createdAt || row.publishedAt || row.updatedAt);
    const parsed = Date.parse(String(raw || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function weightedShuffle(rows, random) {
    const rng = typeof random === 'function' ? random : Math.random;
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const weight = Math.max(1, Number(row && row.score || 0));
      const value = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, Number(rng()) || 0));
      return { row, key: -Math.log(value) / weight };
    }).sort((a, b) => a.key - b.key).map((entry) => entry.row);
  }
  function aggregateEngagement(articles, owner, cutoffMs, random) {
    const ownerKey = String(owner || '').toLowerCase();
    const cutoff = Number(cutoffMs || 0);
    const creators = new Map();
    let likeCount = 0;
    let commentCount = 0;
    function add(row, kind) {
      if (!row || actionTime(row) < cutoff) return;
      const key = String(row.urlname || row.authorUrlname || row.key || '').trim();
      if (!key || key.toLowerCase() === ownerKey) return;
      let creator = creators.get(key.toLowerCase());
      if (!creator) {
        creator = {
          key,
          urlname: key,
          nickname: String(row.nickname || row.authorName || row.name || key),
          userIcon: String(row.userIcon || row.avatar || ''),
          likeCount: 0,
          commentCount: 0,
          score: 0,
          lastActionAt: '',
          isFollowing: null,
          isFollower: null
        };
        creators.set(key.toLowerCase(), creator);
      }
      if (row.nickname || row.authorName || row.name) creator.nickname = String(row.nickname || row.authorName || row.name);
      if (row.userIcon || row.avatar) creator.userIcon = String(row.userIcon || row.avatar);
      creator.isFollowing = mergeRelationship(creator.isFollowing, row.isFollowing);
      creator.isFollower = mergeRelationship(creator.isFollower, row.isFollower);
      const time = actionTime(row);
      if (time > actionTime({ createdAt: creator.lastActionAt })) creator.lastActionAt = new Date(time).toISOString();
      if (kind === 'like') {
        creator.likeCount += 1;
        likeCount += 1;
      } else {
        creator.commentCount += 1;
        commentCount += 1;
      }
      creator.score = creator.likeCount + creator.commentCount;
    }
    Object.values(articles || {}).forEach((article) => {
      (Array.isArray(article.likes) ? article.likes : []).forEach((row) => add(row, 'like'));
      (Array.isArray(article.comments) ? article.comments : []).forEach((row) => add(row, 'comment'));
    });
    const values = Array.from(creators.values());
    const commenters = weightedShuffle(values.filter((row) => row.commentCount > 0), random);
    const likesOnly = weightedShuffle(values.filter((row) => row.commentCount === 0), random);
    const ordered = commenters.concat(likesOnly);
    return {
      creators: ordered,
      stats: { creatorCount: ordered.length, likeCount, commentCount, score: likeCount + commentCount }
    };
  }
  root.NeroEngagementCore = { aggregateEngagement, weightedShuffle, mergeRelationship, actionTime };
})(typeof globalThis !== 'undefined' ? globalThis : this);
