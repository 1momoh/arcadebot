/* =========================================================
   ArcadeBot — Content Script
   Strategy:
   1. Grab the game canvas → read pixel data each frame
   2. Find red-glowing enemy pixels (high R, low G/B)
   3. Cluster them into enemy objects
   4. Move player toward the lowest/nearest threat
   5. Spam Space to shoot continuously
   ========================================================= */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────── */
  let botActive   = false;
  let rafId       = null;
  let playerX     = null;   // estimated player X on canvas
  let frameCount  = 0;
  let killCount   = 0;
  let lastEnemyCount = 0;

  const keysHeld = { left: false, right: false };
  let   shootInterval = null;

  /* ── Overlay HUD ──────────────────────────────────── */
  let hud = null;

  function createHUD() {
    if (hud) return;
    hud = document.createElement('div');
    hud.id = '__arcadebot_hud__';
    Object.assign(hud.style, {
      position:   'fixed',
      top:        '12px',
      right:      '12px',
      zIndex:     '999999',
      background: 'rgba(0,0,0,0.85)',
      border:     '1px solid #00ff88',
      borderRadius: '6px',
      padding:    '8px 14px',
      fontFamily: '"Courier New", monospace',
      fontSize:   '11px',
      color:      '#00ff88',
      lineHeight: '1.7',
      pointerEvents: 'none',
      boxShadow:  '0 0 12px rgba(0,255,136,0.3)',
      minWidth:   '160px',
    });
    hud.innerHTML = `
      <div style="font-size:13px;font-weight:bold;letter-spacing:2px;margin-bottom:4px;">
        🤖 ARCADEBOT
      </div>
      <div id="__bot_status__">● ACTIVE</div>
      <div id="__bot_enemies__">ENEMIES: 0</div>
      <div id="__bot_frame__">FRAME: 0</div>
      <div id="__bot_dir__">DIR: ─</div>
    `;
    document.body.appendChild(hud);
  }

  function removeHUD() {
    if (hud) { hud.remove(); hud = null; }
  }

  function updateHUD(enemies, dir) {
    if (!hud) return;
    document.getElementById('__bot_status__').textContent  = '● ACTIVE';
    document.getElementById('__bot_enemies__').textContent = `ENEMIES: ${enemies}`;
    document.getElementById('__bot_frame__').textContent   = `FRAME: ${frameCount}`;
    document.getElementById('__bot_dir__').textContent     = `DIR: ${dir}`;
  }

  /* ── Key helpers ──────────────────────────────────── */
  function fireKey(type, key, code) {
    const el = getGameTarget();
    el.dispatchEvent(new KeyboardEvent(type, {
      key, code, keyCode: key === ' ' ? 32 : key === 'a' ? 65 : 68,
      which: key === ' ' ? 32 : key === 'a' ? 65 : 68,
      bubbles: true, cancelable: true
    }));
  }

  function holdLeft()    { if (!keysHeld.left)  { keysHeld.left  = true;  fireKey('keydown','a','KeyA'); } }
  function holdRight()   { if (!keysHeld.right) { keysHeld.right = true;  fireKey('keydown','d','KeyD'); } }
  function releaseLeft() { if (keysHeld.left)   { keysHeld.left  = false; fireKey('keyup','a','KeyA');   } }
  function releaseRight(){ if (keysHeld.right)  { keysHeld.right = false; fireKey('keyup','d','KeyD');   } }
  function releaseAll()  { releaseLeft(); releaseRight(); }

  function startShooting() {
    if (shootInterval) return;
    // Press space every 80ms — fast enough to saturate most shooters
    shootInterval = setInterval(() => {
      fireKey('keydown', ' ', 'Space');
      setTimeout(() => fireKey('keyup', ' ', 'Space'), 40);
    }, 80);
  }

  function stopShooting() {
    if (shootInterval) { clearInterval(shootInterval); shootInterval = null; }
    fireKey('keyup', ' ', 'Space');
  }

  /* ── Find game target element for events ─────────── */
  function getGameTarget() {
    return document.querySelector('canvas') || document.body;
  }

  /* ── Canvas detection ─────────────────────────────── */
  function getCanvas() {
    // Prefer canvas with the largest area (the game canvas)
    const canvases = Array.from(document.querySelectorAll('canvas'));
    if (!canvases.length) return null;
    return canvases.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
  }

  /* ── Pixel analysis — find red enemies ───────────── */
  function findEnemies(canvas) {
    let ctx;
    try {
      ctx = canvas.getContext('2d');
      if (!ctx) return [];
    } catch(e) { return []; }

    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return [];

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, W, H);
    } catch(e) {
      // Tainted canvas (cross-origin) — fall back to center-shoot mode
      return null;
    }

    const data = imageData.data;
    const raw  = [];
    const STEP = 3; // sample every 3px for speed

    // Scan top 85% of canvas — player is at bottom
    const scanH = Math.floor(H * 0.85);

    for (let y = 0; y < scanH; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        // Enemy pixels: saturated red, dark green/blue, visible alpha
        if (a > 80 && r > 140 && g < 70 && b < 70) {
          raw.push({ x, y });
        }
      }
    }

    return clusterPoints(raw, 25);
  }

  /* ── DBSCAN-lite clustering ───────────────────────── */
  function clusterPoints(points, radius) {
    if (!points.length) return [];
    const used    = new Uint8Array(points.length);
    const clusters = [];

    for (let i = 0; i < points.length; i++) {
      if (used[i]) continue;
      const members = [i];
      used[i] = 1;
      for (let j = i + 1; j < points.length; j++) {
        if (used[j]) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (dx*dx + dy*dy < radius*radius) { members.push(j); used[j] = 1; }
      }
      if (members.length >= 1) {
        const cx = members.reduce((s,k) => s + points[k].x, 0) / members.length;
        const cy = members.reduce((s,k) => s + points[k].y, 0) / members.length;
        clusters.push({ x: cx, y: cy, size: members.length });
      }
    }
    return clusters;
  }

  /* ── Pick best target ─────────────────────────────── */
  function pickTarget(enemies, canvasW) {
    if (!enemies || !enemies.length) return null;

    // Priority 1: lowest enemy (most urgent threat)
    // Priority 2: among equally low enemies, closest to player center
    const cx = playerX !== null ? playerX : canvasW / 2;

    return enemies.reduce((best, e) => {
      if (!best) return e;
      // Weight: lower Y wins strongly, ties broken by proximity
      const bestScore = best.y * 10 - Math.abs(best.x - cx);
      const eScore    = e.y    * 10 - Math.abs(e.x    - cx);
      return eScore > bestScore ? e : best;
    }, null);
  }

  /* ── Estimate player X from movement history ──────── */
  function updatePlayerX(canvas) {
    if (playerX === null) playerX = canvas.width / 2;
    // Nudge tracked position based on held keys (approx 2px/frame)
    if (keysHeld.left)  playerX = Math.max(0,             playerX - 2);
    if (keysHeld.right) playerX = Math.min(canvas.width,  playerX + 2);
  }

  /* ── Bot main loop ────────────────────────────────── */
  function botLoop() {
    if (!botActive) return;
    frameCount++;

    const canvas = getCanvas();

    if (!canvas) {
      updateHUD(0, 'NO CVS');
      rafId = requestAnimationFrame(botLoop);
      return;
    }

    updatePlayerX(canvas);

    const enemies = findEnemies(canvas);

    /* Tainted canvas fallback — just shoot toward center */
    if (enemies === null) {
      updateHUD('?', 'CORS');
      rafId = requestAnimationFrame(botLoop);
      return;
    }

    const target = pickTarget(enemies, canvas.width);
    let dir = '─';

    if (target) {
      const DEAD_ZONE = 12;
      const diff = target.x - playerX;

      if (diff > DEAD_ZONE) {
        holdRight(); releaseLeft();
        dir = '→';
      } else if (diff < -DEAD_ZONE) {
        holdLeft(); releaseRight();
        dir = '←';
      } else {
        releaseAll();
        dir = '●';
      }
    } else {
      // No enemies visible — idle, stay still
      releaseAll();
    }

    updateHUD(enemies.length, dir);
    rafId = requestAnimationFrame(botLoop);
  }

  /* ── Start / Stop ─────────────────────────────────── */
  function startBot() {
    if (botActive) return;
    botActive = true;
    playerX   = null;
    frameCount = 0;
    createHUD();
    startShooting();
    botLoop();
    console.log('[ArcadeBot] ▶ Started');
  }

  function stopBot() {
    botActive = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    stopShooting();
    releaseAll();
    removeHUD();
    console.log('[ArcadeBot] ■ Stopped');
  }

  /* ── Message bridge from popup ────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'start') { startBot();  sendResponse({ ok: true, active: true  }); }
    if (msg.action === 'stop')  { stopBot();   sendResponse({ ok: true, active: false }); }
    if (msg.action === 'status'){ sendResponse({ ok: true, active: botActive }); }
  });

  console.log('[ArcadeBot] Content script loaded — open the extension popup to activate.');
})();
