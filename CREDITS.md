# Credits

Full attribution for all third-party work used in Jutsu Hero.

---

## Original Creator

**Diego Pacheco** — game design, code, ML pipeline, rhythm engine, online mode
GitHub: [@bunkerapps](https://github.com/bunkerapps)

---

## Open Source Libraries

| Library | Version | License | Author / Organization |
|---------|---------|---------|----------------------|
| [Phaser](https://phaser.io) | ^3.88.2 | MIT | Richard Davey / Photon Storm Ltd |
| [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) | ^0.10.34 | Apache 2.0 | Google LLC |
| [ONNX Runtime Web](https://onnxruntime.ai) | ^1.17.3 | MIT | Microsoft Corporation |
| [Socket.io Client](https://socket.io) | ^4.8.3 | MIT | Guillermo Rauch / Socket.io contributors |
| [Vite](https://vitejs.dev) | ^6.3.5 | MIT | Evan You / Vite contributors |
| [TypeScript](https://www.typescriptlang.org) | ^5.7.3 | Apache 2.0 | Microsoft Corporation |
| [Socket.io Server](https://socket.io) | ^4.x | MIT | Guillermo Rauch / Socket.io contributors |
| [tsx](https://github.com/privatenumber/tsx) | ^4.x | MIT | Hiroki Osame |

Full license texts for all dependencies are available via `npm` in their
respective `node_modules` directories or at [npmjs.com](https://npmjs.com).

---

## Naruto Intellectual Property

All Naruto-related content (characters, jutsus, hand seals, lore) is the
intellectual property of:

- **Masashi Kishimoto** — original creator
- **Shueisha Inc.** — publisher
- **Studio Pierrot Co., Ltd.** — anime adaptation
- **VIZ Media LLC** — North American license

Used without permission as a non-commercial fan tribute. See DISCLAIMER.md.

---

## Audio

### Voice Lines & Sound Effects

| File | Description | Presumed Source | Owner |
|------|-------------|-----------------|-------|
| `Kage Bushin No Jutsu.mp3` | Naruto's jutsu activation line | Naruto anime | Studio Pierrot / Shueisha |
| `naruto_win.mp3` | Naruto victory voice clip | Naruto anime/games | Studio Pierrot / Shueisha |
| `sasuke_win.mp3` | Sasuke victory voice clip | Naruto anime/games | Studio Pierrot / Shueisha |
| `finish_him.mp3` | "Finish Him!" announcer | Mortal Kombat series | NetherRealm Studios / Warner Bros. |
| `fight.wav` / `fight_alt.wav` | "Fight!" announcer | Unknown — needs verification | Unknown |
| `round1.wav` / `round1_alt.wav` | "Round 1" announcer | Unknown — needs verification | Unknown |
| `round2.wav` / `round2_alt.wav` | "Round 2" announcer | Unknown — needs verification | Unknown |
| `round3.wav` / `round3_alt.wav` | "Round 3" announcer | Unknown — needs verification | Unknown |
| `p1wins.wav` / `p2wins.wav` | "Player X Wins" announcer | Unknown — needs verification | Unknown |
| `winner.wav` | Winner announcer | Unknown — needs verification | Unknown |

### Background Music

| File | Description | Source | License |
|------|-------------|--------|---------|
| `jutsu.mp3` | Gameplay background music | Unknown — needs verification | Unknown |
| `menu.mp3` | Menu background music | Unknown — needs verification | Unknown |

> **Contributors wanted:** If you know the exact source of any audio marked
> "needs verification," please open a PR updating this table.

### Video Assets

| File | Description | Source |
|------|-------------|--------|
| `chidori.mp4` | Chidori animation clip | Naruto anime — Studio Pierrot / Shueisha |
| `rasengan.mp4` | Rasengan animation clip | Naruto anime — Studio Pierrot / Shueisha |
| `hand_signs_tutorial.mp4` | Hand seal tutorial video | Unknown — not included in repo (>100MB) |

---

## Artwork

### Character Art

| File | Description | Presumed Source |
|------|-------------|-----------------|
| `naruto_artwork.jpg` | Naruto Uzumaki | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `naruto_battle.png` | Naruto battle sprite | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `sasuke_artwork.jpg` | Sasuke Uchiha | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `sasuke_battle.png` | Sasuke battle sprite | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `kakashi_artwork.jpg` | Kakashi Hatake | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `kakashi_lightning_blade.jpg` | Kakashi with Chidori | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `itachi_artwork.jpg` | Itachi Uchiha | Official Naruto artwork — Masashi Kishimoto / Shueisha |
| `gameplay_bg.jpg` | Gameplay background | Unknown — needs verification |
| `NoteTile.png` | Rhythm note tile | Original — Diego Pacheco |

### Hand Seal Imagery

| Folder | Description | Presumed Source |
|--------|-------------|-----------------|
| `/public/assets/art/seals/` | Colored hand seal photos | Original photography or promotional material |
| `/public/assets/art/seals-bw/` | Black & white seal silhouettes | Adapted from Naruto manga — Masashi Kishimoto / Shueisha |

Hand seal names (Inu, Ne, Uma, Tatsu, Uma, Hitsuji, Mi, Tora, I, Saru, Tori,
Ushi, U) are the traditional Japanese zodiac-named hand seals as depicted in
the Naruto series.

---

## Machine Learning Model

| File | Description | Creator |
|------|-------------|---------|
| `public/assets/seal_classifier.onnx` | Hand seal classifier model | Diego Pacheco |
| `public/assets/ort-wasm/*.wasm` | ONNX Runtime WASM binaries | Microsoft Corporation (MIT) |

The seal classifier was trained by the project author using MediaPipe
landmark data from self-recorded hand gesture samples.

---

## Special Thanks

- The Naruto fan community worldwide for keeping the spirit of the show alive
- The Phaser.js community and Discord for engine support
- The MediaPipe team at Google for making hand tracking accessible
- Everyone who has playtested and contributed feedback
