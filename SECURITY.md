# Security Policy

## Scope

Jutsu Hero is a client-side browser game with an optional WebSocket server
for online multiplayer. The attack surface is limited, but the following
are in scope for security reports:

- WebSocket server (`server/`) — injection, DoS amplification, room spoofing
- Client-side XSS via game data (JSON beatmaps, player-controlled strings)
- Camera/microphone permission abuse
- Dependency vulnerabilities with a clear exploitation path in this project

Out of scope: general npm dependency audits with no clear exploit path,
scanner output without a proof-of-concept, and theoretical issues in
bundled third-party WASM binaries (report those upstream).

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately by email to: **diego@bunkerapps.net**

Include:
- Description of the vulnerability
- Steps to reproduce or proof-of-concept
- Potential impact

You will receive a response within **72 hours**. If confirmed, a fix will
be prioritized and you will be credited in the release notes unless you
prefer to remain anonymous.

## Supported Versions

Only the latest commit on `main` is actively maintained.
