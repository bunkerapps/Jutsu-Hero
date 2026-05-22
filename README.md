# Jutsu Hero

> **Fan-made Naruto rhythm game** — perform jutsu hand seals with your webcam to cast jutsus in real time.

[![License: PolyForm NC](https://img.shields.io/badge/License-PolyForm%20NC%201.0-blue.svg)](LICENSE)
[![Assets: CC BY-NC-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE-ASSETS)
[![Built with Phaser](https://img.shields.io/badge/Built%20with-Phaser%203-orange.svg)](https://phaser.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)

> **DISCLAIMER:** This is an unofficial, non-commercial fan project. Not affiliated with or endorsed by Masashi Kishimoto, Shueisha, Studio Pierrot, VIZ Media, or Bandai Namco. Naruto © Masashi Kishimoto / Shueisha. See [DISCLAIMER.md](DISCLAIMER.md).

---

## What is Jutsu Hero?

Jutsu Hero is a rhythm game where you perform Naruto hand seals (the zodiac hand signs from the manga/anime) in front of your webcam. The game recognizes your gestures using a real-time ML model built with MediaPipe and ONNX Runtime, and translates them into jutsus that deal damage to your opponent.

No controller needed — just your hands.

### Jutsus Available

| Jutsu | Element | Power | Rank | Seals |
|-------|---------|-------|------|-------|
| Kage Bunshin no Jutsu | — | 2 | B | Ne → Saru → Mi → Inu |
| Chidori | Lightning ⚡ | 3 | A | Ne → Uma → Tatsu → … |
| Katon: Goukakyuu no Jutsu | Fire 🔥 | 2 | C | Ne → Hitsuji → … |
| Katon: Housenka no Jutsu | Fire 🔥 | 2 | C | Ne → Uma → Mi → … |
| Katon: Ryuuka no Jutsu | Fire 🔥 | 3 | B | Ne → Uma → Tatsu → … |

---

## Game Modes

### Single Player
Practice seals against the clock. Complete the jutsu sequence perfectly to score.

### Local Battle (Split-Screen)
Two players on the same screen. Each controls their side via webcam or keyboard.
Best of 3 rounds — reduce your opponent's HP to zero to win the round.

### Online Battle (WiFi / LAN)
Each player uses their own device. Connect via a 4-character room code.

- **1v1** — two players, 5 HP each, best of 3
- **4-Player Battle Royale** — last ninja standing wins; the host (P1) starts the match

The host (room creator, P1) chooses when to start. Other players simply select their jutsu ("vote") before the match begins.

---

## Getting Started

### Requirements

- Node.js 18+
- A modern browser (Chrome recommended for best webcam performance)
- A webcam

### Run Locally

```bash
git clone https://github.com/bunkerapps/Jutsu-Hero.git
cd Jutsu-Hero
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Online Multiplayer Server

The online mode requires the game server. Set it up on any machine on your
local network:

```bash
cd server/
npm install
npm run dev   # starts on port 3001
```

Then set the server URL in a `.env.local` file in the repo root:

```
VITE_SERVER_URL=http://<your-machine-ip>:3001
```

Both players must be on the same network (or the server must be publicly
accessible via a tunnel like [ngrok](https://ngrok.com)).

### Production Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the built version
```

---

## How the Seal Recognition Works

1. **MediaPipe Hands** detects 21 hand landmarks (x, y, z coordinates) from the webcam feed at ~30fps
2. A **custom ONNX classifier** (`seal_classifier.onnx`) trained on those landmarks predicts which of the 12 Naruto hand seals you are forming
3. The **RhythmEngine** compares the predicted seal against the expected next seal in the jutsu sequence, scoring it as Perfect / Good / Miss based on timing
4. A completed sequence fires `onJutsuComplete`, dealing damage in battle modes

The ML model was trained by the project author using self-recorded gesture samples. It is included as a compiled `.onnx` file. Training data and pipeline are separate (not in this repo).

---

## Project Structure

```
Jutsu-Hero/
├── src/
│   ├── scenes/          # Phaser scenes (Menu, Gameplay, Battle, Online, Results...)
│   ├── rhythm/          # RhythmEngine + ComboTracker
│   ├── hand-detection/  # MediaPipe + ONNX seal classifier wrapper
│   ├── network/         # NetworkManager (Socket.io client singleton)
│   ├── audio/           # ArcadeAnnouncer
│   └── data/            # Game data types, jutsu power values
├── public/
│   └── assets/
│       ├── art/         # Character artwork, seals, backgrounds
│       ├── audio/       # Music, SFX, voice lines, tutorial video
│       ├── data/        # beatmaps.json, jutsus.json, seals.json
│       └── ort-wasm/    # ONNX Runtime WASM binaries
├── server/              # Node.js + Socket.io multiplayer server
├── CONTRIBUTING.md
├── CREDITS.md
├── DISCLAIMER.md
├── LICENSE              # PolyForm Noncommercial 1.0.0 (code)
└── LICENSE-ASSETS       # CC BY-NC-SA 4.0 (assets)
```

---

## Contributing

We welcome contributions from the fan community!

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Branch strategy
- PR checklist
- How to add new jutsus
- Asset and IP policy

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating.

---

## Credits

Full attribution for all libraries, assets, and third-party content is in
[CREDITS.md](CREDITS.md).

**Created by:** Diego Pacheco ([@bunkerapps](https://github.com/bunkerapps))

**Key technologies:**
[Phaser.js](https://phaser.io) •
[MediaPipe](https://mediapipe.dev) •
[ONNX Runtime Web](https://onnxruntime.ai) •
[Socket.io](https://socket.io) •
[Vite](https://vitejs.dev) •
[TypeScript](https://typescriptlang.org)

---

## License

- **Code** — [PolyForm Noncommercial License 1.0.0](LICENSE)
  Source-available, non-commercial use only. Fork, learn, contribute — don't sell.
- **Assets** — [CC BY-NC-SA 4.0](LICENSE-ASSETS)
  Original game assets. Non-commercial, attribution required, share-alike.
- **Third-party IP** — All Naruto-related content remains the property of its
  respective owners. See [DISCLAIMER.md](DISCLAIMER.md).

---

*Believe it.*
