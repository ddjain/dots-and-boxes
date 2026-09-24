export class Game {
  constructor(board, players) {
    this.board = board;
    this.players = players;
    for (const player of this.players) {
      if (player.active === undefined) player.active = true;
    }
    this.currentIndex = 0;
    this.isOver = false;
    this.lastMove = null;
    this.winnerIndexes = null;
  }

  get currentPlayer() {
    return this.players[this.currentIndex];
  }

  activeCount() {
    return this.players.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }

  nextActiveIndex(from) {
    const n = this.players.length;
    let i = from;
    for (let step = 0; step < n; step += 1) {
      i = (i + 1) % n;
      if (this.players[i].active) return i;
    }
    return from;
  }

  markPlayerLeft(index) {
    const player = this.players[index];
    if (!player || !player.active) return;
    player.active = false;
    if (!this.players[this.currentIndex].active) {
      this.currentIndex = this.nextActiveIndex(this.currentIndex);
    }
    if (this.activeCount() < 2) {
      this.isOver = true;
      this.winnerIndexes = this.computeWinner();
    }
  }

  applyMove(r, c, dir) {
    if (this.isOver) return null;
    const owner = this.currentIndex;
    const completed = this.board.placeEdge(r, c, dir, owner);
    for (const [br, bc] of completed) {
      this.board.claimBox(br, bc, owner);
    }
    const gotExtraTurn = completed.length > 0;
    if (!gotExtraTurn) {
      this.currentIndex = this.nextActiveIndex(this.currentIndex);
    }
    this.isOver = this.board.isGameOver();
    if (this.isOver) {
      this.winnerIndexes = this.computeWinner();
    }
    this.lastMove = { r, c, dir, completed, gotExtraTurn, owner };
    return this.lastMove;
  }

  scores() {
    const scores = new Array(this.players.length).fill(0);
    for (const owner of this.board.boxOwners.values()) {
      scores[owner] += 1;
    }
    return scores;
  }

  computeWinner() {
    const scores = this.scores();
    const active = this.players
      .map((player, i) => (player.active ? i : -1))
      .filter((i) => i !== -1);
    if (active.length === 0) return [];
    const max = Math.max(...active.map((i) => scores[i]));
    return active.filter((i) => scores[i] === max);
  }
}