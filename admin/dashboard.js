(function () {
  'use strict';

  /**
   * Site Comments dashboard (wp-admin › Site Comments).
   * Three panes, like a mail client: views and pages on the left, the comment list in the middle,
   * the selected conversation on the right. Built to work through feedback quickly: undo for every
   * change, bulk select, and keyboard shortcuts (↑/↓ or J/K, Enter, E, R, X, /, Esc).
   * Everything goes through the plugin's REST API; filters are kept in the address bar.
   */
  const cfg = window.bpScDashboard;
  const app = document.getElementById('bpsc-app');
  if (!cfg || !app) return;

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fullDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const age = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
    if (s < 86400 * 30) return `${Math.floor(s / (86400 * 7))}w`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const ago = (iso) => {
    let v = Math.max(1, (Date.now() - new Date(iso)) / 1000);
    for (const [n, unit] of [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']]) {
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
      throw new Error(data.message || 'Something went wrong. Please try again.');
    }
    return data;
  };
  const withParam = (url, key, value) => { try { const u = new URL(url); u.searchParams.set(key, value); return u.toString(); } catch (e) { return url; } };
  const kind = (tag) => {
    const t = String(tag || '').toLowerCase();
    if (/^h[1-6]$/.test(t)) return 'Heading';
    return ({ img: 'Image', picture: 'Image', figure: 'Image', video: 'Video', iframe: 'Embed', p: 'Paragraph', a: 'Link', button: 'Button', li: 'List item', ul: 'List', ol: 'List', section: 'Section', summary: 'Question', details: 'Question', table: 'Table', td: 'Cell', th: 'Cell', blockquote: 'Quote', figcaption: 'Caption', header: 'Header', footer: 'Footer', nav: 'Menu', form: 'Form', input: 'Field', textarea: 'Field', select: 'Field', label: 'Field', svg: 'Icon', span: 'Text', b: 'Text', strong: 'Text', em: 'Text' })[t] || 'Box';
  };
  // "About us | Zyraa Kitchens" -> "About us": the site name repeats on every page. The front page is "Home".
  const siteName = String(cfg.site || '').trim().toLowerCase();
  const pageName = (c) => {
    if (c.page_key === '/') return 'Home';
    const parts = String(c.page_title || '').split(/\s[|–—-]\s/).map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== siteName);
    return parts[0] || c.page_key || '/';
  };
  // A steady colour per person, so a reviewer is easy to spot down the list.
  const hue = (name) => [...String(name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const avatar = (name, url, size = '') => `<span class="bpsc-av${size ? ` bpsc-av--${size}` : ''}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</span>`;

  const svg = (d, w = 16) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icon = {
    inbox: svg('<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l1 8v6H4v-6z"/>'),
    check: svg('<path d="M5 12.5 10 17l9-10"/>'),
    stack: svg('<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>'),
    page: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>', 15),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', 15),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', 15),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 14),
    reply: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 13),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
    cursor: svg('<path d="M5 3l14 7-6 2-2 6z"/>', 15),
    send: svg('<path d="M4 12 20 4l-6 16-3-7z"/>', 15),
    target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', 14),
  };

  /* Illustrations: simple line drawings in the plugin's colours (no external files). */
  const art = {
    // A browser window with pinned comments.
    start: `<svg class="bpsc-art" viewBox="0 0 220 150" aria-hidden="true">
      <rect x="20" y="18" width="180" height="116" rx="12" fill="#fff" stroke="#d7dbe0" stroke-width="2"/>
      <path d="M20 40h180" stroke="#e7e9ec" stroke-width="2"/><circle cx="34" cy="29" r="3.5" fill="#f2b8bb"/><circle cx="45" cy="29" r="3.5" fill="#f3d9a6"/><circle cx="56" cy="29" r="3.5" fill="#bfe3c7"/>
      <rect x="36" y="54" width="86" height="10" rx="5" fill="#e7e9ec"/><rect x="36" y="72" width="120" height="7" rx="3.5" fill="#f0f1f3"/><rect x="36" y="85" width="104" height="7" rx="3.5" fill="#f0f1f3"/>
      <rect x="36" y="102" width="62" height="20" rx="10" fill="#f0f1f3"/><rect x="134" y="98" width="50" height="26" rx="6" fill="#eef0f2"/>
      <g class="bpsc-art__pin"><path d="M128 46a11 11 0 0 1 11 11c0 8-11 15-11 15s-11-7-11-15a11 11 0 0 1 11-11z" fill="#c8202b"/><text x="128" y="61" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">1</text></g>
      <g class="bpsc-art__pin bpsc-art__pin--2"><path d="M176 84a9 9 0 0 1 9 9c0 6.5-9 12-9 12s-9-5.5-9-12a9 9 0 0 1 9-9z" fill="#1d2327"/><text x="176" y="96" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">2</text></g>
      <path d="M150 128c10 0 14-6 22-6" stroke="#c8202b" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 5" fill="none"/>
    </svg>`,
    // Two speech bubbles: pick a conversation.
    pick: `<svg class="bpsc-art" viewBox="0 0 200 130" aria-hidden="true">
      <rect x="22" y="22" width="104" height="58" rx="14" fill="#fff" stroke="#d7dbe0" stroke-width="2"/><path d="M44 80v16l16-16" fill="#fff" stroke="#d7dbe0" stroke-width="2" stroke-linejoin="round"/>
      <rect x="38" y="38" width="60" height="8" rx="4" fill="#e7e9ec"/><rect x="38" y="54" width="72" height="7" rx="3.5" fill="#f0f1f3"/>
      <rect x="84" y="56" width="96" height="50" rx="14" fill="#c8202b"/><path d="M158 106v14l-14-14" fill="#c8202b"/>
      <rect x="100" y="72" width="52" height="7" rx="3.5" fill="#fff" opacity=".9"/><rect x="100" y="86" width="36" height="7" rx="3.5" fill="#fff" opacity=".6"/>
      <circle cx="170" cy="30" r="10" fill="#edfaef" stroke="#7ccf8e" stroke-width="2"/><path d="m165 30 3.5 3.5L175 27" stroke="#008a20" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    // A tidy checklist: everything resolved.
    done: `<svg class="bpsc-art" viewBox="0 0 200 130" aria-hidden="true">
      <rect x="46" y="14" width="108" height="104" rx="14" fill="#fff" stroke="#d7dbe0" stroke-width="2"/>
      <g fill="#edfaef"><circle cx="70" cy="42" r="9"/><circle cx="70" cy="66" r="9"/><circle cx="70" cy="90" r="9"/></g>
      <g stroke="#008a20" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m65.5 42 3 3 6-6"/><path d="m65.5 66 3 3 6-6"/><path d="m65.5 90 3 3 6-6"/></g>
      <g fill="#e7e9ec"><rect x="86" y="38" width="50" height="8" rx="4"/><rect x="86" y="62" width="42" height="8" rx="4"/><rect x="86" y="86" width="48" height="8" rx="4"/></g>
      <g fill="#c8202b"><circle cx="30" cy="34" r="3"/><circle cx="172" cy="28" r="2.5"/><circle cx="176" cy="96" r="3"/></g><g fill="#f3d9a6"><circle cx="24" cy="88" r="2.5"/><circle cx="168" cy="62" r="3"/></g>
      <path d="M24 56h8M28 52v8M164 112h8M168 108v8" stroke="#7ccf8e" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    // A magnifier over an empty list.
    none: `<svg class="bpsc-art" viewBox="0 0 200 130" aria-hidden="true">
      <rect x="30" y="24" width="110" height="18" rx="9" fill="#f0f1f3"/><rect x="30" y="52" width="90" height="18" rx="9" fill="#f5f6f7"/><rect x="30" y="80" width="70" height="18" rx="9" fill="#f8f9fa"/>
      <circle cx="132" cy="70" r="26" fill="#fff" stroke="#1d2327" stroke-width="3"/><path d="m151 89 18 18" stroke="#1d2327" stroke-width="5" stroke-linecap="round"/>
      <path d="M122 70h20" stroke="#c8202b" stroke-width="3" stroke-linecap="round"/>
    </svg>`,
  };

  /* ---------------- state ---------------- */
  const params = new URLSearchParams(location.search);
  const state = {
    comments: [],
    loading: true,
    error: '',
    status: ['open', 'resolved', 'all'].includes(params.get('status')) ? params.get('status') : 'open',
    page: params.get('pg') || '',
    person: params.get('who') || '',
    q: params.get('q') || '',
    sort: params.get('sort') === 'old' ? 'old' : 'new',
    active: Number(params.get('c')) || 0,   // Comment shown in the conversation pane.
    focus: Number(params.get('c')) || 0,    // Row with keyboard focus.
    selected: new Set(),
    trash: Number(cfg.trash) || 0,          // wp_localize_script passes numbers as strings ("0" is truthy).
  };

  const saveFilters = () => {
    const u = new URL(location.href);
    [['status', state.status === 'open' ? '' : state.status], ['pg', state.page], ['who', state.person], ['q', state.q],
      ['sort', state.sort === 'new' ? '' : state.sort], ['c', state.active || '']]
      .forEach(([k, v]) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k)));
    history.replaceState(null, '', u);
  };

  // Same numbering as the pins on the page: order of creation among that page's comments.
  let numberCache = null;
  const numberOf = (c) => {
    if (!numberCache) {
      numberCache = new Map();
      const byPage = {};
      [...state.comments].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((x) => {
        byPage[x.page_key] = (byPage[x.page_key] || 0) + 1;
        numberCache.set(x.id, byPage[x.page_key]);
      });
    }
    return numberCache.get(c.id);
  };
  const find = (id) => state.comments.find((c) => c.id === id);
  const inStatus = (c) => state.status === 'all' || c.status === state.status;

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    const dir = state.sort === 'old' ? 1 : -1;
    return state.comments.filter((c) =>
      inStatus(c) &&
      (!state.page || c.page_key === state.page) &&
      (!state.person || c.author === state.person) &&
      (!q || [c.text, c.snippet, c.author, pageName(c), ...c.replies.map((r) => r.text)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => dir * (new Date(a.date) - new Date(b.date)));
  };

  /* ---------------- shell ---------------- */
  app.insertAdjacentHTML('beforeend', `
    <header class="bpsc-header">
      <div>
        <h2>Site Comments</h2>
        <p>Feedback from your team, pinned to the live site.</p>
      </div>
      <div class="bpsc-header__actions">
        <a class="bpsc-btn bpsc-btn--quiet" href="${esc(cfg.trashUrl)}" data-trash>${icon.trash}<span>Trash</span></a>
        <a class="bpsc-btn bpsc-btn--dark" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">${icon.cursor}<span>Review the site</span></a>
      </div>
    </header>
    <div class="bpsc-shell" data-shell>
      <nav class="bpsc-rail" data-rail aria-label="Filter comments"></nav>
      <section class="bpsc-main" aria-label="Comments">
        <div class="bpsc-main__bar" data-bar></div>
        <div class="bpsc-list" data-list role="listbox" aria-label="Comments" aria-live="polite"></div>
      </section>
      <aside class="bpsc-pane" data-pane aria-label="Conversation"></aside>
    </div>
    <div class="bpsc-toast" data-toast role="status" aria-live="polite" hidden></div>`);
  const $ = (s) => app.querySelector(s);

  /* ---------------- rendering ---------------- */
  const renderBadge = () => {
    const open = state.comments.filter((c) => c.status === 'open').length;
    const item = document.querySelector('#toplevel_page_bp-site-comments .wp-menu-name');
    if (!item || state.loading || state.error) return;
    let badge = item.querySelector('.awaiting-mod');
    if (!open) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.innerHTML = '<span class="pending-count"></span>'; item.append(' ', badge); }
    badge.className = `awaiting-mod count-${open}`;
    badge.firstElementChild.textContent = open;
  };
  const renderTrash = () => { $('[data-trash] span').textContent = state.trash ? `Trash · ${state.trash}` : 'Trash'; };

  const renderRail = () => {
    const rail = $('[data-rail]');
    const all = state.comments;
    const count = (st) => (st === 'all' ? all.length : all.filter((c) => c.status === st).length);
    const open = count('open');
    const pct = all.length ? Math.round(((all.length - open) / all.length) * 100) : 0;
    // Pages, busiest first, counting what is in the current view.
    const pages = [...all.reduce((m, c) => {
      const p = m.get(c.page_key) || { key: c.page_key, name: pageName(c), n: 0 };
      if (inStatus(c)) p.n += 1;
      return m.set(c.page_key, p);
    }, new Map()).values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const ring = 2 * Math.PI * 22;
    rail.innerHTML = `
      <p class="bpsc-rail__label">Views</p>
      ${[['open', 'Open', icon.inbox], ['resolved', 'Resolved', icon.check], ['all', 'All comments', icon.stack]].map(([k, label, ic]) => `
        <button type="button" class="bpsc-rail__item${state.status === k ? ' is-on' : ''} bpsc-rail__item--${k}" data-status="${k}" aria-pressed="${state.status === k}">${ic}<span>${label}</span><b>${count(k)}</b></button>`).join('')}
      <p class="bpsc-rail__label">Pages</p>
      <button type="button" class="bpsc-rail__item${state.page ? '' : ' is-on'}" data-page="" aria-pressed="${!state.page}">${icon.page}<span>All pages</span></button>
      ${pages.map((p) => `<button type="button" class="bpsc-rail__item${state.page === p.key ? ' is-on' : ''}" data-page="${esc(p.key)}" aria-pressed="${state.page === p.key}" title="${esc(p.key)}">${icon.page}<span>${esc(p.name)}</span>${p.n ? `<b>${p.n}</b>` : ''}</button>`).join('')}
      <div class="bpsc-progress">
        <svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="none" stroke="#e7e9ec" stroke-width="5"/><circle cx="26" cy="26" r="22" fill="none" stroke="#008a20" stroke-width="5" stroke-linecap="round" stroke-dasharray="${ring}" stroke-dashoffset="${ring * (1 - pct / 100)}" transform="rotate(-90 26 26)"/></svg>
        <div><b>${pct}% resolved</b><span>${open ? `${plural(open, 'comment', 'comments')} to go` : 'All done'}</span></div>
      </div>`;
  };

  const renderBar = () => {
    const bar = $('[data-bar]');
    const sel = [...state.selected].filter(find);
    const visible = filtered().length;
    // One checkbox selects every comment in the current view; it shows a dash while only some are.
    const selectAll = `<label class="bpsc-selall" title="${sel.length ? 'Select none' : 'Select all'} (Ctrl+A)"><input type="checkbox" data-select-all${sel.length && sel.length >= visible ? ' checked' : ''} aria-label="Select all ${visible} comments"></label>`;
    if (sel.length) {
      bar.innerHTML = `
        <div class="bpsc-bulk">
          ${selectAll}
          <b>${sel.length} selected</b>
          ${sel.length < visible ? `<button type="button" class="bpsc-link" data-bulk="all">Select all ${visible}</button>` : ''}
          <span class="bpsc-sep"></span>
          <button type="button" class="bpsc-btn bpsc-btn--ok bpsc-btn--sm" data-bulk="resolved">${icon.check}Resolve</button>
          <button type="button" class="bpsc-btn bpsc-btn--sm" data-bulk="open">${icon.undo}Reopen</button>
          <button type="button" class="bpsc-btn bpsc-btn--sm bpsc-btn--danger" data-bulk="trash" aria-label="Move to Trash">${icon.trash}</button>
          <button type="button" class="bpsc-x" data-bulk="clear" title="Clear selection (Esc)" aria-label="Clear selection">${icon.close}</button>
        </div>`;
      bar.querySelector('[data-select-all]').indeterminate = sel.length < visible;
      return;
    }
    const people = [...new Set(state.comments.map((c) => c.author))].sort();
    const typing = document.activeElement?.matches?.('[data-q]');
    const view = { open: 'Open', resolved: 'Resolved', all: 'All comments' }[state.status];
    const pageLabel = state.page ? pageName(state.comments.find((c) => c.page_key === state.page) || { page_key: state.page }) : '';
    bar.innerHTML = `
      <div class="bpsc-title-row">
        ${visible ? selectAll : ''}
        <h3>${view}${pageLabel ? `<span> · ${esc(pageLabel)}</span>` : ''}</h3>
        <span class="bpsc-count">${plural(filtered().length, 'comment', 'comments')}</span>
      </div>
      <div class="bpsc-filters">
        <label class="bpsc-search">${icon.search}<span class="screen-reader-text">Search comments</span><input type="search" data-q placeholder="Search" value="${esc(state.q)}"><kbd>/</kbd></label>
        <select data-person aria-label="Person"><option value="">Everyone</option>${people.map((pp) => `<option${state.person === pp ? ' selected' : ''}>${esc(pp)}</option>`).join('')}</select>
        <select data-sort aria-label="Sort"><option value="new"${state.sort === 'new' ? ' selected' : ''}>Newest</option><option value="old"${state.sort === 'old' ? ' selected' : ''}>Oldest</option></select>
      </div>`;
    if (typing) { const q = bar.querySelector('[data-q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };

  const row = (c) => {
    const done = c.status === 'resolved';
    const sel = state.selected.has(c.id);
    const n = numberOf(c);
    return `
      <div class="bpsc-row${done ? ' is-done' : ''}${sel ? ' is-selected' : ''}${state.active === c.id ? ' is-active' : ''}" role="option" aria-selected="${state.active === c.id}" data-id="${c.id}" tabindex="${state.focus === c.id ? 0 : -1}">
        <span class="bpsc-row__lead" data-stop>
          ${avatar(c.author, c.avatar)}
          <input type="checkbox" data-select${sel ? ' checked' : ''} aria-label="Select comment ${n}">
        </span>
        <span class="bpsc-row__body">
          <span class="bpsc-row__top"><span class="bpsc-row__text">${esc(c.text)}</span><time datetime="${esc(c.date)}" title="${esc(fullDate(c.date))}">${age(c.date)}</time></span>
          <span class="bpsc-row__meta">
            <span class="bpsc-pin${done ? ' is-done' : ''}" title="Pin ${n} on the page">${done ? icon.check : n}</span>
            <span class="bpsc-row__who">${esc(c.author)}</span>
            ${state.page ? '' : `<span class="bpsc-dot bpsc-dot--page"></span><span class="bpsc-row__page">${esc(pageName(c))}</span>`}
            <span class="bpsc-dot"></span><span class="bpsc-row__on">${kind(c.tag)}${c.snippet ? `: ${esc(c.snippet)}` : ''}</span>
            ${c.replies.length ? `<span class="bpsc-row__replies">${icon.reply}${c.replies.length}</span>` : ''}
          </span>
        </span>
        <span class="bpsc-row__acts" data-stop>
          ${c.can_edit ? `<button type="button" data-act="status" title="${done ? 'Reopen (E)' : 'Resolve (E)'}" aria-label="${done ? 'Reopen' : 'Resolve'} comment ${n}">${done ? icon.undo : icon.check}</button>` : ''}
          ${c.can_edit ? `<button type="button" data-act="trash" title="Move to Trash" aria-label="Move comment ${n} to Trash">${icon.trash}</button>` : ''}
        </span>
      </div>`;
  };

  const emptyState = () => {
    if (!state.comments.length) {
      return `
        <div class="bpsc-empty bpsc-empty--start">
          ${art.start}
          <h3>No feedback yet</h3>
          <p>Open the site while logged in, turn on <b>Comment mode</b>, then click any heading, image or section and type. Everything your team leaves shows up here.</p>
          <ol class="bpsc-steps"><li><span>1</span>Open the site</li><li><span>2</span>Press <kbd>C</kbd> or click Comment</li><li><span>3</span>Click anything and type</li></ol>
          <a class="bpsc-btn bpsc-btn--dark" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">${icon.cursor}<span>Start reviewing</span></a>
        </div>`;
    }
    if (state.status === 'open' && !state.page && !state.person && !state.q.trim()) {
      return `<div class="bpsc-empty">${art.done}<h3>All caught up</h3><p>Every comment has been resolved. New feedback will appear here.</p><button type="button" class="bpsc-btn" data-status="resolved">See resolved</button></div>`;
    }
    if (state.status === 'open' && state.page && !state.person && !state.q.trim()) {
      return `<div class="bpsc-empty">${art.done}<h3>This page is done</h3><p>No open comments left on this page.</p><button type="button" class="bpsc-btn" data-page="">Show all pages</button></div>`;
    }
    return `<div class="bpsc-empty">${art.none}<h3>Nothing matches</h3><p>Try a different search, person or page.</p><button type="button" class="bpsc-btn" data-act="clear">Clear filters</button></div>`;
  };

  const renderList = () => {
    numberCache = null;
    const list = $('[data-list]');
    const hadFocus = !!document.activeElement?.closest?.('.bpsc-row');   // Redraws keep keyboard focus.
    if (state.loading) { list.innerHTML = '<div class="bpsc-row is-loading"><span></span><span></span></div>'.repeat(7); return; }
    if (state.error) {
      list.innerHTML = `<div class="bpsc-empty">${art.none}<h3>Couldn't load comments</h3><p>${esc(state.error)}</p><button type="button" class="bpsc-btn" data-act="retry">Try again</button></div>`;
      return;
    }
    const items = filtered();
    if (!items.length) { list.innerHTML = emptyState(); return; }
    if (!items.some((c) => c.id === state.focus)) state.focus = items[0].id;
    list.innerHTML = items.map(row).join('');
    if (hadFocus) list.querySelector(`.bpsc-row[data-id="${state.focus}"]`)?.focus({ preventScroll: true });
  };

  const renderPane = () => {
    const pane = $('[data-pane]');
    const c = find(state.active);
    $('[data-shell]').classList.toggle('has-active', !!c);
    if (!c) {
      pane.innerHTML = state.comments.length ? `
        <div class="bpsc-pane__idle">
          ${art.pick}
          <h3>Pick a comment</h3>
          <p>Its conversation opens here. Reply, resolve or jump to the spot on the page.</p>
          <dl class="bpsc-keys">
            <dt><kbd>↑</kbd><kbd>↓</kbd></dt><dd>Move</dd><dt><kbd>Enter</kbd></dt><dd>Open</dd>
            <dt><kbd>E</kbd></dt><dd>Resolve</dd><dt><kbd>R</kbd></dt><dd>Reply</dd>
            <dt><kbd>X</kbd></dt><dd>Select</dd><dt><kbd>Ctrl</kbd> <kbd>A</kbd></dt><dd>Select all</dd><dt><kbd>/</kbd></dt><dd>Search</dd>
          </dl>
        </div>` : '';
      return;
    }
    const done = c.status === 'resolved';
    const msg = (r, first) => `
      <li class="${first ? 'is-first' : ''}">
        ${avatar(r.author, r.avatar, first ? 'lg' : '')}
        <div><p class="bpsc-msg__by"><b>${esc(r.author)}</b><time datetime="${esc(r.date)}" title="${esc(fullDate(r.date))}">${ago(r.date)}</time></p><p class="bpsc-msg__text">${esc(r.text)}</p></div>
      </li>`;
    pane.innerHTML = `
      <header class="bpsc-pane__head">
        <button type="button" class="bpsc-x bpsc-pane__back" data-act="close" aria-label="Close (Esc)">${icon.close}</button>
        <span class="bpsc-status${done ? ' is-done' : ''}">${done ? `${icon.check}Resolved` : 'Open'}</span>
        <span class="bpsc-sep"></span>
        ${c.can_edit ? `<button type="button" class="bpsc-icon" data-act="trash" title="Move to Trash" aria-label="Move to Trash">${icon.trash}</button>` : ''}
        ${c.can_edit ? `<button type="button" class="bpsc-btn bpsc-btn--sm ${done ? '' : 'bpsc-btn--ok'}" data-act="status">${done ? `${icon.undo}Reopen` : `${icon.check}Resolve`}</button>` : ''}
      </header>
      <div class="bpsc-pane__scroll">
        <a class="bpsc-where" href="${esc(withParam(c.page_url, 'bp-comment', c.id))}" target="_blank" rel="noopener" title="Open this spot on the page">
          <span class="bpsc-pin${done ? ' is-done' : ''}">${done ? icon.check : numberOf(c)}</span>
          <span class="bpsc-where__text"><b>${esc(pageName(c))}</b><span>${icon.target}${kind(c.tag)}${c.snippet ? `: ${esc(c.snippet)}` : ''}</span></span>
          <span class="bpsc-where__go">View on page ${icon.ext}</span>
        </a>
        <ol class="bpsc-thread">${msg(c, true)}${c.replies.map((r) => msg(r, false)).join('')}</ol>
      </div>
      <div class="bpsc-compose">
        <textarea rows="2" data-reply-text placeholder="Reply to ${esc(c.author)}…" aria-label="Reply to ${esc(c.author)}"></textarea>
        <div class="bpsc-compose__foot"><span><kbd>Ctrl</kbd> <kbd>Enter</kbd> to send</span><button type="button" class="bpsc-btn bpsc-btn--dark bpsc-btn--sm" data-act="reply" disabled>${icon.send}Send</button></div>
      </div>`;
  };

  const render = () => {
    const fresh = !state.loading && !state.error && !state.comments.length;
    $('[data-shell]').classList.toggle('is-fresh', fresh);   // First run: just the welcome, no empty panes.
    renderTrash(); renderBadge(); renderRail(); renderBar(); renderList(); renderPane();
  };

  /* ---------------- toast with undo ---------------- */
  let toastTimer;
  const toast = (msg, { undo, bad } = {}) => {
    const t = $('[data-toast]');
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" data-undo>${icon.undo}Undo</button>` : ''}`;
    t.classList.toggle('is-bad', !!bad);
    t.hidden = false;
    const hide = () => { t.hidden = true; };
    if (undo) t.querySelector('[data-undo]').addEventListener('click', () => { hide(); undo(); });
    clearTimeout(toastTimer);
    // Long enough to notice a mistake, and paused while the pointer is on it.
    toastTimer = setTimeout(hide, undo ? 10000 : 3000);
    t.onmouseenter = () => clearTimeout(toastTimer);
    t.onmouseleave = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, 2500); };
  };

  /* ---------------- data ---------------- */
  const load = async () => {
    try { state.comments = await api(''); state.error = ''; } catch (e) { state.error = e.message; }
    state.loading = false;
    if (state.active && !find(state.active)) state.active = 0;
    render();
  };
  const upsert = (fresh) => {
    const i = state.comments.findIndex((c) => c.id === fresh.id);
    if (i >= 0) state.comments[i] = fresh; else state.comments.push(fresh);
  };
  const keepFocus = () => app.querySelector(`.bpsc-row[data-id="${state.focus}"]`)?.focus({ preventScroll: false });
  // The row after (or before) comments that are about to leave the current view.
  const nextAfter = (ids) => {
    const items = filtered();
    const idx = items.findIndex((c) => ids.includes(c.id));
    const rest = items.filter((c) => !ids.includes(c.id));
    return (rest[idx] || rest[idx - 1] || {}).id || 0;
  };

  const setStatus = async (ids, status) => {
    const targets = ids.map(find).filter((c) => c && c.can_edit && c.status !== status);
    if (!targets.length) return;
    if (state.status !== 'all') state.focus = nextAfter(targets.map((c) => c.id)) || state.focus;
    const before = targets.map((c) => [c, c.status]);
    targets.forEach((c) => { c.status = status; });   // Instant; rolled back on error.
    render();
    keepFocus();
    try {
      (await Promise.all(targets.map((c) => api(`/${c.id}`, { method: 'PATCH', body: { status } })))).forEach(upsert);
      const word = status === 'resolved' ? 'resolved' : 'reopened';
      toast(targets.length === 1 ? `Comment ${word}` : `${targets.length} comments ${word}`, {
        undo: () => setStatus(targets.map((c) => c.id), status === 'resolved' ? 'open' : 'resolved'),
      });
    } catch (e) {
      before.forEach(([c, s]) => { c.status = s; });
      toast(e.message, { bad: true });
    }
    render();
  };

  const trash = async (ids) => {
    const targets = ids.map(find).filter((c) => c && c.can_edit);
    if (!targets.length) return;
    state.focus = nextAfter(targets.map((c) => c.id)) || state.focus;
    if (targets.some((c) => c.id === state.active)) state.active = 0;
    state.comments = state.comments.filter((c) => !targets.includes(c));
    targets.forEach((c) => state.selected.delete(c.id));
    saveFilters();
    render();
    keepFocus();
    try {
      await Promise.all(targets.map((c) => api(`/${c.id}`, { method: 'DELETE' })));
      state.trash += targets.length;
      renderTrash();
      toast(targets.length === 1 ? 'Moved to Trash' : `${targets.length} comments moved to Trash`, {
        undo: async () => {
          try {
            (await Promise.all(targets.map((c) => api(`/${c.id}/restore`, { method: 'POST' })))).forEach(upsert);
            state.trash = Math.max(0, state.trash - targets.length);
            render();
            toast(targets.length === 1 ? 'Comment restored' : 'Comments restored');
          } catch (e) { toast(e.message, { bad: true }); }
        },
      });
    } catch (e) {
      state.comments.push(...targets);
      render();
      toast(e.message, { bad: true });
    }
  };

  const open = (id) => { state.active = id; state.focus = id; saveFilters(); renderList(); renderPane(); };
  const close = () => { state.active = 0; saveFilters(); renderList(); renderPane(); keepFocus(); };
  const toggleSelect = (id, on = !state.selected.has(id)) => {
    if (on) state.selected.add(id); else state.selected.delete(id);
    renderBar(); renderList(); keepFocus();
  };
  const setFilter = (patch) => {
    Object.assign(state, patch);
    state.selected.clear();
    // A conversation the new filter hides would be confusing next to the list: close it.
    if (state.active && !filtered().some((c) => c.id === state.active)) state.active = 0;
    saveFilters(); render();
  };

  /* ---------------- events ---------------- */
  app.addEventListener('click', async (e) => {
    const statusBtn = e.target.closest('[data-status]');
    if (statusBtn) { setFilter({ status: statusBtn.dataset.status }); return; }
    const pageBtn = e.target.closest('button[data-page]');
    if (pageBtn) { setFilter({ page: pageBtn.dataset.page }); return; }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const ids = [...state.selected];
      const act = bulk.dataset.bulk;
      if (act === 'clear') { state.selected.clear(); render(); return; }
      if (act === 'all') { filtered().forEach((c) => state.selected.add(c.id)); render(); return; }
      state.selected.clear();
      if (act === 'trash') trash(ids); else setStatus(ids, act);
      return;
    }
    const btn = e.target.closest('[data-act]');
    const rowEl = e.target.closest('.bpsc-row');
    const c = rowEl ? find(Number(rowEl.dataset.id)) : find(state.active);
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'clear') { setFilter({ page: '', person: '', q: '' }); return; }
      if (act === 'retry') { state.loading = true; render(); load(); return; }
      if (act === 'close') { close(); return; }
      if (!c) return;
      if (act === 'status') setStatus([c.id], c.status === 'resolved' ? 'open' : 'resolved');
      else if (act === 'trash') trash([c.id]);
      else if (act === 'reply') {
        const box = $('[data-reply-text]');
        const text = box.value.trim();
        if (!text) return;
        btn.disabled = true;
        try {
          upsert(await api(`/${c.id}/replies`, { method: 'POST', body: { text } }));
          renderList(); renderPane();
          $('.bpsc-pane__scroll')?.scrollTo({ top: 1e6 });
          toast('Reply sent');
        } catch (err) { toast(err.message, { bad: true }); btn.disabled = false; }
      }
      return;
    }
    // A click anywhere else on a row opens it (the checkbox and row buttons handle themselves).
    if (rowEl && !e.target.closest('[data-stop]')) open(Number(rowEl.dataset.id));
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-select-all]')) {
      if (t.checked) filtered().forEach((c) => state.selected.add(c.id)); else state.selected.clear();
      renderBar(); renderList();
    } else if (t.matches('[data-select]')) toggleSelect(Number(t.closest('.bpsc-row').dataset.id), t.checked);
    else if (t.matches('[data-person]')) setFilter({ person: t.value });
    else if (t.matches('[data-sort]')) setFilter({ sort: t.value });
  });

  let searchTimer;
  app.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.q = e.target.value; saveFilters(); renderList(); renderBar(); }, 120);
    } else if (e.target.matches('[data-reply-text]')) {
      $('[data-act="reply"]').disabled = !e.target.value.trim();
    }
  });

  // Whichever row gets focus (click, Tab, screen reader) is where the keyboard continues from.
  app.addEventListener('focusin', (e) => {
    const r = e.target.closest?.('.bpsc-row');
    if (!r) return;
    const id = Number(r.dataset.id);
    if (state.focus !== id) {
      app.querySelector(`.bpsc-row[data-id="${state.focus}"]`)?.setAttribute('tabindex', '-1');
      state.focus = id;
      r.setAttribute('tabindex', '0');
    }
  });

  // Keyboard: move through rows, open, resolve, reply, select, search.
  document.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable]');
    if (e.target.matches?.('[data-reply-text]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); $('[data-act="reply"]').click(); return;
    }
    if (e.key === 'Escape') {
      if (inField) { e.target.blur(); keepFocus(); return; }
      if (state.active) { close(); return; }
      if (state.selected.size) { state.selected.clear(); render(); }
      return;
    }
    if (!inField && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A') && !state.loading) {
      const items = filtered();
      if (items.length && !e.target.closest('.bpsc-pane')) {
        e.preventDefault();
        items.forEach((c) => state.selected.add(c.id));
        renderBar(); renderList(); keepFocus();
        return;
      }
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = filtered();
    const i = items.findIndex((c) => c.id === state.focus);
    const go = (j) => {
      const next = items[Math.max(0, Math.min(items.length - 1, j))];
      if (!next) return;
      state.focus = next.id;
      if (state.active) state.active = next.id;   // The conversation follows while it is open.
      renderList(); renderPane(); keepFocus();
    };
    const c = items[i];
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': case 'k': e.preventDefault(); go(i - 1); break;
      // Only from a row (or nowhere): Enter on a focused button or link keeps its own meaning.
      case 'Enter': if (c && (e.target.classList?.contains('bpsc-row') || e.target === document.body)) { e.preventDefault(); open(c.id); } break;
      case 'e': case 'E': if (c) setStatus([c.id], c.status === 'resolved' ? 'open' : 'resolved'); break;
      case 'x': case 'X': if (c) toggleSelect(c.id); break;
      case 'Delete': if (c) trash([c.id]); break;
      case 'r': case 'R': if (c) { e.preventDefault(); open(c.id); $('[data-reply-text]')?.focus(); } break;
      case '/': e.preventDefault(); $('[data-q]')?.focus(); break;
      default:
    }
  });

  // Avatars that fail to load fall back to the initials underneath.
  app.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  // Back on this tab after reviewing the site: show what changed (unless someone is typing).
  window.addEventListener('focus', () => {
    const typing = $('[data-reply-text]')?.value.trim() || app.querySelector('[data-q]:focus');
    if (!state.loading && !typing) load();
  });

  render();
  load();
})();
