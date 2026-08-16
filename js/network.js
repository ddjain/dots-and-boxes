const PeerCtor = globalThis.Peer;

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class RoomHost {
  constructor({ onReady, onLobbyUpdate, onMove, onDisconnect, onError }) {
    this.onReady = onReady;
    this.onLobbyUpdate = onLobbyUpdate;
    this.onMove = onMove;
    this.onDisconnect = onDisconnect;
    this.onError = onError;
    this.conns = new Map();
    this.names = new Map();
    this.attempts = 0;
    this.closed = false;
    this.started = false;
    this.code = generateRoomCode();
    this.open();
  }

  open() {
    if (this.closed) return;
    this.attempts += 1;
    if (this.attempts > 6) {
      this.onError?.(new Error("Could not reserve a room code. Please try again."));
      return;
    }
    this.code = generateRoomCode();
    const peer = new PeerCtor(this.code);
    this.peer = peer;

    peer.on("open", () => this.onReady(this.code));
    peer.on("connection", (conn) => this.setupConnection(conn));
    peer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        try {
          peer.destroy();
        } catch {}
        this.open();
      } else {
        this.onError?.(err);
      }
    });
  }

  setupConnection(conn) {
    conn.on("open", () => {
      if (this.started) {
        conn.send({ t: "full" });
        setTimeout(() => conn.close(), 200);
        return;
      }
      conn.send({ t: "welcome", you: this.conns.size + 1 });
    });
    conn.on("data", (data) => {
      if (!data || typeof data.t !== "string") return;
      if (data.t === "join") {
        const index = this.conns.size + 1;
        this.conns.set(index, conn);
        this.names.set(index, (data.name || `Player ${index + 1}`).slice(0, 14));
        this.onLobbyUpdate(this.conns.size, [...this.names.values()]);
      } else if (data.t === "move") {
        const index = this.indexOf(conn);
        if (index !== -1) this.onMove(index, data.r, data.c, data.dir);
      }
    });
    conn.on("close", () => {
      const index = this.indexOf(conn);
      if (index !== -1) {
        const name = this.names.get(index);
        this.conns.delete(index);
        this.names.delete(index);
        this.onLobbyUpdate(this.conns.size, [...this.names.values()]);
        if (this.conns.size > 0) {
          this.broadcast({ t: "notice", message: `${name} left the room.` });
        }
        this.onDisconnect?.(index, name);
      }
    });
    conn.on("error", (err) => this.onError?.(err));
  }

  indexOf(conn) {
    for (const [index, c] of this.conns) {
      if (c === conn) return index;
    }
    return -1;
  }

  start(players, size) {
    this.started = true;
    for (const [index, conn] of this.conns) {
      conn.send({ t: "start", you: index, players, size });
    }
  }

  broadcast(msg) {
    for (const conn of this.conns.values()) {
      conn.send(msg);
    }
  }

  broadcastMove(r, c, dir) {
    this.broadcast({ t: "move", r, c, dir });
  }

  destroy() {
    this.closed = true;
    try {
      for (const conn of this.conns.values()) conn.close();
    } catch {}
    try {
      this.peer?.destroy();
    } catch {}
    this.conns.clear();
    this.names.clear();
  }
}

export class RoomClient {
  constructor({ code, name, onStarted, onMove, onNotice, onHostLeft, onError }) {
    this.code = code;
    this.name = name;
    this.onStarted = onStarted;
    this.onMove = onMove;
    this.onNotice = onNotice;
    this.onHostLeft = onHostLeft;
    this.onError = onError;
    this.closed = false;
    this.conn = null;
    this.peer = new PeerCtor();
    this.peer.on("open", () => this.connect());
    this.peer.on("error", (err) => {
      if (!this.closed) this.onError?.(err);
    });
  }

  connect() {
    if (this.closed) return;
    const conn = this.peer.connect(this.code, { reliable: true });
    this.conn = conn;
    conn.on("open", () => {
      conn.send({ t: "join", name: this.name });
    });
    conn.on("data", (data) => {
      if (!data) return;
      if (data.t === "start") this.onStarted(data);
      else if (data.t === "move") this.onMove(data.r, data.c, data.dir);
      else if (data.t === "notice") this.onNotice?.(data.message);
      else if (data.t === "full") {
        if (!this.closed) this.onError?.(new Error("Room is already in a game."));
      }
    });
    conn.on("close", () => {
      if (!this.closed) this.onHostLeft?.();
    });
  }

  sendMove(r, c, dir) {
    if (this.conn?.open) {
      this.conn.send({ t: "move", r, c, dir });
    }
  }

  destroy() {
    this.closed = true;
    try {
      this.conn?.close();
    } catch {}
    try {
      this.peer?.destroy();
    } catch {}
    this.conn = null;
  }
}

export function describeError(err) {
  const type = err?.type || err?.name;
  const map = {
    "peer-unavailable": "Room not found. Check the code and try again.",
    "network": "Network error. Check your internet connection.",
    "server-error": "Peer server error. Please try again.",
    "socket-error": "Connection error. Please try again.",
    "socket-closed": "Connection closed.",
    "webrtc": "Connection could not be established.",
    "browser-incompatible": "Your browser does not support WebRTC.",
  };
  return map[type] || err?.message || String(type || err);
}