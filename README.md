# 🤖 ArcadeBot — Autonomous Arcade Shooter

> A Chrome extension that plays your arcade shooter for you. Built by [.87](https://x.com/ofalamin).

---

## What it does

ArcadeBot watches your game's canvas in real-time, finds enemies by their pixel color, tracks the nearest threat, and fires automatically — no human input needed.

- **Canvas pixel scanning** — reads the game canvas every animation frame
- **Enemy detection** — clusters red-glowing pixels into enemy objects
- **Threat prioritization** — always targets the lowest (most dangerous) enemy first
- **Auto-aim** — moves left/right to align with the target
- **Auto-shoot** — fires every 80ms continuously
- **Green HUD overlay** — live stats on enemy count, direction, and frame count

---

## Controls (automated)

| Key | Action |
|-----|--------|
| `A` | Move left |
| `D` | Move right |
| `Space` | Shoot |

---

## Installation

### Load as unpacked extension (dev mode)

1. Clone or download this repo
   ```bash
   git clone https://github.com/ofalamin/arcadebot.git
   cd arcadebot
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer Mode** (toggle in top-right corner)

4. Click **"Load unpacked"** and select the `arcade-bot-extension` folder

5. The ArcadeBot icon will appear in your Chrome toolbar

---

## Usage

1. Open your game in a Chrome tab
2. Click the ArcadeBot extension icon
3. Hit **▶ ENGAGE BOT**
4. Switch back to your game tab — the bot activates immediately
5. A green HUD overlay appears in-game confirming it's running
6. Click **■ DISENGAGE** from the popup to stop at any time

---

## How the enemy detection works

The bot reads raw pixel data from the game canvas each frame using `getImageData()`. It scans every 3 pixels (for performance) and flags any pixel where:

```
red > 140  AND  green < 70  AND  blue < 70  AND  alpha > 80
```

Matching pixels are then grouped using a lightweight clustering algorithm — nearby dots merge into a single enemy object with an averaged center coordinate. The bot then moves toward whichever enemy cluster has the lowest Y position on screen (closest to the player).

> **Note:** If your game canvas is cross-origin (served from a different domain than the page), browser security prevents pixel reads. The bot falls back to center-locked shooting in this case.

---

## File structure

```
arcade-bot-extension/
├── manifest.json     # Chrome Manifest V3
├── content.js        # Bot logic — runs inside the game tab
├── popup.html        # Extension popup UI
├── popup.js          # Popup ↔ content script messaging
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Customization

The bot is tuned for red enemies on a dark background. To adapt it to a different game, edit the pixel filter in `content.js`:

```js
// content.js — enemy pixel detection condition
if (a > 80 && r > 140 && g < 70 && b < 70) {
  raw.push({ x, y });
}
```

Adjust the `r`, `g`, `b` thresholds to match your game's enemy color. You can also tune:

- `STEP = 3` — scan density (lower = more accurate, higher = faster)
- `radius = 25` — cluster merge distance in pixels
- `DEAD_ZONE = 12` — pixel tolerance before moving
- Shoot interval: `80` ms in `startShooting()`

---

## Built with

- Chrome Manifest V3
- Vanilla JS — no dependencies
- Canvas `getImageData()` API for pixel-level game reading
- `requestAnimationFrame` for 60fps bot loop

---

## Author

**[.87](https://x.com/ofalamin)**  
𝕏 [@ofalamin](https://x.com/ofalamin) · Telegram [t.me/Labs87](https://t.me/Labs87)

---

## License

MIT — do whatever you want with it.
