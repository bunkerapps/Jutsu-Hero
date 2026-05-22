# Contributing to Jutsu Hero

First off — thank you for wanting to contribute to a fan project made with
love for the Naruto community. Every bug report, idea, and PR matters.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Opening a Pull Request](#opening-a-pull-request)
- [Commit Style](#commit-style)
- [Code Style](#code-style)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Important: IP and Assets Policy](#important-ip-and-assets-policy)

---

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
By participating you agree to uphold it. Be kind, be constructive.

---

## Ways to Contribute

- Fix a bug — check the [issues](https://github.com/bunkerapps/Jutsu-Hero/issues) labeled `bug`
- Implement a feature — check issues labeled `enhancement` or `good first issue`
- Improve accessibility or mobile support
- Add new jutsus (see the Beatmap section below)
- Improve the hand seal ML model accuracy
- Fix typos / improve documentation
- Help identify unknown audio/art sources in CREDITS.md
- Translate UI strings to other languages

---

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- A modern browser with WebRTC support (Chrome recommended for camera access)
- A webcam (required for seal recognition mode)

### Web Client

```bash
git clone https://github.com/bunkerapps/Jutsu-Hero.git
cd Jutsu-Hero
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

### Online Multiplayer Server

The online battle mode requires the game server. The server source is in the
`server/` directory (tracked separately). To run it:

```bash
cd server/
npm install
npm run dev   # starts on port 3001
```

Set the server URL in `web/.env.local`:

```
VITE_SERVER_URL=http://localhost:3001
```

### Building for Production

```bash
npm run build   # output in dist/
npm run preview # preview the production build
```

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, always deployable |
| `dev` | Integration branch — PRs target this |
| `feat/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `chore/<name>` | Tooling, deps, docs |

**All PRs should target `dev`**, not `main`. Maintainers merge `dev` → `main`
for releases.

---

## Opening a Pull Request

1. **Fork** the repository and create your branch from `dev`:
   ```bash
   git checkout -b feat/my-feature dev
   ```

2. **Make your changes.** Keep PRs focused — one feature or fix per PR.

3. **Test your changes:**
   - Run `npx tsc --noEmit` — zero TypeScript errors required
   - Test in Chrome with webcam if your change touches camera/seal logic
   - Test online mode with two browser tabs if your change touches networking

4. **Commit** using the [commit style](#commit-style) below.

5. **Push** and open a PR against `dev`:
   ```bash
   git push origin feat/my-feature
   ```

6. **Fill out the PR template** — describe what changed, why, and how to test.

7. A maintainer will review within a few days. Be ready for feedback.

### PR Checklist

Before submitting, confirm:

- [ ] TypeScript compiles with no errors (`npx tsc --noEmit`)
- [ ] No `console.log` left in production code
- [ ] No new dependencies added without discussion in an issue first
- [ ] If you added/changed gameplay logic, describe the behavior in the PR body
- [ ] If your PR touches assets, you have verified the asset is either original or properly attributed in CREDITS.md
- [ ] No copyrighted audio, video, or artwork added without prior discussion

---

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`

Scopes: `gameplay`, `online`, `ui`, `audio`, `ml`, `server`, `vfx`, `rhythm`

Examples:
```
feat(gameplay): add Amaterasu jutsu with beatmap
fix(online): prevent duplicate match:start events in BR mode
chore(deps): update phaser to 3.90.0
docs: add server setup instructions to CONTRIBUTING
```

---

## Code Style

- **TypeScript strict mode** — no `any`, no implicit returns
- **No comments** unless the WHY is non-obvious (hidden constraint, subtle
  invariant, workaround for a specific bug)
- **No dead code** — remove unused variables, imports, and methods
- **Phaser idioms** — use `this.add.*`, `this.time.addEvent`, scene lifecycle
  methods as intended; avoid manual DOM manipulation inside scenes
- 2-space indentation, single quotes, no semicolons are fine as long as
  the rest of the file is consistent

---

## Adding a New Jutsu / Beatmap

Each jutsu is defined in two places:

1. **`public/assets/data/jutsus.json`** — name, element, description, beatmap reference
2. **`public/assets/data/beatmaps.json`** — the seal sequence (array of seal IDs)
3. **`src/data/jutsuPower.ts`** — power value (damage), rank, element color

Seal IDs available: `Inu`, `Ne`, `Uma`, `Tatsu`, `Hitsuji`, `Mi`, `Tora`,
`I`, `Saru`, `Tori`, `Ushi`, `U` (the 12 hand seals from Naruto lore).

Please open an issue with the jutsu's Naruto lore source and intended
seal sequence before implementing, so we can verify canon accuracy.

---

## Reporting Bugs

Use the [Bug Report template](https://github.com/bunkerapps/Jutsu-Hero/issues/new?template=bug_report.md).

Include:
- Browser and OS version
- Whether you are using a webcam
- Steps to reproduce
- Expected vs actual behavior
- Console errors (F12 → Console)

---

## Suggesting Features

Use the [Feature Request template](https://github.com/bunkerapps/Jutsu-Hero/issues/new?template=feature_request.md).

Features most likely to be accepted:
- New jutsus from Naruto canon with accurate seal sequences
- Gameplay improvements that don't require new copyrighted assets
- Accessibility improvements
- Performance improvements for mobile browsers
- Online mode improvements

---

## Important: IP and Assets Policy

This project uses copyrighted Naruto IP as a non-commercial fan tribute.
To keep the project legally low-risk:

- **Do not add** audio ripped from the anime or official games
- **Do not add** video clips from the anime
- **Do not add** artwork you don't have rights to distribute
- **Do** replace existing ripped assets with original/royalty-free alternatives
  if you find suitable ones (open an issue first to discuss)
- **Do** attribute every asset you add in CREDITS.md

When in doubt, ask in an issue before spending time on a PR that may not
be accepted due to asset licensing concerns.

---

## Questions?

Open a [Discussion](https://github.com/bunkerapps/Jutsu-Hero/discussions) or
file an issue. We're a fan community — there are no dumb questions.
