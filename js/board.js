export class Board {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.hEdges = new Set();
    this.vEdges = new Set();
    this.hOwners = new Map();
    this.vOwners = new Map();
    this.boxOwners = new Map();
  }

  edgeOwner(r, c, dir) {
    return dir === "h" ? this.hOwners.get(`${r},${c}`) : this.vOwners.get(`${r},${c}`);
  }

  isDrawn(r, c, dir) {
    return dir === "h" ? this.hEdges.has(`${r},${c}`) : this.vEdges.has(`${r},${c}`);
  }

  placeEdge(r, c, dir, owner) {
    if (this.isDrawn(r, c, dir)) return [];
    const key = `${r},${c}`;
    if (dir === "h") {
      this.hEdges.add(key);
      this.hOwners.set(key, owner);
    } else {
      this.vEdges.add(key);
      this.vOwners.set(key, owner);
    }
    const candidates =
      dir === "h" ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]];
    const completed = [];
    for (const [br, bc] of candidates) {
      if (this.isBoxComplete(br, bc)) completed.push([br, bc]);
    }
    return completed;
  }

  isBoxComplete(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return (
      this.hEdges.has(`${r},${c}`) &&
      this.hEdges.has(`${r + 1},${c}`) &&
      this.vEdges.has(`${r},${c}`) &&
      this.vEdges.has(`${r},${c + 1}`)
    );
  }

  boxOwner(r, c) {
    return this.boxOwners.get(`${r},${c}`);
  }

  claimBox(r, c, owner) {
    this.boxOwners.set(`${r},${c}`, owner);
  }

  totalEdges() {
    return this.rows * (this.cols + 1) + this.cols * (this.rows + 1);
  }

  drawnEdges() {
    return this.hEdges.size + this.vEdges.size;
  }

  isGameOver() {
    return this.drawnEdges() >= this.totalEdges();
  }

  remainingEdges() {
    return this.totalEdges() - this.drawnEdges();
  }
}