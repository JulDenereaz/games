/*
 * Minesweeper - Windows XP style.
 * Vanilla JS, single canvas, everything drawn procedurally (no image assets).
 * All drawing happens in "logical" pixels (16px cells) and is scaled to fit the window.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const LEVELS = {
    beginner: { rows: 9, cols: 9, mines: 10, label: 'Beginner' },
    intermediate: { rows: 16, cols: 16, mines: 40, label: 'Intermediate' },
    expert: { rows: 16, cols: 30, mines: 99, label: 'Expert' },
  };
  const CELL = 16;
  const COLORS = {
    face: '#c0c0c0',
    light: '#ffffff',
    dark: '#808080',
    numbers: [null, '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'],
  };
  const LONG_PRESS_MS = 380;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const menubar = document.getElementById('menubar');

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  const settings = Object.assign(
    { level: 'beginner', custom: { rows: 20, cols: 30, mines: 145 }, marks: true },
    store.get('minesweeper.settings', {})
  );
  const defaultBest = () => ({
    beginner: { time: 999, name: 'Anonymous' },
    intermediate: { time: 999, name: 'Anonymous' },
    expert: { time: 999, name: 'Anonymous' },
  });
  let best = Object.assign(defaultBest(), store.get('minesweeper.best', {}));

  // ---------------------------------------------------------------- state
  let cfg; // { rows, cols, mines }
  let mine, adj, st; // per-cell arrays; st: 0 hidden, 1 open, 2 flag, 3 question
  let status; // 'ready' | 'playing' | 'won' | 'lost'
  let flags, opened, time, exploded, timerHandle;
  let geo; // logical geometry
  let scale = 1;

  const HIDDEN = 0, OPEN = 1, FLAG = 2, QUESTION = 3;

  function levelConfig() {
    if (settings.level === 'custom') return Object.assign({}, settings.custom);
    return Object.assign({}, LEVELS[settings.level]);
  }

  function newGame() {
    cfg = levelConfig();
    const n = cfg.rows * cfg.cols;
    mine = new Uint8Array(n);
    adj = new Uint8Array(n);
    st = new Uint8Array(n);
    status = 'ready';
    flags = 0;
    opened = 0;
    time = 0;
    exploded = -1;
    clearInterval(timerHandle);
    input.reset();
    computeGeometry();
    fit();
    updateMenu();
    draw();
  }

  const idx = (r, c) => r * cfg.cols + c;

  function neighbors(i) {
    const r = Math.floor(i / cfg.cols);
    const c = i % cfg.cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < cfg.rows && cc >= 0 && cc < cfg.cols) out.push(idx(rr, cc));
      }
    }
    return out;
  }

  // Mines are laid after the first click so the first click is always safe.
  function placeMines(safe) {
    const n = cfg.rows * cfg.cols;
    const pool = [];
    for (let i = 0; i < n; i++) if (i !== safe) pool.push(i);
    for (let k = 0; k < cfg.mines; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      mine[pool[k]] = 1;
    }
    for (let i = 0; i < n; i++) adj[i] = neighbors(i).reduce((s, j) => s + mine[j], 0);
  }

  function startTimer() {
    time = 1;
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (status !== 'playing') return;
      if (time < 999) time++;
      draw();
    }, 1000);
  }

  function reveal(i) {
    if (status === 'won' || status === 'lost') return;
    if (st[i] !== HIDDEN && st[i] !== QUESTION) return;
    if (status === 'ready') {
      placeMines(i);
      status = 'playing';
      startTimer();
    }
    if (mine[i]) return lose(i);
    flood(i);
    checkWin();
  }

  function flood(start) {
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (st[i] === OPEN || st[i] === FLAG) continue;
      st[i] = OPEN;
      opened++;
      if (adj[i] === 0) {
        for (const j of neighbors(i)) if (st[j] === HIDDEN || st[j] === QUESTION) stack.push(j);
      }
    }
  }

  // Open all neighbours of a satisfied number.
  function chord(i) {
    if (status !== 'playing' || st[i] !== OPEN || adj[i] === 0) return;
    const ns = neighbors(i);
    const flagged = ns.filter((j) => st[j] === FLAG).length;
    if (flagged !== adj[i]) return;
    for (const j of ns) {
      if (st[j] === HIDDEN || st[j] === QUESTION) {
        if (mine[j]) return lose(j);
        flood(j);
      }
    }
    checkWin();
  }

  function cycleMark(i) {
    if (status === 'won' || status === 'lost') return;
    if (st[i] === HIDDEN) {
      st[i] = FLAG;
      flags++;
    } else if (st[i] === FLAG) {
      st[i] = settings.marks ? QUESTION : HIDDEN;
      flags--;
    } else if (st[i] === QUESTION) {
      st[i] = HIDDEN;
    }
  }

  function lose(i) {
    status = 'lost';
    exploded = i;
    clearInterval(timerHandle);
  }

  function checkWin() {
    if (status !== 'playing' || opened !== cfg.rows * cfg.cols - cfg.mines) return;
    status = 'won';
    clearInterval(timerHandle);
    for (let i = 0; i < st.length; i++) {
      if (mine[i] && st[i] !== FLAG) st[i] = FLAG;
    }
    flags = cfg.mines;
    draw();
    const lvl = settings.level;
    if (LEVELS[lvl] && time < best[lvl].time) {
      setTimeout(() => askName(lvl), 150);
    }
  }

  // ---------------------------------------------------------------- geometry
  function computeGeometry() {
    const fieldW = cfg.cols * CELL;
    const fieldH = cfg.rows * CELL;
    const W = fieldW + 24;
    const H = fieldH + 67;
    geo = {
      W,
      H,
      header: { x: 9, y: 9, w: W - 18, h: 37 },
      field: { x: 12, y: 55, w: fieldW, h: fieldH },
      mines: { x: 16, y: 15 },
      timer: { x: W - 16 - 41, y: 15 },
      smiley: { x: Math.floor((W - 26) / 2), y: 15, w: 26, h: 26 },
    };
  }

  function fit() {
    const availW = window.innerWidth - 16;
    const availH = window.innerHeight - menubar.offsetHeight - 16;
    let s = Math.min(availW / geo.W, availH / geo.H);
    if (s >= 1) s = Math.min(4, Math.max(1, Math.floor(s * 2) / 2)); // half steps stay crisp
    else s = Math.max(0.4, s);
    scale = s;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(geo.W * s * dpr);
    canvas.height = Math.round(geo.H * s * dpr);
    canvas.style.width = geo.W * s + 'px';
    canvas.style.height = geo.H * s + 'px';
    menubar.style.width = geo.W * s + 'px';
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }

  // ---------------------------------------------------------------- drawing
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  // 3D bevel: light top-left, dark bottom-right (swapped when sunken).
  function bevel(x, y, w, h, t, raised) {
    const tl = raised ? COLORS.light : COLORS.dark;
    const br = raised ? COLORS.dark : COLORS.light;
    ctx.fillStyle = tl;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - t, y + t);
    ctx.lineTo(x + t, y + t);
    ctx.lineTo(x + t, y + h - t);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = br;
    ctx.beginPath();
    ctx.moveTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + t, y + h - t);
    ctx.lineTo(x + w - t, y + h - t);
    ctx.lineTo(x + w - t, y + t);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
  }

  // Seven-segment LED digits.
  const SEGMENTS = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
    6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
  };
  function segH(x, y, len, t) {
    ctx.beginPath();
    ctx.moveTo(x, y + t / 2);
    ctx.lineTo(x + t / 2, y);
    ctx.lineTo(x + len - t / 2, y);
    ctx.lineTo(x + len, y + t / 2);
    ctx.lineTo(x + len - t / 2, y + t);
    ctx.lineTo(x + t / 2, y + t);
    ctx.closePath();
    ctx.fill();
  }
  function segV(x, y, len, t) {
    ctx.beginPath();
    ctx.moveTo(x + t / 2, y);
    ctx.lineTo(x + t, y + t / 2);
    ctx.lineTo(x + t, y + len - t / 2);
    ctx.lineTo(x + t / 2, y + len);
    ctx.lineTo(x, y + len - t / 2);
    ctx.lineTo(x, y + t / 2);
    ctx.closePath();
    ctx.fill();
  }
  function digit(x, y, ch) {
    const on = SEGMENTS[ch] || '';
    const t = 2.4;
    const L = 9;
    const parts = {
      a: () => segH(x + 2, y + 1, L, t),
      g: () => segH(x + 2, y + 10.3, L, t),
      d: () => segH(x + 2, y + 19.6, L, t),
      f: () => segV(x + 0.8, y + 2, L, t),
      b: () => segV(x + 9.8, y + 2, L, t),
      e: () => segV(x + 0.8, y + 11.4, L, t),
      c: () => segV(x + 9.8, y + 11.4, L, t),
    };
    for (const k of 'abcdefg') {
      ctx.fillStyle = on.includes(k) ? '#ff0000' : '#2e0000';
      parts[k]();
    }
  }
  function counter(x, y, value) {
    const v = Math.max(-99, Math.min(999, value));
    const s = v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0');
    bevel(x - 1, y - 1, 41 + 2, 25 + 2, 1, false);
    rect(x, y, 41, 25, '#000');
    for (let k = 0; k < 3; k++) digit(x + 1 + k * 13, y + 1, s[k]);
  }

  function drawSmiley() {
    const { x, y, w, h } = geo.smiley;
    const pressed = input.smileyDown && input.overSmiley;
    rect(x - 1, y - 1, w + 2, h + 2, COLORS.dark);
    rect(x, y, w, h, COLORS.face);
    if (pressed) {
      rect(x, y, w, 1, COLORS.dark);
      rect(x, y, 1, h, COLORS.dark);
    } else {
      bevel(x, y, w, h, 2, true);
    }
    const o = pressed ? 1 : 0;
    const cx = x + 13 + o;
    const cy = y + 13 + o;
    ctx.fillStyle = '#ffff00';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    let face = 'smile';
    if (status === 'lost') face = 'dead';
    else if (status === 'won') face = 'cool';
    else if (input.fieldDown && !pressed) face = 'ooh';

    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    if (face === 'dead') {
      ctx.lineWidth = 1;
      for (const ex of [cx - 3.5, cx + 2.5]) {
        ctx.beginPath();
        ctx.moveTo(ex - 1.5, cy - 4.5);
        ctx.lineTo(ex + 1.5, cy - 1.5);
        ctx.moveTo(ex + 1.5, cy - 4.5);
        ctx.lineTo(ex - 1.5, cy - 1.5);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy + 6.5, 4, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (face === 'cool') {
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy - 3.5);
      ctx.lineTo(cx + 7, cy - 3.5);
      ctx.lineTo(cx + 6, cy - 1);
      ctx.lineTo(cx + 2, cy - 0.5);
      ctx.lineTo(cx + 1, cy - 2.5);
      ctx.lineTo(cx - 1, cy - 2.5);
      ctx.lineTo(cx - 2, cy - 0.5);
      ctx.lineTo(cx - 6, cy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy + 1, 4.5, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    } else {
      rect(cx - 4, cy - 4, 2, 2, '#000');
      rect(cx + 2, cy - 4, 2, 2, '#000');
      if (face === 'ooh') {
        ctx.beginPath();
        ctx.arc(cx, cy + 3, 2.2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy + 0.5, 4.5, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
      }
    }
  }

  function drawMine(x, y) {
    const cx = x + 8;
    const cy = y + 8;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 6.5, cy);
    ctx.lineTo(cx + 6.5, cy);
    ctx.moveTo(cx, cy - 6.5);
    ctx.lineTo(cx, cy + 6.5);
    ctx.moveTo(cx - 4.3, cy - 4.3);
    ctx.lineTo(cx + 4.3, cy + 4.3);
    ctx.moveTo(cx + 4.3, cy - 4.3);
    ctx.lineTo(cx - 4.3, cy + 4.3);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cy, 4.6, 0, Math.PI * 2);
    ctx.fill();
    rect(cx - 2.5, cy - 2.5, 2, 2, '#fff');
  }

  function drawFlag(x, y) {
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 3);
    ctx.lineTo(x + 9, y + 8.5);
    ctx.lineTo(x + 3.5, y + 5.75);
    ctx.closePath();
    ctx.fill();
    rect(x + 8, y + 3, 1.2, 8, '#000');
    rect(x + 6, y + 10, 5, 1.2, '#000');
    rect(x + 4, y + 11, 9, 2, '#000');
  }

  function drawGlyph(x, y, text, color) {
    ctx.fillStyle = color;
    ctx.font = 'bold 13px Tahoma, Verdana, "DejaVu Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + 8.8);
  }

  function drawCell(i, pressedSet) {
    const r = Math.floor(i / cfg.cols);
    const c = i % cfg.cols;
    const x = geo.field.x + c * CELL;
    const y = geo.field.y + r * CELL;
    const s = st[i];
    const over = status === 'lost' || status === 'won';

    const openLook = (bg) => {
      rect(x, y, CELL, CELL, bg || COLORS.face);
      rect(x, y, CELL, 1, COLORS.dark);
      rect(x, y, 1, CELL, COLORS.dark);
    };

    if (s === OPEN) {
      openLook();
      if (adj[i]) drawGlyph(x, y, String(adj[i]), COLORS.numbers[adj[i]]);
      return;
    }
    if (status === 'lost') {
      if (i === exploded) {
        openLook('#ff0000');
        drawMine(x, y);
        return;
      }
      if (mine[i] && s !== FLAG) {
        openLook();
        drawMine(x, y);
        return;
      }
      if (!mine[i] && s === FLAG) {
        openLook();
        drawMine(x, y);
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 2.5, y + 2.5);
        ctx.lineTo(x + 13.5, y + 13.5);
        ctx.moveTo(x + 13.5, y + 2.5);
        ctx.lineTo(x + 2.5, y + 13.5);
        ctx.stroke();
        return;
      }
    }
    if (!over && pressedSet.has(i) && s !== FLAG) {
      openLook();
      if (s === QUESTION) drawGlyph(x, y, '?', '#000');
      return;
    }
    rect(x, y, CELL, CELL, COLORS.face);
    bevel(x, y, CELL, CELL, 2, true);
    if (s === FLAG) drawFlag(x, y);
    else if (s === QUESTION) drawGlyph(x - 0.5, y - 0.5, '?', '#000');
  }

  function draw() {
    const { W, H, header, field } = geo;
    rect(0, 0, W, H, COLORS.face);
    bevel(0, 0, W, H, 3, true);
    bevel(header.x, header.y, header.w, header.h, 2, false);
    bevel(field.x - 3, field.y - 3, field.w + 6, field.h + 6, 3, false);
    counter(geo.mines.x, geo.mines.y, cfg.mines - flags);
    counter(geo.timer.x, geo.timer.y, time);
    drawSmiley();
    const pressed = input.pressedCells();
    for (let i = 0; i < st.length; i++) drawCell(i, pressed);
  }

  // ---------------------------------------------------------------- input
  const input = {
    mode: 'none', // 'none' | 'left' | 'right' | 'chord' | 'done'
    buttons: 0,
    cell: -1,
    fieldDown: false,
    smileyDown: false,
    overSmiley: false,
    touch: null,
    reset() {
      this.mode = 'none';
      this.buttons = 0;
      this.cell = -1;
      this.fieldDown = false;
      this.smileyDown = false;
      this.overSmiley = false;
      if (this.touch) clearTimeout(this.touch.timer);
      this.touch = null;
    },
    pressedCells() {
      const set = new Set();
      if (this.cell < 0 || status === 'won' || status === 'lost') return set;
      if (this.mode === 'left' || (this.touch && !this.touch.fired)) {
        if (st[this.cell] === HIDDEN || st[this.cell] === QUESTION) set.add(this.cell);
      } else if (this.mode === 'chord') {
        for (const j of [this.cell, ...neighbors(this.cell)]) {
          if (st[j] === HIDDEN || st[j] === QUESTION) set.add(j);
        }
      }
      return set;
    },
  };

  function locate(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const f = geo.field;
    let cell = -1;
    if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) {
      cell = idx(Math.floor((y - f.y) / CELL), Math.floor((x - f.x) / CELL));
    }
    const s = geo.smiley;
    const onSmiley = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
    return { cell, onSmiley };
  }

  // Mouse: a small state machine over e.buttons so left+right chords work
  // (browsers report the second button as a pointermove, not a pointerdown).
  function handleMouse(e) {
    const { cell, onSmiley } = locate(e);
    const b = e.buttons;
    const prev = input.buttons;
    const pressedNow = b & ~prev;
    const released = prev & ~b;
    input.buttons = b;
    input.overSmiley = onSmiley;

    if (e.type === 'pointerdown' && onSmiley && (pressedNow & 1)) {
      input.smileyDown = true;
      draw();
      return;
    }
    if (input.smileyDown) {
      if (b === 0) {
        input.smileyDown = false;
        if (onSmiley) return newGame();
      }
      draw();
      return;
    }

    input.cell = cell;
    const playable = status === 'ready' || status === 'playing';

    if (pressedNow && input.mode === 'none' && cell < 0 && e.type === 'pointerdown') {
      input.mode = 'done'; // pressed outside the field: ignore until release
    }
    if ((pressedNow & 2) && !(b & 1) && input.mode === 'none' && cell >= 0 && playable) {
      cycleMark(cell);
      input.mode = 'right';
    }
    if (input.mode !== 'done' && (((b & 1) && (b & 2)) || (b & 4))) {
      input.mode = 'chord';
    } else if ((b & 1) && input.mode === 'none') {
      input.mode = 'left';
    }

    if (released) {
      if (input.mode === 'left' && b === 0 && cell >= 0) reveal(cell);
      else if (input.mode === 'chord' && cell >= 0) {
        chord(cell);
        input.mode = 'done';
      }
    }
    if (b === 0) input.mode = 'none';
    input.fieldDown = playable && (input.mode === 'left' || input.mode === 'chord');
    draw();
  }

  // Touch: tap = open (or chord on a number), long press = flag.
  function handleTouch(e) {
    const { cell, onSmiley } = locate(e);
    if (e.type === 'pointerdown') {
      if (onSmiley) {
        input.smileyDown = true;
        input.overSmiley = true;
        draw();
        return;
      }
      if (cell < 0 || !(status === 'ready' || status === 'playing')) return;
      input.cell = cell;
      input.fieldDown = true;
      const t = { cell, fired: false, x: e.clientX, y: e.clientY };
      t.timer = setTimeout(() => {
        t.fired = true;
        input.fieldDown = false;
        if (st[cell] !== OPEN) {
          cycleMark(cell);
          if (navigator.vibrate) navigator.vibrate(30);
        }
        draw();
      }, LONG_PRESS_MS);
      input.touch = t;
      draw();
    } else if (e.type === 'pointermove') {
      if (input.smileyDown) {
        input.overSmiley = onSmiley;
        draw();
      } else if (input.touch && Math.hypot(e.clientX - input.touch.x, e.clientY - input.touch.y) > 10) {
        clearTimeout(input.touch.timer);
        input.touch = null;
        input.cell = -1;
        input.fieldDown = false;
        draw();
      }
    } else {
      if (input.smileyDown) {
        input.smileyDown = false;
        if (onSmiley && e.type === 'pointerup') return newGame();
        draw();
        return;
      }
      const t = input.touch;
      input.touch = null;
      input.fieldDown = false;
      input.cell = -1;
      if (t) {
        clearTimeout(t.timer);
        if (!t.fired && e.type === 'pointerup') {
          if (st[t.cell] === OPEN) chord(t.cell);
          else if (st[t.cell] !== FLAG) reveal(t.cell);
        }
      }
      draw();
    }
  }

  function onPointer(e) {
    if (!dialogBackdrop.hidden) return;
    if (e.type === 'pointerdown') {
      closeMenus();
      canvas.setPointerCapture(e.pointerId);
    }
    if (e.pointerType === 'mouse') handleMouse(e);
    else handleTouch(e);
  }
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, onPointer));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('lostpointercapture', () => {
    if (input.buttons) {
      input.reset();
      draw();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!dialogBackdrop.hidden) {
      if (e.key === 'Escape') closeDialog();
      if (e.key === 'Enter') {
        e.preventDefault();
        dialogBackdrop.querySelector('#dialog-buttons button')?.click();
      }
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      newGame();
    } else if (e.key === 'Escape') {
      closeMenus();
    }
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      fit();
      draw();
    });
  });

  // ---------------------------------------------------------------- menus
  const menus = document.querySelectorAll('.menu');
  function closeMenus() {
    menus.forEach((m) => m.classList.remove('open'));
  }
  menus.forEach((menu) => {
    const title = menu.querySelector('.menu-title');
    title.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
    title.addEventListener('pointerenter', () => {
      if ([...menus].some((m) => m.classList.contains('open'))) {
        closeMenus();
        menu.classList.add('open');
      }
    });
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.menu')) closeMenus();
  });

  function saveSettings() {
    store.set('minesweeper.settings', settings);
  }

  function updateMenu() {
    document.querySelectorAll('[data-level]').forEach((li) => {
      li.classList.toggle('checked', li.dataset.level === settings.level);
    });
    document.querySelector('[data-toggle="marks"]').classList.toggle('checked', settings.marks);
  }

  document.querySelectorAll('.menu-list li').forEach((li) => {
    li.addEventListener('click', () => {
      if (li.classList.contains('sep')) return;
      closeMenus();
      if (li.dataset.level) {
        if (li.dataset.level === 'custom') return customDialog();
        settings.level = li.dataset.level;
        saveSettings();
        return newGame();
      }
      if (li.dataset.toggle === 'marks') {
        settings.marks = !settings.marks;
        saveSettings();
        return updateMenu();
      }
      switch (li.dataset.action) {
        case 'new': return newGame();
        case 'best': return bestDialog();
        case 'exit':
          if (window.parent !== window) window.parent.postMessage({ type: 'games:exit' }, location.origin);
          else window.location.href = '../../';
          return;
        case 'help':
          return openDialog('How to play', `
            <p>Find every empty square without clicking on a mine.</p>
            <ul>
              <li><b>Left-click</b> a square to uncover it. A number tells you how many mines touch it.</li>
              <li><b>Right-click</b> to place a flag where you think a mine is (right-click again for <b>?</b> if Marks are on).</li>
              <li>Click a number with <b>both buttons</b> (or the middle button) to uncover all its neighbours once enough flags are placed.</li>
              <li>On touch screens: <b>tap</b> to uncover, <b>long-press</b> to flag, tap a number to uncover its neighbours.</li>
              <li>Your first click is always safe. Click the smiley or press <b>F2</b> for a new game.</li>
            </ul>`, [['OK']]);
        case 'about':
          return openDialog('About Minesweeper', `
            <p><b>Minesweeper</b></p>
            <p>A tribute to the classic desktop game, playable in the browser.</p>`, [['OK']]);
      }
    });
  });

  // ---------------------------------------------------------------- dialogs
  const dialogBackdrop = document.getElementById('dialog-backdrop');
  const dialogBody = document.getElementById('dialog-body');

  // buttons: [[label, fn]]; fn may return false to keep the dialog open.
  function openDialog(title, html, buttons) {
    document.getElementById('dialog-title').textContent = title;
    dialogBody.innerHTML = html;
    const box = document.getElementById('dialog-buttons');
    box.innerHTML = '';
    buttons.forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        if (fn && fn(dialogBody) === false) return;
        closeDialog();
      });
      box.appendChild(b);
    });
    dialogBackdrop.hidden = false;
    (dialogBody.querySelector('input') || box.querySelector('button'))?.focus();
    dialogBody.querySelector('input')?.select?.();
  }
  function closeDialog() {
    dialogBackdrop.hidden = true;
  }
  dialogBackdrop.querySelector('[data-dialog="close"]').addEventListener('click', closeDialog);

  function customDialog() {
    const c = settings.level === 'custom' ? settings.custom : levelConfig();
    openDialog('Custom Field', `
      <label>Height: <input type="number" id="c-rows" min="9" max="24" value="${c.rows}"></label>
      <label>Width: <input type="number" id="c-cols" min="9" max="30" value="${c.cols}"></label>
      <label>Mines: <input type="number" id="c-mines" min="10" value="${c.mines}"></label>`,
    [
      ['OK', (body) => {
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || lo)));
        const rows = clamp(body.querySelector('#c-rows').value, 9, 24);
        const cols = clamp(body.querySelector('#c-cols').value, 9, 30);
        const mines = clamp(body.querySelector('#c-mines').value, 10, (rows - 1) * (cols - 1));
        settings.custom = { rows, cols, mines };
        settings.level = 'custom';
        saveSettings();
        newGame();
      }],
      ['Cancel'],
    ]);
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function bestDialog() {
    const row = (k) => `<tr><td>${LEVELS[k].label}:</td><td>${best[k].time} seconds</td><td>${escapeHtml(best[k].name)}</td></tr>`;
    openDialog('Fastest Mine Sweepers', `
      <table class="best-table">${row('beginner')}${row('intermediate')}${row('expert')}</table>`,
    [
      ['OK'],
      ['Reset Scores', () => {
        best = defaultBest();
        store.set('minesweeper.best', best);
        bestDialog();
        return false;
      }],
    ]);
  }

  function askName(level) {
    const last = store.get('minesweeper.lastName', 'Anonymous');
    openDialog('Congratulations', `
      <p>You have the fastest time for ${LEVELS[level].label.toLowerCase()} level.<br>Please type your name:</p>
      <input type="text" id="best-name" maxlength="32" value="${escapeHtml(last)}">`,
    [
      ['OK', (body) => {
        const name = body.querySelector('#best-name').value.trim() || 'Anonymous';
        best[level] = { time, name };
        store.set('minesweeper.best', best);
        store.set('minesweeper.lastName', name);
        setTimeout(bestDialog, 0);
      }],
    ]);
  }

  // ---------------------------------------------------------------- boot
  newGame();

  // Test hook (only with ?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__mines = {
      get state() { return { status, flags, opened, time, cfg, mine, st, adj }; },
      reveal: (i) => { reveal(i); draw(); },
      chord: (i) => { chord(i); draw(); },
      flag: (i) => { cycleMark(i); draw(); },
    };
  }
})();
