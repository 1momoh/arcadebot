/* =========================================================
   ArcadeBot — Content Script v1.2
   Fixes:
   - Watchdog timer restarts loop if rAF stalls (tab blur etc)
   - try/catch on every frame so errors can't kill the loop
   - setInterval heartbeat as backup to requestAnimationFrame
   - 3x faster shooting (40ms interval)
   - Ultra-fast movement: fires keydown 4x per frame + tiny dead zone
   - Teleport-style movement: bursts of rapid key events
   ========================================================= */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────── */
  let botActive  = false;
  let rafId      = null;
  let heartbeat  = null;   // backup interval if rAF stalls
  let watchdog   = null;   // detects if loop froze
  let lastFrame  = 0;      // timestamp of last successful frame
  let playerX    = null;
  let frameCount = 0;

  const moving = { left: false, right: false };
  let shootInterval = null;

  /* ── HUD ──────────────────────────────────────────── */
  let hud = null;

  function createHUD() {
    if (hud) return;
    hud = document.createElement('div');
    hud.id = '__arcadebot_hud__';
    Object.assign(hud.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '999999',
      background: 'rgba(0,0,0,0.85)', border: '1px solid #00ff88',
      borderRadius: '6px', padding: '8px 14px',
      fontFamily: '"Courier New", monospace', fontSize: '11px',
      color: '#00ff88', lineHeight: '1.7', pointerEvents: 'none',
      boxShadow: '0 0 12px rgba(0,255,136,0.3)', minWidth: '170px',
    });
    hud.innerHTML = `
      <div style="font-size:13px;font-weight:bold;letter-spacing:2px;margin-bottom:4px;">🤖 ARCADEBOT</div>
      <div id="__bot_status__">● ACTIVE</div>
      <div id="__bot_enemies__">ENEMIES: 0</div>
      <div id="__bot_frame__">FRAME: 0</div>
      <div id="__bot_dir__">DIR: ─</div>
      <div id="__bot_wd__" style="color:#ff3366;font-size:9px;"></div>
    `;
    document.body.appendChild(hud);
  }

  function removeHUD() { if (hud) { hud.remove(); hud = null; } }

  function updateHUD(enemies, dir, wdMsg) {
    if (!hud) return;
    try {
      document.getElementById('__bot_status__').textContent  = '● ACTIVE';
      document.getElementById('__bot_enemies__').textContent = `ENEMIES: ${enemies}`;
      document.getElementById('__bot_frame__').textContent   = `FRAME: ${frameCount}`;
      document.getElementById('__bot_dir__').textContent     = `DIR: ${dir}`;
      document.getElementById('__bot_wd__').textContent      = wdMsg || '';
    } catch(e) {}
  }

  /* ── Key broadcast ────────────────────────────────── */
  function broadcastKey(type, key, code, keyCode) {
    const makeEvt = () => new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode,
      bubbles: true, cancelable: true, composed: true,
    });
    try { window.dispatchEvent(makeEvt()); }   catch(e) {}
    try { document.dispatchEvent(makeEvt()); } catch(e) {}
    try { document.body.dispatchEvent(makeEvt()); } catch(e) {}
    const canvas = getCanvas();
    if (canvas) try { canvas.dispatchEvent(makeEvt()); } catch(e) {}
    const active = document.activeElement;
    if (active && active !== document.body) try { active.dispatchEvent(makeEvt()); } catch(e) {}
  }

  function pressKey(key, code, kc)   { broadcastKey('keydown', key, code, kc); }
  function releaseKey(key, code, kc) { broadcastKey('keyup',   key, code, kc); }

  /* ── Ultra-fast movement — fires keydown N times per call ── */
  const BURST = 5; // keydown events per frame — feels like teleporting

  function moveLeft() {
    if (moving.right) { releaseKey('d', 'KeyD', 68); moving.right = false; }
    moving.left = true;
    for (let i = 0; i < BURST; i++) pressKey('a', 'KeyA', 65);
  }

  function moveRight() {
    if (moving.left) { releaseKey('a', 'KeyA', 65); moving.left = false; }
    moving.right = true;
    for (let i = 0; i < BURST; i++) pressKey('d', 'KeyD', 68);
  }

  function stopMoving() {
    if (moving.left)  { releaseKey('a', 'KeyA', 65); moving.left  = false; }
    if (moving.right) { releaseKey('d', 'KeyD', 68); moving.right = false; }
  }

  /* ── Ultra-fast shooting ──────────────────────────── */
  function startShooting() {
    if (shootInterval) return;
    shootInterval = setInterval(() => {
      pressKey(' ', 'Space', 32);
      setTimeout(() => releaseKey(' ', 'Space', 32), 20);
    }, 40); // fires ~25 shots/sec
  }

  function stopShooting() {
    if (shootInterval) { clearInterval(shootInterval); shootInterval = null; }
    try { releaseKey(' ', 'Space', 32); } catch(e) {}
  }

  /* ── Canvas ───────────────────────────────────────── */
  function getCanvas() {
    try {
      const all = Array.from(document.querySelectorAll('canvas'));
      if (!all.length) return null;
      return all.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    } catch(e) { return null; }
  }

  /* ── Pixel scan ───────────────────────────────────── */
  function findEnemies(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      const W = canvas.width, H = canvas.height;
      if (!W || !H) return [];

      let imageData;
      try { imageData = ctx.getImageData(0, 0, W, H); }
      catch (e) { return null; } // tainted

      const data   = imageData.data;
      const raw    = [];
      const STEP   = 3;
      const scanH  = Math.floor(H * 0.88);

      for (let y = 0; y < scanH; y += STEP) {
        for (let x = 0; x < W; x += STEP) {
          const i = (y * W + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a > 80 && r > 130 && g < 80 && b < 80) raw.push({ x, y });
        }
      }
      return cluster(raw, 28);
    } catch(e) { return []; }
  }

  /* ── Clustering ───────────────────────────────────── */
  function cluster(points, radius) {
    if (!points.length) return [];
    const used = new Uint8Array(points.length);
    const out  = [];
    const r2   = radius * radius;
    for (let i = 0; i < points.length; i++) {
      if (used[i]) continue;
      const m = [i]; used[i] = 1;
      for (let j = i + 1; j < points.length; j++) {
        if (used[j]) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (dx*dx + dy*dy < r2) { m.push(j); used[j] = 1; }
      }
      const cx = m.reduce((s,k) => s + points[k].x, 0) / m.length;
      const cy = m.reduce((s,k) => s + points[k].y, 0) / m.length;
      out.push({ x: cx, y: cy, size: m.length });
    }
    return out;
  }

  /* ── Pick target ──────────────────────────────────── */
  function pickTarget(enemies, canvasW) {
    if (!enemies || !enemies.length) return null;
    const cx = playerX !== null ? playerX : canvasW / 2;
    return enemies.reduce((best, e) => {
      if (!best) return e;
      const bs = best.y * 10 - Math.abs(best.x - cx);
      const es = e.y    * 10 - Math.abs(e.x    - cx);
      return es > bs ? e : best;
    }, null);
  }

  /* ── Player position estimate ─────────────────────── */
  function updatePlayerX(canvas) {
    if (playerX === null) playerX = canvas.width / 2;
    // Larger nudge to match faster movement
    if (moving.left)  playerX = Math.max(0,            playerX - 8);
    if (moving.right) playerX = Math.min(canvas.width, playerX + 8);
  }

  /* ── Core frame logic (wrapped in try/catch) ──────── */
  function tick() {
    if (!botActive) return;
    try {
      frameCount++;
      lastFrame = Date.now();

      const canvas = getCanvas();
      if (!canvas) { updateHUD(0, 'NO CANVAS'); return; }

      updatePlayerX(canvas);
      const enemies = findEnemies(canvas);

      // Tainted canvas fallback — oscillate
      if (enemies === null) {
        const phase = Math.floor(frameCount / 60) % 2;
        if (phase === 0) moveLeft(); else moveRight();
        updateHUD('?', 'CORS-OSC');
        return;
      }

      const target = pickTarget(enemies, canvas.width);
      let dir = '─';

      if (target) {
        const DEAD_ZONE = 5; // very tight — snaps instantly
        const diff = target.x - playerX;

        if (diff > DEAD_ZONE) {
          moveRight();
          dir = `→ ${Math.round(diff)}px`;
        } else if (diff < -DEAD_ZONE) {
          moveLeft();
          dir = `← ${Math.round(Math.abs(diff))}px`;
        } else {
          stopMoving();
          dir = '● LOCKED';
        }
      } else {
        stopMoving();
        dir = 'SCANNING';
      }

      updateHUD(enemies.length, dir);
    } catch (err) {
      console.warn('[ArcadeBot] frame error (continuing):', err);
    }
  }

  /* ── rAF loop ─────────────────────────────────────── */
  function botLoop() {
    if (!botActive) return;
    tick();
    rafId = requestAnimationFrame(botLoop);
  }

  /* ── Watchdog — detects stalled loop & revives it ─── */
  function startWatchdog() {
    watchdog = setInterval(() => {
      if (!botActive) return;
      const age = Date.now() - lastFrame;
      if (age > 500) {
        // Loop stalled (tab blur, GC pause, error) — revive
        console.warn('[ArcadeBot] Watchdog: loop stalled, restarting...');
        cancelAnimationFrame(rafId);
        if (hud) {
          try { document.getElementById('__bot_wd__').textContent = '⚡ REVIVED'; } catch(e){}
        }
        rafId = requestAnimationFrame(botLoop);
      }
    }, 500);
  }

  /* ── Heartbeat interval — secondary driver ─────────── */
  // Runs tick() every 16ms independently of rAF.
  // Ensures movement/shooting continues even when rAF pauses.
  function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      if (!botActive) return;
      tick();
    }, 16);
  }

  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function stopWatchdog() {
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
  }

  /* ── Start / Stop ─────────────────────────────────── */
  function startBot() {
    if (botActive) return;
    botActive  = true;
    playerX    = null;
    frameCount = 0;
    lastFrame  = Date.now();
    createHUD();
    startShooting();
    startHeartbeat();
    startWatchdog();
    botLoop();
    console.log('[ArcadeBot] ▶ Started v1.2');
  }

  function stopBot() {
    botActive = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    stopShooting();
    stopMoving();
    stopHeartbeat();
    stopWatchdog();
    removeHUD();
    console.log('[ArcadeBot] ■ Stopped');
  }

  /* ── Message bridge ───────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'start')  { startBot(); sendResponse({ ok: true, active: true  }); }
    if (msg.action === 'stop')   { stopBot();  sendResponse({ ok: true, active: false }); }
    if (msg.action === 'status') { sendResponse({ ok: true, active: botActive }); }
  });

  console.log('[ArcadeBot] v1.2 loaded.');
})();
