export class Game {
  constructor(board, players) {
    this.board = board;
    this.players = players;
    this.currentIndex = 0;
    this.isOver = false;
    this.lastMove = null;
    this.winnerIndexes = null;
  }

  get currentPlayer() {
    return this.players[this.currentIndex];
  }

  applyMove(r, c, dir) {
    if (this.isOver) return null;
    const completed = this.board.placeEdge(r, c, dir, this.currentIndex);
    for (const [br, bc] of completed) {
      this.board.claimBox(br, bc, this.currentIndex);
    }
    const gotExtraTurn = completed.length > 0;
    if (!gotExtraTurn) {
      this.currentIndex = (this.currentIndex + 1) % this.players.length;
    }
    this.isOver = this.board.isGameOver();
    if (this.isOver) {
      this.winnerIndexes = this.computeWinner();
    }
    this.lastMove = { r, c, dir, completed, gotExtraTurn };
    return this.lastMove;
  }

  skipTurn() {
    if (this.isOver) return null;
    this.currentIndex = (this.currentIndex + 1) % this.players.length;
    this.lastMove = { skipped: true };
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
    const max = Math.max(...scores);
    const winners = [];
    scores.forEach((score, i) => {
      if (score === max) winners.push(i);
    });
    return winners;
  }
}