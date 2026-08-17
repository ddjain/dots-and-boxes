const BROKER_ID = "dots-and-boxes-lobby-v1";

const PeerCtor = globalThis.Peer;

export class Lobby {
  constructor({
    onRooms,
    onStatus,
    onError,
    heartbeatMs = 3000,
    staleMs = 9000,
    sweepMs = 2000,
    pingMs = 2000,
    deadBrokerMs = 6000,
    watchdogMs = 1000,
    openTimeoutMs = 5000,
    reconnectMs = 400,
    errorRetryMs = 1200,
    claimRetryMs = 3000,
  } = {}) {
    this.onRooms = onRooms;
    this.onStatus = onStatus;
    this.onError = onError;
    this.heartbeatMs = heartbeatMs;
    this.staleMs = staleMs;
    this.sweepMs = sweepMs;
    this.pingMs = pingMs;
    this.deadBrokerMs = deadBrokerMs;
    this.watchdogMs = watchdogMs;
    this.openTimeoutMs = openTimeoutMs;
    this.reconnectMs = reconnectMs;
    this.errorRetryMs = errorRetryMs;
    this.claimRetryMs = claimRetryMs;
    this.peer = null;
    this.conn = null;
    this.rooms = new Map();
    this.knownRooms = new Map();
    this.lastSeen = new Map();
    this.brokerConns = new Set();
    this.isBroker = false;
    this.myRoom = null;
    this.closed = false;
    this.retry = null;
    this.heartbeatTimer = null;
    this.sweepTimer = null;
    this.watchdogTimer = null;
    this.openTimer = null;
    this.lastDataTs = 0;
  }

  start() {
    this.closed = false;
    this.becomeBroker();
  }

  becomeBroker() {
    this.clear();
    if (this.closed) return;
    this.onStatus?.("connecting");
    const peer = new PeerCtor(BROKER_ID);
    this.peer = peer;
    peer.on("open", () => {
      if (this.closed || this.peer !== peer) return;
      this.isBroker = true;
      this.brokerConns.clear();
      this.rooms = new Map(this.knownRooms);
      this.knownRooms.clear();
      this.lastSeen.clear();
      const now = Date.now();
      for (const code of this.rooms.keys()) this.lastSeen.set(code, now);
      if (this.myRoom) {
        this.rooms.set(this.myRoom.code, this.myRoom);
        this.lastSeen.set(this.myRoom.code, now);
      }
      this.onStatus?.("hosting");
      this.startSweep();
      this.broadcastRooms();
    });
    peer.on("connection", (conn) => this.handleBrokerConn(conn));
    peer.on("error", (err) => {
      if (this.closed || this.peer !== peer) return;
      if (err.type === "unavailable-id") {
        this.isBroker = false;
        this.connectToBroker();
      } else {
        this.onError?.(err);
        this.onStatus?.("offline");
        this.retry = setTimeout(() => this.becomeBroker(), this.claimRetryMs);
      }
    });
  }

  connectToBroker() {
    if (this.closed) return;
    this.onStatus?.("connecting");
    const peer = new PeerCtor();
    this.peer = peer;
    peer.on("open", () => {
      if (this.closed || this.peer !== peer) return;
      const conn = peer.connect(BROKER_ID, { reliable: true });
      if (!conn) {
        this.onStatus?.("reconnecting");
        this.retry = setTimeout(() => this.becomeBroker(), this.errorRetryMs);
        return;
      }
      this.conn = conn;
      this.clearOpenTimer();
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        if (this.closed || this.conn !== conn || conn.open) return;
        this.onStatus?.("reconnecting");
        this.retry = setTimeout(() => this.becomeBroker(), this.reconnectMs);
      }, this.openTimeoutMs);
      conn.on("open", () => {
        if (this.closed || this.conn !== conn) return;
        this.clearOpenTimer();
        this.onStatus?.("connected");
        if (this.myRoom) conn.send({ t: "publish", room: this.myRoom });
        conn.send({ t: "list" });
        this.startHeartbeat();
        this.startWatchdog();
      });
      conn.on("data", (data) => {
        this.lastDataTs = Date.now();
        if (data?.t === "rooms") {
          this.knownRooms = new Map(data.rooms.map((r) => [r.code, r]));
          this.onRooms?.(data.rooms);
        }
      });
      conn.on("close", () => {
        if (this.closed || this.conn !== conn) return;
        this.clearOpenTimer();
        this.stopHeartbeat();
        this.stopWatchdog();
        this.onStatus?.("reconnecting");
        this.retry = setTimeout(() => this.becomeBroker(), this.reconnectMs);
      });
      conn.on("error", () => {
        if (this.closed || this.conn !== conn) return;
        this.clearOpenTimer();
        this.stopHeartbeat();
        this.stopWatchdog();
        this.retry = setTimeout(() => this.becomeBroker(), this.errorRetryMs);
      });
    });
    peer.on("error", () => {
      if (this.closed || this.peer !== peer) return;
      this.onStatus?.("reconnecting");
      this.retry = setTimeout(() => this.becomeBroker(), this.errorRetryMs);
    });
  }

  handleBrokerConn(conn) {
    this.brokerConns.add(conn);
    conn.on("data", (data) => {
      if (!data) return;
      if (data.t === "publish" && data.room?.code) {
        conn.roomCode = data.room.code;
        this.rooms.set(data.room.code, data.room);
        this.lastSeen.set(data.room.code, Date.now());
        this.broadcastRooms();
      } else if (
        data.t === "heartbeat" &&
        data.code &&
        conn.roomCode === data.code
      ) {
        this.lastSeen.set(data.code, Date.now());
      } else if (data.t === "unpublish" && data.code) {
        if (conn.roomCode === data.code) {
          this.rooms.delete(data.code);
          this.lastSeen.delete(data.code);
        }
        this.broadcastRooms();
      } else if (data.t === "list") {
        conn.send({ t: "rooms", rooms: [...this.rooms.values()] });
      }
    });
    conn.on("close", () => {
      this.brokerConns.delete(conn);
      if (this.closed) return;
      if (conn.roomCode && this.rooms.has(conn.roomCode)) {
        this.rooms.delete(conn.roomCode);
        this.lastSeen.delete(conn.roomCode);
        this.broadcastRooms();
      }
    });
  }

  broadcastRooms() {
    const rooms = [...this.rooms.values()];
    this.knownRooms = new Map(this.rooms);
    this.onRooms?.(rooms);
    for (const conn of this.brokerConns) {
      if (conn.open) conn.send({ t: "rooms", rooms });
    }
  }

  publish(room) {
    this.myRoom = room;
    if (this.isBroker) {
      this.rooms.set(room.code, room);
      this.lastSeen.set(room.code, Date.now());
      this.broadcastRooms();
    } else if (this.conn?.open) {
      this.conn.send({ t: "publish", room });
    }
  }

  unpublish() {
    const code = this.myRoom?.code;
    this.myRoom = null;
    if (!code) return;
    if (this.isBroker) {
      if (this.rooms.has(code)) {
        this.rooms.delete(code);
        this.lastSeen.delete(code);
        this.broadcastRooms();
      }
    } else if (this.conn?.open) {
      this.conn.send({ t: "unpublish", code });
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;
      if (this.myRoom && this.conn?.open) {
        this.conn.send({ t: "heartbeat", code: this.myRoom.code });
      }
    }, this.heartbeatMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  startWatchdog() {
    this.stopWatchdog();
    this.lastDataTs = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.closed || this.isBroker) return;
      if (!this.conn?.open) return;
      if (this.retry) return;
      if (Date.now() - this.lastDataTs > this.deadBrokerMs) {
        this.onStatus?.("reconnecting");
        this.retry = setTimeout(() => this.becomeBroker(), this.reconnectMs);
      }
    }, this.watchdogMs);
  }

  stopWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  clearOpenTimer() {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  startSweep() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    const sweep = () => {
      if (this.closed || !this.isBroker) return;
      if (this.myRoom) this.lastSeen.set(this.myRoom.code, Date.now());
      for (const conn of this.brokerConns) {
        if (conn.open) conn.send({ t: "ping" });
      }
      let removed = false;
      const now = Date.now();
      for (const code of this.rooms.keys()) {
        if (code === this.myRoom?.code) continue;
        const last = this.lastSeen.get(code) || 0;
        if (now - last > this.staleMs) {
          this.rooms.delete(code);
          this.lastSeen.delete(code);
          removed = true;
        }
      }
      if (removed) this.broadcastRooms();
    };
    sweep();
    this.sweepTimer = setInterval(sweep, this.sweepMs);
  }

  clear() {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    this.clearOpenTimer();
    this.stopHeartbeat();
    this.stopWatchdog();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.lastSeen.clear();
    const conn = this.conn;
    this.conn = null;
    try {
      conn?.close();
    } catch {}
    const peer = this.peer;
    this.peer = null;
    try {
      peer?.destroy();
    } catch {}
    this.isBroker = false;
    this.brokerConns.clear();
  }

  destroy() {
    this.closed = true;
    this.unpublish();
    this.clear();
  }
}