import { CONFIG } from "./config.js";

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

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

    const defs = el("defs", {}, this.svg);

    // Graph-paper grid, one faint square per box.
    const pattern = el("pattern", {
      id: "paperGrid",
      width: cellSize,
      height: cellSize,
      patternUnits: "userSpaceOnUse",
      x: padding,
      y: padding,
    }, defs);
    el("path", {
      d: `M ${cellSize} 0 H 0 V ${cellSize}`,
      fill: "none",
      stroke: "rgba(31, 41, 82, 0.09)",
      "stroke-width": 1,
    }, pattern);

    const soft = el("radialGradient", { id: "paperGlow", cx: "50%", cy: "0%", r: "90%" }, defs);
    el("stop", { offset: "0%", "stop-color": "rgba(255,255,255,0.55)" }, soft);
    el("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" }, soft);

    this.gBoard = el("g", {}, this.svg);
    el("rect", { class: "board-bg", x: 0, y: 0, width: this.width, height: this.height }, this.gBoard);
    el("rect", { class: "board-glow", x: 0, y: 0, width: this.width, height: this.height, fill: "url(#paperGlow)" }, this.gBoard);
    el("rect", {
      class: "board-grid",
      x: padding,
      y: padding,
      width: cols * cellSize,
      height: rows * cellSize,
      fill: "url(#paperGrid)",
    }, this.gBoard);
    el("rect", {
      class: "board-frame",
      x: padding - 14,
      y: padding - 14,
      width: cols * cellSize + 28,
      height: rows * cellSize + 28,
      rx: 14,
    }, this.gBoard);

    this.drawEdges();
    this.drawDots();
  }

  pt(r, c) {
    return {
      x: CONFIG.padding + c * CONFIG.cellSize,
      y: CONFIG.padding + r * CONFIG.cellSize,
    };
  }

  edgeCoords(r, c, dir) {
    const a = this.pt(r, c);
    const b = dir === "h" ? this.pt(r, c + 1) : this.pt(r + 1, c);
    return { a, b };
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
    if (this.board.isDrawn(r, c, dir)) return;
    const slot = el("g", { class: "edge-slot" });
    slot.dataset.r = r;
    slot.dataset.c = c;
    slot.dataset.dir = dir;

    const { a, b } = this.edgeCoords(r, c, dir);
    const pad = CONFIG.lineWidth;
    if (dir === "h") {
      el("rect", {
        x: a.x - pad,
        y: a.y - pad,
        width: CONFIG.cellSize + pad * 2,
        height: pad * 2,
      }, slot);
    } else {
      el("rect", {
        x: a.x - pad,
        y: a.y - pad,
        width: pad * 2,
        height: CONFIG.cellSize + pad * 2,
      }, slot);
    }

    const preview = el("line", {
      class: "edge-preview",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      "stroke-width": CONFIG.lineWidth,
    }, slot);

    slot.addEventListener("click", () => {
      if (this.onEdgeClick) this.onEdgeClick(r, c, dir);
    });

    this.gBoard.appendChild(slot);
  }

  drawDots() {
    const { rows, cols } = this.board;
    for (let r = 0; r < rows + 1; r++) {
      for (let c = 0; c < cols + 1; c++) {
        const p = this.pt(r, c);
        el("circle", { class: "dot", cx: p.x, cy: p.y, r: CONFIG.dotRadius }, this.gBoard);
      }
    }
  }

  setPlayerColor(index) {
    const color =
      index === null || index === undefined ? "#565d82" : this.players[index].color;
    this.svg.style.setProperty("--player-color", color);
  }
  drawLine(r, c, dir, owner, animate) {
    const slotSel = `.edge-slot[data-r="${r}"][data-c="${c}"][data-dir="${dir}"]`;
    this.svg.querySelector(slotSel)?.remove();
    const { a, b } = this.edgeCoords(r, c, dir);
    const line = el("line", {
      class: "edge-drawn",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: this.players[owner].color,
      "stroke-width": CONFIG.lineWidth,
    }, this.gBoard);
    if (animate) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      line.style.strokeDasharray = `${length}`;
      line.style.strokeDashoffset = `${length}`;
      requestAnimationFrame(() => {
        line.style.transition = "stroke-dashoffset 150ms ease-out";
        line.style.strokeDashoffset = "0";
        setTimeout(() => {
          line.style.transition = "";
          line.style.strokeDasharray = "";
          line.style.strokeDashoffset = "";
        }, 220);
      });
    }
    return line;
  }

  // Rebuild everything, then re-apply static content for the current state.
  redraw() {
    this.build();
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols + 1; c++) {
        const owner = this.board.edgeOwner(r, c, "v");
        if (owner !== undefined) this.drawLine(r, c, "v", owner, false);
      }
    }
    for (let r = 0; r < this.board.rows + 1; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const owner = this.board.edgeOwner(r, c, "h");
        if (owner !== undefined) this.drawLine(r, c, "h", owner, false);
      }
    }
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const owner = this.board.boxOwner(r, c);
        if (owner !== undefined) this.captureBox(r, c, owner, 0, false);
      }
    }
  }

  captureBox(r, c, owner, delay = 0, animate = true) {
    const { p } = this.boxGeom(r, c);
    const player = this.players[owner];
    const { cellSize } = CONFIG;
    const g = el("g", { class: "box-claimed" + (animate ? " box-pop" : "") }, this.gBoard);
    if (animate) g.style.animationDelay = `${delay}ms`;
    el("rect", {
      x: p.x,
      y: p.y,
      width: cellSize,
      height: cellSize,
      rx: 6,
      fill: player.color,
      "fill-opacity": CONFIG.boxFillOpacity,
      stroke: player.color,
      "stroke-opacity": 0.55,
      "stroke-width": 2,
    }, g);
    const text = el("text", {
      class: "box-emoji",
      x: p.x + cellSize / 2,
      y: p.y + cellSize / 2,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    }, g);
    text.textContent = player.symbol;
    return g;
  }

  boxGeom(r, c) {
    const p = this.pt(r, c);
    return { p };
  }
}
