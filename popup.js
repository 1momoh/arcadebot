/* popup.js — ArcadeBot control panel */
'use strict';

const btn        = document.getElementById('btn');
const dot        = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const badge      = document.getElementById('badge');
const tip        = document.getElementById('tip');

let isActive = false;

/* Sync UI state */
function setUI(active) {
  isActive = active;

  if (active) {
    dot.classList.add('active');
    statusText.textContent = 'BOT ACTIVE';
    statusText.className   = 'status-text active';
    badge.textContent      = 'RUNNING';
    badge.className        = 'status-badge active';
    btn.textContent        = '■ DISENGAGE';
    btn.className          = 'btn-toggle stop';
    tip.textContent        = 'Bot is scanning canvas for red enemies and aiming. Switch to the game tab!';
  } else {
    dot.classList.remove('active');
    statusText.textContent = 'BOT OFFLINE';
    statusText.className   = 'status-text idle';
    badge.textContent      = 'IDLE';
    badge.className        = 'status-badge idle';
    btn.textContent        = '▶ ENGAGE BOT';
    btn.className          = 'btn-toggle start';
    tip.textContent        = 'Bot scans for red enemies via canvas pixels\nand aims at the lowest threat automatically.';
  }
}

/* Send message to content script in active tab */
async function sendToTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;

  try {
    return await chrome.tabs.sendMessage(tab.id, { action });
  } catch (e) {
    console.warn('[ArcadeBot Popup] Could not reach content script:', e.message);
    return null;
  }
}

/* Button click */
btn.addEventListener('click', async () => {
  const action  = isActive ? 'stop' : 'start';
  const response = await sendToTab(action);

  if (response && response.ok) {
    setUI(response.active);
  } else {
    // Content script might not be injected yet — try scripting API
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files:  ['content.js']
        });
        const r2 = await sendToTab(action);
        if (r2 && r2.ok) setUI(r2.active);
      } catch (err) {
        statusText.textContent = 'ERR: CHECK PERMISSIONS';
      }
    }
  }
});

/* On open — query current state */
(async () => {
  const response = await sendToTab('status');
  if (response && response.ok) setUI(response.active);
})();
