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
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
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
    html.${UI}-on body { -webkit-user-select: none; user-select: none; }
    #bp-site-comments { all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
    html.${UI}-on #wpadminbar #wp-admin-bar-bp-site-comments > .ab-item { background: #c8202b; color: #fff; }
    #wpadminbar #wp-admin-bar-bp-site-comments .ab-icon::before { top: 2px; }`);
  doc.head.append(pageStyle);
  // On <html>, not <body>, so a transformed or overflow-clipped body cannot trap the layer.
  root.append(host);
  if (doc.getElementById('wpadminbar')) host.classList.add('has-adminbar');

  const $ = (sel) => shadow.querySelector(sel);
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
  const visibleRect = (el) => {
    const r = el?.getBoundingClientRect();
    return r && (r.width || r.height) ? r : null;
  };

  /* ---------------- UI ---------------- */
  const icon = {
    chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>',
    cursor: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
  };

  const tpl = doc.createElement('template');
  tpl.innerHTML = `
    <div class="hl" aria-hidden="true"><span class="hl__tag"><b></b><span class="hl__hint">Click to comment</span></span></div>
    <div class="pins"></div>
    <button class="launch" type="button" aria-pressed="false" title="Comment mode (C)">${icon.chat}<span>Comment</span><span class="launch__count" hidden></span></button>
    <div class="bar" role="toolbar" aria-label="Comment mode" hidden>
      <span class="bar__mode"><span class="bar__live" aria-hidden="true"></span>Comment mode</span>
      <span class="bar__hint">${icon.cursor}Click anything to leave a comment</span>
      <span class="bar__sep" aria-hidden="true"></span>
      <button type="button" class="bar__chip" data-resolved aria-pressed="false">${icon.check}Resolved</button>
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
    try { comments = await api(`?url=${encodeURIComponent(pageUrl())}`); } catch (e) { comments = []; }
    updateCounts(); renderPins(); renderPanel();
  };

  /* ---------------- mode ---------------- */
  const setPanel = (open) => {
    panel.hidden = !open;
    $('[data-panel]').setAttribute('aria-expanded', String(open));
    if (open) renderPanel();
  };
  const setMode = (value) => {
    on = value;
    root.classList.toggle(`${UI}-on`, on);
    launcher.setAttribute('aria-pressed', String(on));
    launcher.hidden = on;   // The toolbar takes over while commenting.
    bar.hidden = !on;
    if (!on) { hideHl(); closePopover(); setPanel(false); }
    renderPins();
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
    if (!on || openPopover) return;
    const el = fromUs(e) ? null : pick(e.target);
    if (el !== hoverEl) { hoverEl = el; lockedEl = null; pickStack = []; }
    drawHl();
  }, { passive: true });
  root.addEventListener('pointerleave', () => { if (!openPopover) hideHl(); });
  const reflow = () => { drawHl(); placePins(); if (openPopover) place(openPopover.el, openPopover.anchor); };
  addEventListener('scroll', reflow, { passive: true, capture: true });
  addEventListener('resize', reflow);

  // In comment mode a click comments instead of following links or pressing buttons.
  const swallow = (e) => {
    if (!on || fromUs(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'submit'].forEach((t) => doc.addEventListener(t, swallow, { capture: true, passive: false }));
  doc.addEventListener('click', (e) => {
    if (!on || fromUs(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (openPopover) { closePopover(); return; }
    const el = target() || pick(e.target);
    if (el) compose(el);
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
    let left = Math.min(Math.max(12, r.left), innerWidth - pw - 12);
    let top = r.bottom + gap;
    if (top + ph > innerHeight - 12) top = r.top - ph - gap;          // Above when there is no room below.
    if (top < 12) {
      // Tall targets: beside them, so the thing being discussed stays visible.
      top = Math.min(Math.max(12, r.top), innerHeight - ph - 12);
      if (r.right + gap + pw < innerWidth - 12) left = r.right + gap;
      else if (r.left - gap - pw > 12) left = r.left - gap - pw;
    }
    pop.classList.remove('is-floating');
    Object.assign(pop.style, { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(12, top))}px` });
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

  const targetHead = (k, snippet) => `<div class="pop__target"><span class="chip">${esc(k)}</span>${snippet ? `<span class="pop__snippet">${esc(snippet.slice(0, 90))}${snippet.length > 90 ? '…' : ''}</span>` : ''}</div>`;
  const avatar = (name, url) => `<span class="avatar" aria-hidden="true">${esc(initials(name))}${url ? `<img src="${esc(url)}" alt="" width="28" height="28" loading="lazy" onerror="this.remove()">` : ''}</span>`;
  const submitOnCtrlEnter = (ta, btn) => {
    ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btn.click(); } });
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  };

  const compose = (el) => {
    const snippet = snippetFor(el);
    const pop = popover(el, `
      ${targetHead(kind(el), snippet)}
      <textarea class="input" rows="3" aria-label="Your comment" placeholder="What should change here?"></textarea>
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
    save.addEventListener('click', async () => {
      save.disabled = true; save.textContent = 'Posting…';
      try {
        const c = await api('', { method: 'POST', body: { text: ta.value, url: pageUrl(), selector: selectorFor(el), snippet, tag: el.tagName.toLowerCase(), title: doc.title } });
        comments.push(c);
        closePopover(); updateCounts(); renderPins(); renderPanel();
        say('Comment posted');
      } catch (err) {
        say(err.message, true); save.disabled = false; save.textContent = 'Post';
      }
    });
  };

  const thread = (c) => {
    const el = findEl(c);
    const n = comments.indexOf(c) + 1;
    const canChange = c.mine || cfg.manage;
    const msg = (r) => `<li class="msg">${avatar(r.author, r.avatar)}<div><p class="msg__meta"><b>${esc(r.author)}</b><time datetime="${esc(r.date)}">${ago(r.date)}</time></p><p class="msg__text">${nl2br(r.text)}</p></div></li>`;
    const pop = popover(el, `
      <div class="pop__head">
        <span class="num">${c.status === 'resolved' ? icon.check : n}</span>
        ${targetHead(el ? kind(el) : 'Removed', c.snippet)}
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon.close}</button>
      </div>
      ${!el ? '<p class="note">This part of the page has changed since the comment was left.</p>' : ''}
      <ol class="thread">${msg(c)}${c.replies.map(msg).join('')}</ol>
      <textarea class="input input--reply" rows="2" aria-label="Reply" placeholder="Reply…"></textarea>
      <div class="pop__foot">
        <span class="pop__actions">${canChange ? '<button type="button" class="btn btn--ghost btn--danger" data-delete>Delete</button>' : ''}</span>
        <span class="pop__actions">
          ${canChange ? `<button type="button" class="btn btn--ghost" data-status>${c.status === 'resolved' ? 'Reopen' : `${icon.check}Resolve`}</button>` : ''}
          <button type="button" class="btn" data-reply disabled>Reply</button>
        </span>
      </div>`, c.status === 'resolved' ? 'is-resolved' : '');
    pins.querySelector(`[data-id="${c.id}"]`)?.classList.add('is-active');

    const ta = pop.querySelector('textarea');
    const send = pop.querySelector('[data-reply]');
    submitOnCtrlEnter(ta, send);
    pop.querySelector('[data-close]').addEventListener('click', closePopover);

    const replace = (fresh) => { comments[comments.indexOf(c)] = fresh; updateCounts(); renderPins(); renderPanel(); return fresh; };
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
    pop.querySelector('[data-delete]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Delete for good?'; return; }
      try {
        await api(`/${c.id}`, { method: 'DELETE' });
        comments = comments.filter((x) => x !== c);
        closePopover(); updateCounts(); renderPins(); renderPanel();
        say('Comment deleted');
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
      pin.addEventListener('click', () => thread(c));
      pin.addEventListener('pointerenter', () => { if (!openPopover) drawBox(findEl(c), ''); });
      pin.addEventListener('pointerleave', () => { if (!openPopover) hl.classList.remove('is-on'); });
      pins.append(pin);
    });
    placePins();
  };

  const placePins = () => {
    if (!on) return;
    const taken = [];
    pins.querySelectorAll('.pin').forEach((pin) => {
      const c = comments.find((x) => String(x.id) === pin.dataset.id);
      const r = c && visibleRect(findEl(c));
      pin.hidden = !r || r.bottom < 0 || r.top > innerHeight;
      if (pin.hidden) return;
      // Top-left corner of the element, where reading starts; nudge pins that would overlap.
      let x = Math.min(Math.max(r.left - 13, 6), innerWidth - 36);
      const y = Math.max(r.top - 13, 6);
      while (taken.some(([tx, ty]) => Math.abs(tx - x) < 26 && Math.abs(ty - y) < 26)) x += 30;
      taken.push([x, y]);
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
      li.firstElementChild.addEventListener('click', () => focusComment(c));
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
    const wanted = new URLSearchParams(location.search).get('bp-comment');
    // Comment mode always starts off; only a click (or a link to a specific comment) turns it on.
    try { sessionStorage.removeItem('bp-sc-on'); } catch (e) { /* storage blocked */ }
    const c = wanted && comments.find((x) => String(x.id) === wanted);
    if (c) {
      setMode(true);
      setTimeout(() => focusComment(c), 600);
    }
  });
})();
