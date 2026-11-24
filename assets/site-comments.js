(function () {
  'use strict';

  /**
   * Site Comments by BornPixel.
   * Comment mode: hover highlights the thing under the pointer, a click opens a comment box
   * pinned to it. Pins, threads and the page list all talk to the plugin's REST API.
   *
   * All of the plugin's UI lives in one shadow root, so no theme can restyle, hide or break it,
   * and none of its styles leak into the site. That is what lets it drop into any WordPress site.
   */
  const cfg = window.bpSiteComments;
  if (!cfg || window.__bpSiteComments) return;
  window.__bpSiteComments = true;

  const UI = 'bp-sc';
  const doc = document;
  const root = doc.documentElement;
  const pageUrl = () => location.href.split('#')[0];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let on = false;
  let showResolved = false;
  let comments = [];
  let hoverEl = null;
  let lockedEl = null;   // Element picked with ↑ / ↓ while hovering.
  let pickStack = [];    // For ↓: children we climbed out of.
  let openPopover = null;

  /* ---------------- helpers ---------------- */
  const h = (tag, attrs = {}, html = '') => {
    const el = doc.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (el.className = v) : el.setAttribute(k, v)));
    if (html) el.innerHTML = html;
    return el;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
  // Comment text with its web addresses and emails made clickable (they open in a new tab).
  // The text is split around the addresses and every piece escaped, so nothing in it can become markup.
  const URLS = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[^\s<>"']+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b)/gi;
  const rich = (text) => String(text ?? '').split(URLS).map((part, i) => {
    if (i % 2 === 0) return nl2br(part);
    const tail = (part.match(/[).,!?;:]+$/) || [''])[0];   // "see example.com." keeps the full stop as text
    const url = tail ? part.slice(0, -tail.length) : part;
    const href = url.includes('@') && !/^https?:/i.test(url) ? `mailto:${url}` : (/^www\./i.test(url) ? `https://${url}` : url);
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url)}</a>${esc(tail)}`;
  }).join('');
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const ago = (iso) => {
    let v = Math.max(1, (Date.now() - new Date(iso)) / 1000);
    const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
    for (const [n, unit] of steps) {
      if (v < n) { v = Math.floor(v); return unit === 'second' ? 'just now' : `${v} ${unit}${v === 1 ? '' : 's'} ago`; }
      v /= n;
    }
    return '';
  };
  const api = async (path = '', opts = {}) => {
    const res = await fetch(cfg.api + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'rest_cookie_invalid_nonce') throw new Error('Your session has expired. Reload the page and try again.');
      if (res.status === 401) throw new Error('You have been logged out. Log in again to comment.');
      throw new Error(data.message || 'Something went wrong. Please try again.');
    }
    return data;
  };

  /* ---------------- the isolated layer ---------------- */
  // data-lenis-prevent: smooth-scroll libraries (Lenis, used by MouseWheel Smooth Scroll and many
  // themes) would otherwise swallow the wheel, so the comment list and long threads could not scroll.
  // The layer itself lets pointer events through, so the page keeps its smooth scrolling.
  const host = h('div', { id: 'bp-site-comments', 'data-bp-sc': '', 'data-lenis-prevent': '' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="${esc(cfg.css)}">`;
  // The few rules that must reach the page itself: comment cursor and the admin bar item.
  const pageStyle = h('style', { id: 'bp-site-comments-page' }, `
    html.${UI}-on body *:not(#bp-site-comments) { cursor: crosshair !important; }
    /* iPhone and iPad Safari only send a tap on plain text or a box to a page-wide click listener
       when the element looks clickable; without this, tapping a paragraph in comment mode did nothing. */
    @media (hover: none) { html.${UI}-on body *:not(#bp-site-comments) { cursor: pointer !important; -webkit-tap-highlight-color: transparent; } }
    html.${UI}-on body { -webkit-user-select: none; user-select: none; }
    #bp-site-comments { all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
    html.${UI}-on #wpadminbar #wp-admin-bar-bp-site-comments > .ab-item { background: #c8202b; color: #fff; }
    #wpadminbar #wp-admin-bar-bp-site-comments .ab-icon::before { top: 2px; }`);
  doc.head.append(pageStyle);
  // On <html>, not <body>, so a transformed or overflow-clipped body cannot trap the layer.
  root.append(host);
  if (doc.getElementById('wpadminbar')) host.classList.add('has-adminbar');

  const $ = (sel) => shadow.querySelector(sel);
  // A missing avatar falls back to the initials underneath (no inline handler, so a strict CSP is fine).
  shadow.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  const fromUs = (e) => e.composedPath?.().includes(host) || e.target?.closest?.('#wpadminbar');

  /* What people call each kind of element, shown on the highlight. */
  const kind = (el) => {
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return 'Heading';
    if (t === 'img' || t === 'picture' || t === 'figure') return 'Image';
    if (t === 'video' || t === 'iframe') return t === 'video' ? 'Video' : 'Embed';
    if (t === 'p') return 'Paragraph';
    if (t === 'a') return /\bbtn|button\b/.test(el.className) ? 'Button' : 'Link';
    if (t === 'button') return 'Button';
    if (t === 'li') return 'List item';
    if (t === 'ul' || t === 'ol') return 'List';
    if (t === 'section') return 'Section';
    if (t === 'header') return 'Header';
    if (t === 'footer') return 'Footer';
    if (t === 'nav') return 'Menu';
    if (t === 'form') return 'Form';
    if (['input', 'select', 'textarea', 'label'].includes(t)) return 'Form field';
    if (t === 'svg') return 'Icon';
    if (t === 'summary' || t === 'details') return 'Question';
    if (['span', 'b', 'strong', 'em', 'small', 'i', 'mark'].includes(t)) return 'Text';
    return getComputedStyle(el).backgroundImage !== 'none' ? 'Image box' : 'Box';
  };

  /* The natural thing to comment on under the pointer. */
  const pick = (el) => {
    if (!el || el.nodeType !== 1 || el === host || el === root || el === doc.body) return null;
    if (el.closest('svg')) el = el.closest('a, button') || el.closest('svg');
    const meaningful = el.closest('img, video, iframe, picture, h1, h2, h3, h4, h5, h6, p, a, button, li, label, input, select, textarea, figcaption, blockquote, td, th');
    return meaningful || el;
  };

  /* A CSS path that finds this element again on the next visit. */
  const selectorFor = (el) => {
    const good = (id) => id && !/^\d|[^\w-]|wp-|\d{4,}/.test(id) && doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== doc.body; node = node.parentElement) {
      if (good(node.id)) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const tag = node.tagName.toLowerCase();
      const same = [...(node.parentElement?.children || [])].filter((c) => c.tagName === node.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    }
    if (!parts[0]?.startsWith('#')) parts.unshift('body');
    return parts.join(' > ');
  };
  const snippetFor = (el) => {
    if (el.tagName === 'IMG') return el.alt || (el.currentSrc || el.src || '').split('/').pop().split('?')[0];
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const findEl = (c) => {
    let el = null;
    try { el = doc.querySelector(c.selector); } catch (e) { /* stale selector */ }
    if (el && (!c.snippet || c.tag === 'img' || snippetFor(el).slice(0, 40) === c.snippet.slice(0, 40))) return el;
    // The layout moved: fall back to the same text elsewhere on the page.
    if (c.snippet && c.snippet.length > 8) {
      const hit = [...doc.body.querySelectorAll(c.tag || '*')].find((n) => snippetFor(n).startsWith(c.snippet.slice(0, 40)));
      if (hit) return hit;
    }
    return el;
  };
  // The link an element is (or sits in), so it can still be opened while commenting.
  const linkOf = (el) => {
    const a = el?.closest?.('a[href]');
    return a && !/^\s*javascript:/i.test(a.getAttribute('href')) ? a : null;
  };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const visibleRect = (el) => {
    const r = el?.getBoundingClientRect();
    return r && (r.width || r.height) ? r : null;
  };
  // The part of an element that can actually be seen: its box cut by every ancestor that clips
  // (scrolling lists, carousels, tickers). Null when none of it shows, so its pin hides instead of
  // floating over other content. The clipping ancestors are looked up once per element.
  const clippers = new WeakMap();
  const clipsFor = (el) => {
    let list = clippers.get(el);
    if (!list) {
      list = [];
      for (let n = el.parentElement; n && n !== doc.body && n !== root; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') list.push(n);
      }
      clippers.set(el, list);
    }
    return list;
  };
  const shownRect = (el) => {
    const r = visibleRect(el);
    if (!r || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) return null;
    let { left, top, right, bottom } = r;
    for (const n of clipsFor(el)) {
      const c = n.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      if (right - left < 2 || bottom - top < 2) return null;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  /* ---------------- UI ---------------- */
  const icon = {
    chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    cursor: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
  };

  const tpl = doc.createElement('template');
  tpl.innerHTML = `
    <div class="hl" aria-hidden="true"><span class="hl__tag"><b></b><span class="hl__hint">Click to comment</span></span></div>
    <div class="pins"></div>
    <button class="launch" type="button" aria-pressed="false" title="Comment mode (C)">${icon.chat}<span>Comment</span><span class="launch__count" hidden></span></button>
    <div class="bar" role="toolbar" aria-label="Comment mode" hidden>
      <span class="bar__mode"><span class="bar__live" aria-hidden="true"></span>Comment mode</span>
      <span class="bar__hint">${icon.cursor}Click anything to leave a comment<span class="bar__keys"><kbd>${mac ? '⌘' : 'Ctrl'}</kbd>+ click opens a link</span></span>
      <span class="bar__sep" aria-hidden="true"></span>
      <button type="button" class="bar__chip" data-resolved aria-pressed="false" title="Show resolved comments on the page">${icon.check}Show resolved</button>
      <button type="button" class="bar__chip" data-panel aria-expanded="false">${icon.list}All comments<span class="bar__count" data-bar-count></span></button>
      <button type="button" class="bar__done" data-exit>Done</button>
    </div>
    <aside class="panel" aria-label="Comments on this page" hidden>
      <header class="panel__head">
        <div><b>Comments</b><span data-panel-count></span></div>
        <button type="button" class="icon-btn" data-panel-close aria-label="Close list">${icon.close}</button>
      </header>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="open">Open</button>
        <button type="button" role="tab" aria-selected="false" data-tab="resolved">Resolved</button>
      </div>
      <ol class="panel__list" data-panel-list></ol>
      <a class="panel__all" href="${esc(cfg.admin)}">All comments across the site ↗</a>
    </aside>
    <div class="toast" role="status" aria-live="polite"></div>`;
  shadow.append(tpl.content);

  const hl = $('.hl'), pins = $('.pins'), launcher = $('.launch'), bar = $('.bar'), panel = $('.panel'), toast = $('.toast');

  let toastTimer;
  const say = (msg, bad = false) => {
    toast.textContent = msg;
    toast.classList.toggle('is-bad', bad);
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2600);
  };

  /* ---------------- state ---------------- */
  // Authors can edit or delete their own comment for a short while after posting (15 minutes unless the
  // site changes it). The server says how many seconds are left; the deadline is kept on this clock.
  const stamp = (c) => {
    const at = (x) => Object.assign(x, { editUntil: Date.now() + (Number(x.edit_left) || 0) * 1000 });
    (c.replies || []).forEach(at);
    return at(c);
  };
  const editable = (c) => c.mine && Date.now() < (c.editUntil || 0);
  const deletable = (c) => editable(c) || !!cfg.manage;
  const minutesLeft = (c) => Math.max(1, Math.ceil(((c.editUntil || 0) - Date.now()) / 60000));
  const visible = () => comments.filter((c) => showResolved || c.status !== 'resolved');
  const openCount = () => comments.filter((c) => c.status !== 'resolved').length;

  const updateCounts = () => {
    const n = openCount();
    const badge = launcher.querySelector('.launch__count');
    badge.hidden = !n;
    badge.textContent = n;
    $('[data-bar-count]').textContent = n ? n : '';
    const ab = doc.querySelector('#wp-admin-bar-bp-site-comments .ab-label');
    if (ab) ab.textContent = n ? `Comment mode (${n})` : 'Comment mode';
  };

  const load = async () => {
    lastLoad = Date.now();
    try { comments = (await api(`?url=${encodeURIComponent(pageUrl())}`)).map(stamp); } catch (e) { /* keep what is shown */ }
    elCache.clear();
    updateCounts(); renderPins(); renderPanel();
  };

  /* ---------------- mode ---------------- */
  const setPanel = (open) => {
    panel.hidden = !open;
    host.classList.toggle('panel-open', open);
    $('[data-panel]').setAttribute('aria-expanded', String(open));
    if (open) { renderPanel(); refresh(); }
  };
  // Other people comment too: fetch again when commenting starts, the list opens or the tab is back in view.
  let lastLoad = 0;
  const refresh = () => {
    if (Date.now() - lastLoad < 4000 || openPopover) return;
    load();
  };
  addEventListener('focus', () => { if (on) refresh(); });
  doc.addEventListener('visibilitychange', () => { if (on && doc.visibilityState === 'visible') refresh(); });
  const setMode = (value) => {
    on = value;
    root.classList.toggle(`${UI}-on`, on);
    launcher.setAttribute('aria-pressed', String(on));
    launcher.hidden = on;   // The toolbar takes over while commenting.
    bar.hidden = !on;
    if (!on) { hideHl(); closePopover(); setPanel(false); }
    else refresh();
    renderPins();
    trackPins();
  };

  launcher.addEventListener('click', () => setMode(true));
  doc.querySelector('#wp-admin-bar-bp-site-comments > a')?.addEventListener('click', (e) => { e.preventDefault(); setMode(!on); });
  $('[data-exit]').addEventListener('click', () => setMode(false));
  $('[data-resolved]').addEventListener('click', (e) => {
    showResolved = !showResolved;
    e.currentTarget.setAttribute('aria-pressed', String(showResolved));
    renderPins();
  });
  $('[data-panel]').addEventListener('click', () => setPanel(panel.hidden));
  $('[data-panel-close]').addEventListener('click', () => setPanel(false));

  /* ---------------- highlight ---------------- */
  const target = () => lockedEl || hoverEl;
  const drawBox = (el, label) => {
    const r = visibleRect(el);
    if (!on || !r) { hl.classList.remove('is-on'); return; }
    Object.assign(hl.style, { transform: `translate(${r.left - 5}px, ${r.top - 5}px)`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
    hl.querySelector('b').textContent = label || '';
    hl.classList.toggle('is-quiet', !label);
    hl.classList.toggle('is-low', r.top < 40);
    hl.classList.add('is-on');
  };
  const drawHl = () => {
    if (openPopover) return drawBox(openPopover.anchor, '');   // Keep the discussed element framed.
    const el = target();
    drawBox(el, el ? kind(el) : '');
    hl.querySelector('.hl__hint').textContent = el?.parentElement && el.parentElement !== doc.body ? 'Click to comment · ↑ wider' : 'Click to comment';
  };
  const hideHl = () => { hoverEl = lockedEl = null; pickStack = []; hl.classList.remove('is-on'); };

  doc.addEventListener('pointermove', (e) => {
    if (!on || openPopover || e.pointerType === 'touch') return;
    const el = fromUs(e) ? null : pick(e.target);
    if (el !== hoverEl) { hoverEl = el; lockedEl = null; pickStack = []; }
    drawHl();
  }, { passive: true });
  root.addEventListener('pointerleave', () => { if (!openPopover) hideHl(); });
  const reflow = () => { drawHl(); placePins(); if (openPopover) place(openPopover.el, openPopover.anchor); };
  addEventListener('scroll', reflow, { passive: true, capture: true });
  addEventListener('resize', reflow);

  // In comment mode a click comments instead of following links or pressing buttons.
  // Touch is left alone (blocking touchstart would stop scrolling and taps on phones).
  // Ctrl / Cmd + click and middle-click open a link as usual, so reviewers can still move around the site.
  const opensLink = (e) => (e.ctrlKey || e.metaKey || e.button === 1) && !!linkOf(e.target);
  const swallow = (e) => {
    if (!on || fromUs(e) || e.pointerType === 'touch' || opensLink(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ['pointerdown', 'mousedown', 'mouseup', 'submit'].forEach((t) => doc.addEventListener(t, swallow, { capture: true, passive: false }));
  // Something typed in the open box is never thrown away by a stray click on the page or a pin:
  // the box stays, says so, and puts the cursor back. Cancel, Esc or the close button still discard it.
  const keepDraft = () => {
    const typed = [...(openPopover?.el.querySelectorAll('textarea') || [])].find((t) => t.value.trim());
    if (!typed) return false;
    say('Post or cancel what you are writing first', true);
    typed.focus({ preventScroll: true });
    return true;
  };
  const commentAt = (node) => {
    if (openPopover) { if (!keepDraft()) closePopover(); return; }
    // The element under the click (a tap has no hover), or the wider box picked with the Up key around it.
    const base = pick(node);
    const el = lockedEl && lockedEl.contains(node) ? lockedEl : base;
    if (el) compose(el);
  };
  // Taps are recognised here rather than from the click: Safari on iPhone and iPad sends no click at
  // all for a tap on plain text or a box, so comment mode did nothing there. A finger that moves
  // (a scroll) or stays down (a long press) is not a tap.
  let tapStart = null;
  let lastTap = 0;
  doc.addEventListener('pointerdown', (e) => {
    tapStart = on && e.pointerType === 'touch' && e.isPrimary && !fromUs(e) ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
  }, { capture: true, passive: true });
  doc.addEventListener('pointercancel', () => { tapStart = null; }, { capture: true, passive: true });
  doc.addEventListener('pointerup', (e) => {
    const s = tapStart;
    tapStart = null;
    if (!s || !on || e.pointerType !== 'touch' || fromUs(e)) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10 || e.timeStamp - s.t > 700) return;
    lastTap = Date.now();
    commentAt(e.target);
  }, { capture: true, passive: true });
  doc.addEventListener('click', (e) => {
    if (!on || fromUs(e) || opensLink(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // The click some browsers still send after a tap was already handled above.
    if (Date.now() - lastTap < 800) return;
    commentAt(e.target);
  }, true);

  /* ---------------- keyboard ---------------- */
  doc.addEventListener('keydown', (e) => {
    const inner = e.composedPath?.()[0] || e.target;
    const typing = inner.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (openPopover) closePopover();
      else if (!panel.hidden) setPanel(false);
      else if (on) setMode(false);
      return;
    }
    if (typing) return;
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) { setMode(!on); return; }
    if (!on || openPopover) return;
    const el = target();
    if (e.key === 'ArrowUp' && el?.parentElement && el.parentElement !== doc.body) {
      e.preventDefault(); pickStack.push(el); lockedEl = el.parentElement; drawHl();
    } else if (e.key === 'ArrowDown' && pickStack.length) {
      e.preventDefault(); lockedEl = pickStack.pop(); drawHl();
    } else if (e.key === 'Enter' && el) {
      e.preventDefault(); compose(el);
    }
  });

  /* ---------------- popovers ---------------- */
  const closePopover = () => {
    openPopover?.el.remove();
    openPopover = null;
    pins.querySelectorAll('.is-active').forEach((p) => p.classList.remove('is-active'));
    drawHl();
  };

  // Fixed to the viewport and re-placed on scroll, so it always sits next to its element.
  const place = (pop, el) => {
    const r = visibleRect(el);
    if (!r) { pop.classList.add('is-floating'); return; }
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14;
    const minTop = Math.max(0, doc.getElementById('wpadminbar')?.getBoundingClientRect().bottom || 0) + 12; // Keep the admin bar visible.
    let left = Math.min(Math.max(12, r.left), innerWidth - pw - 12);
    let top = r.bottom + gap;
    if (top + ph > innerHeight - 12) top = r.top - ph - gap;          // Above when there is no room below.
    if (top < minTop) {
      // Tall targets: beside them, so the thing being discussed stays visible.
      top = Math.min(Math.max(minTop, r.top), innerHeight - ph - 12);
      if (r.right + gap + pw < innerWidth - 12) left = r.right + gap;
      else if (r.left - gap - pw > 12) left = r.left - gap - pw;
    }
    pop.classList.remove('is-floating');
    Object.assign(pop.style, { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(minTop, top))}px` });
  };

  const popover = (el, html, cls = '') => {
    openPopover?.el.remove();
    const pop = h('div', { class: `pop ${cls}`, role: 'dialog', 'aria-label': 'Comment' }, html);
    shadow.append(pop);
    openPopover = { el: pop, anchor: el };
    place(pop, el);
    drawHl();
    return pop;
  };

  // Commenting on a link must not make it a dead end: the box offers to open it (the only way on a phone).
  const openLink = (el) => {
    const a = linkOf(el);
    return a ? `<a class="open-link" data-open-link href="${esc(a.href)}"${a.target === '_blank' || !/^https?:/i.test(a.href) ? ' target="_blank" rel="noopener"' : ''}>Open link${icon.open}</a>` : '';
  };
  const targetHead = (k, snippet, el) => `<div class="pop__target"><span class="pop__kind"><span class="chip">${esc(k)}</span>${el ? openLink(el) : ''}</span>${snippet ? `<span class="pop__snippet">${esc(snippet.slice(0, 90))}${snippet.length > 90 ? '…' : ''}</span>` : ''}</div>`;
  const avatar = (name, url) => `<span class="avatar" aria-hidden="true">${esc(initials(name))}${url ? `<img src="${esc(url)}" alt="" width="28" height="28" loading="lazy">` : ''}</span>`;
  const submitOnCtrlEnter = (ta, btn) => {
    ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btn.click(); } });
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  };

  const compose = (el, inner = []) => {
    const snippet = snippetFor(el);
    const wider = el.parentElement && el.parentElement !== doc.body && el.parentElement !== root;
    const pop = popover(el, `
      ${targetHead(kind(el), snippet, el)}
      ${wider || inner.length ? `<div class="pop__scope">${inner.length ? '<button type="button" class="scope-btn" data-narrow>&minus; Smaller area</button>' : ''}${wider ? '<button type="button" class="scope-btn" data-wider>+ Bigger area</button>' : ''}</div>` : ''}
      <textarea maxlength="5000" class="input" rows="3" aria-label="Your comment" placeholder="What should change here?"></textarea>
      <div class="pop__foot">
        <span class="hint"><kbd>Ctrl</kbd><kbd>Enter</kbd> to post</span>
        <span class="pop__actions">
          <button type="button" class="btn btn--ghost" data-cancel>Cancel</button>
          <button type="button" class="btn" data-save disabled>Post</button>
        </span>
      </div>`);
    const ta = pop.querySelector('textarea');
    const save = pop.querySelector('[data-save]');
    submitOnCtrlEnter(ta, save);
    pop.querySelector('[data-cancel]').addEventListener('click', closePopover);
    // Switching area keeps what was already typed.
    const rescope = (next, stack) => {
      const text = ta.value;
      compose(next, stack);
      const fresh = openPopover.el.querySelector('textarea');
      fresh.value = text;
      fresh.dispatchEvent(new Event('input'));
    };
    pop.querySelector('[data-wider]')?.addEventListener('click', () => rescope(el.parentElement, [...inner, el]));
    pop.querySelector('[data-narrow]')?.addEventListener('click', () => rescope(inner[inner.length - 1], inner.slice(0, -1)));
    save.addEventListener('click', async () => {
      save.disabled = true; save.textContent = 'Posting…';
      try {
        const c = stamp(await api('', { method: 'POST', body: { text: ta.value, url: pageUrl(), selector: selectorFor(el), snippet, tag: el.tagName.toLowerCase(), title: doc.title } }));
        comments.push(c);
        closePopover(); updateCounts(); renderPins(); renderPanel();
        say(editable(c) ? `Comment posted · you can edit it for ${minutesLeft(c)} minutes` : 'Comment posted');
      } catch (err) {
        say(err.message, true); save.disabled = false; save.textContent = 'Post';
      }
    });
  };

  const thread = (c) => {
    const el = findEl(c);
    const n = comments.indexOf(c) + 1;
    const canResolve = c.mine || cfg.manage;
    // Every message you wrote (the comment or a reply) has its own Edit and Delete for 15 minutes only.
    // Removing the whole comment with its replies is the Delete button at the bottom.
    const note = (r) => (editable(r) ? `<p class="msg__window" data-window>You can edit or delete this for ${minutesLeft(r)} more minute${minutesLeft(r) === 1 ? '' : 's'}</p>` : '');
    const msg = (r, key) => {
      const acts = editable(r) ? '<button type="button" class="link-btn" data-edit>Edit</button><button type="button" class="link-btn link-btn--danger" data-del>Delete</button>' : '';
      return `<li class="msg" data-msg="${esc(key)}">${avatar(r.author, r.avatar)}<div><p class="msg__meta"><b>${esc(r.author)}</b><time datetime="${esc(r.date)}">${ago(r.date)}</time>${acts ? `<span class="msg__acts">${acts}</span>` : ''}</p><p class="msg__text">${rich(r.text)}</p>${note(r)}</div></li>`;
    };
    const pop = popover(el, `
      <div class="pop__head">
        <span class="num">${c.status === 'resolved' ? icon.check : n}</span>
        ${targetHead(el ? kind(el) : 'Removed', c.snippet, el)}
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon.close}</button>
      </div>
      ${!el ? '<p class="note">This part of the page has changed since the comment was left.</p>' : ''}
      <ol class="thread">${msg(c, 'root')}${c.replies.map((x, i) => msg(x, x.id || `old-${i}`)).join('')}</ol>
      <textarea maxlength="5000" class="input input--reply" rows="2" aria-label="Reply" placeholder="Reply…"></textarea>
      <div class="pop__foot">
        <span class="pop__actions">${deletable(c) ? '<button type="button" class="btn btn--ghost btn--danger" data-del-all>Delete</button>' : ''}</span>
        <span class="pop__actions">
          ${canResolve ? `<button type="button" class="btn btn--ghost" data-status>${c.status === 'resolved' ? 'Reopen' : `${icon.check}Resolve`}</button>` : ''}
          <button type="button" class="btn" data-reply disabled>Reply</button>
        </span>
      </div>`, c.status === 'resolved' ? 'is-resolved' : '');
    pins.querySelector(`[data-id="${c.id}"]`)?.classList.add('is-active');

    const ta = pop.querySelector('textarea');
    const send = pop.querySelector('[data-reply]');
    submitOnCtrlEnter(ta, send);
    pop.querySelector('[data-close]').addEventListener('click', closePopover);

    const replace = (fresh) => { comments[comments.indexOf(c)] = stamp(fresh); updateCounts(); renderPins(); renderPanel(); return fresh; };
    const messageOf = (node) => {
      const key = node.closest('.msg').dataset.msg;
      return key === 'root' ? { key, r: c, path: `/${c.id}` } : { key, r: c.replies.find((x) => x.id === key), path: `/${c.id}/replies/${key}` };
    };
    // The countdown under your own messages; when one runs out, its Edit and Delete go away
    // (unless something is being typed: the server then turns the change down with a message).
    if ([c, ...c.replies].some(editable)) {
      const tick = setInterval(() => {
        if (!pop.isConnected) { clearInterval(tick); return; }
        const expired = [...pop.querySelectorAll('[data-window]')].some((w) => !editable(messageOf(w).r || {}));
        if (!expired) { pop.querySelectorAll('[data-window]').forEach((w) => { w.outerHTML = note(messageOf(w).r); }); return; }
        if (pop.querySelector('.edit') || ta.value.trim()) return;
        clearInterval(tick);
        thread(c);
      }, 15000);
    }
    pop.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-del], [data-del-all]');
      if (editBtn) {
        const m = messageOf(editBtn);
        const body = editBtn.closest('.msg').querySelector('.msg__text');
        body.outerHTML = `<div class="edit"><textarea maxlength="5000" class="input input--reply" aria-label="Edit your ${m.key === 'root' ? 'comment' : 'reply'}"></textarea><div class="pop__actions"><button type="button" class="btn btn--ghost" data-edit-cancel>Cancel</button><button type="button" class="btn" data-edit-save>Save</button></div></div>`;
        editBtn.closest('.msg__acts')?.remove();
        const box = pop.querySelector('.edit textarea');
        box.value = m.r.text;
        const saveEdit = pop.querySelector('[data-edit-save]');
        submitOnCtrlEnter(box, saveEdit);
        pop.querySelector('[data-edit-cancel]').addEventListener('click', () => thread(c));
        saveEdit.addEventListener('click', async () => {
          if (!box.value.trim()) { say('Write something first, or use Delete.', true); return; }
          saveEdit.disabled = true;
          try { thread(replace(await api(m.path, { method: 'PATCH', body: { text: box.value } }))); say(m.key === 'root' ? 'Comment updated' : 'Reply updated'); }
          catch (err) { say(err.message, true); saveEdit.disabled = false; }
        });
        return;
      }
      if (delBtn) {
        // The bottom Delete removes the whole comment and its replies (managers any time, authors for 15 minutes).
        const m = delBtn.matches('[data-del-all]') ? { key: 'root', r: c, path: `/${c.id}` } : messageOf(delBtn);
        // A second click confirms, so one slip of the finger does not remove anything.
        if (!delBtn.dataset.sure) {
          delBtn.dataset.sure = '1';
          delBtn.textContent = m.key === 'root' && c.replies.length ? 'Delete with replies?' : (delBtn.matches('[data-del-all]') ? 'Delete this comment?' : 'Delete for sure?');
          return;
        }
        delBtn.disabled = true;
        try {
          if (m.key === 'root') {
            await api(m.path, { method: 'DELETE' });
            comments = comments.filter((x) => x !== c);
            closePopover(); updateCounts(); renderPins(); renderPanel();
            say('Comment deleted');
          } else {
            thread(replace(await api(m.path, { method: 'DELETE' })));
            say('Reply deleted');
          }
        } catch (err) { say(err.message, true); delBtn.disabled = false; }
      }
    });
    send.addEventListener('click', async () => {
      send.disabled = true;
      try { thread(replace(await api(`/${c.id}/replies`, { method: 'POST', body: { text: ta.value } }))); }
      catch (err) { say(err.message, true); send.disabled = false; }
    });
    pop.querySelector('[data-status]')?.addEventListener('click', async () => {
      try {
        const fresh = replace(await api(`/${c.id}`, { method: 'PATCH', body: { status: c.status === 'resolved' ? 'open' : 'resolved' } }));
        closePopover();
        say(fresh.status === 'resolved' ? 'Marked as resolved' : 'Reopened');
      } catch (err) { say(err.message, true); }
    });
  };

  /* ---------------- pins ---------------- */
  const renderPins = () => {
    pins.innerHTML = '';
    if (!on) return;
    visible().forEach((c) => {
      const n = comments.indexOf(c) + 1;
      const pin = h('button', { type: 'button', class: `pin${c.status === 'resolved' ? ' is-resolved' : ''}`, 'data-id': c.id, 'aria-label': `Comment ${n} by ${c.author}: ${c.text.slice(0, 80)}` }, c.status === 'resolved' ? icon.check : String(n));
      pin.addEventListener('click', () => { if (!keepDraft()) thread(c); });
      pin.addEventListener('pointerenter', () => { if (!openPopover) drawBox(findEl(c), ''); });
      pin.addEventListener('pointerleave', () => { if (!openPopover) hl.classList.remove('is-on'); });
      pins.append(pin);
    });
    placePins();
  };

  // Elements per comment, so following them every frame stays cheap. An element that is not on the
  // page (removed, or not rendered yet) is looked for again at most once a second: searching the
  // whole page for its text on every frame made long pages stutter.
  const elCache = new Map();
  const elFor = (c) => {
    const hit = elCache.get(c.id);
    if (hit?.el?.isConnected) return hit.el;
    if (hit && !hit.el && performance.now() - hit.at < 1000) return null;
    const el = findEl(c);
    elCache.set(c.id, { el, at: performance.now() });
    return el;
  };
  // Content can move without any resize (entrance animations, sliders, sticky bars): keep pins on it.
  let tracking = false;
  const trackPins = () => {
    if (tracking || !on) return;
    tracking = true;
    const tick = () => {
      if (!on) { tracking = false; return; }
      placePins();
      if (openPopover) { drawHl(); place(openPopover.el, openPopover.anchor); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const placePins = () => {
    if (!on) return;
    const taken = [];
    // A pin under the toolbar or the open list could not be tapped (on phones the toolbar spans the
    // screen): it waits there hidden until the page is scrolled.
    const covers = [bar, panel].filter((n) => !n.hidden).map((n) => n.getBoundingClientRect());
    const covered = (x, y) => covers.some((c) => x + 26 > c.left && x < c.right && y + 26 > c.top && y < c.bottom);
    pins.querySelectorAll('.pin').forEach((pin) => {
      const c = comments.find((x) => String(x.id) === pin.dataset.id);
      const el = c && elFor(c);
      const r = el && shownRect(el);
      pin.hidden = !r || r.bottom < 0 || r.top > innerHeight;
      if (pin.hidden) return;
      // Top-left corner of the element, where reading starts; nudge pins that would overlap.
      let x = Math.min(Math.max(r.left - 13, 6), innerWidth - 36);
      const y = Math.max(r.top - 13, 6);
      while (taken.some(([tx, ty]) => Math.abs(tx - x) < 26 && Math.abs(ty - y) < 26)) x += 30;
      pin.hidden = covered(x, y);
      if (pin.hidden) return;
      taken.push([x, y]);
      // `translate`, not `transform`: the hover `scale` is applied after `transform` and would scale
      // the position too, making the pin jump away from the pointer.
      pin.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    });
  };
  // Layout shifts (fonts, images, menus) move things; keep pins in place.
  new ResizeObserver(() => placePins()).observe(doc.body);

  /* ---------------- page list ---------------- */
  let tab = 'open';
  shadow.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    shadow.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderPanel();
  }));

  const renderPanel = () => {
    const list = $('[data-panel-list]');
    const items = comments.filter((c) => (tab === 'resolved' ? c.status === 'resolved' : c.status !== 'resolved'));
    $('[data-panel-count]').textContent = `${openCount()} open`;
    list.innerHTML = items.length ? '' : `<li class="empty">${tab === 'open' ? 'No open comments on this page.<br>Click anything on the page to add one.' : 'Nothing resolved yet.'}</li>`;
    items.forEach((c) => {
      const li = h('li', {}, `<button type="button" class="row${c.status === 'resolved' ? ' is-resolved' : ''}">
        <span class="num">${c.status === 'resolved' ? icon.check : comments.indexOf(c) + 1}</span>
        <span class="row__body">
          <span class="row__text">${esc(c.text)}</span>
          <span class="row__meta">${esc(c.author)} · ${ago(c.date)}${c.replies.length ? ` · ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}${findEl(c) ? '' : ' · <em>element changed</em>'}</span>
        </span></button>`);
      li.firstElementChild.addEventListener('click', () => { if (!keepDraft()) focusComment(c); });
      list.append(li);
    });
  };

  const focusComment = (c) => {
    if (c.status === 'resolved' && !showResolved) $('[data-resolved]').click();
    const el = findEl(c);
    if (el) {
      el.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => thread(c), reduced.matches ? 0 : 450);
    } else thread(c);
  };

  /* ---------------- start ---------------- */
  load().then(() => {
    const query = new URLSearchParams(location.search);
    const wanted = query.get('bp-comment');
    const review = query.has('bp-comments'); // "Review the site" / "Open page" in the dashboard.
    // Comment mode always starts off; only a click (or a link from the dashboard) turns it on.
    try { sessionStorage.removeItem('bp-sc-on'); } catch (e) { /* storage blocked */ }
    const c = wanted && comments.find((x) => String(x.id) === wanted);
    if (wanted || review) {
      const clean = new URL(location.href);
      clean.searchParams.delete('bp-comment');
      clean.searchParams.delete('bp-comments');
      history.replaceState(history.state, '', clean);
    }
    if (c || review) setMode(true);
    if (c) setTimeout(() => focusComment(c), 600);
  });
})();
