/*
 * Klondike Solitaire - Windows XP style.
 * Vanilla JS, no dependencies. Card faces live in ../img/<RANK>_<SUIT>.png
 * where RANK is A,2..9,0 (ten),J,Q,K and SUIT is C,D,H,S.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const SUITS = ['C', 'D', 'H', 'S'];
  const RANK_FILES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'J', 'Q', 'K'];
  const RATIO = 314 / 226;
  const DOUBLE_CLICK_MS = 350;
  const DRAG_THRESHOLD = 4;
  const MOVE_MS = 140; // must match the transition in style.css
  const isRed = (suit) => suit === 'D' || suit === 'H';

  const board = document.getElementById('board');
  const canvas = document.getElementById('cascade');
  const statusMsg = document.getElementById('status-msg');
  const statusTime = document.getElementById('status-time');
  const statusHigh = document.getElementById('status-high');
  const statusScore = document.getElementById('status-score');
  const slots = {
    stock: document.getElementById('slot-stock'),
    waste: document.getElementById('slot-waste'),
    found: [0, 1, 2, 3].map((i) => document.getElementById('slot-f' + i)),
    tab: [0, 1, 2, 3, 4, 5, 6].map((i) => document.getElementById('slot-t' + i)),
  };

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
    { draw: 1, scoring: 'standard', timed: true, cumulative: false },
    store.get('solitaire.settings', {})
  );
  let highScore = store.get('solitaire.highscore', 0);
  let vegasBank = store.get('solitaire.vegasBank', 0);

  // ---------------------------------------------------------------- cards
  const cards = [];
  for (const suit of SUITS) {
    for (let r = 0; r < 13; r++) {
      const el = document.createElement('div');
      el.className = 'card down';
      const img = document.createElement('img');
      img.src = 'img/' + RANK_FILES[r] + '_' + suit + '.png';
      img.alt = RANK_FILES[r] + suit;
      img.draggable = false;
      const back = document.createElement('div');
      back.className = 'back';
      el.append(img, back);
      const card = { id: cards.length, rank: r + 1, suit, up: false, el, img };
      el.dataset.id = card.id;
      cards.push(card);
      board.appendChild(el);
    }
  }

  // ---------------------------------------------------------------- game state
  const piles = {
    stock: { type: 'stock', index: 0, cards: [] },
    waste: { type: 'waste', index: 0, cards: [] },
    found: [0, 1, 2, 3].map((i) => ({ type: 'found', index: i, cards: [] })),
    tab: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ type: 'tab', index: i, cards: [] })),
  };
  const allPiles = () => [piles.stock, piles.waste, ...piles.found, ...piles.tab];

  let game = null; // per-deal state (score, time, ...)
  let undoState = null; // XP keeps a single level of undo
  let timerHandle = null;
  let layout = null;

  function newGameState() {
    const vegas = settings.scoring === 'vegas';
    return {
      score: vegas ? (settings.cumulative ? vegasBank : 0) - 52 : 0,
      seconds: 0,
      started: false,
      won: false,
      passes: 0, // how many times the stock was turned (Vegas limits)
      wasteShown: 0, // how many waste cards are fanned (draw three)
      mode: { draw: settings.draw, scoring: settings.scoring, timed: settings.timed, cumulative: vegas && settings.cumulative },
    };
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function deal() {
    stopCascade();
    closeDialog();
    // Abandoning a Vegas game still costs the buy-in (cumulative mode).
    if (game && game.mode.scoring === 'vegas' && game.mode.cumulative && game.started && !game.won) {
      vegasBank = game.score;
      store.set('solitaire.vegasBank', vegasBank);
    }
    game = newGameState();
    undoState = null;
    allPiles().forEach((p) => (p.cards = []));
    const deck = shuffle(cards.slice());
    deck.forEach((c) => { c.up = false; c.el.classList.remove('hidden'); });
    for (let i = 0; i < 7; i++) {
      for (let j = i; j < 7; j++) piles.tab[j].cards.push(deck.pop());
    }
    piles.tab.forEach((p) => (p.cards[p.cards.length - 1].up = true));
    piles.stock.cards = deck;
    board.classList.remove('animate');
    render();
    requestAnimationFrame(() => board.classList.add('animate'));
    startTimer();
    updateStatus();
    updateMenu();
  }

  // ---------------------------------------------------------------- undo
  function snapshot() {
    return {
      piles: allPiles().map((p) => p.cards.map((c) => [c.id, c.up])),
      score: game.score,
      passes: game.passes,
      wasteShown: game.wasteShown,
    };
  }

  function pushUndo() {
    undoState = snapshot();
  }

  function undo() {
    if (!undoState || game.won) return;
    const list = allPiles();
    undoState.piles.forEach((entries, i) => {
      list[i].cards = entries.map(([id, up]) => {
        cards[id].up = up;
        return cards[id];
      });
    });
    game.score = undoState.score;
    game.passes = undoState.passes;
    game.wasteShown = undoState.wasteShown;
    undoState = null;
    render();
    updateStatus();
    updateMenu();
  }

  // ---------------------------------------------------------------- scoring
  function addScore(points) {
    if (game.mode.scoring === 'none') return;
    game.score += points;
    if (game.mode.scoring === 'standard' && game.score < 0) game.score = 0;
  }

  function scoreMove(from, to) {
    const s = game.mode.scoring;
    if (s === 'standard') {
      if (from === 'waste' && to === 'tab') addScore(5);
      else if (from === 'waste' && to === 'found') addScore(10);
      else if (from === 'tab' && to === 'found') addScore(10);
      else if (from === 'found' && to === 'tab') addScore(-15);
    } else if (s === 'vegas') {
      if (to === 'found' && from !== 'found') addScore(5);
      else if (from === 'found' && to === 'tab') addScore(-5);
    }
  }

  function maxPasses() {
    if (game.mode.scoring !== 'vegas') return Infinity;
    return game.mode.draw === 3 ? 3 : 1;
  }

  // ---------------------------------------------------------------- timer
  function startTimer() {
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (!game.started || game.won) return;
      game.seconds++;
      if (game.mode.timed && game.mode.scoring === 'standard' && game.seconds % 10 === 0) {
        addScore(-2);
      }
      updateStatus();
    }, 1000);
  }

  function markStarted() {
    game.started = true;
  }

  // ---------------------------------------------------------------- rules
  const top = (pile) => pile.cards[pile.cards.length - 1];

  function canDrop(moving, pile) {
    const c = moving[0];
    const t = top(pile);
    if (pile.type === 'found') {
      if (moving.length !== 1) return false;
      return t ? t.suit === c.suit && c.rank === t.rank + 1 : c.rank === 1;
    }
    if (pile.type === 'tab') {
      if (!t) return c.rank === 13;
      return t.up && isRed(t.suit) !== isRed(c.suit) && c.rank === t.rank - 1;
    }
    return false;
  }

  function moveCards(from, count, to) {
    markStarted();
    pushUndo();
    const moving = from.cards.splice(from.cards.length - count, count);
    to.cards.push(...moving);
    if (from.type === 'waste') game.wasteShown = Math.max(1, game.wasteShown - 1);
    scoreMove(from.type, to.type);
    afterMove();
  }

  function afterMove() {
    render();
    updateStatus();
    updateMenu();
    checkWin();
  }

  function drawFromStock() {
    if (game.won) return;
    const stock = piles.stock;
    const waste = piles.waste;
    if (stock.cards.length === 0) {
      if (waste.cards.length === 0) return;
      if (game.passes + 1 >= maxPasses()) return; // no more redeals (Vegas)
      markStarted();
      pushUndo();
      stock.cards = waste.cards.reverse();
      waste.cards = [];
      stock.cards.forEach((c) => (c.up = false));
      game.passes++;
      game.wasteShown = 0;
      if (game.mode.scoring === 'standard') addScore(game.mode.draw === 3 ? -20 : -100);
    } else {
      markStarted();
      pushUndo();
      const n = Math.min(game.mode.draw, stock.cards.length);
      for (let i = 0; i < n; i++) {
        const c = stock.cards.pop();
        c.up = true;
        waste.cards.push(c);
      }
      game.wasteShown = n;
    }
    afterMove();
  }

  function flipTop(pile) {
    const c = top(pile);
    if (!c || c.up) return;
    markStarted();
    pushUndo();
    c.up = true;
    if (game.mode.scoring === 'standard') addScore(5);
    afterMove();
  }

  // Send a single top card to a foundation if possible.
  function sendToFoundation(pile) {
    const c = top(pile);
    if (!c || !c.up || pile.type === 'found') return false;
    const target = piles.found.find((f) => canDrop([c], f));
    if (!target) return false;
    moveCards(pile, 1, target);
    return true;
  }

  // Right-click: move everything that can go up to the foundations.
  function autoPlay() {
    if (game.won) return;
    let moved = true;
    while (moved && !game.won) {
      moved = false;
      for (const pile of [piles.waste, ...piles.tab]) {
        if (sendToFoundation(pile)) { moved = true; break; }
      }
    }
  }

  function checkWin() {
    if (game.won || !piles.found.every((f) => f.cards.length === 13)) return;
    game.won = true;
    undoState = null;
    if (game.mode.scoring === 'standard' && game.mode.timed && game.seconds >= 30) {
      addScore(Math.round(700000 / game.seconds));
    }
    if (game.mode.scoring === 'standard' && game.score > highScore) {
      highScore = game.score;
      store.set('solitaire.highscore', highScore);
    }
    if (game.mode.cumulative) {
      vegasBank = game.score;
      store.set('solitaire.vegasBank', vegasBank);
    }
    updateStatus();
    updateMenu();
    setTimeout(startCascade, 400);
  }

  // ---------------------------------------------------------------- layout & render
  function computeLayout() {
    const W = board.clientWidth;
    const H = board.clientHeight;
    let gap = Math.max(4, W * 0.02);
    let cw = (W - 8 * gap) / 7;
    let ch = cw * RATIO;
    const maxCh = H / 2.6;
    if (ch > maxCh) {
      ch = maxCh;
      cw = ch / RATIO;
    }
    const gapY = Math.max(4, Math.min(gap / 2, 12));
    const totalW = 7 * cw + 6 * gap;
    const x0 = (W - totalW) / 2;
    layout = {
      W, H, cw, ch, gap,
      colX: (i) => x0 + i * (cw + gap),
      topY: gapY,
      tabY: gapY * 2 + ch,
      down: ch * 0.06,
      up: ch * 0.2,
      fan: cw * 0.2,
      thick: (n) => Math.floor(n / 8) * Math.max(1, cw / 100),
    };
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
    board.style.setProperty('--r', Math.max(3, cw * 0.06) + 'px');
  }

  function place(el, x, y, z) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.zIndex = z;
  }

  // Returns {x, y} for every card in every pile.
  function positions() {
    const L = layout;
    const pos = new Map();
    piles.stock.cards.forEach((c, j) => {
      const o = L.thick(j);
      pos.set(c, { x: L.colX(0) + o, y: L.topY + o, z: 10 + j });
    });
    const w = piles.waste.cards;
    const fanCount = game.mode.draw === 3 ? Math.min(Math.max(game.wasteShown, 1), 3, w.length) : 1;
    const baseThick = L.thick(Math.max(0, w.length - fanCount));
    w.forEach((c, j) => {
      const fanIdx = j - (w.length - fanCount);
      const x = L.colX(1) + baseThick + (fanIdx > 0 ? fanIdx * L.fan : 0);
      const o = fanIdx > 0 ? baseThick : L.thick(j);
      pos.set(c, { x: fanIdx > 0 ? x : L.colX(1) + o, y: L.topY + (fanIdx > 0 ? baseThick : o), z: 100 + j });
    });
    piles.found.forEach((f, i) => {
      f.cards.forEach((c, j) => {
        const o = L.thick(j);
        pos.set(c, { x: L.colX(3 + i) + o, y: L.topY + o, z: 200 + j });
      });
    });
    piles.tab.forEach((t, i) => {
      const downs = t.cards.filter((c) => !c.up).length;
      const ups = t.cards.length - downs;
      let upStep = L.up;
      const avail = L.H - L.tabY - L.ch - L.gap / 2;
      if (ups > 1) {
        const needed = downs * L.down + (ups - 1) * upStep;
        if (needed > avail) upStep = Math.max(L.ch * 0.08, (avail - downs * L.down) / (ups - 1));
      }
      let y = L.tabY;
      t.cards.forEach((c, j) => {
        pos.set(c, { x: L.colX(i), y, z: 300 + j });
        y += c.up ? upStep : L.down;
      });
    });
    return pos;
  }

  function render() {
    if (!layout) computeLayout();
    const L = layout;
    place(slots.stock, L.colX(0), L.topY, 1);
    place(slots.waste, L.colX(1), L.topY, 1);
    slots.found.forEach((s, i) => place(s, L.colX(3 + i), L.topY, 1));
    slots.tab.forEach((s, i) => place(s, L.colX(i), L.tabY, 1));
    const exhausted = piles.stock.cards.length === 0 && game.passes + 1 >= maxPasses();
    slots.stock.classList.toggle('no-redeal', exhausted);

    const animating = board.classList.contains('animate');
    for (const [c, p] of positions()) {
      c.el.classList.toggle('down', !c.up);
      const moved = Math.abs(parseFloat(c.el.style.left) - p.x) > 0.5 || Math.abs(parseFloat(c.el.style.top) - p.y) > 0.5;
      clearTimeout(c.zTimer);
      if (animating && moved) {
        // Keep a travelling card above everything until it has landed.
        place(c.el, p.x, p.y, 1000 + p.z);
        c.zTimer = setTimeout(() => (c.el.style.zIndex = p.z), MOVE_MS + 40);
      } else {
        place(c.el, p.x, p.y, p.z);
      }
    }
  }

  // ---------------------------------------------------------------- status & menu
  function fmtTime(s) {
    const pad = (n) => String(n).padStart(2, '0');
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }

  function updateStatus() {
    const s = game.mode.scoring;
    statusTime.style.display = game.mode.timed ? '' : 'none';
    statusTime.textContent = 'Time : ' + fmtTime(game.seconds);
    statusHigh.style.display = s === 'standard' ? '' : 'none';
    statusHigh.textContent = 'High Score : ' + highScore;
    statusScore.style.display = s === 'none' ? 'none' : '';
    statusScore.textContent = s === 'vegas'
      ? 'Score : ' + (game.score < 0 ? '-$' + -game.score : '$' + game.score)
      : 'Score : ' + game.score;
    statusMsg.textContent = game.won ? 'You win! Press Space to deal again' : 'For new game, press Space';
  }

  function updateMenu() {
    document.querySelectorAll('[data-setting]').forEach((li) => {
      li.classList.add('radio');
      li.classList.toggle('checked', String(settings[li.dataset.setting]) === li.dataset.value);
    });
    document.querySelectorAll('[data-toggle]').forEach((li) => {
      li.classList.toggle('checked', !!settings[li.dataset.toggle]);
    });
    document.querySelector('[data-toggle="cumulative"]').classList.toggle('disabled', settings.scoring !== 'vegas');
    document.getElementById('menu-undo').classList.toggle('disabled', !undoState);
  }

  // ---------------------------------------------------------------- input
  let drag = null;
  let lastClick = { id: -1, t: 0 };

  function findCard(id) {
    for (const p of allPiles()) {
      const idx = p.cards.findIndex((c) => c.id === id);
      if (idx >= 0) return { pile: p, idx };
    }
    return null;
  }

  function rectOverlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function pileDropRect(pile) {
    const L = layout;
    const t = top(pile);
    if (pile.type === 'found') return { x: L.colX(3 + pile.index), y: L.topY, w: L.cw, h: L.ch };
    if (!t) return { x: L.colX(pile.index), y: L.tabY, w: L.cw, h: L.ch };
    return { x: parseFloat(t.el.style.left), y: parseFloat(t.el.style.top), w: L.cw, h: L.ch };
  }

  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !game || game.won || drag) return;
    closeMenus();
    const el = e.target.closest('.card');
    const slot = e.target.closest('.slot');
    if (!el) {
      if (slot === slots.stock) drag = { kind: 'stock', x: e.clientX, y: e.clientY };
      return;
    }
    const found = findCard(+el.dataset.id);
    if (!found) return;
    const { pile, idx } = found;
    const card = pile.cards[idx];
    const isTop = idx === pile.cards.length - 1;

    if (pile.type === 'stock') {
      drag = { kind: 'stock', x: e.clientX, y: e.clientY };
      return;
    }
    if (!card.up) {
      if (pile.type === 'tab' && isTop) drag = { kind: 'flip', pile, x: e.clientX, y: e.clientY };
      return;
    }
    if ((pile.type === 'waste' || pile.type === 'found') && !isTop) return;

    const moving = pile.cards.slice(idx);
    drag = {
      kind: 'cards',
      pile,
      card,
      moving,
      x: e.clientX,
      y: e.clientY,
      origin: moving.map((c) => ({ x: parseFloat(c.el.style.left), y: parseFloat(c.el.style.top) })),
      moved: false,
    };
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag || drag.kind !== 'cards') return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.moving.forEach((c, i) => {
        c.el.classList.add('dragging');
        c.el.style.zIndex = 3000 + i;
      });
    }
    drag.moving.forEach((c, i) => {
      c.el.style.left = drag.origin[i].x + dx + 'px';
      c.el.style.top = drag.origin[i].y + dy + 'px';
    });
  });

  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'stock') {
      if (!cancelled) drawFromStock();
      return;
    }
    if (d.kind === 'flip') {
      if (!cancelled) flipTop(d.pile);
      return;
    }
    d.moving.forEach((c) => c.el.classList.remove('dragging'));

    if (!d.moved) {
      if (cancelled) return;
      const now = performance.now();
      if (lastClick.id === d.card.id && now - lastClick.t < DOUBLE_CLICK_MS) {
        lastClick = { id: -1, t: 0 };
        if (d.moving.length === 1) sendToFoundation(d.pile);
      } else {
        lastClick = { id: d.card.id, t: now };
      }
      return;
    }

    if (!cancelled) {
      const L = layout;
      const r = {
        x: parseFloat(d.card.el.style.left),
        y: parseFloat(d.card.el.style.top),
        w: L.cw,
        h: L.ch,
      };
      const candidates = [...piles.tab, ...piles.found]
        .filter((p) => p !== d.pile)
        .map((p) => ({ p, area: rectOverlap(r, pileDropRect(p)) }))
        .filter((o) => o.area > 0)
        .sort((a, b) => b.area - a.area);
      for (const { p } of candidates) {
        if (canDrop(d.moving, p)) {
          moveCards(d.pile, d.moving.length, p);
          return;
        }
      }
    }
    render(); // snap back
  }

  board.addEventListener('pointerup', (e) => endDrag(e, false));
  board.addEventListener('pointercancel', (e) => endDrag(e, true));

  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!drag) autoPlay();
  });

  document.addEventListener('keydown', (e) => {
    if (!dialogBackdrop.hidden) {
      if (e.key === 'Escape') closeDialog();
      return;
    }
    if (cascade) {
      e.preventDefault();
      stopCascade(true);
      return;
    }
    if (e.key === 'F2' || e.code === 'Space') {
      e.preventDefault();
      deal();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      closeMenus();
    }
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      board.classList.remove('animate');
      computeLayout();
      if (game) render();
      if (cascade) stopCascade(false);
      requestAnimationFrame(() => board.classList.add('animate'));
    });
  });

  // ---------------------------------------------------------------- menus
  const menus = document.querySelectorAll('.menu');
  function closeMenus() {
    menus.forEach((m) => m.classList.remove('open'));
  }
  menus.forEach((menu) => {
    menu.querySelector('.menu-title').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
    menu.querySelector('.menu-title').addEventListener('pointerenter', () => {
      if ([...menus].some((m) => m.classList.contains('open'))) {
        closeMenus();
        menu.classList.add('open');
      }
    });
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.menu')) closeMenus();
  });

  document.querySelectorAll('.menu-list li').forEach((li) => {
    li.addEventListener('click', () => {
      if (li.classList.contains('sep') || li.classList.contains('disabled')) return;
      closeMenus();
      if (li.dataset.action) return menuAction(li.dataset.action);
      if (li.dataset.setting) {
        const key = li.dataset.setting;
        const value = key === 'draw' ? +li.dataset.value : li.dataset.value;
        if (settings[key] === value) return;
        settings[key] = value;
        store.set('solitaire.settings', settings);
        deal(); // like XP, changing options starts a new deal
        return;
      }
      if (li.dataset.toggle) {
        const key = li.dataset.toggle;
        settings[key] = !settings[key];
        store.set('solitaire.settings', settings);
        if (key === 'cumulative' && !settings.cumulative) {
          vegasBank = 0;
          store.set('solitaire.vegasBank', 0);
        }
        deal();
      }
    });
  });

  function menuAction(action) {
    switch (action) {
      case 'deal': return deal();
      case 'undo': return undo();
      case 'exit':
        if (window.parent !== window) window.parent.postMessage({ type: 'games:exit' }, location.origin);
        else window.location.href = '../../';
        return;
      case 'help':
        return openDialog('How to play', `
          <p>Build four piles up by suit, from Ace to King, in the top-right foundations.</p>
          <ul>
            <li>On the seven tableau columns, stack cards down in alternating colours (red on black, black on red).</li>
            <li>Only a King can be placed on an empty column.</li>
            <li>Click the deck to draw cards. Click a face-down card at the bottom of a column to turn it over.</li>
            <li>Double-click a card to send it to a foundation. Right-click anywhere to send every possible card up.</li>
            <li><b>F2</b> / <b>Space</b>: new deal &nbsp;·&nbsp; <b>Ctrl+Z</b>: undo the last move.</li>
          </ul>
          <p><b>Standard scoring:</b> waste→column +5, to foundation +10, turn over a card +5, foundation→column −15,
          recycling the deck −100 (Draw One) or −20 (Draw Three), −2 every 10 seconds in a timed game,
          and a time bonus when you win.</p>
          <p><b>Vegas scoring:</b> you buy the deck for $52 and win $5 per card on the foundations.
          Draw One allows a single pass through the deck, Draw Three allows three.</p>`, [['OK']]);
      case 'about':
        return openDialog('About Solitaire', `
          <p><b>Solitaire</b></p>
          <p>A tribute to the classic desktop Klondike, playable in the browser.</p>`, [['OK']]);
    }
  }

  // ---------------------------------------------------------------- dialog
  const dialogBackdrop = document.getElementById('dialog-backdrop');
  function openDialog(title, html, buttons) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = html;
    const box = document.getElementById('dialog-buttons');
    box.innerHTML = '';
    buttons.forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        closeDialog();
        if (fn) fn();
      });
      box.appendChild(b);
    });
    dialogBackdrop.hidden = false;
    box.querySelector('button')?.focus();
  }
  function closeDialog() {
    dialogBackdrop.hidden = true;
  }
  dialogBackdrop.querySelector('[data-dialog="close"]').addEventListener('click', closeDialog);

  // ---------------------------------------------------------------- win cascade
  let cascade = null;

  function startCascade() {
    if (!game.won) return;
    const L = layout;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = L.W * dpr;
    canvas.height = L.H * dpr;
    canvas.style.width = L.W + 'px';
    canvas.style.height = L.H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    canvas.classList.add('active');

    const stacks = piles.found.map((f) => f.cards.slice());
    cascade = { ctx, stacks, next: 0, current: null, raf: 0 };

    const launch = () => {
      // Kings first, round-robin across the four foundations.
      for (let k = 0; k < 4; k++) {
        const i = (cascade.next + k) % 4;
        const stack = stacks[i];
        if (stack.length) {
          cascade.next = (i + 1) % 4;
          const c = stack.pop();
          c.el.classList.add('hidden');
          let vx = (Math.random() * 6 + 2) * (L.cw / 100) * (Math.random() < 0.5 ? -1 : 1);
          if (i === 0 && vx < 0 && L.colX(3) < L.cw * 2) vx = -vx;
          return {
            card: c,
            x: L.colX(3 + i),
            y: L.topY,
            vx,
            vy: -(Math.random() * 6 + 2) * (L.ch / 140),
          };
        }
      }
      return null;
    };

    const gravity = 0.5 * (L.ch / 140);
    const step = () => {
      if (!cascade) return;
      let cur = cascade.current;
      if (!cur) {
        cur = cascade.current = launch();
        if (!cur) {
          stopCascade(true);
          return;
        }
      }
      // Several sub-steps per frame keep the trail dense, like the original.
      for (let s = 0; s < 2; s++) {
        cur.vy += gravity;
        cur.x += cur.vx;
        cur.y += cur.vy;
        if (cur.y + L.ch > L.H) {
          cur.y = L.H - L.ch;
          cur.vy = -cur.vy * 0.75;
        }
        ctx.drawImage(cur.card.img, cur.x, cur.y, L.cw, L.ch);
      }
      if (cur.x + L.cw < 0 || cur.x > L.W) cascade.current = null;
      cascade.raf = requestAnimationFrame(step);
    };
    cascade.raf = requestAnimationFrame(step);
    canvas.onpointerdown = () => stopCascade(true);
  }

  function stopCascade(askDealAgain) {
    if (!cascade) return;
    cancelAnimationFrame(cascade.raf);
    cascade = null;
    canvas.classList.remove('active');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    cards.forEach((c) => c.el.classList.remove('hidden'));
    if (askDealAgain) {
      openDialog('Game Over', '<p>Deal again?</p>', [['Yes', deal], ['No']]);
    }
  }

  // ---------------------------------------------------------------- boot
  computeLayout();
  deal();

  // Test hook (only with ?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__solitaire = { piles, cards, get game() { return game; }, afterMove, render };
  }
})();
