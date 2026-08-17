import { CONFIG } from "./config.js";
import { Board } from "./board.js";
import { Game } from "./game.js";
import { Renderer } from "./renderer.js";
import { RoomHost, RoomClient, describeError } from "./network.js";
import { Lobby } from "./lobby.js";
import * as sound from "./sound.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  gameLayout: $("#gameLayout"),
  setupOverlay: $("#setupOverlay"),
  resultOverlay: $("#resultOverlay"),
  board: $("#board"),
  scoreList: $("#scoreList"),
  turnChip: $("#turnChip"),
  statusText: $("#statusText"),
  newGameBtn: $("#newGameBtn"),
  toastContainer: $("#toastContainer"),
  soundToggle: $("#soundToggle"),
  resultTitle: $("#resultTitle"),
  resultDetails: $("#resultDetails"),
  playAgainBtn: $("#playAgainBtn"),
  resultCloseBtn: $("#resultCloseBtn"),

  tabs: [...document.querySelectorAll(".mode-tab")],
  panes: {
    local: $("#pane-local"),
    host: $("#pane-host"),
    join: $("#pane-join"),
  },

  gridSizeLocal: $("#gridSizeLocal"),
  playerCountLocal: $("#playerCountLocal"),
  playerNamesLocal: $("#playerNamesLocal"),
  startLocalBtn: $("#startLocalBtn"),

  gridSizeHost: $("#gridSizeHost"),
  playerCountHost: $("#playerCountHost"),
  hostName: $("#hostName"),
  createRoomBtn: $("#createRoomBtn"),
  hostStatus: $("#hostStatus"),
  hostYouName: $("#hostYouName"),
  roomCodeText: $("#roomCodeText"),
  copyLinkBtn: $("#copyLinkBtn"),
  qrCode: $("#qrCode"),
  waitingText: $("#waitingText"),
  lobbyList: $("#lobbyList"),
  cancelHostBtn: $("#cancelHostBtn"),

  joinCode: $("#joinCode"),
  joinName: $("#joinName"),
  joinRoomBtn: $("#joinRoomBtn"),
  joinStatus: $("#joinStatus"),
  cancelJoinBtn: $("#cancelJoinBtn"),
  lobbyStatus: $("#lobbyStatus"),
  roomList: $("#roomList"),
  joinWaitOverlay: $("#joinWaitOverlay"),
  joinWaitStatus: $("#joinWaitStatus"),
  joinWaitList: $("#joinWaitList"),
  leaveJoinBtn: $("#leaveJoinBtn"),
};

let renderer = null;
let game = null;
let mode = "local";
let myIndex = 0;
let host = null;
let client = null;
let lobby = null;
let joinedNames = [];

function buildPlayerInputs() {
  const count = Number(els.playerCountLocal.value);
  els.playerNamesLocal.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "player-name-row";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = CONFIG.playerTemplates[i].color;

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 14;
    input.placeholder = CONFIG.playerTemplates[i].name;
    input.dataset.index = i;

    row.appendChild(swatch);
    row.appendChild(input);
    els.playerNamesLocal.appendChild(row);
  }
}

function setMode(m) {
  mode = m;
  for (const tab of els.tabs) {
    tab.classList.toggle("active", tab.dataset.mode === m);
  }
  for (const key of Object.keys(els.panes)) {
    els.panes[key].hidden = key !== m;
  }
}

function teardownNetwork() {
  lobby?.unpublish();
  host?.destroy();
  host = null;
  client?.destroy();
  client = null;
  joinedNames = [];
  els.joinWaitOverlay.hidden = true;
  els.createRoomBtn.disabled = false;
  els.joinRoomBtn.disabled = false;
  els.hostStatus.hidden = true;
  els.joinStatus.hidden = true;
  els.cancelJoinBtn.hidden = true;
  els.waitingText.classList.remove("error");
  els.joinStatus.classList.remove("error");
}

function showSetup() {
  teardownNetwork();
  game = null;
  renderer = null;
  els.resultOverlay.hidden = true;
  els.gameLayout.hidden = true;
  els.setupOverlay.hidden = false;
  setMode("local");
}

function startGame(size, players, myIdx, netMode) {
  mode = netMode;
  myIndex = myIdx;
  game = new Game(new Board(size, size), players);
  renderer = new Renderer(els.board, game.board, players);
  renderer.onEdgeClick = onEdgeClick;
  els.setupOverlay.hidden = true;
  els.joinWaitOverlay.hidden = true;
  els.resultOverlay.hidden = true;
  els.gameLayout.hidden = false;
  updateUI();
}

function startLocalGame() {
  const size = Number(els.gridSizeLocal.value);
  const inputs = [...els.playerNamesLocal.querySelectorAll("input")];
  const players = inputs.map((input, i) => ({
    name: input.value.trim() || CONFIG.playerTemplates[i].name,
    color: CONFIG.playerTemplates[i].color,
    symbol: CONFIG.playerTemplates[i].symbol,
  }));
  startGame(size, players, 0, "local");
}

function onEdgeClick(r, c, dir) {
  if (!game || game.isOver) return;
  if (mode === "local") {
    applyMove(r, c, dir);
  } else if (mode === "host") {
    if (game.currentIndex !== 0) {
      sound.playError();
      return;
    }
    if (game.board.isDrawn(r, c, dir)) {
      sound.playError();
      return;
    }
    host.broadcastMove(r, c, dir);
    applyMove(r, c, dir);
  } else if (mode === "join") {
    if (game.currentIndex !== myIndex) {
      sound.playError();
      return;
    }
    if (game.board.isDrawn(r, c, dir)) {
      sound.playError();
      return;
    }
    client.sendMove(r, c, dir);
  }
}

function applyMove(r, c, dir) {
  if (!game || game.isOver) return;
  if (game.board.isDrawn(r, c, dir)) {
    sound.playError();
    return;
  }
  game.applyMove(r, c, dir);
  renderer.redraw();
  updateUI(game.lastMove);
  sound.playMove();
}

function handlePlayerLeft(index, name) {
  if (!game || index < 0 || index >= game.players.length) return;
  game.markPlayerLeft(index);
  renderer.redraw();
  updateUI();
  sound.playLeave();
  showToast(`${name} left. Their turns are skipped.`, "leave");
}

function renderScores() {
  const scores = game.scores();
  els.scoreList.innerHTML = "";
  game.players.forEach((player, i) => {
    const item = document.createElement("li");
    item.className =
      "score-item" + (player.active === false ? " score-item-offline" : "");
    item.style.borderColor =
      i === game.currentIndex && !game.isOver ? player.color : "transparent";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = player.color;

    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = player.name;
    if (mode !== "local" && i === myIndex) {
      const you = document.createElement("span");
      you.className = "score-you";
      you.textContent = " (you)";
      name.appendChild(you);
    }
    if (player.active === false) {
      const left = document.createElement("span");
      left.className = "score-left";
      left.textContent = " left";
      name.appendChild(left);
    }

    const value = document.createElement("span");
    value.className = "score-value";
    value.style.color = player.color;
    value.textContent = scores[i];

    item.appendChild(swatch);
    item.appendChild(name);
    item.appendChild(value);
    els.scoreList.appendChild(item);
  });
}

function updateUI(lastMove) {
  renderScores();

  const isYourTurn = mode === "local" || game.currentIndex === myIndex;
  renderer.setPlayerColor(isYourTurn ? game.currentIndex : null);

  if (game.isOver) {
    els.turnChip.textContent = "Game Over";
    els.turnChip.style.color = "var(--muted)";
    els.turnChip.style.borderColor = "var(--border)";
    els.statusText.textContent = "";
    showResults();
    return;
  }

  const player = game.currentPlayer;
  els.turnChip.textContent = player.name;
  els.turnChip.style.color = player.color;
  els.turnChip.style.borderColor = player.color;

  const boxWord = (n) => `${n} box${n === 1 ? "" : "es"}`;

  if (mode === "local") {
    if (lastMove?.gotExtraTurn) {
      els.statusText.textContent = `Nice! ${player.name} completed ${boxWord(
        lastMove.completed.length
      )} — extra turn!`;
    } else if (lastMove) {
      els.statusText.textContent = `${player.name}'s turn. Draw a line.`;
    } else {
      els.statusText.textContent = `${player.name} goes first. Draw a line.`;
    }
  } else if (isYourTurn) {
    if (lastMove?.gotExtraTurn) {
      els.statusText.textContent = `Nice! You completed ${boxWord(
        lastMove.completed.length
      )} — extra turn!`;
    } else {
      els.statusText.textContent = "Your turn — draw a line.";
    }
  } else {
    els.statusText.textContent = `Waiting for ${player.name}…`;
  }

  els.statusText.classList.remove("flash");
  void els.statusText.offsetWidth;
  els.statusText.classList.add("flash");
}

function showResults() {
  sound.playWin();
  const scores = game.scores();
  const sorted = game.players
    .map((player, i) => ({ player, score: scores[i] }))
    .sort((a, b) => b.score - a.score);

  const winners = game.winnerIndexes;
  if (winners.length === 1) {
    els.resultTitle.textContent = `🏆 ${game.players[winners[0]].name} wins!`;
  } else {
    const names = winners.map((i) => game.players[i].name).join(", ");
    els.resultTitle.textContent = `🏆 It's a tie between ${names}!`;
  }

  els.resultDetails.innerHTML = "";
  sorted.forEach(({ player, score }) => {
    const row = document.createElement("li");
    row.className = "result-row";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = player.color;

    const name = document.createElement("span");
    name.textContent = player.name;

    const scoreEl = document.createElement("span");
    scoreEl.className = "result-score";
    scoreEl.textContent = `${score} box${score === 1 ? "" : "es"}`;

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(scoreEl);
    els.resultDetails.appendChild(row);
  });

  els.resultOverlay.hidden = false;
}

function startHostRoom() {
  if (!window.Peer) {
    return showNetError(
      new Error("PeerJS failed to load. Check your connection and reload.")
    );
  }
  const size = Number(els.gridSizeHost.value);
  const playerCount = Number(els.playerCountHost.value);
  const hostNameValue = els.hostName.value.trim() || generateName();

  els.hostStatus.hidden = false;
  els.waitingText.classList.remove("error");
  els.waitingText.textContent = "Reserving room code…";
  els.lobbyList.innerHTML = "";
  els.createRoomBtn.disabled = true;

  host = new RoomHost({
    hostName: hostNameValue,
    maxPlayers: playerCount,
    onReady: (code) => {
      els.roomCodeText.textContent = code;
      els.hostYouName.textContent = hostNameValue;
      renderQr(buildJoinLink(code));
      els.waitingText.textContent = `Waiting for players (1/${playerCount})`;
      lobby?.publish({
        code,
        hostName: hostNameValue,
        size,
        players: 1,
        maxPlayers: playerCount,
      });
    },
    onLobbyUpdate: (count, names) => {
      joinedNames = names;
      els.lobbyList.innerHTML = "";
      names.forEach((name, i) => {
        const li = document.createElement("li");
        li.className = "lobby-item";
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = CONFIG.playerTemplates[i + 1].color;
        li.appendChild(swatch);
        li.appendChild(document.createTextNode(name));
        els.lobbyList.appendChild(li);
      });
      els.waitingText.textContent = `Waiting for players (${count + 1}/${playerCount})`;
      lobby?.publish({
        code: els.roomCodeText.textContent,
        hostName: hostNameValue,
        size,
        players: count + 1,
        maxPlayers: playerCount,
      });
      if (!game && count + 1 >= playerCount) {
        startHostGame(size, playerCount, hostNameValue);
      }
    },
    onMove: (senderIndex, r, c, dir) => {
      if (!game || game.currentIndex !== senderIndex) return;
      if (game.board.isDrawn(r, c, dir)) return;
      host.broadcastMove(r, c, dir);
      applyMove(r, c, dir);
    },
    onDisconnect: (index, name) => {
      if (mode === "host" && game) {
        handlePlayerLeft(index, name);
      } else {
        sound.playLeave();
        showToast(`${name} left the room.`, "leave");
      }
    },
    onError: (err) => showNetError(err),
  });
}

function startHostGame(size, playerCount, hostNameValue) {
  const players = [
    {
      name: hostNameValue,
      color: CONFIG.playerTemplates[0].color,
      symbol: CONFIG.playerTemplates[0].symbol,
    },
  ];
  for (let i = 0; i < joinedNames.length; i++) {
    players.push({
      name: joinedNames[i],
      color: CONFIG.playerTemplates[i + 1].color,
      symbol: CONFIG.playerTemplates[i + 1].symbol,
    });
  }
  host.start(players, size);
  lobby?.unpublish();
  startGame(size, players, 0, "host");
}

function showJoinWait(you, players, max) {
  myIndex = you;
  els.setupOverlay.hidden = true;
  els.joinWaitOverlay.hidden = false;
  renderJoinWait(players, max);
}

function renderJoinWait(players, max) {
  const list = Array.isArray(players) ? players : [];
  els.joinWaitList.innerHTML = "";
  list.forEach((name, i) => {
    const li = document.createElement("li");
    li.className = "wait-player";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background =
      CONFIG.playerTemplates[i % CONFIG.playerTemplates.length].color;
    li.appendChild(swatch);

    const label = document.createElement("span");
    label.textContent = name;
    li.appendChild(label);

    if (i === myIndex) {
      const you = document.createElement("em");
      you.className = "wait-you";
      you.textContent = "(you)";
      li.appendChild(you);
    }
    els.joinWaitList.appendChild(li);
  });
  const waiting = max - list.length;
  els.joinWaitStatus.textContent =
    waiting > 0
      ? `Waiting for ${waiting} more player${waiting === 1 ? "" : "s"}…`
      : "All players joined — starting…";
}

function joinRoom() {
  if (!window.Peer) {
    return showNetError(
      new Error("PeerJS failed to load. Check your connection and reload.")
    );
  }
  const code = els.joinCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    return showNetError(new Error("Enter the 6-digit room code."));
  }
  const name = els.joinName.value.trim() || generateName();

  els.joinRoomBtn.disabled = true;
  els.joinStatus.hidden = false;
  els.joinStatus.classList.remove("error");
  els.joinStatus.textContent = "Connecting…";
  els.cancelJoinBtn.hidden = false;

  client = new RoomClient({
    code,
    name,
    onStarted: (data) => {
      startGame(data.size, data.players, data.you, "join");
    },
    onJoined: (you, players, max) => showJoinWait(you, players, max),
    onPlayers: (players, max) => renderJoinWait(players, max),
    onMove: (r, c, dir) => applyMove(r, c, dir),
    onPlayerLeft: (index, name) => handlePlayerLeft(index, name),
    onNotice: (message) => {
      sound.playLeave();
      showToast(message, "leave");
    },
    onHostLeft: () => {
      sound.playLeave();
      showToast("The host left the room. Game ended.", "leave");
      setTimeout(showSetup, 2500);
    },
    onError: (err) => showNetError(err),
  });
}

function showNetError(err) {
  const message = describeError(err);
  if (!els.joinWaitOverlay.hidden) {
    showToast(message, "leave");
    setTimeout(showSetup, 1500);
    return;
  }
  if (mode === "host") {
    els.waitingText.textContent = message;
    els.waitingText.classList.add("error");
    els.createRoomBtn.disabled = false;
  } else if (mode === "join") {
    els.joinStatus.textContent = message;
    els.joinStatus.classList.add("error");
    els.joinRoomBtn.disabled = false;
  }
}

const LOBBY_STATUS_TEXT = {
  connecting: "Connecting to lobby…",
  hosting: "Hosting the lobby",
  connected: "Lobby connected",
  reconnecting: "Lobby reconnecting…",
  offline: "Lobby unavailable",
};

function setLobbyStatus(status) {
  els.lobbyStatus.textContent = LOBBY_STATUS_TEXT[status] || "";
  els.lobbyStatus.className = `lobby-status ${status || ""}`;
}

function renderRoomList(rooms) {
  els.roomList.innerHTML = "";
  const list = Array.isArray(rooms) ? rooms : [];
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "room-list-empty";
    empty.textContent = "No rooms available right now. Create one to get started.";
    els.roomList.appendChild(empty);
    return;
  }
  for (const room of list) {
    const item = document.createElement("div");
    item.className = "room-item";

    const info = document.createElement("div");
    info.className = "room-info";
    const name = document.createElement("div");
    name.className = "room-name";
    name.textContent = room.hostName || "Host";
    const meta = document.createElement("div");
    meta.className = "room-meta";
    meta.textContent = `#${room.code} · ${room.size} × ${room.size} · ${room.players}/${room.maxPlayers}`;
    info.appendChild(name);
    info.appendChild(meta);

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn-join";
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => {
      els.joinCode.value = room.code;
      joinRoom();
    });

    item.appendChild(info);
    item.appendChild(joinBtn);
    els.roomList.appendChild(item);
  }
}

function initLobby() {
  if (!window.Peer) return;
  lobby = new Lobby({
    onRooms: renderRoomList,
    onStatus: setLobbyStatus,
    onError: () => {},
  });
  lobby.start();
}

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 350);
  }, 4200);
}

function buildJoinLink(code) {
  let base = window.location.href.split("#")[0].split("?")[0].replace(/\/+$/, "");
  if (base.endsWith("/index.html")) base = base.slice(0, -"index.html".length);
  return `${base}?type=join&code=${code}`;
}

const NAME_ADJECTIVES = [
  "dark", "bright", "silent", "wild", "frozen", "golden", "shadow",
  "mighty", "swift", "hidden", "crimson", "mystic", "lonely", "brave",
  "cosmic", "electric", "ancient", "stormy", "clever", "phantom",
];

const NAME_NOUNS = [
  "forest", "wolf", "tiger", "dragon", "falcon", "shadow", "hunter",
  "warrior", "eagle", "fox", "bear", "lion", "snake", "raven",
  "phoenix", "storm", "knight", "ghost", "panther", "viper",
];

function generateName() {
  const adjective = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${adjective}_${noun}`;
}

function renderQr(text) {
  if (typeof qrcode !== "function") return;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  els.qrCode.src = qr.createDataURL(10, 4);
  els.qrCode.hidden = false;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {}
  document.body.removeChild(textarea);
  return true;
}

async function copyShareLink() {
  const code = els.roomCodeText.textContent.trim();
  if (!/^\d{6}$/.test(code)) return;
  await copyToClipboard(buildJoinLink(code));
  const button = els.copyLinkBtn;
  const original = button.textContent;
  button.textContent = "✓ Copied!";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copied");
  }, 2000);
}

function parseRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const hashMatch = window.location.hash.match(/join\/(\d{6})/);
  const pathMatch = window.location.pathname.match(/\/join\/(\d{6})\/?$/);
  const code =
    (params.get("code") || "").match(/\d{6}/)?.[0] ||
    (hashMatch && hashMatch[1]) ||
    (pathMatch && pathMatch[1]);
  if (code) {
    els.joinCode.value = code;
    setMode("join");
    els.joinName.focus();
  }
}

// Events
for (const tab of els.tabs) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
}
els.playerCountLocal.addEventListener("change", buildPlayerInputs);
els.startLocalBtn.addEventListener("click", startLocalGame);

els.createRoomBtn.addEventListener("click", startHostRoom);
els.copyLinkBtn.addEventListener("click", copyShareLink);
els.cancelHostBtn.addEventListener("click", () => {
  lobby?.unpublish();
  host?.destroy();
  host = null;
  joinedNames = [];
  els.hostStatus.hidden = true;
  els.createRoomBtn.disabled = false;
});

els.joinRoomBtn.addEventListener("click", joinRoom);
els.leaveJoinBtn.addEventListener("click", () => {
  client?.destroy();
  client = null;
  showSetup();
});
els.cancelJoinBtn.addEventListener("click", () => {
  client?.destroy();
  client = null;
  els.joinStatus.hidden = true;
  els.joinRoomBtn.disabled = false;
  els.cancelJoinBtn.hidden = true;
});

els.joinCode.addEventListener("input", () => {
  els.joinCode.value = els.joinCode.value.replace(/\D/g, "").slice(0, 6);
});

for (const el of [els.joinCode, els.joinName]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });
}

els.newGameBtn.addEventListener("click", showSetup);
els.playAgainBtn.addEventListener("click", showSetup);
els.resultCloseBtn.addEventListener("click", () => {
  els.resultOverlay.hidden = true;
});

els.soundToggle.addEventListener("click", () => {
  const muted = !sound.isMuted();
  sound.setMuted(muted);
  els.soundToggle.textContent = muted ? "🔇" : "🔊";
  els.soundToggle.classList.toggle("muted", muted);
});

buildPlayerInputs();
parseRoomFromUrl();
initLobby();