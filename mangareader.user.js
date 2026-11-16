// ==UserScript==
// @name         MangaReader
// @namespace    frosty.spread
// @version      2.0
// @description  Two-page spreader for manga sites that has chapter pages as a column of images
// @match        *://*/*
// @downloadURL  https://raw.githubusercontent.com/coldcommits/mangareader/main/universal-spread.user.js
// @updateURL    https://raw.githubusercontent.com/coldcommits/mangareader/main/universal-spread.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return; // skip iframes

  // site config
  // site overrides if some don't work
  //   images: CSS keyword for images
  //   next:   CSS selector for next chapter link
  const SITES = {
    // 'example-reader.com': { images: '#reader img', next: '#reader-nav a.next' },
  };

  // Containers used by common manga websites, tried before auto-detection
  // Should work for the majority of websites
  const KNOWN_CONTAINERS = [
    '#readerarea',              
    '.reading-content',       
    '.container-chapter-reader', 
    '.chapter-content',
    '.reader-area',
    '.page-break',
    '.entry-content',            
    'article',
  ];
  
  // Same thing for selectors
  const NEXT_SELECTORS = [
    'a[rel=next]', 'a.ch-next-btn', 'a.next_page', '.nav-next a', 'a.next', 'a.btn-next',
  ];

  // Chapter URLs /chapter-52/, /ch-12/, /chap_3, /c/12
  const CHAPTER_URL = /(chapter|chap|ch|episode|ep)[-_/ ]?\d+|\/c\/\d+/i;
  const JUNK = /logo|avatar|banner|icon|sprite|emoji|gravatar|ads?[\/_-]|button|thumb|cover-small/i;
  const MIN_PAGES = 3;

  const cfg = SITES[location.hostname.replace(/^www\./, '')] || {};
  const state = { pages: [], idx: 0, rtl: true, coverAlone: true, overlay: null, spreads: [] };

  // image finder
  const imgUrl = (img) => {
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') || img.getAttribute('data-echo') || img.getAttribute('data-url');
    if (lazy) return lazy.trim();
    const srcset = img.getAttribute('data-srcset');
    if (srcset) return srcset.split(',').pop().trim().split(' ')[0];
    return img.currentSrc || img.src || '';
  };

  const usable = (img) => {
    const u = imgUrl(img);
    if (!u || u.startsWith('data:') || JUNK.test(u)) return false;
    // drop too small images
    if (img.complete && img.naturalWidth && img.naturalWidth < 250) return false;
    return true;
  };

  const dedupe = (urls) => [...new Set(urls)];

  function fromSelector(sel) {
    return dedupe([...document.querySelectorAll(sel)].filter(usable).map(imgUrl));
  }

  function fromKnownContainers() {
    for (const c of KNOWN_CONTAINERS) {
      for (const el of document.querySelectorAll(c)) {
        const urls = dedupe([...el.querySelectorAll('img')].filter(usable).map(imgUrl));
        if (urls.length >= MIN_PAGES) return urls;
      }
    }
    return [];
  }

  // Group image with nearest neighbor
  function fromClusters() {
    const groups = new Map();
    for (const img of [...document.querySelectorAll('img')].filter(usable)) {
      let el = img.parentElement;
      while (el && el !== document.body && el.querySelectorAll('img').length < 2) el = el.parentElement;
      if (!el) continue;
      if (!groups.has(el)) groups.set(el, []);
      groups.get(el).push(img);
    }
    let best = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    return dedupe(best.map(imgUrl));
  }

  function collectPages() {
    if (cfg.images) return fromSelector(cfg.images);
    const known = fromKnownContainers();
    return known.length ? known : fromClusters();
  }

  function findNext() {
    const sels = cfg.next ? [cfg.next, ...NEXT_SELECTORS] : NEXT_SELECTORS;
    for (const s of sels) {
      const a = document.querySelector(s);
      if (a && a.href) return a;
    }
    return [...document.querySelectorAll('a[href]')]
      .find((a) => /^\s*next(\s+chapter)?\s*[»>›→]?\s*$/i.test(a.textContent)) || null;
  }

  // Make spread based off grouping
  function buildSpreads(sizes) {
    const out = [];
    let i = 0;
    if (state.coverAlone && state.pages.length) { out.push([0]); i = 1; }
    const wide = (k) => sizes[k] && sizes[k].w > sizes[k].h;
    while (i < state.pages.length) {
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

  // Reader
  function render() {
    const o = state.overlay;
    const stage = o.querySelector('.tps-stage');
    stage.innerHTML = '';
    const spread = state.spreads[state.idx] || [];
    for (const p of (state.rtl ? [...spread].reverse() : spread)) {
      const im = document.createElement('img');
      im.src = state.pages[p];
      im.referrerPolicy = 'no-referrer-when-downgrade';
      stage.appendChild(im);
    }
    o.querySelector('.tps-info').textContent =
      `${state.idx + 1}/${state.spreads.length}  |  ${state.rtl ? 'RTL' : 'LTR'}  |  cover ${state.coverAlone ? 'alone' : 'paired'}`;
    (state.spreads[state.idx + 1] || []).forEach((p) => { new Image().src = state.pages[p]; });
  }

  function go(d) {
    const n = state.idx + d;
    if (n < 0) return;
    if (n >= state.spreads.length) {
      const next = findNext();
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
    state.idx = keepPage ? Math.max(0, state.spreads.findIndex((s) => s.includes(cur))) : 0;
    render();
  }

  const HANDLED = ['Escape', 'ArrowLeft', 'ArrowRight', ' ', 'r', 'c'];
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  function onKey(e) {
    if (!state.overlay || !HANDLED.includes(e.key)) return;
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

  // Launch reader
  let button = null;
  function maybeAddButton() {
    if (button) return;
    const looksLikeChapter = cfg.images || CHAPTER_URL.test(location.pathname);
    if (!looksLikeChapter || collectPages().length < MIN_PAGES) return;
    button = document.createElement('button');
    button.textContent = 'Spread';
    button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:8px 14px;' +
      'background:#c0392b;color:#fff;border:0;border-radius:6px;cursor:pointer;font:600 14px system-ui';
    button.onclick = open;
    document.body.appendChild(button);
  }
  
  maybeAddButton();
  [1000, 3000, 6000].forEach((t) => setTimeout(maybeAddButton, t));
})();