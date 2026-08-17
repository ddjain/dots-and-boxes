import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MockPeer, loadAsEsm } from "../test-utils/mock-peer.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.Peer = MockPeer;

// Load the real lobby module (as ESM) with the mock installed.
const { Lobby } = await loadAsEsm("js/lobby.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const allLobbies = [];

function setup() {
  MockPeer.byId = new Map();
  const store = { lobbies: [], events: [] };
  allLobbies.push(...store.lobbies);
  return store;
}

function makeLobby(name, store, overrides = {}) {
  const l = new Lobby({
    onRooms: (rooms) =>
      store.events.push({ who: name, type: "rooms", rooms }),
    onStatus: (status) =>
      store.events.push({ who: name, type: "status", status }),
    onError: () => {},
    // fast timings so the sweep/heartbeat/watchdog logic runs quickly
    heartbeatMs: 50,
    staleMs: 250,
    sweepMs: 50,
    pingMs: 50,
    deadBrokerMs: 200,
    watchdogMs: 50,
    openTimeoutMs: 200,
    reconnectMs: 40,
    errorRetryMs: 60,
    claimRetryMs: 100,
    ...overrides,
  });
  store.lobbies.push(l);
  allLobbies.push(l);
  return l;
}

const room = (code, hostName = "H", players = 1) => ({
  code,
  hostName,
  size: 5,
  players,
  maxPlayers: 2,
});

const roomSeen = (l, code) => l.knownRooms.has(code);
const sawRooms = (events, who, code) =>
  events.some(
    (e) =>
      e.who === who &&
      e.type === "rooms" &&
      e.rooms.some((r) => r.code === code)
  );

after(() => {
  for (const l of allLobbies) l.destroy();
});

// ---------------------------------------------------------------------------
// Election
// ---------------------------------------------------------------------------
test("first client becomes broker", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  assert.equal(A.isBroker, true);
  assert.ok(
    s.events.some((e) => e.who === "A" && e.status === "hosting"),
    "broker reports 'hosting' status"
  );
  assert.equal(A.rooms.size, 0, "broker starts with an empty registry");
});

test("exactly one broker among several clients; the rest connect", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  const brokers = [A, B, C].filter((l) => l.isBroker);
  assert.equal(brokers.length, 1, "exactly one broker");
  for (const l of [A, B, C]) {
    assert.ok(
      l.isBroker || (l.conn && l.conn.open),
      "every client is connected or hosting"
    );
  }
});

// ---------------------------------------------------------------------------
// Publishing / listing
// ---------------------------------------------------------------------------
test("a published room is visible to the broker and every client", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  const r1 = room("111111", "Bob");
  B.publish(r1);
  await delay(25);

  assert.ok(A.rooms.has("111111"), "broker holds the room");
  for (const l of [A, B, C]) {
    assert.ok(roomSeen(l, "111111"), "client sees the room");
  }
  for (const who of ["A", "B", "C"]) {
    assert.ok(sawRooms(s.events, who, "111111"), `${who} received the room list`);
  }
});

test("multiple rooms are listed with full metadata", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  const r1 = room("111111", "Bob");
  const r2 = room("222222", "Carol", 2);
  B.publish(r1);
  await delay(15);
  C.publish(r2);
  await delay(15);

  assert.equal(A.rooms.size, 2, "broker lists both rooms");
  assert.deepEqual(A.rooms.get("111111"), r1, "room metadata preserved");
  assert.deepEqual(A.rooms.get("222222"), r2, "second room metadata preserved");
  for (const l of [A, B, C]) {
    assert.ok(roomSeen(l, "111111") && roomSeen(l, "222222"));
  }
});

test("a fresh session joining an existing lobby sees rooms (not empty)", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  B.publish(room("111111", "Bob"));
  await delay(20);

  const D = makeLobby("D", s);
  D.start();
  await delay(30);

  assert.equal(D.isBroker, false, "fresh session joins the existing broker");
  assert.ok(roomSeen(D, "111111"), "fresh session sees the available room");
});

test("a player-count update propagates to everyone", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  B.publish(room("111111", "Bob"));
  await delay(15);
  B.publish(room("111111", "Bob", 2));
  await delay(15);

  for (const l of [A, B, C]) {
    assert.equal(l.knownRooms.get("111111").players, 2, "updated count seen");
  }
});

test("a fresh session sees an empty list when no rooms exist", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  const G = makeLobby("G", s);
  G.start();
  await delay(30);

  assert.equal(G.knownRooms.size, 0, "no rooms -> empty list");
});

// ---------------------------------------------------------------------------
// Takeover after the broker dies
// ---------------------------------------------------------------------------
async function startWithRooms(s) {
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);
  B.publish(room("111111", "Bob"));
  await delay(15);
  C.publish(room("222222", "Carol"));
  await delay(15);
  return { A, B, C };
}

test("broker death -> exactly one new broker", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);

  const nb = [B, C].filter((l) => l.isBroker);
  assert.equal(nb.length, 1, "exactly one new broker after takeover");
});

test("new broker rebuilds the old room list from its snapshot", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);

  const nb = [B, C].find((l) => l.isBroker);
  assert.ok(nb, "a new broker exists");
  assert.ok(
    nb.rooms.has("111111") && nb.rooms.has("222222"),
    "old rooms are immediately joinable again"
  );
});

test("a fresh session after takeover sees the rebuilt rooms", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);

  const E = makeLobby("E", s);
  E.start();
  await delay(30);
  assert.ok(
    roomSeen(E, "111111") && roomSeen(E, "222222"),
    "fresh session is not empty after takeover"
  );
});

test("live hosts' rooms persist across takeover (heartbeat keeps them)", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);

  const nb = [B, C].find((l) => l.isBroker);
  await delay(400); // several sweep cycles

  assert.ok(
    nb.rooms.has("111111") && nb.rooms.has("222222"),
    "live rooms survive the sweep"
  );
});

test("a new room published after takeover appears for everyone", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);

  const nb = [B, C].find((l) => l.isBroker);
  B.publish(room("444444", "Dave"));
  await delay(25);

  assert.ok(nb.rooms.has("444444"), "broker accepts post-takeover publish");
  for (const l of [B, C]) assert.ok(roomSeen(l, "444444"));
});

test("a second broker death still heals (chain takeover)", async () => {
  const s = setup();
  const { A, B, C } = await startWithRooms(s);
  A.destroy();
  await delay(250);
  const nb1 = [B, C].find((l) => l.isBroker);
  const survivor = nb1 === B ? C : B;
  const survivorRoom = survivor === B ? "111111" : "222222";
  const deadRoom = survivor === B ? "222222" : "111111";

  nb1.destroy();
  await delay(250);

  assert.equal(survivor.isBroker, true, "survivor takes over");
  assert.ok(survivor.rooms.has(survivorRoom), "survivor's own room is listed");
  assert.ok(!survivor.rooms.has(deadRoom), "departed broker's room is gone");
});

// ---------------------------------------------------------------------------
// Host leaves / cleanup
// ---------------------------------------------------------------------------
test("host leaving gracefully removes its room everywhere", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  const F = makeLobby("F", s);
  F.start();
  await delay(30);
  assert.equal(F.isBroker, false, "F is a lobby client");
  F.publish(room("333333", "Frank"));
  await delay(20);
  assert.ok(A.rooms.has("333333"));

  F.destroy(); // graceful leave (unpublish + disconnect)
  await delay(25);

  assert.ok(!A.rooms.has("333333"), "broker no longer lists the room");
  for (const l of [B, C]) {
    assert.ok(!roomSeen(l, "333333"), "clients no longer see the room");
  }
});

test("host crashing (tab closed) as a client is removed via conn close", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  const F = makeLobby("F", s);
  F.start();
  await delay(30);
  F.publish(room("333333", "Frank"));
  await delay(20);
  assert.ok(A.rooms.has("333333"));

  F.closed = true;
  F.clear(); // simulate a crash: no unpublish, connection just drops
  await delay(25);

  assert.ok(!A.rooms.has("333333"), "broker drops the room on conn close");
  assert.ok(!roomSeen(B, "333333"), "other clients get the update");
});

test("the room of a host that died as the broker is swept away", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  A.publish(room("999999", "Ann"));
  await delay(15);

  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  A.closed = true;
  A.clear(); // broker host crashes (no unpublish)
  await delay(250); // takeover completes

  const nb = [B, C].find((l) => l.isBroker);
  assert.ok(nb, "a new broker exists");
  assert.ok(
    nb.rooms.has("999999"),
    "rebuilt from snapshot right after takeover"
  );

  await delay(350); // > staleMs + sweep period
  assert.ok(
    !nb.rooms.has("999999"),
    "stale room is swept once its host never heartbeats"
  );
});

test("broker's own room is never swept while it stays broker", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  A.publish(room("555555", "Ann"));
  await delay(20);

  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  assert.ok(A.rooms.has("555555"));
  assert.ok(roomSeen(B, "555555"), "clients see the broker's own room");
  await delay(400); // many sweep cycles
  assert.ok(A.rooms.has("555555"), "own room survives sweeps");
  assert.ok(roomSeen(B, "555555"), "still visible to clients after sweeps");
});

test("explicit unpublish removes the room everywhere", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);

  C.publish(room("222222", "Carol"));
  await delay(15);
  assert.ok(A.rooms.has("222222"));

  C.unpublish();
  await delay(25);

  assert.ok(!A.rooms.has("222222"), "broker drops the room");
  for (const l of [A, B, C]) {
    assert.ok(!roomSeen(l, "222222"), "no client sees the room");
  }
});

test("host going offline (blip) removes its room, then it reappears on return", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  const F = makeLobby("F", s);
  F.start();
  await delay(30);
  F.publish(room("333333", "Frank"));
  await delay(20);
  assert.ok(A.rooms.has("333333"));

  // network blip: F's lobby connection drops and stays down for a moment
  F.conn.close();
  F.closed = true;
  F.clear();
  await delay(25);
  assert.ok(!A.rooms.has("333333"), "room is gone while host is offline");
  assert.ok(!roomSeen(B, "333333"));

  // network returns: F rejoins the lobby and re-publishes its room
  F.closed = false;
  F.start();
  await delay(150);
  assert.ok(A.rooms.has("333333"), "room reappears after the host rejoins");
  assert.ok(roomSeen(B, "333333"), "other clients see it again");
});

test("host switching rooms lists only the new room", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  const F = makeLobby("F", s);
  F.start();
  await delay(30);
  F.publish(room("111111", "Frank"));
  await delay(15);
  F.unpublish();
  await delay(15);
  F.publish(room("222222", "Frank"));
  await delay(20);

  assert.ok(!A.rooms.has("111111"), "old room removed");
  assert.ok(A.rooms.has("222222"), "new room listed");
  assert.ok(roomSeen(B, "222222"), "clients see the new room");
  assert.ok(!roomSeen(B, "111111"), "clients no longer see the old room");
});

test("a non-hosting viewer reconnecting does not disturb the rooms", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  B.publish(room("111111", "Bob"));
  await delay(15);

  const V = makeLobby("V", s);
  V.start();
  await delay(30);
  assert.ok(roomSeen(V, "111111"));

  V.conn.close(); // viewer's lobby connection drops; it will retry
  await delay(150);

  assert.ok(A.rooms.has("111111"), "rooms unaffected by viewer churn");
  assert.ok(roomSeen(V, "111111"), "viewer sees rooms again after reconnect");
});

// ---------------------------------------------------------------------------
// Broker death without a clean connection close (real-PeerJS failure modes)
// ---------------------------------------------------------------------------
test("a new leader is elected via the watchdog when the broker dies silently", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);
  const C = makeLobby("C", s);
  C.start();
  await delay(25);
  B.publish(room("111111", "Bob"));
  await delay(20);
  assert.ok(A.rooms.has("111111"));

  // Broker dies silently: its ID is freed and it stops pinging, but the
  // clients' DataConnections are never closed and never error (PeerJS can
  // leave them hanging when the remote page is killed abruptly).
  const brokerPeer = A.peer;
  MockPeer.byId.delete(brokerPeer.id);
  A.closed = true;
  A.isBroker = false;
  clearInterval(A.sweepTimer);
  A.sweepTimer = null;

  await delay(700); // watchdog detects the silence, election runs, rooms rebuild

  const leaders = [B, C].filter((l) => l.isBroker);
  assert.equal(leaders.length, 1, "a new leader is elected");
  assert.ok(leaders[0].rooms.has("111111"), "new leader rebuilds the room list");

  const D = makeLobby("D", s);
  D.start();
  await delay(40);
  assert.ok(roomSeen(D, "111111"), "a fresh session sees the rebuilt rooms");
});

test("client keeps retrying the election while the old broker ID is stale", async () => {
  const s = setup();
  const A = makeLobby("A", s);
  A.start();
  await delay(25);
  const B = makeLobby("B", s);
  B.start();
  await delay(25);

  // A dies but its ID stays registered and unresponsive on the server, so
  // B's claims get "unavailable-id" and connects to the ghost never open.
  A.closed = true;
  A.isBroker = false;
  clearInterval(A.sweepTimer);
  A.sweepTimer = null;
  const ghost = A.peer;
  ghost.silent = true;

  await delay(1200); // several watchdog + claim + open-timeout cycles

  assert.equal(B.closed, false, "B never gave up");
  assert.equal(B.isBroker, false, "B cannot win while the stale ID is held");

  // The server finally frees the dead broker's ID
  MockPeer.byId.delete(ghost.id);
  await delay(400);

  assert.equal(B.isBroker, true, "B takes over once the ID is freed");
});
