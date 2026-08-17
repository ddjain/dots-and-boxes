const BROKER_ID = "dots-and-boxes-lobby-v1";

const PeerCtor = globalThis.Peer;

export class Lobby {
  constructor({ onRooms, onStatus, onError } = {}) {
    this.onRooms = onRooms;
    this.onStatus = onStatus;
    this.onError = onError;
    this.peer = null;
    this.conn = null;
    this.rooms = new Map();
    this.knownRooms = new Map();
    this.confTimers = new Map();
    this.brokerConns = new Set();
    this.isBroker = false;
    this.myRoom = null;
    this.closed = false;
    this.retry = null;
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
      if (this.closed) return;
      this.isBroker = true;
      this.brokerConns.clear();
      this.rooms = new Map(this.knownRooms);
      this.knownRooms.clear();
      if (this.myRoom) this.rooms.set(this.myRoom.code, this.myRoom);
      this.onStatus?.("hosting");
      this.armCleanup();
      this.broadcastRooms();
    });
    peer.on("connection", (conn) => this.handleBrokerConn(conn));
    peer.on("error", (err) => {
      if (this.closed) return;
      if (err.type === "unavailable-id") {
        this.isBroker = false;
        this.connectToBroker();
      } else {
        this.onError?.(err);
        this.onStatus?.("offline");
        this.retry = setTimeout(() => this.becomeBroker(), 3000);
      }
    });
  }

  connectToBroker() {
    if (this.closed) return;
    this.onStatus?.("connecting");
    const peer = new PeerCtor();
    this.peer = peer;
    peer.on("open", () => {
      const conn = peer.connect(BROKER_ID, { reliable: true });
      this.conn = conn;
      conn.on("open", () => {
        if (this.closed) return;
        this.onStatus?.("connected");
        if (this.myRoom) conn.send({ t: "publish", room: this.myRoom });
        conn.send({ t: "list" });
      });
      conn.on("data", (data) => {
        if (data?.t === "rooms") {
          this.knownRooms = new Map(data.rooms.map((r) => [r.code, r]));
          this.onRooms?.(data.rooms);
        }
      });
      conn.on("close", () => {
        if (this.closed) return;
        this.onStatus?.("reconnecting");
        this.retry = setTimeout(() => this.becomeBroker(), 400);
      });
      conn.on("error", () => {
        if (this.closed) return;
        this.retry = setTimeout(() => this.becomeBroker(), 1200);
      });
    });
    peer.on("error", () => {
      if (this.closed) return;
      this.onStatus?.("reconnecting");
      this.retry = setTimeout(() => this.becomeBroker(), 1200);
    });
  }

  handleBrokerConn(conn) {
    this.brokerConns.add(conn);
    conn.on("data", (data) => {
      if (!data) return;
      if (data.t === "publish" && data.room?.code) {
        conn.roomCode = data.room.code;
        this.rooms.set(data.room.code, data.room);
        this.confirmRoom(data.room.code);
        this.broadcastRooms();
      } else if (data.t === "unpublish" && data.code) {
        if (conn.roomCode === data.code) this.rooms.delete(data.code);
        this.broadcastRooms();
      } else if (data.t === "list") {
        conn.send({ t: "rooms", rooms: [...this.rooms.values()] });
      }
    });
    conn.on("close", () => {
      this.brokerConns.delete(conn);
      if (conn.roomCode && this.rooms.has(conn.roomCode)) {
        this.rooms.delete(conn.roomCode);
        this.broadcastRooms();
      }
    });
  }

  broadcastRooms() {
    const rooms = [...this.rooms.values()];
    this.knownRooms = new Map(this.rooms);
    this.onRooms?.(rooms);
    for (const conn of this.brokerConns) {
      conn.send({ t: "rooms", rooms });
    }
  }

  confirmRoom(code) {
    const t = this.confTimers.get(code);
    if (t) {
      clearTimeout(t);
      this.confTimers.delete(code);
    }
  }

  armCleanup() {
    for (const t of this.confTimers.values()) clearTimeout(t);
    this.confTimers.clear();
    for (const code of this.rooms.keys()) {
      if (code === this.myRoom?.code) continue;
      const t = setTimeout(() => {
        this.confTimers.delete(code);
        if (this.rooms.delete(code)) this.broadcastRooms();
      }, 20000);
      this.confTimers.set(code, t);
    }
  }

  publish(room) {
    this.myRoom = room;
    if (this.isBroker) {
      this.rooms.set(room.code, room);
      this.confirmRoom(room.code);
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
        this.broadcastRooms();
      }
    } else if (this.conn?.open) {
      this.conn.send({ t: "unpublish", code });
    }
  }

  clear() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    try {
      this.conn?.close();
    } catch {}
    this.conn = null;
    try {
      this.peer?.destroy();
    } catch {}
    this.peer = null;
    this.isBroker = false;
    this.brokerConns.clear();
    for (const t of this.confTimers.values()) clearTimeout(t);
    this.confTimers.clear();
  }

  destroy() {
    this.closed = true;
    this.unpublish();
    this.clear();
  }
}