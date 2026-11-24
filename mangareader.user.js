// ==UserScript==
// @name         MangaReader
// @namespace    frosty.spread
// @version      3.1
// @description  Two-page spreader for manga sites that has chapter pages as a column of images
// @match        *://*/*
// @downloadURL  https://raw.githubusercontent.com/coldcommits/mangareader/main/universal-spread.user.js
// @updateURL    https://raw.githubusercontent.com/coldcommits/mangareader/main/universal-spread.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
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
    "#readerarea",
    ".reading-content",
    ".container-chapter-reader",
    ".chapter-content",
    ".reader-area",
    ".page-break",
    ".entry-content",
    "article",
  ];

  // Same thing for selectors
  const NEXT_SELECTORS = [
    "a[rel=next]",
    "a.ch-next-btn",
    "a.next_page",
    ".nav-next a",
    "a.next",
    "a.btn-next",
  ];

  const PREV_SELECTORS = [
    "a[rel=prev]",
    "a.ch-prev-btn",
    "a.prev_page",
    ".nav-previous a",
    "a.prev",
    "a.btn-prev",
  ];

  // Chapter URLs /chapter-52/, /ch-12/, /chap_3, /c/12
  const CHAPTER_URL = /(chapter|chap|ch|episode|ep)[-_/ ]?\d+|\/c\/\d+/i;
  const JUNK =
    /logo|avatar|banner|icon|sprite|emoji|gravatar|(^|[\/_.-])ads?[\/_.-]|button|thumb|cover-small/i;
  const MIN_PAGES = 3;

  const cfg = SITES[location.hostname.replace(/^www\./, "")] || {};
  const state = {
    pages: [],
    idx: 0,
    rtl: true,
    coverAlone: true,
    overlay: null,
    spreads: [],
    doc: document,
    loading: false,
  };

  // image finder
  const imgUrl = (img) => {
    const lazy =
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-echo") ||
      img.getAttribute("data-url");
    if (lazy) return lazy.trim();
    const srcset = img.getAttribute("data-srcset");
    if (srcset) return srcset.split(",").pop().trim().split(" ")[0];
    return img.currentSrc || img.src || "";
  };

  const usable = (img) => {
    const u = imgUrl(img);
    if (!u || u.startsWith("data:") || JUNK.test(u)) return false;
    // drop too small images
    if (img.complete && img.naturalWidth && img.naturalWidth < 250)
      return false;
    return true;
  };

  const dedupe = (urls) => [...new Set(urls)];

  function fromSelector(sel, root = document) {
    return dedupe([...root.querySelectorAll(sel)].filter(usable).map(imgUrl));
  }

  function fromKnownContainers(root = document) {
    for (const c of KNOWN_CONTAINERS) {
      for (const el of root.querySelectorAll(c)) {
        const urls = dedupe(
          [...el.querySelectorAll("img")].filter(usable).map(imgUrl),
        );
        if (urls.length >= MIN_PAGES) return urls;
      }
    }
    return [];
  }

  // Group image with nearest neighbor
  function fromClusters(root = document) {
    const groups = new Map();
    for (const img of [...root.querySelectorAll("img")].filter(usable)) {
      let el = img.parentElement;
      while (el && el !== root.body && el.querySelectorAll("img").length < 2)
        el = el.parentElement;
      if (!el) continue;
      if (!groups.has(el)) groups.set(el, []);
      groups.get(el).push(img);
    }
    let best = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    return dedupe(best.map(imgUrl));
  }

  function collectPages(root = document) {
    if (cfg.images) return fromSelector(cfg.images, root);
    const known = fromKnownContainers(root);
    return known.length ? known : fromClusters(root);
  }

  function findNext(root = document) {
    const sels = cfg.next ? [cfg.next, ...NEXT_SELECTORS] : NEXT_SELECTORS;
    for (const s of sels) {
      const a = root.querySelector(s);
      if (a && a.href) return a;
    }
    return (
      [...root.querySelectorAll("a[href]")].find((a) =>
        /^\s*next(\s+chapter)?\s*[»>›→]?\s*$|^\s*continue\b/i.test(
          a.textContent,
        ),
      ) || null
    );
  }

  function findPrev(root = document) {
    const sels = cfg.prev ? [cfg.prev, ...PREV_SELECTORS] : PREV_SELECTORS;
    for (const s of sels) {
      const a = root.querySelector(s);
      if (a && a.href) return a;
    }
    return (
      [...root.querySelectorAll("a[href]")].find((a) =>
        /^\s*[«<‹←]?\s*prev(ious)?(\s+chapter)?\s*$/i.test(a.textContent),
      ) || null
    );
  }

  // Make spread based off grouping
  function buildSpreads(sizes) {
    const out = [];
    let i = 0;
    if (state.coverAlone && state.pages.length) {
      out.push([0]);
      i = 1;
    }
    const wide = (k) => sizes[k] && sizes[k].w > sizes[k].h;
    while (i < state.pages.length) {
      if (wide(i) || i === state.pages.length - 1 || wide(i + 1)) {
        out.push([i]);
        i += 1;
      } else {
        out.push([i, i + 1]);
        i += 2;
      }
    }
    return out;
  }

  function loadSizes() {
    return Promise.all(
      state.pages.map(
        (u) =>
          new Promise((res) => {
            const im = new Image();
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => res(null);
            im.src = u;
          }),
      ),
    );
  }

  // Reader
  function render() {
    const o = state.overlay;
    const stage = o.querySelector(".tps-stage");
    stage.innerHTML = "";
    const spread = state.spreads[state.idx] || [];
    for (const p of state.rtl ? [...spread].reverse() : spread) {
      const im = document.createElement("img");
      im.src = state.pages[p];
      im.referrerPolicy = "no-referrer-when-downgrade";
      stage.appendChild(im);
    }
    o.querySelector(".tps-title").textContent = chapterTitle();
    o.querySelector(".tps-info").textContent =
      `${state.idx + 1}/${state.spreads.length}  |  ${state.rtl ? "RTL" : "LTR"}  |  cover ${state.coverAlone ? "alone" : "paired"}`;
    (state.spreads[state.idx + 1] || []).forEach((p) => {
      new Image().src = state.pages[p];
    });
    const isLast = state.idx === state.spreads.length - 1;
    o.querySelector(".tps-nextch").style.display =
      isLast && findNext(state.doc) ? "block" : "none";

    o.querySelector(".tps-prevch").style.display =
      state.idx === 0 && findPrev(state.doc) ? "block" : "none";
  }

  async function loadChapter(url, atEnd) {
    if (state.loading) return;
    state.loading = true;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(
        await res.text(),
        "text/html",
      );
      const base = doc.createElement("base");
      base.href = url;
      doc.head.prepend(base);
      const pages = collectPages(doc);
      if (pages.length < MIN_PAGES) throw new Error("no pages");
      state.doc = doc;
      state.pages = pages;
      history.pushState(null, "", url);
      if (doc.title) document.title = doc.title;
      state.idx = 0;
      await rebuild(false);
      if (atEnd) {
        state.idx = state.spreads.length - 1;
        render();
      }
    } catch {
      sessionStorage.setItem("tps-auto", atEnd ? "end" : "start");
      location.href = url;
    } finally {
      state.loading = false;
    }
  }

  function goNextChapter() {
    const next = findNext(state.doc);
    if (next) loadChapter(next.href, false);
  }

  function goPreviousChapter() {
    const prev = findPrev(state.doc);
    if (prev) loadChapter(prev.href, true);
  }

  function go(d) {
    const n = state.idx + d;
    if (n < 0) {
      goPreviousChapter();
      return;
    }
    if (n >= state.spreads.length) {
      goNextChapter();
      return;
    }
    state.idx = n;
    render();
  }

  async function rebuild(keepPage) {
    const sizes = await loadSizes();
    const cur = (state.spreads[state.idx] || [0])[0];
    state.spreads = buildSpreads(sizes);
    state.idx = keepPage
      ? Math.max(
          0,
          state.spreads.findIndex((s) => s.includes(cur)),
        )
      : 0;
    render();
  }

  const HANDLED = ["Escape", "ArrowLeft", "ArrowRight", " ", "r", "c", "f"];

  function chapterTitle() {
    const parts = location.pathname.split("/").filter(Boolean);
    let slug = parts.pop() || "";
    if (/^(chapter|chap|ch|episode|ep)[-_ ]?\d/i.test(slug) && parts.length)
      slug = parts.pop() + " " + slug;
    return decodeURIComponent(slug)
      .replace(/\.\w+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  const KEY_EVENTS = ["keydown", "keyup", "keypress"];

  function onKey(e) {
    if (!state.overlay || !HANDLED.includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (e.type !== "keydown") return;
    const k = e.key;
    if (k === "Escape") return close();
    if (k === "ArrowLeft") go(state.rtl ? 1 : -1);
    else if (k === "ArrowRight") go(state.rtl ? -1 : 1);
    else if (k === " ") go(e.shiftKey ? -1 : 1);
    else if (k === "r") {
      state.rtl = !state.rtl;
      render();
    } else if (k === "c") {
      state.coverAlone = !state.coverAlone;
      rebuild(true);
    } else if (k === "f") {
      toggleFullscreen();
    }
  }

  function close() {
    if (document.fullscreenElement) document.exitFullscreen();
    state.overlay.remove();
    state.overlay = null;
    document.documentElement.style.overflow = "";
    KEY_EVENTS.forEach((t) => window.removeEventListener(t, onKey, true));
    if (state.doc !== document) location.reload();
  }

  async function open(atEnd = false) {
    state.pages = collectPages();
    if (state.pages.length < 2) {
      alert("Could not find chapter images on this page.");
      return;
    }
    const o = document.createElement("div");
    o.innerHTML = `
      <style>
        .tps{position:fixed;inset:0;z-index:2147483647;background:#111;color:#ddd;font:13px system-ui;display:flex;flex-direction:column}
        .tps-stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:center}
        .tps-stage img{max-height:100%;max-width:50%;object-fit:contain;display:block}
        .tps-stage img:only-child{max-width:100%}
        .tps-bar{padding:6px 12px;background:#000;display:flex;gap:16px;align-items:center}
        .tps-bar button{background:#333;color:#ddd;border:0;padding:3px 10px;border-radius:4px;cursor:pointer}
        .tps-hit{position:absolute;top:0;bottom:30px;width:35%;cursor:pointer}
        .tps-chnav{position:absolute;bottom:50px;left:50%;transform:translateX(-50%);z-index:2;display:flex;gap:12px}
        .tps-chnav button{display:none;padding:10px 20px;background:#c0392b;color:#fff;border:0;border-radius:6px;font:600 15px system-ui;cursor:pointer;white-space:nowrap}
      </style>
      <div class="tps">
        <div class="tps-stage"></div>
        <div class="tps-hit" style="left:0" data-side="l"></div>
        <div class="tps-hit" style="right:0" data-side="r"></div>
        <div class="tps-chnav">
          <button class="tps-prevch">&larr; Previous chapter</button>
          <button class="tps-nextch">Next chapter &rarr;</button>
        </div>
        <div class="tps-bar">
          <span class="tps-info"></span>
          <span>&larr;/&rarr; or click sides: turn | R: flip direction | C: cover alone | F: fullscreen | Esc: close</span>
    <span class="tps-title" style="margin-left:auto;font-weight:600;color:#fff"></span>
          <button class="tps-fs">Fullscreen</button>
          <button class="tps-x">Close</button>
        </div>
      </div>`;
    o.querySelector(".tps-prevch").onclick = goPreviousChapter;
    document.body.appendChild(o);
    state.overlay = o;
    document.documentElement.style.overflow = "hidden";
    o.querySelector(".tps-x").onclick = close;
    o.querySelector(".tps-fs").onclick = toggleFullscreen;
    o.querySelector(".tps-nextch").onclick = goNextChapter;
    o.querySelectorAll(".tps-hit").forEach((h) => {
      h.onclick = () => {
        const left = h.dataset.side === "l";
        go(left ? (state.rtl ? 1 : -1) : state.rtl ? -1 : 1);
      };
    });
    KEY_EVENTS.forEach((t) => window.addEventListener(t, onKey, true));
    state.idx = 0;
    await rebuild(false);
    if (atEnd) {
      state.idx = state.spreads.length - 1;
      render();
    }
  }

  // Launch reader
  let button = null;
  function maybeAddButton() {
    if (button) return;
    const looksLikeChapter = cfg.images || CHAPTER_URL.test(location.pathname);
    if (!looksLikeChapter || collectPages().length < MIN_PAGES) return;
    button = document.createElement("button");
    button.textContent = "Spread";
    button.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:8px 14px;" +
      "background:#c0392b;color:#fff;border:0;border-radius:6px;cursor:pointer;font:600 14px system-ui";
    button.onclick = () => open();
    document.body.appendChild(button);
    const auto = sessionStorage.getItem("tps-auto");
    if (auto) {
      sessionStorage.removeItem("tps-auto");
      open(auto === "end");
    }
  }

  window.addEventListener("popstate", () => {
    if (state.doc !== document) location.reload();
  });

  maybeAddButton();
  [1000, 3000, 6000].forEach((t) => setTimeout(maybeAddButton, t));
})();
