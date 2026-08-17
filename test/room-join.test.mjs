import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MockPeer, loadAsEsm } from "../test-utils/mock-peer.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.Peer = MockPeer;

const { RoomHost, RoomClient } = await loadAsEsm("js/network.js");

const all = [];

function setup() {
  MockPeer.byId = new Map();
  return [];
}

function makeHost(overrides = {}) {
  const log = [];
  let readyCode = null;
  const host = new RoomHost({
    onReady: (code) => {
      readyCode = code;
      log.push({ type: "ready", code });
    },
    onLobbyUpdate: (count, names) =>
      log.push({ type: "lobby", count, names }),
    onMove: () => {},
    onDisconnect: (index, name) => log.push({ type: "leave", index, name }),
    onError: (err) => log.push({ type: "error", err }),
    maxPlayers: 3,
    hostName: "Host",
    ...overrides,
  });
  all.push(host);
  return { host, log, readyCode: () => readyCode };
}

function makeClient(code, name = "Player") {
  const log = [];
  const client = new RoomClient({
    code,
    name,
    onStarted: (data) => log.push({ type: "start", data }),
    onMove: () => {},
    onNotice: (message) => log.push({ type: "notice", message }),
    onHostLeft: () => log.push({ type: "hostleft" }),
    onError: (err) => log.push({ type: "error", message: err.message }),
    onJoined: (you, players, max) =>
      log.push({ type: "joined", you, players, max }),
    onPlayers: (players, max) =>
      log.push({ type: "players", players, max }),
  });
  all.push(client);
  return { client, log };
}

after(() => {
  for (const x of all) x.destroy?.();
});

test("client joining a room immediately gets 'joined' with its index and the player list", async () => {
  const s = setup();
  const { host, readyCode } = makeHost();
  await delay(20);
  assert.ok(host.peer.open, "host peer is open");
  const code = readyCode();

  const c = makeClient(code, "Alice");
  await delay(30);

  const joined = c.log.find((e) => e.type === "joined");
  assert.ok(joined, "client received 'joined'");
  assert.equal(joined.you, 1, "index 1 (host is 0)");
  assert.deepEqual(joined.players, ["Host", "Alice"], "players includes host + joiner");
  assert.equal(joined.max, 3);
});

test("a second joiner updates the waiting list for the first client", async () => {
  const s = setup();
  const { host, readyCode } = makeHost();
  await delay(20);
  const code = readyCode();

  const c1 = makeClient(code, "Alice");
  await delay(20);
  const c2 = makeClient(code, "Bob");
  await delay(30);

  const firstPlayers = c1.log.find((e) => e.type === "joined");
  assert.deepEqual(firstPlayers.players, ["Host", "Alice"]);

  const update = c1.log.find(
    (e) => e.type === "players" && e.players.includes("Bob")
  );
  assert.ok(update, "first client saw the updated player list");
  assert.deepEqual(update.players, ["Host", "Alice", "Bob"]);
  assert.equal(update.max, 3);

  const secondJoined = c2.log.find((e) => e.type === "joined");
  assert.equal(secondJoined.you, 2, "second joiner is index 2");
});

test("host starting the game sends 'start' to every joined client", async () => {
  const s = setup();
  const { host, readyCode } = makeHost();
  await delay(20);
  const code = readyCode();

  const c1 = makeClient(code, "Alice");
  await delay(20);
  const c2 = makeClient(code, "Bob");
  await delay(20);

  const players = [
    { name: "Host" },
    { name: "Alice" },
    { name: "Bob" },
  ];
  host.start(players, 5);

  const s1 = c1.log.find((e) => e.type === "start");
  assert.ok(s1, "first client got 'start'");
  assert.equal(s1.data.you, 1);
  assert.deepEqual(s1.data.players, players);
  assert.equal(s1.data.size, 5);

  const s2 = c2.log.find((e) => e.type === "start");
  assert.ok(s2, "second client got 'start'");
  assert.equal(s2.data.you, 2);
});

test("a client leaving while waiting updates the remaining clients and sends a notice", async () => {
  const s = setup();
  const { host, readyCode } = makeHost();
  await delay(20);
  const code = readyCode();

  const c1 = makeClient(code, "Alice");
  await delay(20);
  const c2 = makeClient(code, "Bob");
  await delay(20);

  c1.client.destroy();
  await delay(20);

  const update = c2.log.find((e) => e.type === "players" && e.players.length === 2);
  assert.ok(update, "remaining client saw the shrunken list");
  assert.deepEqual(update.players, ["Host", "Bob"]);

  const notice = c2.log.find((e) => e.type === "notice");
  assert.ok(notice, "remaining client got a leave notice");
  assert.match(notice.message, /Alice/);
});

test("joining a room that already started is rejected with 'full'", async () => {
  const s = setup();
  const { host, readyCode } = makeHost();
  await delay(20);
  const code = readyCode();

  const c1 = makeClient(code, "Alice");
  await delay(20);
  host.start([{ name: "Host" }, { name: "Alice" }], 5);
  await delay(10);

  const c2 = makeClient(code, "Late");
  await delay(30);

  const err = c2.log.find((e) => e.type === "error");
  assert.ok(err, "late client got an error");
  assert.match(err.message, /already in a game/);
});
