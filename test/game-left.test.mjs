import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadAsEsm } from "../test-utils/mock-peer.mjs";

const { Game } = await loadAsEsm("js/game.js");

const games = [];

class FakeBoard {
  constructor(extraOnClaim = false) {
    this.boxOwners = new Map();
    this.claims = 0;
    this.extraOnClaim = extraOnClaim;
  }
  placeEdge() {
    this.claims += 1;
    if (this.extraOnClaim && this.claims === 1) return [[0, 0]];
    return [];
  }
  claimBox(br, bc, owner) {
    this.boxOwners.set(`${br},${bc}`, owner);
  }
  isGameOver() {
    return false;
  }
  isDrawn() {
    return false;
  }
}

function makeGame(count, extraOnClaim = false) {
  const players = Array.from({ length: count }, (_, i) => ({
    name: `P${i}`,
    color: "#fff",
    symbol: String(i),
  }));
  const game = new Game(new FakeBoard(extraOnClaim), players);
  games.push(game);
  return game;
}

after(() => {
  games.length = 0;
});

test("turn cycle skips a player who left", () => {
  const game = makeGame(3);
  game.markPlayerLeft(1);
  game.applyMove(0, 0, "h");
  assert.equal(game.currentIndex, 2, "skips the departed player 1");
});

test("leaving on your own turn advances to the next active player", () => {
  const game = makeGame(3);
  game.markPlayerLeft(0);
  assert.equal(game.currentIndex, 1);
});

test("leaving mid extra-turn advances instead of replaying the departed player", () => {
  const game = makeGame(3, true);
  game.applyMove(0, 0, "h");
  assert.equal(game.currentIndex, 0, "box completed => extra turn stays on 0");
  game.markPlayerLeft(0);
  assert.equal(game.currentIndex, 1, "departed player is skipped");
});

test("leaving does not shift active players' relative order", () => {
  const game = makeGame(4);
  game.markPlayerLeft(1);
  game.markPlayerLeft(3);
  game.applyMove(0, 0, "h");
  assert.equal(game.currentIndex, 2, "cycles 0 -> 2, skipping 1 and 3");
  game.applyMove(2, 0, "h");
  assert.equal(game.currentIndex, 0);
});

test("in a 2-player game the remaining player wins when the other leaves", () => {
  const game = makeGame(2);
  game.markPlayerLeft(1);
  assert.equal(game.activeCount(), 1);
  assert.equal(game.isOver, true);
  assert.deepEqual(game.winnerIndexes, [0]);
});

test("the last remaining player wins the game", () => {
  const game = makeGame(3);
  game.markPlayerLeft(1);
  game.markPlayerLeft(2);
  assert.equal(game.activeCount(), 1);
  assert.equal(game.isOver, true);
  assert.deepEqual(game.winnerIndexes, [0]);
});

test("winner is computed only among active players", () => {
  const game = makeGame(3);
  game.board.claimBox(0, 0, 0);
  game.board.claimBox(1, 0, 1);
  game.board.claimBox(2, 0, 2);
  game.markPlayerLeft(2);
  assert.deepEqual(game.computeWinner(), [0, 1], "left player 2 cannot win");
});

test("a departed player is flagged inactive", () => {
  const game = makeGame(3);
  game.markPlayerLeft(1);
  assert.equal(game.players[1].active, false);
  assert.equal(game.players[0].active, true);
});
