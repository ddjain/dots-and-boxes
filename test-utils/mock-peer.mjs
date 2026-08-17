import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Copies a project module (.js) to a temp .mjs and imports it, so Node treats
// it as ESM the same way the browser does. Must be called after setting
// globalThis.Peer so the module captures the right constructor.
export async function loadAsEsm(relativePath) {
  const dir = await mkdtemp(join(tmpdir(), "db-test-"));
  const target = join(dir, "module.mjs");
  await copyFile(join(HERE, "..", relativePath), target);
  return await import(target);
}
export class MockConn {
  constructor(peer, open) {
    this.peer = peer;
    this.open = open;
    this.handlers = {};
    this.roomCode = null;
  }
  send(data) {
    if (!this.open) return;
    this.peer._dispatchData(this, data);
  }
  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }
  _emit(event, ...args) {
    for (const fn of this.handlers[event] || []) fn(...args);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this._emit("close");
  }
}

export class MockPeer {
  constructor(id) {
    this.id = id;
    this.destroyed = false;
    this.open = false;
    this.handlers = {};
    this._conns = [];
    if (id !== undefined) {
      if (MockPeer.byId.has(id)) {
        this.claimFailed = true;
        setTimeout(() => this._emit("error", { type: "unavailable-id" }), 0);
      } else {
        MockPeer.byId.set(id, this);
        setTimeout(() => {
          this.open = true;
          this._emit("open");
        }, 0);
      }
    } else {
      setTimeout(() => {
        this.open = true;
        this._emit("open");
      }, 0);
    }
  }
  connect(id, opts) {
    const target = MockPeer.byId.get(id);
    if (!target || target.destroyed) return null;
    const clientConn = new MockConn(this, true);
    const hostConn = new MockConn(target, true);
    clientConn.pair = hostConn;
    hostConn.pair = clientConn;
    this._conns.push(clientConn);
    target._conns.push(hostConn);
    if (target.silent) {
      // registered but unresponsive: the connection never opens
      clientConn.open = false;
      return clientConn;
    }
    setTimeout(() => target._emit("connection", hostConn), 0);
    setTimeout(() => {
      clientConn._emit("open");
      hostConn._emit("open");
    }, 5);
    return clientConn;
  }
  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }
  _emit(event, ...args) {
    for (const fn of this.handlers[event] || []) fn(...args);
  }
  _dispatchData(conn, data) {
    conn.pair?._emit("data", data);
    this._emit("data", data);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.id !== undefined) MockPeer.byId.delete(this.id);
    const conns = this._conns;
    this._conns = [];
    for (const c of conns) {
      c.close();
      c.pair?.close();
    }
  }
}
MockPeer.byId = new Map();
