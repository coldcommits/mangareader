// ==UserScript==
// @name         mangareader
// @namespace    frosty.spread
// @version      1.0
// @description  Adds a button that lays out online manga scans to two pages
// @match        https://w3.chainsawmann.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const state = { pages: [], idx: 0, rtl: true, coverAlone: true, overlay: null, spreads: [] };

  //find chapter images
  const imgUrl = (img) =>
    img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
    img.getAttribute('data-original') || img.currentSrc || img.src || '';

  function collectPages() {
    const imgs = [...document.querySelectorAll('img')].filter((i) => {
      const u = imgUrl(i);
      return u && !u.startsWith('data:') && !/logo|avatar|banner|icon|sprite/i.test(u);
    });
    //group images by the nearest ancestor that has 2+ <img>, take the biggest
    const groups = new Map();
    for (const img of imgs) {
      let el = img.parentElement;
      while (el && el !== document.body && el.querySelectorAll('img').length < 2) el = el.parentElement;
      if (!el) continue;
      if (!groups.has(el)) groups.set(el, []);
      groups.get(el).push(img);
    }
    let best = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    return best.map(imgUrl);
  }

  //make spread
  //wide images leave alone; cover optionally leave alone
  function buildSpreads(sizes) {
    const out = [];
    let i = 0;
    if (state.coverAlone && state.pages.length) { out.push([0]); i = 1; }
    while (i < state.pages.length) {
      const wide = (k) => sizes[k] && sizes[k].w > sizes[k].h;
      if (wide(i) || i === state.pages.length - 1 || wide(i + 1)) { out.push([i]); i += 1; }
      else { out.push([i, i + 1]); i += 2; }
    }
    return out;
  }

  function loadSizes() {
    return Promise.all(state.pages.map((u) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = u;
    })));
  }

  //simple UI
  function render() {
    const o = state.overlay;
    const stage = o.querySelector('.tps-stage');
    stage.innerHTML = '';
    const spread = state.spreads[state.idx] || [];
    const order = state.rtl ? [...spread].reverse() : spread;
    for (const p of order) {
      const im = document.createElement('img');
      im.src = state.pages[p];
      stage.appendChild(im);
    }
    o.querySelector('.tps-info').textContent =
      `${state.idx + 1}/${state.spreads.length}  |  ${state.rtl ? 'RTL' : 'LTR'}  |  cover ${state.coverAlone ? 'alone' : 'paired'}`;
    //preload next one
    (state.spreads[state.idx + 1] || []).forEach((p) => { new Image().src = state.pages[p]; });
  }

  function go(d) {
    const n = state.idx + d;
    if (n < 0) return;
    if (n >= state.spreads.length) {
      const next = document.querySelector('a[rel=next], a.next, a[href*="chapter"][class*="next" i]') ||
        [...document.querySelectorAll('a')].find((a) => /^\s*next/i.test(a.textContent));
      if (next) location.href = next.href;
      return;
    }
    state.idx = n;
    render();
  }

  async function rebuild(keepPage) {
    const sizes = await loadSizes();
    const cur = (state.spreads[state.idx] || [0])[0];
    state.spreads = buildSpreads(sizes);
    if (keepPage) state.idx = Math.max(0, state.spreads.findIndex((s) => s.includes(cur)));
    render();
  }

  const HANDLED = ['Escape', 'ArrowLeft', 'ArrowRight', ' ', 'r', 'c'];

  function onKey(e) {
    if (!state.overlay || !HANDLED.includes(e.key)) return;
    // stop site's native left/right arrow controls from turning page
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (e.type !== 'keydown') return;
    const k = e.key;
    if (k === 'Escape') return close();
    if (k === 'ArrowLeft') go(state.rtl ? 1 : -1);
    else if (k === 'ArrowRight') go(state.rtl ? -1 : 1);
    else if (k === ' ') go(e.shiftKey ? -1 : 1);
    else if (k === 'r') { state.rtl = !state.rtl; render(); }
    else if (k === 'c') { state.coverAlone = !state.coverAlone; rebuild(true); }
  }

  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  function close() {
    state.overlay.remove();
    state.overlay = null;
    document.documentElement.style.overflow = '';
    KEY_EVENTS.forEach((t) => window.removeEventListener(t, onKey, true));
  }

  async function open() {
    state.pages = collectPages();
    if (state.pages.length < 2) { alert('Could not find chapter images on this page.'); return; }
    const o = document.createElement('div');
    o.innerHTML = `
      <style>
        .tps{position:fixed;inset:0;z-index:2147483647;background:#111;color:#ddd;font:13px system-ui;display:flex;flex-direction:column}
        .tps-stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:center}
        .tps-stage img{max-height:100%;max-width:50%;object-fit:contain;display:block}
        .tps-stage img:only-child{max-width:100%}
        .tps-bar{padding:6px 12px;background:#000;display:flex;gap:16px;align-items:center}
        .tps-bar button{background:#333;color:#ddd;border:0;padding:3px 10px;border-radius:4px;cursor:pointer}
        .tps-hit{position:absolute;top:0;bottom:30px;width:35%;cursor:pointer}
      </style>
      <div class="tps">
        <div class="tps-stage"></div>
        <div class="tps-hit" style="left:0" data-side="l"></div>
        <div class="tps-hit" style="right:0" data-side="r"></div>
        <div class="tps-bar">
          <span class="tps-info"></span>
          <span>&larr;/&rarr; or click sides: turn | R: flip direction | C: cover alone | Esc: close</span>
          <button class="tps-x" style="margin-left:auto">Close</button>
        </div>
      </div>`;
    document.body.appendChild(o);
    state.overlay = o;
    document.documentElement.style.overflow = 'hidden';
    o.querySelector('.tps-x').onclick = close;
    o.querySelectorAll('.tps-hit').forEach((h) => {
      h.onclick = () => {
        const left = h.dataset.side === 'l';
        go(left ? (state.rtl ? 1 : -1) : (state.rtl ? -1 : 1));
      };
    });
    KEY_EVENTS.forEach((t) => window.addEventListener(t, onKey, true));
    state.idx = 0;
    await rebuild(false);
  }

  //launcher button
  if (/chapter/i.test(location.pathname)) {
    const b = document.createElement('button');
    b.textContent = 'Spread';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:8px 14px;' +
      'background:#c0392b;color:#fff;border:0;border-radius:6px;cursor:pointer;font:600 14px system-ui';
    b.onclick = open;
    document.body.appendChild(b);
  }
})();
