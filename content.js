/* =========================================================
   ArcadeBot — Content Script v1.1
   Fix: broadcast key events to window + document + body + canvas
        AND re-fire keydown every frame while moving (key-repeat)
   ========================================================= */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────── */
  let botActive  = false;
  let rafId      = null;
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
      boxShadow: '0 0 12px rgba(0,255,136,0.3)', minWidth: '160px',
    });
    hud.innerHTML = `
      <div style="font-size:13px;font-weight:bold;letter-spacing:2px;margin-bottom:4px;">🤖 ARCADEBOT</div>
      <div id="__bot_status__">● ACTIVE</div>
      <div id="__bot_enemies__">ENEMIES: 0</div>
      <div id="__bot_frame__">FRAME: 0</div>
      <div id="__bot_dir__">DIR: ─</div>
    `;
    document.body.appendChild(hud);
  }

  function removeHUD() { if (hud) { hud.remove(); hud = null; } }

  function updateHUD(enemies, dir) {
    if (!hud) return;
    document.getElementById('__bot_status__').textContent  = '● ACTIVE';
    document.getElementById('__bot_enemies__').textContent = `ENEMIES: ${enemies}`;
    document.getElementById('__bot_frame__').textContent   = `FRAME: ${frameCount}`;
    document.getElementById('__bot_dir__').textContent     = `DIR: ${dir}`;
  }

  /* ── Key broadcast — fires to EVERY possible listener ── */
  function broadcastKey(type, key, code, keyCode) {
    const makeEvt = () => new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode,
      bubbles: true, cancelable: true,
      composed: true,  // crosses shadow DOM
    });

    // Cover all common game event targets
    window.dispatchEvent(makeEvt());
    document.dispatchEvent(makeEvt());
    document.body.dispatchEvent(makeEvt());

    const canvas = getCanvas();
    if (canvas) canvas.dispatchEvent(makeEvt());

    // Also any focused element
    const active = document.activeElement;
    if (active && active !== document.body) active.dispatchEvent(makeEvt());
  }

  function pressKey(key, code, keyCode)   { broadcastKey('keydown', key, code, keyCode); }
  function releaseKey(key, code, keyCode) { broadcastKey('keyup',   key, code, keyCode); }

  /* ── Movement — re-fires keydown EVERY frame (simulates key-hold) ── */
  function moveLeft() {
    if (moving.right) { releaseKey('d', 'KeyD', 68); moving.right = false; }
    moving.left = true;
    pressKey('a', 'KeyA', 65);
  }

  function moveRight() {
    if (moving.left) { releaseKey('a', 'KeyA', 65); moving.left = false; }
    moving.right = true;
    pressKey('d', 'KeyD', 68);
  }

  function stopMoving() {
    if (moving.left)  { releaseKey('a', 'KeyA', 65); moving.left  = false; }
    if (moving.right) { releaseKey('d', 'KeyD', 68); moving.right = false; }
  }

  /* ── Shooting ─────────────────────────────────────── */
  function startShooting() {
    if (shootInterval) return;
    shootInterval = setInterval(() => {
      pressKey(' ', 'Space', 32);
      setTimeout(() => releaseKey(' ', 'Space', 32), 50);
    }, 100);
  }

  function stopShooting() {
    if (shootInterval) { clearInterval(shootInterval); shootInterval = null; }
    releaseKey(' ', 'Space', 32);
  }

  /* ── Canvas ───────────────────────────────────────── */
  function getCanvas() {
    const all = Array.from(document.querySelectorAll('canvas'));
    if (!all.length) return null;
    return all.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
  }

  /* ── Pixel scan — find red enemies ───────────────── */
  function findEnemies(canvas) {
    let ctx;
    try { ctx = canvas.getContext('2d'); if (!ctx) return []; }
    catch (e) { return []; }

    const W = canvas.width, H = canvas.height;
    if (!W || !H) return [];

    let imageData;
    try { imageData = ctx.getImageData(0, 0, W, H); }
    catch (e) { return null; } // tainted canvas

    const data = imageData.data;
    const raw  = [];
    const STEP = 3;
    const scanH = Math.floor(H * 0.88);

    for (let y = 0; y < scanH; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        // Red enemy pixels: high R, low G/B
        if (a > 80 && r > 130 && g < 80 && b < 80) {
          raw.push({ x, y });
        }
      }
    }

    return cluster(raw, 28);
  }

  /* ── Clustering ───────────────────────────────────── */
  function cluster(points, radius) {
    if (!points.length) return [];
    const used     = new Uint8Array(points.length);
    const clusters = [];
    const r2       = radius * radius;

    for (let i = 0; i < points.length; i++) {
      if (used[i]) continue;
      const members = [i];
      used[i] = 1;
      for (let j = i + 1; j < points.length; j++) {
        if (used[j]) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (dx * dx + dy * dy < r2) { members.push(j); used[j] = 1; }
      }
      const cx = members.reduce((s, k) => s + points[k].x, 0) / members.length;
      const cy = members.reduce((s, k) => s + points[k].y, 0) / members.length;
      clusters.push({ x: cx, y: cy, size: members.length });
    }
    return clusters;
  }

  /* ── Pick target — lowest + closest to player ────── */
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

  /* ── Track player position estimate ──────────────── */
  function updatePlayerX(canvas) {
    if (playerX === null) playerX = canvas.width / 2;
    if (moving.left)  playerX = Math.max(0,            playerX - 3);
    if (moving.right) playerX = Math.min(canvas.width, playerX + 3);
  }

  /* ── Main loop ────────────────────────────────────── */
  function botLoop() {
    if (!botActive) return;
    frameCount++;

    const canvas = getCanvas();
    if (!canvas) {
      updateHUD(0, 'NO CANVAS');
      rafId = requestAnimationFrame(botLoop);
      return;
    }

    updatePlayerX(canvas);

    const enemies = findEnemies(canvas);

    // Tainted canvas — can't read pixels, oscillate and shoot
    if (enemies === null) {
      const period = 90;
      const phase  = Math.floor(frameCount / period) % 2;
      if (phase === 0) moveLeft(); else moveRight();
      updateHUD('?', 'CORS-OSC');
      rafId = requestAnimationFrame(botLoop);
      return;
    }

    const target = pickTarget(enemies, canvas.width);
    let dir = '─';

    if (target) {
      const DEAD_ZONE = 8;
      const diff = target.x - playerX;

      if (diff > DEAD_ZONE) {
        moveRight();
        dir = `→ (${Math.round(diff)}px)`;
      } else if (diff < -DEAD_ZONE) {
        moveLeft();
        dir = `← (${Math.round(Math.abs(diff))}px)`;
      } else {
        stopMoving();
        dir = '● LOCKED';
      }
    } else {
      stopMoving();
      dir = 'SCANNING';
    }

    updateHUD(enemies.length, dir);
    rafId = requestAnimationFrame(botLoop);
  }

  /* ── Start / Stop ─────────────────────────────────── */
  function startBot() {
    if (botActive) return;
    botActive  = true;
    playerX    = null;
    frameCount = 0;
    createHUD();
    startShooting();
    botLoop();
    console.log('[ArcadeBot] ▶ Started v1.1');
  }

  function stopBot() {
    botActive = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    stopShooting();
    stopMoving();
    removeHUD();
    console.log('[ArcadeBot] ■ Stopped');
  }

  /* ── Message bridge ───────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'start')  { startBot(); sendResponse({ ok: true, active: true  }); }
    if (msg.action === 'stop')   { stopBot();  sendResponse({ ok: true, active: false }); }
    if (msg.action === 'status') { sendResponse({ ok: true, active: botActive }); }
  });

  console.log('[ArcadeBot] v1.1 loaded — open popup to activate.');
})();
