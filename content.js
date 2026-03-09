/* =========================================================
   ArcadeBot — Content Script v1.3
   - ONE loop only (rAF) — no dual-loop conflict
   - Watchdog revives if rAF stalls (tab blur, GC, errors)
   - Fast shoot: 40ms interval (~25/sec)
   - Fast movement: burst keydowns per frame, tight dead zone
   - Every frame wrapped in try/catch — loop never dies
   ========================================================= */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────── */
  let botActive  = false;
  let rafId      = null;
  let watchdog   = null;
  let lastTick   = 0;
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
      <div id="__bot_wd__" style="color:#ff3366;font-size:9px;min-height:12px;"></div>
    `;
    document.body.appendChild(hud);
  }

  function removeHUD() { if (hud) { hud.remove(); hud = null; } }

  function updateHUD(enemies, dir, note) {
    if (!hud) return;
    try {
      document.getElementById('__bot_status__').textContent  = '● ACTIVE';
      document.getElementById('__bot_enemies__').textContent = `ENEMIES: ${enemies}`;
      document.getElementById('__bot_frame__').textContent   = `FRAME: ${frameCount}`;
      document.getElementById('__bot_dir__').textContent     = `DIR: ${dir}`;
      document.getElementById('__bot_wd__').textContent      = note || '';
    } catch (e) {}
  }

  /* ── Key broadcast — all possible targets ─────────── */
  function broadcastKey(type, key, code, keyCode) {
    const makeEvt = () => new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode,
      bubbles: true, cancelable: true, composed: true,
    });
    try { window.dispatchEvent(makeEvt()); }        catch (e) {}
    try { document.dispatchEvent(makeEvt()); }      catch (e) {}
    try { document.body.dispatchEvent(makeEvt()); } catch (e) {}
    const cvs = getCanvas();
    if (cvs) try { cvs.dispatchEvent(makeEvt()); } catch (e) {}
    const focused = document.activeElement;
    if (focused && focused !== document.body) {
      try { focused.dispatchEvent(makeEvt()); } catch (e) {}
    }
  }

  function pressKey(key, code, kc)   { broadcastKey('keydown', key, code, kc); }
  function releaseKey(key, code, kc) { broadcastKey('keyup',   key, code, kc); }

  /* ── Movement ─────────────────────────────────────── */
  // Fires a burst of keydowns per call for snappy response
  const BURST = 4;

  function moveLeft() {
    // Release right first if it was held
    if (moving.right) {
      releaseKey('d', 'KeyD', 68);
      moving.right = false;
    }
    moving.left = true;
    for (let i = 0; i < BURST; i++) pressKey('a', 'KeyA', 65);
  }

  function moveRight() {
    // Release left first if it was held
    if (moving.left) {
      releaseKey('a', 'KeyA', 65);
      moving.left = false;
    }
    moving.right = true;
    for (let i = 0; i < BURST; i++) pressKey('d', 'KeyD', 68);
  }

  function stopMoving() {
    if (moving.left)  { releaseKey('a', 'KeyA', 65); moving.left  = false; }
    if (moving.right) { releaseKey('d', 'KeyD', 68); moving.right = false; }
  }

  /* ── Shooting — independent interval, not in loop ── */
  function startShooting() {
    if (shootInterval) return;
    shootInterval = setInterval(() => {
      pressKey(' ', 'Space', 32);
      setTimeout(() => releaseKey(' ', 'Space', 32), 20);
    }, 40);
  }

  function stopShooting() {
    if (shootInterval) { clearInterval(shootInterval); shootInterval = null; }
    try { releaseKey(' ', 'Space', 32); } catch (e) {}
  }

  /* ── Canvas ───────────────────────────────────────── */
  function getCanvas() {
    try {
      const all = Array.from(document.querySelectorAll('canvas'));
      if (!all.length) return null;
      return all.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    } catch (e) { return null; }
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
      catch (e) { return null; } // tainted canvas

      const data  = imageData.data;
      const raw   = [];
      const STEP  = 3;
      const scanH = Math.floor(H * 0.88);

      for (let y = 0; y < scanH; y += STEP) {
        for (let x = 0; x < W; x += STEP) {
          const i = (y * W + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a > 80 && r > 130 && g < 80 && b < 80) raw.push({ x, y });
        }
      }
      return cluster(raw, 28);
    } catch (e) { return []; }
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
        if (dx * dx + dy * dy < r2) { m.push(j); used[j] = 1; }
      }
      const cx = m.reduce((s,k) => s + points[k].x, 0) / m.length;
      const cy = m.reduce((s,k) => s + points[k].y, 0) / m.length;
      out.push({ x: cx, y: cy, size: m.length });
    }
    return out;
  }

  /* ── Pick best target ─────────────────────────────── */
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

  /* ── Player X estimate ────────────────────────────── */
  function updatePlayerX(canvas) {
    if (playerX === null) playerX = canvas.width / 2;
    if (moving.left)  playerX = Math.max(0,            playerX - 6);
    if (moving.right) playerX = Math.min(canvas.width, playerX + 6);
  }

  /* ── Single frame tick ────────────────────────────── */
  function tick() {
    if (!botActive) return;
    lastTick = Date.now();

    try {
      frameCount++;
      const canvas = getCanvas();
      if (!canvas) { updateHUD(0, 'NO CANVAS'); return; }

      updatePlayerX(canvas);
      const enemies = findEnemies(canvas);

      if (enemies === null) {
        // Tainted canvas — oscillate left/right
        if (Math.floor(frameCount / 80) % 2 === 0) moveLeft();
        else moveRight();
        updateHUD('?', 'CORS-OSC');
        return;
      }

      const target = pickTarget(enemies, canvas.width);
      let dir = '─';

      if (target) {
        const DEAD_ZONE = 6;
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
      console.warn('[ArcadeBot] tick error (continuing):', err.message);
    }
  }

  /* ── rAF loop — the ONE and ONLY driver ───────────── */
  function botLoop() {
    if (!botActive) return;
    tick();
    rafId = requestAnimationFrame(botLoop);
  }

  /* ── Watchdog — revives stalled rAF ──────────────── */
  // Checks every 400ms. If lastTick is too old, rAF has stalled
  // (browser throttled the tab). Cancels old rAF and starts fresh.
  function startWatchdog() {
    watchdog = setInterval(() => {
      if (!botActive) return;
      if (Date.now() - lastTick > 600) {
        console.warn('[ArcadeBot] Watchdog: rAF stalled — reviving');
        cancelAnimationFrame(rafId);
        try {
          document.getElementById('__bot_wd__').textContent = '⚡ REVIVED';
          setTimeout(() => {
            const el = document.getElementById('__bot_wd__');
            if (el) el.textContent = '';
          }, 1000);
        } catch (e) {}
        rafId = requestAnimationFrame(botLoop);
      }
    }, 400);
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
    lastTick   = Date.now();
    createHUD();
    startShooting();   // independent setInterval — won't conflict with rAF
    startWatchdog();   // revive guard
    botLoop();         // single rAF loop
    console.log('[ArcadeBot] ▶ v1.3');
  }

  function stopBot() {
    botActive = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    stopShooting();
    stopMoving();
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

  console.log('[ArcadeBot] v1.3 loaded.');
})();
