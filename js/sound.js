let ctx = null;
let muted = false;

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

function tone({ freq, type = "sine", duration = 0.12, gain = 0.2, when = 0, slideTo }) {
  const ac = ensureContext();
  if (!ac || muted) return;
  const start = ac.currentTime + when;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), start + duration);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playMove() {
  tone({ freq: 640, type: "triangle", duration: 0.07, gain: 0.28 });
}

export function playError() {
  tone({ freq: 160, type: "square", duration: 0.16, gain: 0.16 });
  tone({ freq: 110, type: "square", duration: 0.2, gain: 0.16, when: 0.07 });
}

export function playWin() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    tone({ freq, type: "triangle", duration: 0.26, gain: 0.22, when: i * 0.13 });
  });
}
export function playCapture() {
  tone({ freq: 660, type: "sine", duration: 0.1, gain: 0.22 });
  tone({ freq: 880, type: "sine", duration: 0.14, gain: 0.22, when: 0.08 });
}

export function playLeave() {
  tone({ freq: 420, type: "sine", duration: 0.16, gain: 0.2 });
  tone({ freq: 300, type: "sine", duration: 0.24, gain: 0.2, when: 0.16 });
}

export function setMuted(value) {
  muted = Boolean(value);
}

export function isMuted() {
  return muted;
}