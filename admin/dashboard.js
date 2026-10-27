(function () {
  'use strict';

  /**
   * Site Comments dashboard (wp-admin › Site Comments).
   * A compact review inbox: one line per comment, grouped by page, with the full comment, its
   * thread and actions in a side panel. Built to get through a lot of feedback quickly:
   * hover actions, bulk select, undo, and keyboard shortcuts (↑/↓ or j/k, Enter, E, X, /, Esc).
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
  // Short ages for the list ("3h", "2d"), dates once they are old.
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
  // "About us | Zyraa Kitchens" -> "About us"; the site name repeats on every page.
  const pageName = (c) => String(c.page_title || '').split(/\s[|–—-]\s/)[0].trim() || c.page_key || '/';

  const svg = (d, w = 16) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icon = {
    check: svg('<path d="M5 12.5 10 17l9-10"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 14),
    reply: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 13),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
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
    group: params.get('group') !== 'none',
    active: Number(params.get('c')) || 0,   // Comment shown in the side panel.
    focus: Number(params.get('c')) || 0,   // Row with keyboard focus (starts on the open comment).
    selected: new Set(),
    trash: Number(cfg.trash) || 0,         // wp_localize_script passes numbers as strings ("0" is truthy).
  };

  const saveFilters = () => {
    const u = new URL(location.href);
    [['status', state.status === 'open' ? '' : state.status], ['pg', state.page], ['who', state.person], ['q', state.q],
      ['sort', state.sort === 'new' ? '' : state.sort], ['group', state.group ? '' : 'none'], ['c', state.active || '']]
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

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    const list = state.comments.filter((c) =>
      (state.status === 'all' || c.status === state.status) &&
      (!state.page || c.page_key === state.page) &&
      (!state.person || c.author === state.person) &&
      (!q || [c.text, c.snippet, c.author, pageName(c), ...c.replies.map((r) => r.text)].join(' ').toLowerCase().includes(q)));
    const dir = state.sort === 'old' ? 1 : -1;
    list.sort((a, b) => dir * (new Date(a.date) - new Date(b.date)));
    if (!state.group) return list;
    // Grouped: pages in order of their first comment in the current sort, comments kept in that order.
    const order = [...new Set(list.map((c) => c.page_key))];
    return list.sort((a, b) => order.indexOf(a.page_key) - order.indexOf(b.page_key));
  };

  /* ---------------- shell ---------------- */
  app.insertAdjacentHTML('beforeend', `
    <div class="bpsc-top">
      <h2 class="bpsc-title">Site Comments</h2>
      <a class="page-title-action" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">Review the site</a>
      <p class="bpsc-summary" data-summary></p>
    </div>
    <div class="bpsc-bar" data-bar></div>
    <div class="bpsc-body" data-body>
      <div class="bpsc-list" data-list role="list" aria-live="polite"></div>
      <aside class="bpsc-detail" data-detail aria-label="Comment" hidden></aside>
    </div>
    <p class="bpsc-keys" data-keys><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>E</kbd> resolve <kbd>R</kbd> reply <kbd>X</kbd> select <kbd>/</kbd> search <kbd>Esc</kbd> close</p>
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

  const renderSummary = () => {
    const all = state.comments.length;
    const open = state.comments.filter((c) => c.status === 'open').length;
    const pages = new Set(state.comments.filter((c) => c.status === 'open').map((c) => c.page_key)).size;
    const pct = all ? Math.round(((all - open) / all) * 100) : 0;
    $('[data-summary]').innerHTML = state.loading || !all ? '' : `
      <span><b>${open}</b> open${pages ? ` on ${plural(pages, 'page', 'pages')}` : ''}</span>
      <span class="bpsc-meter" title="${all - open} of ${all} resolved"><span style="width:${pct}%"></span></span>
      <span>${pct}% resolved</span>`;
  };

  const renderBar = () => {
    const bar = $('[data-bar]');
    const all = state.comments;
    bar.hidden = !state.loading && !all.length;
    if (bar.hidden) return;
    const sel = [...state.selected].filter(find);
    if (sel.length) {
      const visible = filtered().length;
      bar.innerHTML = `
        <div class="bpsc-bulk">
          <label class="bpsc-check"><input type="checkbox" data-select-all checked><span class="screen-reader-text">Clear selection</span></label>
          <b>${sel.length} selected</b>
          ${sel.length < visible ? `<button type="button" class="button-link" data-bulk="all">Select all ${visible}</button>` : ''}
          <span class="bpsc-sep"></span>
          <button type="button" class="button" data-bulk="resolved">${icon.check}Resolve</button>
          <button type="button" class="button" data-bulk="open">${icon.undo}Reopen</button>
          <button type="button" class="button bpsc-danger" data-bulk="trash">${icon.trash}Trash</button>
          <button type="button" class="button-link" data-bulk="clear">Cancel</button>
        </div>`;
      return;
    }
    const count = (s) => (s === 'all' ? all.length : all.filter((c) => c.status === s).length);
    const pages = [...new Map(all.map((c) => [c.page_key, pageName(c)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const people = [...new Set(all.map((c) => c.author))].sort();
    const typing = document.activeElement?.matches?.('[data-q]');
    bar.innerHTML = `
      <label class="bpsc-check"><input type="checkbox" data-select-all${filtered().length ? '' : ' disabled'}><span class="screen-reader-text">Select all</span></label>
      <ul class="subsubsub bpsc-tabs">
        ${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, label], i) => `<li><a href="#" data-status="${k}"${state.status === k ? ' class="current" aria-current="page"' : ''}>${label} <span class="count">(${count(k)})</span></a>${i < 2 ? ' |' : ''}</li>`).join('')}
      </ul>
      <span class="bpsc-sep"></span>
      <label class="bpsc-search">${icon.search}<span class="screen-reader-text">Search comments</span><input type="search" data-q placeholder="Search" value="${esc(state.q)}"></label>
      <select data-page aria-label="Page"><option value="">All pages</option>${pages.map(([k, n]) => `<option value="${esc(k)}"${state.page === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select data-person aria-label="Person"><option value="">Everyone</option>${people.map((p) => `<option${state.person === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <select data-sort aria-label="Sort"><option value="new"${state.sort === 'new' ? ' selected' : ''}>Newest</option><option value="old"${state.sort === 'old' ? ' selected' : ''}>Oldest</option></select>
      <label class="bpsc-toggle"><input type="checkbox" data-group${state.group ? ' checked' : ''}>By page</label>
      <a class="bpsc-trash" href="${esc(cfg.trashUrl)}">Trash${state.trash ? ` (${state.trash})` : ''}</a>`;
    if (typing) { const q = bar.querySelector('[data-q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };

  const row = (c) => {
    const done = c.status === 'resolved';
    const sel = state.selected.has(c.id);
    const n = numberOf(c);
    return `
      <div class="bpsc-row${done ? ' is-done' : ''}${sel ? ' is-selected' : ''}${state.active === c.id ? ' is-active' : ''}" role="listitem" data-id="${c.id}" tabindex="${state.focus === c.id ? 0 : -1}">
        <label class="bpsc-check" data-stop><input type="checkbox" data-select${sel ? ' checked' : ''}><span class="screen-reader-text">Select comment ${n}</span></label>
        <span class="bpsc-pin" title="${done ? 'Resolved' : 'Open'} · pin ${n} on the page">${n}</span>
        <span class="bpsc-row__text">${esc(c.text)}</span>
        <span class="bpsc-row__on" title="${esc(kind(c.tag))}${c.snippet ? `: ${esc(c.snippet)}` : ''}"><em>${kind(c.tag)}</em>${c.snippet ? ` ${esc(c.snippet)}` : ''}</span>
        <span class="bpsc-row__replies">${c.replies.length ? `${icon.reply}${c.replies.length}` : ''}</span>
        ${state.group ? '' : `<span class="bpsc-row__page" title="${esc(c.page_key)}">${esc(pageName(c))}</span>`}
        <span class="bpsc-row__who" title="${esc(c.author)}">${esc(initials(c.author))}</span>
        <time class="bpsc-row__age" datetime="${esc(c.date)}" title="${esc(fullDate(c.date))}">${age(c.date)}</time>
        <span class="bpsc-row__acts" data-stop>
          ${c.can_edit ? `<button type="button" data-act="status" title="${done ? 'Reopen (E)' : 'Resolve (E)'}" aria-label="${done ? 'Reopen' : 'Resolve'} comment ${n}">${done ? icon.undo : icon.check}</button>` : ''}
          <a href="${esc(withParam(c.page_url, 'bp-comment', c.id))}" target="_blank" rel="noopener" title="View on page" aria-label="View comment ${n} on the page">${icon.ext}</a>
          ${c.can_edit ? `<button type="button" data-act="trash" title="Move to Trash" aria-label="Move comment ${n} to Trash">${icon.trash}</button>` : ''}
        </span>
      </div>`;
  };

  const emptyList = () => {
    if (!state.comments.length) {
      return `
        <div class="bpsc-empty">
          <h3>No comments yet</h3>
          <p>Open the site while logged in, turn on <b>Comment mode</b> (the Comment button, or press <kbd>C</kbd>), click anything and type. Comments from everyone on your team show up here.</p>
          <a class="button button-primary" href="${esc(withParam(cfg.home, 'bp-comments', '1'))}" target="_blank" rel="noopener">Review the site</a>
        </div>`;
    }
    if (state.status === 'open' && !state.page && !state.person && !state.q.trim()) {
      return '<div class="bpsc-empty"><h3>All caught up</h3><p>Every comment is resolved.</p><a href="#" data-status="resolved">Show resolved comments</a></div>';
    }
    return '<div class="bpsc-empty"><h3>No comments match</h3><p>Try another search or filter.</p><button type="button" class="button" data-act="clear">Clear filters</button></div>';
  };

  const renderList = () => {
    numberCache = null;
    const list = $('[data-list]');
    // Redrawing replaces the rows; put keyboard focus back on the same row afterwards.
    const hadFocus = !!document.activeElement?.closest?.('.bpsc-row');
    list.classList.toggle('is-flat', !state.group);   // Flat list shows a Page column instead of headers.
    if (state.loading) { list.innerHTML = '<div class="bpsc-row is-loading"></div>'.repeat(8); return; }
    if (state.error) {
      list.innerHTML = `<div class="bpsc-empty"><h3>Couldn't load comments</h3><p>${esc(state.error)}</p><button type="button" class="button" data-act="retry">Try again</button></div>`;
      return;
    }
    const items = filtered();
    if (!items.length) { list.innerHTML = emptyList(); return; }
    if (!items.some((c) => c.id === state.focus)) state.focus = items[0].id;
    let html = '';
    let lastPage = null;
    items.forEach((c) => {
      if (state.group && c.page_key !== lastPage) {
        lastPage = c.page_key;
        const here = items.filter((x) => x.page_key === c.page_key).length;
        html += `<div class="bpsc-group" role="presentation"><b>${esc(pageName(c))}</b><code>${esc(c.page_key)}</code><span class="bpsc-group__n">${here}</span><a href="${esc(withParam(c.page_url, 'bp-comments', '1'))}" target="_blank" rel="noopener">Open page ${icon.ext}</a></div>`;
      }
      html += row(c);
    });
    list.innerHTML = html;
    if (hadFocus) list.querySelector(`.bpsc-row[data-id="${state.focus}"]`)?.focus({ preventScroll: true });
  };

  const renderDetail = () => {
    const pane = $('[data-detail]');
    const c = find(state.active);
    pane.hidden = !c;
    $('[data-body]').classList.toggle('has-detail', !!c);
    if (!c) return;
    const done = c.status === 'resolved';
    const msg = (r) => `<li><span class="bpsc-av" aria-hidden="true">${esc(initials(r.author))}${r.avatar ? `<img src="${esc(r.avatar)}" alt="" width="24" height="24">` : ''}</span><div><p class="bpsc-detail__by"><b>${esc(r.author)}</b> <time datetime="${esc(r.date)}" title="${esc(fullDate(r.date))}">${ago(r.date)}</time></p><p class="bpsc-detail__text">${esc(r.text)}</p></div></li>`;
    pane.innerHTML = `
      <header class="bpsc-detail__head">
        <span class="bpsc-pin">${numberOf(c)}</span>
        <div class="bpsc-detail__where">
          <a class="bpsc-detail__page" href="${esc(c.page_url)}" target="_blank" rel="noopener">${esc(pageName(c))}</a>
          <span class="bpsc-detail__on"><em>${kind(c.tag)}</em>${c.snippet ? ` ${esc(c.snippet)}` : ''}</span>
        </div>
        <button type="button" class="bpsc-x" data-act="close" aria-label="Close (Esc)">${icon.close}</button>
      </header>
      <div class="bpsc-detail__actions">
        ${c.can_edit ? `<button type="button" class="button ${done ? '' : 'button-primary'}" data-act="status">${done ? 'Reopen' : 'Resolve'}</button>` : ''}
        <a class="button" href="${esc(withParam(c.page_url, 'bp-comment', c.id))}" target="_blank" rel="noopener">View on page</a>
        <span class="bpsc-sep"></span>
        <span class="bpsc-state${done ? ' is-done' : ''}">${done ? 'Resolved' : 'Open'}</span>
      </div>
      <ol class="bpsc-detail__thread">${msg(c)}${c.replies.map(msg).join('')}</ol>
      <div class="bpsc-detail__reply">
        <textarea rows="3" data-reply-text placeholder="Reply…" aria-label="Reply to ${esc(c.author)}"></textarea>
        <div><span>Ctrl + Enter to send</span><button type="button" class="button button-primary" data-act="reply" disabled>Reply</button></div>
      </div>
      ${c.can_edit ? '<p class="bpsc-detail__foot"><button type="button" class="button-link bpsc-danger" data-act="trash">Move to Trash</button></p>' : ''}`;
  };

  const render = () => {
    renderBadge(); renderSummary(); renderBar(); renderList(); renderDetail();
    $('[data-keys]').hidden = !state.comments.length;
  };

  /* ---------------- toast with undo ---------------- */
  let toastTimer;
  const toast = (msg, { undo, bad } = {}) => {
    const t = $('[data-toast]');
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="button-link" data-undo>Undo</button>' : ''}`;
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
      toast(targets.length === 1 ? `#${numberOf(targets[0])} on ${pageName(targets[0])} ${word}` : `${targets.length} comments ${word}`, {
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
    render();
    keepFocus();
    try {
      await Promise.all(targets.map((c) => api(`/${c.id}`, { method: 'DELETE' })));
      state.trash += targets.length;
      renderBar();
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

  const open = (id) => { state.active = id; state.focus = id; saveFilters(); renderList(); renderDetail(); };
  const close = () => { state.active = 0; saveFilters(); renderList(); renderDetail(); keepFocus(); };
  const toggleSelect = (id, on = !state.selected.has(id)) => {
    on ? state.selected.add(id) : state.selected.delete(id);
    renderBar(); renderList(); keepFocus();
  };
  const setFilter = (patch) => { Object.assign(state, patch); state.selected.clear(); saveFilters(); render(); };

  /* ---------------- events ---------------- */
  app.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-status]');
    if (tab) { e.preventDefault(); setFilter({ status: tab.dataset.status }); return; }
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
        btn.disabled = true; btn.textContent = 'Sending…';
        try { upsert(await api(`/${c.id}/replies`, { method: 'POST', body: { text } })); renderList(); renderDetail(); toast('Reply sent'); }
        catch (err) { toast(err.message, { bad: true }); btn.disabled = false; btn.textContent = 'Reply'; }
      }
      return;
    }
    // A click anywhere else on a row opens it (checkbox and action buttons handle themselves).
    if (rowEl && !e.target.closest('[data-stop]')) open(Number(rowEl.dataset.id));
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-select]')) toggleSelect(Number(t.closest('.bpsc-row').dataset.id), t.checked);
    else if (t.matches('[data-select-all]')) { if (t.checked) filtered().forEach((c) => state.selected.add(c.id)); else state.selected.clear(); render(); }
    else if (t.matches('[data-page]')) setFilter({ page: t.value });
    else if (t.matches('[data-person]')) setFilter({ person: t.value });
    else if (t.matches('[data-sort]')) setFilter({ sort: t.value });
    else if (t.matches('[data-group]')) setFilter({ group: t.checked });
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

  let searchTimer;
  app.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.q = e.target.value; saveFilters(); renderList(); }, 120);
    } else if (e.target.matches('[data-reply-text]')) {
      $('[data-act="reply"]').disabled = !e.target.value.trim();
    }
  });

  // Keyboard: move through rows, open, resolve, reply, select, search.
  document.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.target.matches?.('[data-reply-text]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); $('[data-act="reply"]').click(); return;
    }
    if (e.key === 'Escape') {
      if (inField) { e.target.blur(); keepFocus(); return; }
      if (state.active) { close(); return; }
      if (state.selected.size) { state.selected.clear(); render(); }
      return;
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = filtered();
    const i = items.findIndex((c) => c.id === state.focus);
    const go = (j) => {
      const next = items[Math.max(0, Math.min(items.length - 1, j))];
      if (!next) return;
      state.focus = next.id;
      if (state.active) state.active = next.id;   // The panel follows while it is open.
      renderList(); renderDetail(); keepFocus();
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
