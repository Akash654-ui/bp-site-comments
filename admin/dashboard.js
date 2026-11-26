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
  // WordPress's translation functions (wp-i18n); plain English if they are missing for any reason.
  const { __, _n, sprintf } = window.wp?.i18n || {
    __: (s) => s,
    _n: (one, many, n) => (n === 1 ? one : many),
    sprintf: (f, ...a) => { let i = 0; return f.replace(/%(%|(\d+)\$[sd]|[sd])/g, (m, x, p) => (x === '%' ? '%' : String(a[p ? p - 1 : i++]))); },
  };
  const app = document.getElementById('bpsc-app');
  if (!cfg || !app) return;

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Comment text with web addresses and emails made clickable (new tab); every piece is escaped.
  const URLS = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[^\s<>"']+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b)/gi;
  const rich = (text) => String(text ?? '').split(URLS).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const tail = (part.match(/[).,!?;:]+$/) || [''])[0];
    const url = tail ? part.slice(0, -tail.length) : part;
    const href = url.includes('@') && !/^https?:/i.test(url) ? `mailto:${url}` : (/^www\./i.test(url) ? `https://${url}` : url);
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url)}</a>${esc(tail)}`;
  }).join('');
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const fullDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const age = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    // Short forms for the list: "now", "5m", "3h", "2d", "1w".
    if (s < 60) return __('now', 'bp-site-comments');
    /* translators: %d: minutes, shown short in the comment list, e.g. "5m". */
    if (s < 3600) return sprintf(__('%dm', 'bp-site-comments'), Math.floor(s / 60));
    /* translators: %d: hours, shown short, e.g. "3h". */
    if (s < 86400) return sprintf(__('%dh', 'bp-site-comments'), Math.floor(s / 3600));
    /* translators: %d: days, shown short, e.g. "2d". */
    if (s < 86400 * 7) return sprintf(__('%dd', 'bp-site-comments'), Math.floor(s / 86400));
    /* translators: %d: weeks, shown short, e.g. "1w". */
    if (s < 86400 * 30) return sprintf(__('%dw', 'bp-site-comments'), Math.floor(s / (86400 * 7)));
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const ago = (iso) => {
    const s = Math.max(1, (Date.now() - new Date(iso)) / 1000);
    const n = (unit) => Math.floor(s / unit);
    if (s < 60) return __('just now', 'bp-site-comments');
    /* translators: %d: number of minutes. */
    if (s < 3600) return sprintf(_n('%d minute ago', '%d minutes ago', n(60), 'bp-site-comments'), n(60));
    /* translators: %d: number of hours. */
    if (s < 86400) return sprintf(_n('%d hour ago', '%d hours ago', n(3600), 'bp-site-comments'), n(3600));
    /* translators: %d: number of days. */
    if (s < 604800) return sprintf(_n('%d day ago', '%d days ago', n(86400), 'bp-site-comments'), n(86400));
    /* translators: %d: number of weeks. */
    if (s < 2630880) return sprintf(_n('%d week ago', '%d weeks ago', n(604800), 'bp-site-comments'), n(604800));
    /* translators: %d: number of months. */
    if (s < 31570560) return sprintf(_n('%d month ago', '%d months ago', n(2630880), 'bp-site-comments'), n(2630880));
    /* translators: %d: number of years. */
    return sprintf(_n('%d year ago', '%d years ago', n(31570560), 'bp-site-comments'), n(31570560));
  };
  // "3 comments": a count with its noun, in the site's language.
  /* translators: %d: number of comments. */
  const nComments = (n) => sprintf(_n('%d comment', '%d comments', n, 'bp-site-comments'), n);
  const api = async (path = '', opts = {}) => {
    const res = await fetch(cfg.api + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'rest_cookie_invalid_nonce') throw new Error(__('Your session has expired. Reload the page and try again.', 'bp-site-comments'));
      throw Object.assign(new Error(data.message || __('Something went wrong. Please try again.', 'bp-site-comments')), { status: res.status });
    }
    return data;
  };
  const withParam = (url, key, value) => { try { const u = new URL(url); u.searchParams.set(key, value); return u.toString(); } catch (e) { return url; } };
  const kind = (tag) => {
    const t = String(tag || '').toLowerCase();
    if (/^h[1-6]$/.test(t)) return __('Heading', 'bp-site-comments');
    const image = __('Image', 'bp-site-comments'), list = __('List', 'bp-site-comments'), question = __('Question', 'bp-site-comments');
    const cell = __('Cell', 'bp-site-comments'), field = __('Field', 'bp-site-comments'), text = __('Text', 'bp-site-comments');
    return ({
      img: image, picture: image, figure: image, video: __('Video', 'bp-site-comments'), iframe: __('Embed', 'bp-site-comments'),
      p: __('Paragraph', 'bp-site-comments'), a: __('Link', 'bp-site-comments'), button: __('Button', 'bp-site-comments'),
      li: __('List item', 'bp-site-comments'), ul: list, ol: list, section: __('Section', 'bp-site-comments'), summary: question, details: question,
      table: __('Table', 'bp-site-comments'), td: cell, th: cell, blockquote: __('Quote', 'bp-site-comments'), figcaption: __('Caption', 'bp-site-comments'),
      header: __('Header', 'bp-site-comments'), footer: __('Footer', 'bp-site-comments'), nav: __('Menu', 'bp-site-comments'), form: __('Form', 'bp-site-comments'),
      input: field, textarea: field, select: field, label: field, svg: __('Icon', 'bp-site-comments'), span: text, b: text, strong: text, em: text,
    })[t] || __('Box', 'bp-site-comments');
  };
  // "About us | Zyraa Kitchens" -> "About us": the site name repeats on every page. The front page is "Home".
  const siteName = String(cfg.site || '').trim().toLowerCase();
  const pageName = (c) => {
    if (c.page_key === '/') return __('Home', 'bp-site-comments');
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
  // The server says how many seconds each of your replies can still be deleted; keep that deadline on
  // this computer's clock, so a wrong clock does not matter and the Delete button goes away on time.
  const stamp = (c) => { (c.replies || []).forEach((r) => { r.delUntil = Date.now() + (Number(r.edit_left) || 0) * 1000; }); return c; };
  const canDelReply = (r) => r.mine && r.id && Date.now() < (r.delUntil || 0);
  // Authors can delete their own comment only for a short while after posting; managers always can.
  const canTrash = (c) => !!c.can_delete;
  const inStatus = (c) => state.status === 'all' || c.status === state.status;

  // People are told apart by user ID (two people can share a name). Old links with a name still work.
  const personKey = (c) => (c.author_id ? String(c.author_id) : c.author);

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    const dir = state.sort === 'old' ? 1 : -1;
    return state.comments.filter((c) =>
      inStatus(c) &&
      (!state.page || c.page_key === state.page) &&
      (!state.person || personKey(c) === state.person) &&
      (!q || [c.text, c.snippet, c.author, pageName(c), ...c.replies.map((r) => r.text)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => dir * (new Date(a.date) - new Date(b.date)));
  };

  /* ---------------- shell ---------------- */
  app.insertAdjacentHTML('beforeend', `
    <header class="bpsc-header">
      <div>
        <h2>${esc(__('Site Comments', 'bp-site-comments'))}</h2>
        <p>${esc(__('Feedback from your team, pinned to the live site.', 'bp-site-comments'))}</p>
      </div>
      <div class="bpsc-header__actions">
        <a class="bpsc-btn bpsc-btn--quiet" href="${esc(cfg.trashUrl)}" data-trash>${icon.trash}<span>${esc(__('Trash', 'bp-site-comments'))}</span></a>
        <a class="bpsc-btn bpsc-btn--dark" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">${icon.cursor}<span>${esc(__('Review the site', 'bp-site-comments'))}</span></a>
      </div>
    </header>
    <div class="bpsc-shell" data-shell>
      <nav class="bpsc-rail" data-rail aria-label="${esc(__('Filter comments', 'bp-site-comments'))}"></nav>
      <section class="bpsc-main" aria-label="${esc(__('Comments', 'bp-site-comments'))}">
        <div class="bpsc-main__bar" data-bar></div>
        <div class="bpsc-list" data-list role="listbox" aria-label="${esc(__('Comments', 'bp-site-comments'))}" aria-live="polite"></div>
      </section>
      <aside class="bpsc-pane" data-pane aria-label="${esc(__('Conversation', 'bp-site-comments'))}"></aside>
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
  const renderTrash = () => { /* translators: %d: number of comments in the Trash. */
    $('[data-trash] span').textContent = state.trash ? sprintf(__('Trash · %d', 'bp-site-comments'), state.trash) : __('Trash', 'bp-site-comments'); };

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
      <p class="bpsc-rail__label">${esc(__('Views', 'bp-site-comments'))}</p>
      ${[['open', __('Open', 'bp-site-comments'), icon.inbox], ['resolved', __('Resolved', 'bp-site-comments'), icon.check], ['all', __('All comments', 'bp-site-comments'), icon.stack]].map(([k, label, ic]) => `
        <button type="button" class="bpsc-rail__item${state.status === k ? ' is-on' : ''} bpsc-rail__item--${k}" data-status="${k}" aria-pressed="${state.status === k}">${ic}<span>${esc(label)}</span><b>${count(k)}</b></button>`).join('')}
      <p class="bpsc-rail__label">${esc(__('Pages', 'bp-site-comments'))}</p>
      <button type="button" class="bpsc-rail__item${state.page ? '' : ' is-on'}" data-page="" aria-pressed="${!state.page}">${icon.page}<span>${esc(__('All pages', 'bp-site-comments'))}</span></button>
      ${pages.map((p) => `<button type="button" class="bpsc-rail__item${state.page === p.key ? ' is-on' : ''}" data-page="${esc(p.key)}" aria-pressed="${state.page === p.key}" title="${esc(p.key)}">${icon.page}<span>${esc(p.name)}</span>${p.n ? `<b>${p.n}</b>` : ''}</button>`).join('')}
      <div class="bpsc-progress">
        <svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="none" stroke="#e7e9ec" stroke-width="5"/><circle cx="26" cy="26" r="22" fill="none" stroke="#008a20" stroke-width="5" stroke-linecap="round" stroke-dasharray="${ring}" stroke-dashoffset="${ring * (1 - pct / 100)}" transform="rotate(-90 26 26)"/></svg>
        <div><b>${esc(sprintf(__('%d%% resolved', 'bp-site-comments'), pct))}</b><span>${esc(open ? sprintf(_n('%d comment to go', '%d comments to go', open, 'bp-site-comments'), open) : __('All done', 'bp-site-comments'))}</span></div>
      </div>`;
  };

  const renderBar = () => {
    const bar = $('[data-bar]');
    const sel = [...state.selected].filter(find);
    const visible = filtered().length;
    // One checkbox selects every comment in the current view; it shows a dash while only some are.
    const selectAll = `<label class="bpsc-selall" title="${esc(sel.length ? __('Select none (Ctrl+A)', 'bp-site-comments') : __('Select all (Ctrl+A)', 'bp-site-comments'))}"><input type="checkbox" data-select-all${sel.length && sel.length >= visible ? ' checked' : ''} aria-label="${esc(sprintf(_n('Select all %d comment', 'Select all %d comments', visible, 'bp-site-comments'), visible))}"></label>`;
    if (sel.length) {
      bar.innerHTML = `
        <div class="bpsc-bulk">
          ${selectAll}
          <b>${esc(sprintf(__('%d selected', 'bp-site-comments'), sel.length))}</b>
          ${sel.length < visible ? `<button type="button" class="bpsc-link" data-bulk="all">${esc(sprintf(__('Select all %d', 'bp-site-comments'), visible))}</button>` : ''}
          <span class="bpsc-sep"></span>
          <button type="button" class="bpsc-btn bpsc-btn--ok bpsc-btn--sm" data-bulk="resolved">${icon.check}${esc(__('Resolve', 'bp-site-comments'))}</button>
          <button type="button" class="bpsc-btn bpsc-btn--sm" data-bulk="open">${icon.undo}${esc(__('Reopen', 'bp-site-comments'))}</button>
          <button type="button" class="bpsc-btn bpsc-btn--sm bpsc-btn--danger" data-bulk="trash" aria-label="${esc(__('Move to Trash', 'bp-site-comments'))}">${icon.trash}</button>
          <button type="button" class="bpsc-x" data-bulk="clear" title="${esc(__('Clear selection (Esc)', 'bp-site-comments'))}" aria-label="${esc(__('Clear selection', 'bp-site-comments'))}">${icon.close}</button>
        </div>`;
      bar.querySelector('[data-select-all]').indeterminate = sel.length < visible;
      return;
    }
    const people = [...new Map(state.comments.map((c) => [personKey(c), c.author])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const sameName = (name) => people.filter(([, n]) => n === name).length > 1;
    if (state.person && !people.some(([k]) => k === state.person)) {
      const byName = people.find(([, n]) => n === state.person);   // An old ?who=Name link.
      if (byName) state.person = byName[0];
    }
    const typing = document.activeElement?.matches?.('[data-q]');
    const view = { open: __('Open', 'bp-site-comments'), resolved: __('Resolved', 'bp-site-comments'), all: __('All comments', 'bp-site-comments') }[state.status];
    const pageLabel = state.page ? pageName(state.comments.find((c) => c.page_key === state.page) || { page_key: state.page }) : '';
    bar.innerHTML = `
      <div class="bpsc-title-row">
        ${visible ? selectAll : ''}
        <h3>${esc(view)}${pageLabel ? `<span> · ${esc(pageLabel)}</span>` : ''}</h3>
        <span class="bpsc-count">${esc(nComments(filtered().length))}</span>
      </div>
      <div class="bpsc-filters">
        <label class="bpsc-search">${icon.search}<span class="screen-reader-text">${esc(__('Search comments', 'bp-site-comments'))}</span><input type="search" data-q placeholder="${esc(__('Search', 'bp-site-comments'))}" value="${esc(state.q)}"><kbd>/</kbd></label>
        <select data-person aria-label="${esc(__('Person', 'bp-site-comments'))}"><option value="">${esc(__('Everyone', 'bp-site-comments'))}</option>${people.map(([k, name]) => `<option value="${esc(k)}"${state.person === k ? ' selected' : ''}>${esc(sameName(name) ? `${name} (#${k})` : name)}</option>`).join('')}</select>
        <select data-sort aria-label="${esc(__('Sort', 'bp-site-comments'))}"><option value="new"${state.sort === 'new' ? ' selected' : ''}>${esc(__('Newest', 'bp-site-comments'))}</option><option value="old"${state.sort === 'old' ? ' selected' : ''}>${esc(__('Oldest', 'bp-site-comments'))}</option></select>
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
          <input type="checkbox" data-select${sel ? ' checked' : ''} aria-label="${esc(sprintf(__('Select comment %d', 'bp-site-comments'), n))}">
        </span>
        <span class="bpsc-row__body">
          <span class="bpsc-row__top"><span class="bpsc-row__text">${esc(c.text)}</span><time datetime="${esc(c.date)}" title="${esc(fullDate(c.date))}">${age(c.date)}</time></span>
          <span class="bpsc-row__meta">
            <span class="bpsc-pin${done ? ' is-done' : ''}" title="${esc(sprintf(__('Pin %d on the page', 'bp-site-comments'), n))}">${done ? icon.check : n}</span>
            <span class="bpsc-row__who">${esc(c.author)}</span>
            ${state.page ? '' : `<span class="bpsc-dot bpsc-dot--page"></span><span class="bpsc-row__page">${esc(pageName(c))}</span>`}
            <span class="bpsc-dot"></span><span class="bpsc-row__on">${esc(kind(c.tag))}${c.snippet ? `: ${esc(c.snippet)}` : ''}</span>
            ${c.replies.length ? `<span class="bpsc-row__replies">${icon.reply}${c.replies.length}</span>` : ''}
          </span>
        </span>
        <span class="bpsc-row__acts" data-stop>
          ${c.can_edit ? `<button type="button" data-act="status" title="${esc(done ? __('Reopen (E)', 'bp-site-comments') : __('Resolve (E)', 'bp-site-comments'))}" aria-label="${esc(sprintf(done ? __('Reopen comment %d', 'bp-site-comments') : __('Resolve comment %d', 'bp-site-comments'), n))}">${done ? icon.undo : icon.check}</button>` : ''}
          ${canTrash(c) ? `<button type="button" data-act="trash" title="${esc(__('Move to Trash', 'bp-site-comments'))}" aria-label="${esc(sprintf(__('Move comment %d to Trash', 'bp-site-comments'), n))}">${icon.trash}</button>` : ''}
        </span>
      </div>`;
  };

  const emptyState = () => {
    if (!state.comments.length) {
      return `
        <div class="bpsc-empty bpsc-empty--start">
          ${art.start}
          <h3>${esc(__('No feedback yet', 'bp-site-comments'))}</h3>
          <p>${esc(__('Open the site while logged in, turn on Comment mode, then click any heading, image or section and type. Everything your team leaves shows up here.', 'bp-site-comments'))}</p>
          <ol class="bpsc-steps"><li><span>1</span>${esc(__('Open the site', 'bp-site-comments'))}</li><li><span>2</span>${esc(__('Press C or click Comment', 'bp-site-comments'))}</li><li><span>3</span>${esc(__('Click anything and type', 'bp-site-comments'))}</li></ol>
          <a class="bpsc-btn bpsc-btn--dark" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">${icon.cursor}<span>${esc(__('Start reviewing', 'bp-site-comments'))}</span></a>
        </div>`;
    }
    if (state.status === 'open' && !state.page && !state.person && !state.q.trim()) {
      return `<div class="bpsc-empty">${art.done}<h3>${esc(__('All caught up', 'bp-site-comments'))}</h3><p>${esc(__('Every comment has been resolved. New feedback will appear here.', 'bp-site-comments'))}</p><button type="button" class="bpsc-btn" data-status="resolved">${esc(__('See resolved', 'bp-site-comments'))}</button></div>`;
    }
    if (state.status === 'open' && state.page && !state.person && !state.q.trim()) {
      return `<div class="bpsc-empty">${art.done}<h3>${esc(__('This page is done', 'bp-site-comments'))}</h3><p>${esc(__('No open comments left on this page.', 'bp-site-comments'))}</p><button type="button" class="bpsc-btn" data-page="">${esc(__('Show all pages', 'bp-site-comments'))}</button></div>`;
    }
    return `<div class="bpsc-empty">${art.none}<h3>${esc(__('Nothing matches', 'bp-site-comments'))}</h3><p>${esc(__('Try a different search, person or page.', 'bp-site-comments'))}</p><button type="button" class="bpsc-btn" data-act="clear">${esc(__('Clear filters', 'bp-site-comments'))}</button></div>`;
  };

  const renderList = () => {
    numberCache = null;
    const list = $('[data-list]');
    const hadFocus = !!document.activeElement?.closest?.('.bpsc-row');   // Redraws keep keyboard focus.
    if (state.loading) { list.innerHTML = '<div class="bpsc-row is-loading"><span></span><span></span></div>'.repeat(7); return; }
    if (state.error) {
      list.innerHTML = `<div class="bpsc-empty">${art.none}<h3>${esc(__('Couldn\'t load comments', 'bp-site-comments'))}</h3><p>${esc(state.error)}</p><button type="button" class="bpsc-btn" data-act="retry">${esc(__('Try again', 'bp-site-comments'))}</button></div>`;
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
          <h3>${esc(__('Pick a comment', 'bp-site-comments'))}</h3>
          <p>${esc(__('Its conversation opens here. Reply, resolve or jump to the spot on the page.', 'bp-site-comments'))}</p>
          <dl class="bpsc-keys">
            <dt><kbd>↑</kbd><kbd>↓</kbd></dt><dd>${esc(__('Move', 'bp-site-comments'))}</dd><dt><kbd>Enter</kbd></dt><dd>${esc(__('Open', 'bp-site-comments'))}</dd>
            <dt><kbd>E</kbd></dt><dd>${esc(__('Resolve', 'bp-site-comments'))}</dd><dt><kbd>R</kbd></dt><dd>${esc(__('Reply', 'bp-site-comments'))}</dd>
            <dt><kbd>X</kbd></dt><dd>${esc(__('Select', 'bp-site-comments'))}</dd><dt><kbd>Ctrl</kbd> <kbd>A</kbd></dt><dd>${esc(__('Select all', 'bp-site-comments'))}</dd><dt><kbd>/</kbd></dt><dd>${esc(__('Search', 'bp-site-comments'))}</dd>
          </dl>
        </div>` : '';
      return;
    }
    const done = c.status === 'resolved';
    const msg = (r, first) => `
      <li class="${first ? 'is-first' : ''}">
        ${avatar(r.author, r.avatar, first ? 'lg' : '')}
        <div><p class="bpsc-msg__by"><b>${esc(r.author)}</b><time datetime="${esc(r.date)}" title="${esc(fullDate(r.date))}">${ago(r.date)}</time>${!first && canDelReply(r) ? `<button type="button" class="bpsc-msg__del" data-act="del-reply" data-reply="${esc(r.id)}" title="${esc(sprintf(_n('You can delete your reply for %d minute after posting', 'You can delete your reply for %d minutes after posting', Number(cfg.window) || 15, 'bp-site-comments'), Number(cfg.window) || 15))}">${esc(__('Delete', 'bp-site-comments'))}</button>` : ''}</p><p class="bpsc-msg__text">${rich(r.text)}</p></div>
      </li>`;
    pane.innerHTML = `
      <header class="bpsc-pane__head">
        <button type="button" class="bpsc-x bpsc-pane__back" data-act="close" aria-label="${esc(__('Close (Esc)', 'bp-site-comments'))}">${icon.close}</button>
        <span class="bpsc-status${done ? ' is-done' : ''}">${done ? `${icon.check}${esc(__('Resolved', 'bp-site-comments'))}` : esc(__('Open', 'bp-site-comments'))}</span>
        <span class="bpsc-sep"></span>
        ${canTrash(c) ? `<button type="button" class="bpsc-icon" data-act="trash" title="${esc(__('Move to Trash', 'bp-site-comments'))}" aria-label="${esc(__('Move to Trash', 'bp-site-comments'))}">${icon.trash}</button>` : ''}
        ${c.can_edit ? `<button type="button" class="bpsc-btn bpsc-btn--sm ${done ? '' : 'bpsc-btn--ok'}" data-act="status">${done ? `${icon.undo}${esc(__('Reopen', 'bp-site-comments'))}` : `${icon.check}${esc(__('Resolve', 'bp-site-comments'))}`}</button>` : ''}
      </header>
      <div class="bpsc-pane__scroll">
        <a class="bpsc-where" href="${esc(withParam(c.page_url, 'bp-comment', c.id))}" target="_blank" rel="noopener" title="${esc(__('Open this spot on the page', 'bp-site-comments'))}">
          <span class="bpsc-pin${done ? ' is-done' : ''}">${done ? icon.check : numberOf(c)}</span>
          <span class="bpsc-where__text"><b>${esc(pageName(c))}</b><span>${icon.target}${esc(kind(c.tag))}${c.snippet ? `: ${esc(c.snippet)}` : ''}</span></span>
          <span class="bpsc-where__go">${esc(__('View on page', 'bp-site-comments'))} ${icon.ext}</span>
        </a>
        <ol class="bpsc-thread">${msg(c, true)}${c.replies.map((r) => msg(r, false)).join('')}</ol>
      </div>
      <div class="bpsc-compose">
        <textarea rows="2" maxlength="5000" data-reply-text placeholder="${esc(sprintf(__('Reply to %s…', 'bp-site-comments'), c.author))}" aria-label="${esc(sprintf(__('Reply to %s', 'bp-site-comments'), c.author))}"></textarea>
        <div class="bpsc-compose__foot"><span><kbd>${mac ? '⌘' : 'Ctrl'}</kbd> <kbd>Enter</kbd> ${esc(__('to send', 'bp-site-comments'))}</span><button type="button" class="bpsc-btn bpsc-btn--dark bpsc-btn--sm" data-act="reply" disabled>${icon.send}${esc(__('Send', 'bp-site-comments'))}</button></div>
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
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" data-undo>${icon.undo}${esc(__('Undo', 'bp-site-comments'))}</button>` : ''}`;
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
    try { state.comments = (await api('')).map(stamp); state.error = ''; } catch (e) { state.error = e.message; }
    state.loading = false;
    if (state.active && !find(state.active)) state.active = 0;
    render();
  };
  const upsert = (fresh) => {
    const i = state.comments.findIndex((c) => c.id === fresh.id);
    stamp(fresh);
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

  // Runs one request per comment and splits the comments into the ones that worked and the ones that
  // did not, so one failure (for example a comment a colleague just removed) cannot undo the rest on screen.
  const each = async (targets, call) => {
    const res = await Promise.allSettled(targets.map(call));
    const done = [], failed = [], gone = [];
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') done.push([targets[i], r.value]);
      else if (r.reason?.status === 404) gone.push(targets[i]);   // Removed meanwhile by someone else.
      else failed.push([targets[i], r.reason]);
    });
    if (gone.length) state.comments = state.comments.filter((c) => !gone.includes(c));
    return { done, failed, error: failed[0]?.[1]?.message || '' };
  };

  const setStatus = async (ids, status) => {
    const targets = ids.map(find).filter((c) => c && c.can_edit && c.status !== status);
    if (!targets.length) return;
    if (state.status !== 'all') state.focus = nextAfter(targets.map((c) => c.id)) || state.focus;
    const before = targets.map((c) => [c, c.status]);
    targets.forEach((c) => { c.status = status; });   // Instant; rolled back on error.
    render();
    keepFocus();
    const { done, failed, error } = await each(targets, (c) => api(`/${c.id}`, { method: 'PATCH', body: { status } }));
    done.forEach(([, fresh]) => upsert(fresh));
    failed.forEach(([c]) => { c.status = before.find(([x]) => x === c)[1]; });
    /* translators: 1: comments changed, 2: comments not changed, 3: the error. */
    if (failed.length) toast(done.length ? sprintf(__('%1$d changed, %2$d not: %3$s', 'bp-site-comments'), done.length, failed.length, error) : error, { bad: true });
    else {
      const n = done.length;
      toast(status === 'resolved'
        ? sprintf(_n('Comment resolved', '%d comments resolved', n, 'bp-site-comments'), n)
        : sprintf(_n('Comment reopened', '%d comments reopened', n, 'bp-site-comments'), n), {
        undo: () => setStatus(done.map(([c]) => c.id), status === 'resolved' ? 'open' : 'resolved'),
      });
    }
    render();
  };

  const trash = async (ids) => {
    const targets = ids.map(find).filter((c) => c && canTrash(c));
    if (!targets.length) return;
    state.focus = nextAfter(targets.map((c) => c.id)) || state.focus;
    if (targets.some((c) => c.id === state.active)) state.active = 0;
    state.comments = state.comments.filter((c) => !targets.includes(c));
    targets.forEach((c) => state.selected.delete(c.id));
    saveFilters();
    render();
    keepFocus();
    const { done, failed, error } = await each(targets, (c) => api(`/${c.id}`, { method: 'DELETE' }));
    const gone = done.map(([c]) => c);
    state.trash += gone.length;
    if (failed.length) {
      state.comments.push(...failed.map(([c]) => c));   // Only the ones still on the server come back.
      render();
      /* translators: 1: comments moved, 2: comments not moved, 3: the error. */
      toast(gone.length ? sprintf(__('%1$d moved to Trash, %2$d not: %3$s', 'bp-site-comments'), gone.length, failed.length, error) : error, { bad: true });
      return;
    }
    renderTrash();
    toast(sprintf(_n('Moved to Trash', '%d comments moved to Trash', gone.length, 'bp-site-comments'), gone.length), {
      undo: async () => {
        const back = await each(gone, (c) => api(`/${c.id}/restore`, { method: 'POST' }));
        back.done.forEach(([, fresh]) => upsert(fresh));
        state.trash = Math.max(0, state.trash - back.done.length);
        render();
        if (back.failed.length) toast(back.error, { bad: true });
        else toast(sprintf(_n('Comment restored', '%d comments restored', back.done.length, 'bp-site-comments'), back.done.length));
      },
    });
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
      else if (act === 'del-reply') {
        // Second click confirms.
        if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = __('Delete for sure?', 'bp-site-comments'); return; }
        btn.disabled = true;
        try {
          upsert(await api(`/${c.id}/replies/${btn.dataset.reply}`, { method: 'DELETE' }));
          renderList(); renderPane();
          toast(__('Reply deleted', 'bp-site-comments'));
        } catch (err) { toast(err.message, { bad: true }); btn.disabled = false; }
      }
      else if (act === 'reply') {
        const box = $('[data-reply-text]');
        const text = box.value.trim();
        if (!text) return;
        btn.disabled = true;
        try {
          upsert(await api(`/${c.id}/replies`, { method: 'POST', body: { text } }));
          renderList(); renderPane();
          $('.bpsc-pane__scroll')?.scrollTo({ top: 1e6 });
          toast(__('Reply sent', 'bp-site-comments'));
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

  // Your reply's Delete goes away when its time is up, without redrawing (a half-written reply stays).
  setInterval(() => {
    app.querySelectorAll('[data-act="del-reply"]').forEach((b) => {
      const r = find(state.active)?.replies.find((x) => x.id === b.dataset.reply);
      if (!r || !canDelReply(r)) b.remove();
    });
  }, 5000);

  // Avatars that fail to load fall back to the initials underneath.
  app.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  // Back on this tab after reviewing the site: show what changed (unless someone is typing).
  window.addEventListener('focus', () => {
    const typing = $('[data-reply-text]')?.value.trim() || app.querySelector('[data-q]:focus');
    if (!state.loading && !typing) load();
  });

  render();
  load();

  // Back from the Trash: after deleting its last comments, or because it was already empty.
  // ("removed", not WordPress's own "deleted", which wp-admin strips from the address before this runs.)
  const deleted = Number(params.get('removed')) || 0;
  if (deleted || params.get('trash') === 'empty') {
    /* translators: %d: number of comments. */
    const gone = sprintf(_n('%d comment deleted permanently.', '%d comments deleted permanently.', deleted, 'bp-site-comments'), deleted);
    toast(deleted ? (state.trash ? gone : `${gone} ${__('The Trash is now empty.', 'bp-site-comments')}`) : __('The Trash is empty.', 'bp-site-comments'));
    const u = new URL(location.href);
    u.searchParams.delete('removed');
    u.searchParams.delete('trash');
    history.replaceState(null, '', u);
  }
})();
