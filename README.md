# SnakesWeb — Snakes & Ladders

An interactive, multiplayer Snakes & Ladders browser game built with **React 19**, **TypeScript**, **Vite**, and **Cloudflare Workers + Durable Objects (SQLite)**.

## Features

- **3 Play Modes**:
  - **Online Multiplayer** (up to 6 players + bots, instant 4-character room codes, live Open Lobbies browser, optional password protection, seamless reconnect & 30s grace period).
  - **Solo vs Bots** (instant local game against automated opponents).
  - **Pass & Play (Couch)** (up to 6 local players/bots on one screen).
- **3 Board Presets**: Classic, Serpent's Den (high-volatility portals including `99 -> 12`), and Shuffled (deterministic seeded layout).
- **House Rules**: Exact 100 finish bounce, extra roll on 6, triple-6 bust penalty, pawn bumping, and configurable turn timers (`0 | 10 | 15 | 30s`).
- **Tactile 3D Dice Physics**: Pure TypeScript rigid-body 3D simulation with 24-element cube rotation group remapping so every physical tumble lands cleanly on the authoritative rolled face.
- **Procedural Audio**: Zero external audio files — Web Audio API sound effects and warm marimba/kalimba background loops.

## Development

```bash
npm install
npm run dev
```

## Verification & Build

```bash
npm run typecheck
npm test
npm run build
```

## Deployment (Cloudflare Workers)

```bash
npm run deploy
```
