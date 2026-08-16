import { CONFIG } from "./config.js";

export class Renderer {
  constructor(svg, board, players) {
    this.svg = svg;
    this.board = board;
    this.players = players;
    this.onEdgeClick = null;
    this.build();
  }

  build() {
    const { rows, cols } = this.board;
    const { cellSize, padding } = CONFIG;
    this.width = padding * 2 + cols * cellSize;
    this.height = padding * 2 + rows * cellSize;
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute("width", this.width);
    this.svg.setAttribute("height", this.height);
    this.svg.innerHTML = "";

    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    const style = document.createElementNS(ns, "style");
    style.textContent = `.edge-slot:hover .edge-preview{stroke:var(--player-color, var(--accent));opacity:0.5}`;
    defs.appendChild(style);
    this.svg.appendChild(defs);

    this.gBoard = document.createElementNS(ns, "g");
    this.svg.appendChild(this.gBoard);
    this.drawBoxes();
    this.drawEdges();
    this.drawDots();
  }

  pt(r, c) {
    return {
      x: CONFIG.padding + c * CONFIG.cellSize,
      y: CONFIG.padding + r * CONFIG.cellSize,
    };
  }

  drawBoxes() {
    const ns = "http://www.w3.org/2000/svg";
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const rect = document.createElementNS(ns, "rect");
        const p = this.pt(r, c);
        rect.setAttribute("x", p.x);
        rect.setAttribute("y", p.y);
        rect.setAttribute("width", CONFIG.cellSize);
        rect.setAttribute("height", CONFIG.cellSize);
        rect.setAttribute("class", "box-empty");
        this.gBoard.appendChild(rect);
      }
    }
  }

  drawEdges() {
    const { rows, cols } = this.board;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols + 1; c++) this.drawEdge(r, c, "v");
    }
    for (let r = 0; r < rows + 1; r++) {
      for (let c = 0; c < cols; c++) this.drawEdge(r, c, "h");
    }
  }

  drawEdge(r, c, dir) {
    const ns = "http://www.w3.org/2000/svg";
    const owner = this.board.edgeOwner(r, c, dir);
    if (owner !== undefined) {
      const line = document.createElementNS(ns, "line");
      if (dir === "h") {
        const a = this.pt(r, c);
        const b = this.pt(r, c + 1);
        line.setAttribute("x1", a.x);
        line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x);
        line.setAttribute("y2", b.y);
      } else {
        const a = this.pt(r, c);
        const b = this.pt(r + 1, c);
        line.setAttribute("x1", a.x);
        line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x);
        line.setAttribute("y2", b.y);
      }
      line.setAttribute("stroke", this.players[owner].color);
      line.setAttribute("stroke-width", CONFIG.lineWidth);
      line.setAttribute("class", "edge-drawn");
      this.gBoard.appendChild(line);
      return;
    }

    const slot = document.createElementNS(ns, "g");
    slot.setAttribute("class", "edge-slot");
    slot.dataset.r = r;
    slot.dataset.c = c;
    slot.dataset.dir = dir;

    const hitbox = document.createElementNS(ns, "rect");
    if (dir === "h") {
      const a = this.pt(r, c);
      hitbox.setAttribute("x", a.x - CONFIG.lineWidth);
      hitbox.setAttribute("y", a.y - CONFIG.lineWidth);
      hitbox.setAttribute("width", CONFIG.cellSize + CONFIG.lineWidth * 2);
      hitbox.setAttribute("height", CONFIG.lineWidth * 2);
    } else {
      const a = this.pt(r, c);
      hitbox.setAttribute("x", a.x - CONFIG.lineWidth);
      hitbox.setAttribute("y", a.y - CONFIG.lineWidth);
      hitbox.setAttribute("width", CONFIG.lineWidth * 2);
      hitbox.setAttribute("height", CONFIG.cellSize + CONFIG.lineWidth * 2);
    }
    slot.appendChild(hitbox);

    const preview = document.createElementNS(ns, "line");
    preview.setAttribute("class", "edge-preview");
    if (dir === "h") {
      const a = this.pt(r, c);
      const b = this.pt(r, c + 1);
      preview.setAttribute("x1", a.x);
      preview.setAttribute("y1", a.y);
      preview.setAttribute("x2", b.x);
      preview.setAttribute("y2", b.y);
    } else {
      const a = this.pt(r, c);
      const b = this.pt(r + 1, c);
      preview.setAttribute("x1", a.x);
      preview.setAttribute("y1", a.y);
      preview.setAttribute("x2", b.x);
      preview.setAttribute("y2", b.y);
    }
    preview.setAttribute("stroke-width", CONFIG.lineWidth);
    slot.appendChild(preview);

    slot.addEventListener("click", () => {
      if (this.onEdgeClick) this.onEdgeClick(r, c, dir);
    });

    this.gBoard.appendChild(slot);
  }

  drawDots() {
    const ns = "http://www.w3.org/2000/svg";
    for (let r = 0; r < this.board.rows + 1; r++) {
      for (let c = 0; c < this.board.cols + 1; c++) {
        const circle = document.createElementNS(ns, "circle");
        const p = this.pt(r, c);
        circle.setAttribute("cx", p.x);
        circle.setAttribute("cy", p.y);
        circle.setAttribute("r", CONFIG.dotRadius);
        circle.setAttribute("class", "dot");
        this.gBoard.appendChild(circle);
      }
    }
  }

  setPlayerColor(index) {
    const color =
      index === null || index === undefined
        ? "#565d82"
        : this.players[index].color;
    this.svg.style.setProperty("--player-color", color);
  }

  refreshBoxes() {
    const ns = "http://www.w3.org/2000/svg";
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const owner = this.board.boxOwner(r, c);
        if (owner === undefined) continue;
        const p = this.pt(r, c);
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", p.x);
        rect.setAttribute("y", p.y);
        rect.setAttribute("width", CONFIG.cellSize);
        rect.setAttribute("height", CONFIG.cellSize);
        rect.setAttribute("fill", this.players[owner].color);
        rect.setAttribute("fill-opacity", CONFIG.boxFillOpacity);
        rect.setAttribute("class", "box-claimed");
        this.gBoard.appendChild(rect);

        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", p.x + CONFIG.cellSize / 2);
        text.setAttribute("y", p.y + CONFIG.cellSize / 2);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("fill", this.players[owner].color);
        text.textContent = this.players[owner].symbol;
        this.gBoard.appendChild(text);
      }
    }
  }

  redraw() {
    this.build();
    this.refreshBoxes();
  }
}