# Dots & Boxes

A turn-based multiplayer strategy game built with vanilla HTML, CSS, and JavaScript. Draw lines, claim boxes, chain extra turns, and capture the most boxes to win.

## Play

▶️ **Play online:** https://ddjain.github.io/dots-and-boxes/

## How to Play

- The game starts with a grid of dots. Players take turns connecting two adjacent dots with a horizontal or vertical line (diagonals are not allowed).
- A line can only be drawn once.
- When a line completes all four sides of a square, that player **claims the box** and **gets another turn**.
- If no box is completed, the turn passes to the next player.
- The game ends when all possible lines have been drawn.
- The player with the most boxes wins.

## Features

- **Local play** — 2–4 players on one screen
- **Online multiplayer** — host a room and share a 6-digit code or a direct join link; up to 4 players take turns one-by-one
  - Create Room with grid size and player-count settings
  - Live lobby showing who has joined
  - Copy a share link like `https://host/?type=join&code=123456` for one-click joining
- **Room browser** — the Join tab lists all waiting rooms (name, grid, players, code) with one-click join; rooms appear/disappear automatically as hosts come and go
- **Self-healing lobby** — a room registry on a shared peer ID; if the hosting client leaves, another client takes over and rooms re-publish automatically
- **Live scoreboard** with the current player's turn highlighted
- **Sound effects** — move, error, win, and player-left sounds with a mute toggle
- **Player leave notifications** — everyone is notified when someone leaves the room
- Grid sizes from 4 × 4 up to 8 × 8

## Tech

- Vanilla HTML / CSS / JavaScript (ES modules)
- [PeerJS](https://peerjs.com) for WebRTC-based online rooms (host is authoritative and relays moves)
- Web Audio API for synthesized sound effects (no audio files)

## Project Structure

```
├── index.html          # UI shell, setup / lobby / results overlays
├── css/style.css       # Dark theme styling
└── js/
    ├── config.js       # Geometry + player color templates
    ├── board.js        # Grid state, edges, box-completion detection
    ├── game.js         # Turn rotation, extra-turn rule, win detection
    ├── renderer.js     # SVG board rendering and click handling
    ├── network.js      # PeerJS room host/client with move relaying
    ├── lobby.js        # Self-healing room registry (broker election)
    ├── sound.js        # Web Audio sound effects
    └── main.js         # App wiring, UI, toasts
```

## Run Locally

The app uses ES modules, so serve it over HTTP (not `file://`):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.