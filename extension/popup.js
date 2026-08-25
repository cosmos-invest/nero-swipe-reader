'use strict';

let autoEnabled = false;

function formatTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
}

async function refreshAuto() {
  const result = await browser.runtime.sendMessage({ type: 'NERO_AUTO_STATUS' });
  const state = result && result.state || {};
  autoEnabled = Boolean(state.enabled);
  const badge = document.getElementById('autoBadge');
  const status = document.getElementById('autoStatus');
  const toggle = document.getElementById('autoToggle');
  const resume = document.getElementById('autoResume');
  badge.textContent = state.paused ? '停止中' : (autoEnabled ? 'ON' : 'OFF');
  toggle.textContent = autoEnabled ? '自動運転をOFF' : '自動運転をON';
  resume.hidden = !state.paused;
  const likeText = Number(state.likeBlockedUntil || 0) > Date.now()
    ? 'スキ休止中（' + formatTime(state.likeBlockedUntil) + '再確認）／マガジンは継続'
    : 'スキ稼働中';
  status.textContent = `${likeText}｜直近60分 ${Number(state.hourlyMagazineCount || 0)}/${Number(state.maxMagazinePerHour || 10)}件｜5分おき` + (state.boundAccount ? `｜@${state.boundAccount}` : '');
  if (state.pauseReason) status.textContent += `｜停止理由: ${state.pauseReason}`;
}

document.getElementById('autoToggle').addEventListener('click', async () => {
  const type = autoEnabled ? 'NERO_AUTO_DISABLE' : 'NERO_AUTO_ENABLE';
  const result = await browser.runtime.sendMessage({ type });
  if (!result || !result.ok) alert('自動運転を変更できませんでした。noteのログイン状態を確認してください。');
  await refreshAuto();
});

document.getElementById('autoResume').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'NERO_AUTO_RESUME' });
  await refreshAuto();
});

document.getElementById('openReader').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'NERO_OPEN_READER' });
  window.close();
});

document.getElementById('openNeroReader').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'NERO_OPEN_NERO_READER' });
  window.close();
});

document.getElementById('openLogin').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'NERO_OPEN_NOTE_LOGIN' });
  window.close();
});

refreshAuto().catch(() => {});
