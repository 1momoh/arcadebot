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


## Author

**[.87](https://x.com/ofalamin)**  
𝕏 [@ofalamin](https://x.com/ofalamin) · Telegram [t.me/Labs87](https://t.me/Labs87)

---

## License

MIT — do whatever you want with it.
