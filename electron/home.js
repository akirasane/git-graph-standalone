// Repository hub: the first screen. Lists every known repository as a card (branch, changes,
// ahead/behind, last commit - loaded lazily), in Pinned / Recent sections, and handles open / clone /
// new / scan / pin / reveal / terminal / remove (with undo). Keyboard: "/" search, arrow keys move
// between cards, Enter opens, P pins, Delete removes, Shift+F10 / context-menu key opens the menu.
(function () {
	'use strict';

	var api = window.electronAPI.home;
	var GG = window.GG;
	var $ = function (id) { return document.getElementById(id); };

	var prefs = loadPrefs();
	var state = { repos: [], loaded: false, summaries: {}, filter: prefs.filter || 'all', query: '', sort: prefs.sort || 'recent' };
	var cards = {};              // path -> card element
	var pendingRemoval = {};     // path -> timer (removed from view, committed when the undo toast expires)
	var firstRender = true;
	var defaults = null;

	var SORTS = { recent: 'Recent', name: 'Name', commit: 'Last commit' };

	/* ---------- helpers ---------- */

	function loadPrefs() {
		try { return JSON.parse(localStorage.getItem('gg-hub') || '{}') || {}; } catch (_) { return {}; }
	}
	function savePrefs() {
		try { localStorage.setItem('gg-hub', JSON.stringify({ filter: state.filter, sort: state.sort })); } catch (_) { /* private mode */ }
	}
	function h(tag, cls, text) {
		var el = document.createElement(tag);
		if (cls) el.className = cls;
		if (text !== undefined) el.textContent = text;
		return el;
	}
	function icon(name) { var i = document.createElement('i'); i.setAttribute('data-icon', name); return i; }
	function displayPath(p) {
		var win = /^[A-Za-z]:/.test(p);
		var parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
		var sep = win ? '\\' : '/';
		return parts.length > 3 ? '…' + sep + parts.slice(-3).join(sep) : (win ? parts.join(sep) : '/' + parts.join(sep));
	}
	function nativePath(p) { return /^[A-Za-z]:/.test(p) ? p.replace(/\//g, '\\') : p; }
	function ago(sec) {
		var d = Math.max(0, Date.now() / 1000 - sec);
		if (d < 60) return 'just now';
		if (d < 3600) return Math.floor(d / 60) + 'm ago';
		if (d < 86400) return Math.floor(d / 3600) + 'h ago';
		if (d < 86400 * 7) return Math.floor(d / 86400) + 'd ago';
		if (d < 86400 * 30) return Math.floor(d / (86400 * 7)) + 'w ago';
		if (d < 86400 * 365) return Math.floor(d / (86400 * 30)) + 'mo ago';
		return Math.floor(d / (86400 * 365)) + 'y ago';
	}
	function toast(msg, kind) { GG.toast(msg, kind || 'info'); }
	function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
	function repoByPath(p) { for (var i = 0; i < state.repos.length; i++) if (state.repos[i].path === p) return state.repos[i]; return null; }

	/* ---------- data ---------- */

	function refreshList() {
		return api.list().then(function (list) {
			state.repos = list.filter(function (r) { return !pendingRemoval[r.path]; });
			state.loaded = true;
			render();
			loadSummaries(false);
		});
	}

	var queue = [], active = 0, lastFullRefresh = 0;
	function loadSummaries(force) {
		if (force) lastFullRefresh = Date.now();
		var seen = {};
		queue.forEach(function (p) { seen[p] = true; });
		// Visible cards first, so the screen fills in top-down even with hundreds of repositories.
		visibleOrder().concat(state.repos.map(function (r) { return r.path; })).forEach(function (p) {
			if (!seen[p] && (force || !state.summaries[p])) { seen[p] = true; queue.push(p); }
		});
		pump();
	}
	function pump() {
		while (active < 4 && queue.length) {
			(function (p) {
				active++;
				api.summary(p).then(function (s) {
					state.summaries[p] = s;
					var repo = repoByPath(p);
					if (repo && cards[p]) fillCard(cards[p], repo);
					scheduleRefresh();
				}).catch(function () { /* the card keeps its skeleton; retried on next focus */ }).then(function () { active--; pump(); });
			})(queue.shift());
		}
	}
	var refreshQueued = false;
	function scheduleRefresh() {
		if (refreshQueued) return;
		refreshQueued = true;
		requestAnimationFrame(function () {
			refreshQueued = false;
			updateStats();
			if (state.filter === 'changes' || state.filter === 'behind' || state.sort === 'commit' || state.query) render();
		});
	}

	/* ---------- filtering / ordering ---------- */

	function matches(r) {
		var s = state.summaries[r.path];
		if (state.query) {
			var q = state.query.toLowerCase();
			if (r.name.toLowerCase().indexOf(q) === -1 && r.path.toLowerCase().indexOf(q) === -1 &&
				!(s && s.branch && s.branch.toLowerCase().indexOf(q) !== -1)) return false;
		}
		if (state.filter === 'pinned') return r.pinned;
		if (state.filter === 'changes') return !!s && s.changes > 0;
		if (state.filter === 'behind') return !!s && s.behind > 0;
		return true;
	}
	function commitDate(r) { var s = state.summaries[r.path]; return s && s.lastCommit ? s.lastCommit.date : 0; }
	function sorted(list) {
		return list.slice().sort(function (a, b) {
			if (state.sort === 'recent' && a.lastOpened !== b.lastOpened) return b.lastOpened - a.lastOpened;
			if (state.sort === 'commit' && commitDate(a) !== commitDate(b)) return commitDate(b) - commitDate(a);
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
		});
	}
	function visibleOrder() {
		return Array.prototype.map.call(document.querySelectorAll('.hub-grid > .repo'), function (c) { return c.dataset.path; });
	}

	/* ---------- cards ---------- */

	function buildCard(r, index) {
		var el = h('div', 'card repo' + (firstRender && index < 18 ? ' enter' : ''));
		el.tabIndex = 0;
		el.setAttribute('role', 'listitem');
		el.dataset.path = r.path;
		el.style.setProperty('--i', String(Math.min(index, 18)));
		el.innerHTML =
			'<div class="repo-head"><div class="repo-mono"></div><div class="repo-names"><div class="repo-name"></div><div class="repo-path"></div></div>' +
			'<div class="repo-tools">' +
			'<button class="btn btn-icon t-reveal" data-act="reveal" tabindex="-1" title="Show in folder" aria-label="Show in folder"><i data-icon="folder-simple"></i></button>' +
			'<button class="btn btn-icon t-pin" data-act="pin" tabindex="-1"><i data-icon="push-pin"></i></button>' +
			'<button class="btn btn-icon t-more" data-act="more" tabindex="-1" title="More actions" aria-label="More actions" aria-haspopup="menu"><i data-icon="dots-three"></i></button>' +
			'</div></div><div class="repo-tags"></div><div class="repo-last"></div>';
		if (el.classList.contains('enter')) el.addEventListener('animationend', function () { el.classList.remove('enter'); }, { once: true });
		return el;
	}

	function tag(cls, iconName, text, title) {
		var t = h('span', 'tag ' + cls);
		if (iconName) t.appendChild(icon(iconName));
		t.appendChild(document.createTextNode(text));
		if (title) t.title = title;
		return t;
	}

	function fillCard(el, r) {
		var s = state.summaries[r.path];
		var letter = (r.name.match(/[A-Za-z0-9]/) || [r.name.charAt(0) || '?'])[0];
		el.querySelector('.repo-mono').textContent = letter.toUpperCase();
		el.querySelector('.repo-name').textContent = r.name;
		var pathEl = el.querySelector('.repo-path');
		pathEl.textContent = displayPath(r.path);
		pathEl.title = nativePath(r.path);
		el.classList.toggle('is-pinned', r.pinned);
		var pin = el.querySelector('.t-pin');
		pin.title = r.pinned ? 'Unpin' : 'Pin to top';
		pin.setAttribute('aria-label', pin.title);
		pin.setAttribute('aria-pressed', r.pinned ? 'true' : 'false');
		var missing = !!s && !!s.error;
		el.classList.toggle('is-missing', missing);
		el.setAttribute('aria-label', r.name + (r.pinned ? ', pinned' : '') + (missing ? ', ' + s.error : s ? ', ' + (s.branch || 'detached') + (s.changes ? ', ' + plural(s.changes, 'change', 'changes') : ', clean') : ''));

		var tags = el.querySelector('.repo-tags'), last = el.querySelector('.repo-last');
		tags.textContent = '';
		last.textContent = '';
		if (!s) {
			[64, 54].forEach(function (w) { var sk = h('span', 'skeleton tag'); sk.style.width = w + 'px'; tags.appendChild(sk); });
			var line = h('span', 'skeleton skel-line'); line.style.width = '62%';
			last.appendChild(line);
			return;
		}
		if (missing) {
			var notFound = /not found/i.test(s.error);
			tags.appendChild(tag('tag-danger', 'warning', notFound ? 'Folder not found' : 'Unavailable', s.error));
			last.appendChild(h('span', 'subject none', notFound ? 'Moved or deleted? Remove it from the list.' : String(s.error).split('\n')[0]));
			var rm = h('button', 'btn btn-secondary btn-sm', 'Remove');
			rm.dataset.act = 'remove';
			rm.tabIndex = -1;
			last.appendChild(rm);
			return;
		}
		var branchTag = tag('tag-neutral tag-branch', 'git-branch', s.detached ? 'detached HEAD' : (s.branch || '-'), 'Current branch');
		tags.appendChild(branchTag);
		if (s.changes > 0) tags.appendChild(tag('tag-warning', 'circle', String(s.changes), plural(s.changes, 'uncommitted change', 'uncommitted changes')));
		else tags.appendChild(tag('tag-success', 'check', 'Clean', 'No uncommitted changes'));
		if (s.ahead > 0) tags.appendChild(tag('tag-accent', 'arrow-up', String(s.ahead), plural(s.ahead, 'commit', 'commits') + ' to push'));
		if (s.behind > 0) tags.appendChild(tag('tag-accent', 'arrow-down', String(s.behind), plural(s.behind, 'commit', 'commits') + ' to pull'));
		if (s.lastCommit) {
			var subj = h('span', 'subject', s.lastCommit.subject);
			subj.title = s.lastCommit.subject + '\n' + s.lastCommit.author;
			var when = h('span', 'when', ago(s.lastCommit.date));
			when.dataset.ts = String(s.lastCommit.date);
			when.title = new Date(s.lastCommit.date * 1000).toLocaleString();
			last.appendChild(subj);
			last.appendChild(when);
		} else {
			last.appendChild(h('span', 'subject none', 'No commits yet'));
		}
	}

	/* ---------- rendering ---------- */

	function render() {
		Array.prototype.forEach.call(document.querySelectorAll('[data-skeleton]'), function (sk) { sk.remove(); });
		var known = {};
		state.repos.forEach(function (r) { known[r.path] = true; });
		Object.keys(cards).forEach(function (p) { if (!known[p]) { cards[p].remove(); delete cards[p]; } });

		var hadFocus = document.activeElement && document.activeElement.closest && document.activeElement.closest('.repo');
		var order = sorted(state.repos);
		var pinnedGrid = $('secPinned').querySelector('.hub-grid'), restGrid = $('secRecent').querySelector('.hub-grid');
		var shownPinned = 0, shownRest = 0, index = 0;
		var wantPinned = [], wantRest = [];
		order.forEach(function (r) {
			if (!cards[r.path]) { cards[r.path] = buildCard(r, index); fillCard(cards[r.path], r); }
			else fillCard(cards[r.path], r);
			var ok = matches(r);
			cards[r.path].hidden = !ok;
			if (ok) index++;
			if (r.pinned) { wantPinned.push(r.path); if (ok) shownPinned++; } else { wantRest.push(r.path); if (ok) shownRest++; }
		});
		place(pinnedGrid, wantPinned);
		place(restGrid, wantRest);
		if (hadFocus && document.contains(hadFocus) && !hadFocus.hidden) hadFocus.focus();

		var empty = state.loaded && state.repos.length === 0;
		$('secPinned').hidden = shownPinned === 0;
		$('secRecent').hidden = shownRest === 0;
		$('secPinned').querySelector('.n').textContent = String(shownPinned);
		$('secRecent').querySelector('.n').textContent = String(shownRest);
		$('secRecent').querySelector('.lbl').textContent = state.sort === 'recent' ? 'Recent' : (shownPinned ? 'Other repositories' : 'Repositories');
		$('empty').hidden = !empty;
		$('toolbar').style.visibility = empty ? 'hidden' : '';
		$('nomatch').hidden = !state.loaded || empty || shownPinned + shownRest > 0;
		if (!$('nomatch').hidden) {
			var f = { pinned: 'pinned ', changes: 'with changes ', behind: 'behind their upstream ' }[state.filter] || '';
			$('nomatchText').textContent = state.query
				? 'No ' + (f ? f.trim() + ' ' : '') + 'repositories match “' + state.query + '”.'
				: 'No repositories are ' + (f || 'here ').trim() + ' right now.';
		}
		updateStats();
		firstRender = false;
	}

	/** Reorder a grid's children only when needed (keeps focus and avoids re-animating). */
	function place(grid, paths) {
		var current = Array.prototype.map.call(grid.children, function (c) { return c.dataset.path; }).join('\n');
		if (current === paths.join('\n')) return;
		var frag = document.createDocumentFragment();
		paths.forEach(function (p) { frag.appendChild(cards[p]); });
		grid.appendChild(frag);
	}

	function skeletons() {
		var grid = $('secRecent').querySelector('.hub-grid');
		$('secRecent').hidden = false;
		$('secRecent').querySelector('.n').textContent = '';
		for (var i = 0; i < 6; i++) {
			var c = h('div', 'card repo');
			c.innerHTML = '<div class="repo-head"><div class="repo-mono skeleton"></div><div class="repo-names"><span class="skeleton skel-line" style="width:45%"></span><br><span class="skeleton skel-line" style="width:70%;height:8px"></span></div></div>' +
				'<div class="repo-tags"><span class="skeleton tag" style="width:64px"></span><span class="skeleton tag" style="width:54px"></span></div><div class="repo-last"><span class="skeleton skel-line" style="width:60%"></span></div>';
			c.dataset.skeleton = '1';
			grid.appendChild(c);
		}
	}

	function updateStats() {
		var total = state.repos.length, changes = 0, behind = 0, loaded = 0;
		state.repos.forEach(function (r) {
			var s = state.summaries[r.path];
			if (!s) return;
			loaded++;
			if (s.changes > 0) changes++;
			if (s.behind > 0) behind++;
		});
		var box = $('stats');
		if (total === 0) { box.textContent = ''; return; }
		var html = '<b>' + total + '</b> ' + (total === 1 ? 'repository' : 'repositories');
		if (loaded > 0) html += ' · <b>' + changes + '</b> with changes · <b>' + behind + '</b> behind';
		box.innerHTML = html;
		var counts = { all: total, pinned: state.repos.filter(function (r) { return r.pinned; }).length, changes: changes, behind: behind };
		Array.prototype.forEach.call($('filters').querySelectorAll('input'), function (inp) { inp.parentNode.title = counts[inp.value] + ' ' + (counts[inp.value] === 1 ? 'repository' : 'repositories'); });
	}

	// Relative times stay current.
	setInterval(function () {
		Array.prototype.forEach.call(document.querySelectorAll('.repo-last .when'), function (w) { w.textContent = ago(+w.dataset.ts); });
	}, 60000);

	/* ---------- actions ---------- */

	function openRepo(p) {
		var s = state.summaries[p];
		if (s && s.error && /not found/i.test(s.error)) { toast('The folder ' + nativePath(p) + ' no longer exists.', 'error'); return; }
		api.open(p).then(function (res) { if (!res.ok) toast(res.error, 'error'); });
	}

	function afterAdd(res) {
		if (res.cancelled) return;
		if (!res.ok) { toast(res.error, 'error'); return; }
		toast(res.already ? 'Already in your list' : 'Repository added', res.already ? 'info' : 'success');
		refreshList().then(function () { focusCard(res.path); });
	}
	function addPath(p) {
		return api.add(p).then(function (res) {
			if (!res.ok && !res.cancelled && /not a git repository/i.test(res.error)) return api.scan(p).then(afterScan);
			afterAdd(res);
		});
	}
	function afterScan(res) {
		if (res.cancelled) return;
		if (!res.ok) { toast(res.error, 'error'); return; }
		var parts = ['Found ' + plural(res.found, 'repository', 'repositories') + ' in ' + nativePath(res.root)];
		var detail = [];
		if (res.added) detail.push(res.added + ' added');
		if (res.known) detail.push(res.known + ' already listed');
		if (res.failed) detail.push(res.failed + ' skipped');
		if (detail.length) parts.push(detail.join(', '));
		if (res.truncated) parts.push('Stopped early - the folder is very large; scan a narrower folder for the rest.');
		toast(parts.join('\n'), res.added ? 'success' : 'info', 6000);
		refreshList();
	}
	function withBusy(btn, promise) {
		var label = btn.innerHTML;
		btn.disabled = true;
		btn.innerHTML = '<i data-icon="circle-notch" class="spin"></i><span class="lbl">Scanning...</span>';
		return promise.then(function (v) { btn.disabled = false; btn.innerHTML = label; return v; }, function (e) { btn.disabled = false; btn.innerHTML = label; throw e; });
	}
	function doOpen() { api.add(null).then(afterAdd); }
	function doScan() { withBusy($('btnScan'), api.scan(null)).then(afterScan); }

	function togglePin(p) {
		var r = repoByPath(p);
		if (!r) return;
		r.pinned = !r.pinned; // optimistic
		render();
		focusCard(p);
		api.pin(p).then(function (pinned) { r.pinned = pinned; render(); });
	}

	/** Remove from the list with a few seconds to undo; nothing on disk is touched. */
	function removeRepo(p) {
		var r = repoByPath(p);
		if (!r) return;
		var next = neighbour(cards[p]);
		state.repos = state.repos.filter(function (x) { return x.path !== p; });
		render();
		if (next) next.focus();
		var commit = function () { delete pendingRemoval[p]; api.remove(p); };
		pendingRemoval[p] = setTimeout(function () { dismiss(); commit(); }, 7000);
		var dismiss = undoToast('Removed “' + r.name + '” from the list', function () {
			clearTimeout(pendingRemoval[p]);
			delete pendingRemoval[p];
			state.repos.push(r);
			render();
			focusCard(p);
		});
	}
	window.addEventListener('pagehide', function () {
		Object.keys(pendingRemoval).forEach(function (p) { clearTimeout(pendingRemoval[p]); api.remove(p); });
	});

	function undoToast(message, onUndo) {
		var box = document.querySelector('.gg-toasts');
		if (!box) { box = h('div', 'gg-toasts'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
		var el = h('div', 'gg-toast');
		el.appendChild(icon('trash'));
		el.appendChild(h('span', null, message));
		var undo = h('button', 'btn btn-ghost btn-sm toast-action', 'Undo');
		el.appendChild(undo);
		box.appendChild(el);
		var gone = false;
		function dismiss() {
			if (gone) return;
			gone = true;
			el.style.transition = 'opacity .2s, transform .2s';
			el.style.opacity = '0';
			el.style.transform = 'translateY(6px)';
			setTimeout(function () { el.remove(); }, 220);
		}
		undo.addEventListener('click', function () { dismiss(); onUndo(); });
		return dismiss;
	}

	function cardMenu(p, pos) {
		var r = repoByPath(p);
		if (!r) return;
		var card = cards[p];
		var missing = !!(state.summaries[p] && state.summaries[p].error);
		card.classList.add('is-menu');
		GG.menu.open(pos, [
			{ id: 'open', label: 'Open', icon: 'arrow-square-out', kbd: 'Enter', disabled: missing },
			{ id: 'pin', label: r.pinned ? 'Unpin' : 'Pin to top', icon: 'push-pin', kbd: 'P' },
			{ separator: true },
			{ id: 'reveal', label: navigator.platform.indexOf('Mac') === 0 ? 'Reveal in Finder' : 'Show in folder', icon: 'folder-simple', disabled: missing },
			{ id: 'terminal', label: 'Open terminal', icon: 'terminal-window', disabled: missing },
			{ id: 'copy', label: 'Copy path', icon: 'copy' },
			{ separator: true },
			{ id: 'remove', label: 'Remove from list', icon: 'trash', kbd: 'Del', danger: true }
		], function (it) { runAction(it.id, p); }, function () { card.classList.remove('is-menu'); });
	}

	function runAction(act, p) {
		if (act === 'open') openRepo(p);
		else if (act === 'pin') togglePin(p);
		else if (act === 'reveal') api.reveal(p);
		else if (act === 'terminal') api.terminal(p).then(function (res) { if (!res.ok) toast(res.error, 'error'); });
		else if (act === 'copy') api.copyPath(p).then(function () { toast('Path copied', 'success'); });
		else if (act === 'remove') removeRepo(p);
	}

	/* ---------- keyboard navigation between cards ---------- */

	function visibleCards() {
		return Array.prototype.filter.call(document.querySelectorAll('.hub-grid > .repo'), function (c) { return !c.hidden && c.offsetParent !== null; });
	}
	function focusCard(p) { var c = cards[p]; if (c && !c.hidden) { c.focus(); c.scrollIntoView({ block: 'nearest' }); } }
	function neighbour(card) {
		var list = visibleCards(), i = list.indexOf(card);
		return list[i + 1] || list[i - 1] || null;
	}
	/** Spatial move: left/right in reading order, up/down to the nearest card in the next row. */
	function moveFocus(card, key) {
		var list = visibleCards(), i = list.indexOf(card);
		if (i === -1) return;
		var target = null;
		if (key === 'ArrowRight') target = list[i + 1];
		else if (key === 'ArrowLeft') target = list[i - 1];
		else if (key === 'Home') target = list[0];
		else if (key === 'End') target = list[list.length - 1];
		else {
			var a = card.getBoundingClientRect(), cx = a.left + a.width / 2, best = null, bestScore = Infinity;
			list.forEach(function (c) {
				if (c === card) return;
				var b = c.getBoundingClientRect();
				var dy = key === 'ArrowDown' ? b.top - a.bottom : a.top - b.bottom;
				if (dy < -2) return;
				var score = dy * 4 + Math.abs(b.left + b.width / 2 - cx);
				if (score < bestScore) { bestScore = score; best = c; }
			});
			target = best;
		}
		if (target) { target.focus(); target.scrollIntoView({ block: 'nearest' }); }
		else if (key === 'ArrowUp') $('search').focus();
	}

	/* ---------- dialogs (Clone / New) ---------- */

	function dialog(cfg) {
		var back = h('div', 'dialog-backdrop');
		var dlg = h('div', 'dialog');
		dlg.setAttribute('role', 'dialog');
		dlg.setAttribute('aria-modal', 'true');
		dlg.setAttribute('aria-labelledby', 'dlgTitle');
		dlg.innerHTML = '<h2 class="dialog-title" id="dlgTitle"></h2><p class="dialog-sub"></p>' + cfg.body +
			'<div class="dialog-error" role="alert" hidden><i data-icon="warning-circle"></i><span></span></div>' +
			'<div class="dialog-actions"><button class="btn btn-secondary" data-role="cancel">Cancel</button><button class="btn btn-primary" data-role="ok"></button></div>';
		dlg.querySelector('.dialog-title').textContent = cfg.title;
		dlg.querySelector('.dialog-sub').textContent = cfg.sub;
		var ok = dlg.querySelector('[data-role=ok]'), cancel = dlg.querySelector('[data-role=cancel]');
		ok.textContent = cfg.okText;
		back.appendChild(dlg);
		document.body.appendChild(back);
		var prevFocus = document.activeElement;
		var busy = false;

		var api2 = {
			el: dlg,
			q: function (sel) { return dlg.querySelector(sel); },
			close: function () {
				back.remove();
				document.removeEventListener('keydown', onKey, true);
				if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
			},
			error: function (msg) {
				var box = dlg.querySelector('.dialog-error');
				box.hidden = !msg;
				box.querySelector('span').textContent = msg || '';
			},
			busy: function (on, text) {
				busy = on;
				Array.prototype.forEach.call(dlg.querySelectorAll('input, [data-pick], .recent-dirs button'), function (x) { x.disabled = on; });
				ok.disabled = on;
				ok.innerHTML = '';
				if (on) { ok.appendChild(icon('circle-notch')); ok.lastChild.classList.add('spin'); }
				ok.appendChild(document.createTextNode(on ? text : cfg.okText));
				cancel.textContent = on && cfg.cancelBusy ? cfg.cancelBusy : 'Cancel';
				cancel.disabled = on && !cfg.cancelBusy;
			}
		};
		function onKey(e) {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (busy) { if (cfg.onCancelBusy) cfg.onCancelBusy(); } else api2.close(); }
			else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); if (!busy) cfg.submit(api2); }
			else if (e.key === 'Tab') {
				// Keep focus inside the dialog.
				var f = Array.prototype.filter.call(dlg.querySelectorAll('input, button'), function (x) { return !x.disabled && x.offsetParent !== null; });
				if (!f.length) return;
				var i = f.indexOf(document.activeElement);
				if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
				else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
			}
		}
		document.addEventListener('keydown', onKey, true);
		back.addEventListener('mousedown', function (e) { if (e.target === back && !busy) api2.close(); });
		cancel.addEventListener('click', function () { if (busy) { if (cfg.onCancelBusy) cfg.onCancelBusy(); } else api2.close(); });
		ok.addEventListener('click', function () { if (!busy) cfg.submit(api2); });
		Array.prototype.forEach.call(dlg.querySelectorAll('[data-pick]'), function (b) {
			b.addEventListener('click', function () {
				api.pickFolder(b.dataset.title).then(function (p) {
					if (!p) return;
					var inp = dlg.querySelector('#' + b.dataset.pick);
					inp.value = nativePath(p);
					inp.dispatchEvent(new Event('input'));
				});
			});
		});
		if (cfg.init) cfg.init(api2);
		var first = dlg.querySelector('input');
		if (first) setTimeout(function () { first.focus(); first.select(); }, 20);
		return api2;
	}

	function field(id, label, input, extra) {
		return '<div class="field"><label for="' + id + '">' + label + '</label>' + input + '<div class="field-error" id="' + id + 'Err"></div>' + (extra || '') + '</div>';
	}
	function folderInput(id, title) {
		return '<div class="pick"><input class="input" type="text" id="' + id + '" spellcheck="false" placeholder="Choose a folder">' +
			'<button class="btn btn-secondary" type="button" data-pick="' + id + '" data-title="' + title + '"><i data-icon="folder-open"></i>Browse</button></div>';
	}
	function setErr(d, id, msg) {
		var inp = d.q('#' + id), err = d.q('#' + id + 'Err');
		err.textContent = msg || '';
		if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
		return !msg;
	}
	var BAD_NAME = /[\\/:*?"<>|]/;
	var URL_RE = /^(?:(?:https?|ssh|git|file):\/\/\S+|[\w.-]+@[\w.-]+:\S+|[A-Za-z]:[\\/]\S*|\/\S+|\.{1,2}[\\/]\S*|\\\\\S+)$/;
	function nameFromUrl(u) { return u.trim().replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/:]/).pop() || ''; }
	function joinPath(dir, name) { var sep = /^[A-Za-z]:/.test(dir) || dir.indexOf('\\') !== -1 ? '\\' : '/'; return dir.replace(/[\\/]+$/, '') + sep + name; }

	function withDefaults(fn) {
		if (defaults) return fn(defaults);
		api.defaults().then(function (d) { defaults = d; fn(d); });
	}

	function cloneDialog() {
		withDefaults(function (d) {
			var nameTouched = false, checkSeq = 0, progressOn = false, dlg = null;
			var recent = (d.recentCloneDirs || []).slice(0, 4).map(function (p) { return '<button type="button" title="' + nativePath(p).replace(/"/g, '&quot;') + '" data-dir="' + p.replace(/"/g, '&quot;') + '">' + displayPath(p).replace(/</g, '&lt;') + '</button>'; }).join('');
			dialog({
				title: 'Clone a repository',
				sub: 'Download a repository and add it to your list.',
				okText: 'Clone',
				cancelBusy: 'Cancel clone',
				onCancelBusy: function () { api.cancelClone(); },
				body:
					field('cUrl', 'Repository URL', '<input class="input" type="text" id="cUrl" placeholder="https://github.com/user/repo.git" spellcheck="false" autocomplete="off">') +
					field('cDir', 'Clone into', folderInput('cDir', 'Clone into folder'), recent ? '<div class="recent-dirs" aria-label="Recent folders">' + recent + '</div>' : '') +
					field('cName', 'Folder name', '<input class="input" type="text" id="cName" placeholder="repo" spellcheck="false" autocomplete="off">', '<div class="field-hint" id="cHint"></div>') +
					'<div class="clone-progress" id="cProg" hidden><div class="meta"><span id="cPhase">Connecting...</span><b id="cPct"></b></div><div class="gg-progress is-indeterminate" id="cBar"><span></span></div></div>',
				init: function (dl) {
					dlg = dl;
					var url = dl.q('#cUrl'), dir = dl.q('#cDir'), name = dl.q('#cName');
					dir.value = nativePath(d.cloneDir || '');
					Array.prototype.forEach.call(dl.el.querySelectorAll('.recent-dirs button'), function (b) {
						b.addEventListener('click', function () { dir.value = nativePath(b.dataset.dir); dir.dispatchEvent(new Event('input')); });
					});
					name.addEventListener('input', function () { nameTouched = name.value !== ''; check(); });
					url.addEventListener('input', function () {
						setErr(dl, 'cUrl', '');
						if (!nameTouched) name.value = nameFromUrl(url.value);
						check();
					});
					url.addEventListener('blur', function () { if (url.value.trim() && !URL_RE.test(url.value.trim())) setErr(dl, 'cUrl', 'That does not look like a Git URL (https://..., git@host:path or a local path).'); });
					dir.addEventListener('input', check);
					check();
				},
				submit: function (dl) {
					var url = dl.q('#cUrl').value.trim(), dir = dl.q('#cDir').value.trim(), name = dl.q('#cName').value.trim() || nameFromUrl(url);
					var ok = setErr(dl, 'cUrl', !url ? 'Enter the repository URL.' : !URL_RE.test(url) ? 'That does not look like a Git URL (https://..., git@host:path or a local path).' : '');
					ok = setErr(dl, 'cDir', dir ? '' : 'Choose where to clone it.') && ok;
					ok = setErr(dl, 'cName', BAD_NAME.test(name) ? 'Folder names cannot contain \\ / : * ? " < > |' : '') && ok;
					if (!ok) { check(); var bad = dl.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
					api.checkTarget(dir, name).then(function (t) {
						if (!t.parentOk) { setErr(dl, 'cDir', 'This folder does not exist.'); dl.q('#cDir').focus(); return; }
						if (t.exists) { setErr(dl, 'cName', 'A folder named “' + name + '” already exists there.'); dl.q('#cName').focus(); return; }
						dl.error('');
						dl.busy(true, 'Cloning...');
						progressOn = true;
						setProgress(dl, { phase: 'Connecting...', percent: null });
						dl.q('#cProg').hidden = false;
						api.clone({ url: url, parent: dir, name: name }).then(function (res) {
							progressOn = false;
							dl.busy(false);
							if (!res.ok) {
								dl.q('#cProg').hidden = true;
								if (!/cancelled/i.test(res.error)) dl.error(res.error);
								return;
							}
							defaults = null;
							dl.close();
							toast('Cloned “' + name + '”', 'success');
							refreshList().then(function () { openRepo(res.path); });
						});
					});
				}
			});
			cloneProgress = function (p) { if (progressOn) setProgress(dlg, p); };
			function check() {
				var dir = dlg.q('#cDir').value.trim(), name = dlg.q('#cName').value.trim() || nameFromUrl(dlg.q('#cUrl').value);
				dlg.q('#cHint').textContent = dir && name ? 'Creates ' + joinPath(dir, name) : '';
				if (BAD_NAME.test(name)) { setErr(dlg, 'cName', 'Folder names cannot contain \\ / : * ? " < > |'); return; }
				var seq = ++checkSeq;
				if (!dir) { setErr(dlg, 'cName', ''); return; }
				api.checkTarget(dir, name).then(function (t) {
					if (seq !== checkSeq) return;
					setErr(dlg, 'cDir', t.parentOk ? '' : 'This folder does not exist.');
					setErr(dlg, 'cName', t.exists ? 'A folder named “' + name + '” already exists there.' : '');
				});
			}
		});
	}
	var cloneProgress = function () { };
	function setProgress(dl, p) {
		var bar = dl.q('#cBar'), known = typeof p.percent === 'number';
		bar.classList.toggle('is-indeterminate', !known);
		bar.firstChild.style.width = known ? p.percent + '%' : '';
		dl.q('#cPhase').textContent = p.phase;
		dl.q('#cPct').textContent = known ? p.percent + '%' : '';
	}
	api.onCloneProgress(function (p) { cloneProgress(p); });

	function newDialog() {
		withDefaults(function (d) {
			var checkSeq = 0;
			dialog({
				title: 'New repository',
				sub: 'Create a folder and initialise it as an empty Git repository.',
				okText: 'Create',
				body:
					field('nName', 'Name', '<input class="input" type="text" id="nName" placeholder="my-project" spellcheck="false" autocomplete="off">') +
					field('nDir', 'Location', folderInput('nDir', 'Where should the repository be created?'), '<div class="field-hint" id="nHint"></div>'),
				init: function (dl) {
					dl.q('#nDir').value = nativePath(d.newRepoDir || '');
					var check = function () {
						var name = dl.q('#nName').value.trim(), dir = dl.q('#nDir').value.trim();
						dl.q('#nHint').textContent = dir && name ? 'Creates ' + joinPath(dir, name) : '';
						if (BAD_NAME.test(name)) { setErr(dl, 'nName', 'Names cannot contain \\ / : * ? " < > |'); return; }
						setErr(dl, 'nName', '');
						var seq = ++checkSeq;
						if (!dir) return;
						api.checkTarget(dir, name).then(function (t) {
							if (seq !== checkSeq) return;
							setErr(dl, 'nDir', t.parentOk ? '' : 'This folder does not exist.');
							if (name && t.exists && !t.empty) setErr(dl, 'nName', 'A folder named “' + name + '” already exists there and is not empty.');
						});
					};
					dl.q('#nName').addEventListener('input', check);
					dl.q('#nDir').addEventListener('input', check);
					check();
				},
				submit: function (dl) {
					var name = dl.q('#nName').value.trim(), dir = dl.q('#nDir').value.trim();
					var ok = setErr(dl, 'nName', !name ? 'Enter a name for the repository.' : BAD_NAME.test(name) ? 'Names cannot contain \\ / : * ? " < > |' : '');
					ok = setErr(dl, 'nDir', dir ? '' : 'Choose a location.') && ok;
					if (!ok) { var bad = dl.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
					dl.error('');
					dl.busy(true, 'Creating...');
					api.init({ parent: dir, name: name }).then(function (res) {
						dl.busy(false);
						if (!res.ok) { dl.error(res.error); return; }
						defaults = null;
						dl.close();
						toast('Created “' + name + '”', 'success');
						refreshList().then(function () { openRepo(res.path); });
					});
				}
			});
		});
	}

	/* ---------- wiring ---------- */

	$('btnOpen').addEventListener('click', doOpen);
	$('btnScan').addEventListener('click', doScan);
	$('btnNew').addEventListener('click', newDialog);
	$('btnClone').addEventListener('click', cloneDialog);
	$('startOpen').addEventListener('click', doOpen);
	$('startNew').addEventListener('click', newDialog);
	$('startClone').addEventListener('click', cloneDialog);
	api.onAction(function (a) {
		if (document.querySelector('.dialog-backdrop')) return;
		if (a === 'clone') cloneDialog(); else if (a === 'new') newDialog(); else if (a === 'open') doOpen();
	});

	$('search').addEventListener('input', function (e) { state.query = e.target.value.trim(); render(); });
	$('search').addEventListener('keydown', function (e) {
		if (e.key === 'ArrowDown' || (e.key === 'Enter' && state.query)) {
			var first = visibleCards()[0];
			if (first) { e.preventDefault(); if (e.key === 'Enter' && visibleCards().length === 1) openRepo(first.dataset.path); else first.focus(); }
		}
	});
	Array.prototype.forEach.call($('filters').querySelectorAll('input'), function (inp) { inp.checked = inp.value === state.filter; });
	$('filters').addEventListener('change', function (e) { state.filter = e.target.value; savePrefs(); render(); });
	$('clearFilters').addEventListener('click', function () {
		$('search').value = ''; state.query = ''; state.filter = 'all';
		$('filters').querySelector('input[value=all]').checked = true;
		savePrefs(); render(); $('search').focus();
	});
	$('sortLabel').textContent = SORTS[state.sort];
	$('sortBtn').addEventListener('click', function (e) {
		GG.menu.open({ anchor: $('sortBtn'), align: 'end', keyboard: e.detail === 0 }, Object.keys(SORTS).map(function (k) {
			return { id: k, label: SORTS[k], checked: state.sort === k };
		}), function (it) { state.sort = it.id; $('sortLabel').textContent = SORTS[it.id]; savePrefs(); render(); });
	});

	function cardOf(e) { var c = e.target.closest('.repo'); return c && !c.dataset.skeleton ? c : null; }
	$('scroll').addEventListener('click', function (e) {
		var card = cardOf(e);
		if (!card) return;
		var p = card.dataset.path, btn = e.target.closest('[data-act]');
		if (!btn) { openRepo(p); return; }
		e.stopPropagation();
		if (btn.dataset.act === 'more') cardMenu(p, { anchor: btn, align: 'end' });
		else runAction(btn.dataset.act, p);
	});
	$('scroll').addEventListener('contextmenu', function (e) {
		var card = cardOf(e);
		if (!card) return;
		e.preventDefault();
		card.focus();
		cardMenu(card.dataset.path, { x: e.clientX, y: e.clientY });
	});
	$('scroll').addEventListener('keydown', function (e) {
		var card = cardOf(e);
		if (!card || e.target !== card) return;
		var p = card.dataset.path;
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRepo(p); }
		else if (/^Arrow|^Home$|^End$/.test(e.key)) { e.preventDefault(); moveFocus(card, e.key); }
		else if (e.key === 'Delete') { e.preventDefault(); removeRepo(p); }
		else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePin(p); }
		else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
			e.preventDefault();
			var r = card.getBoundingClientRect();
			cardMenu(p, { x: r.left + 24, y: r.top + 40, keyboard: true });
		}
	});

	document.addEventListener('keydown', function (e) {
		if (document.querySelector('.dialog-backdrop') || GG.menu.isOpen()) return;
		var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
		if (e.key === '/' && !typing) { e.preventDefault(); $('search').focus(); $('search').select(); }
		else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); }
		else if (e.key === 'Escape' && document.activeElement === $('search')) {
			if ($('search').value) { $('search').value = ''; state.query = ''; render(); } else $('search').blur();
		}
	});

	/* drag & drop a folder anywhere */
	var dragDepth = 0;
	function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
	window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').classList.add('show'); });
	window.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').classList.remove('show'); });
	window.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
	window.addEventListener('drop', function (e) {
		e.preventDefault();
		dragDepth = 0;
		$('drop').classList.remove('show');
		Array.prototype.forEach.call(e.dataTransfer.files, function (f) {
			var p = api.pathForFile(f);
			if (p) addPath(p.replace(/\\/g, '/'));
		});
	});

	// Coalesce bursts (a folder scan registers many repositories in a row).
	var changedTimer = null;
	api.onReposChanged(function () { clearTimeout(changedTimer); changedTimer = setTimeout(refreshList, 150); });
	var focusTimer = null;
	window.addEventListener('focus', function () {
		clearTimeout(focusTimer);
		// Refresh statuses when coming back to the app (not more than every 20s - hundreds of repos are expensive).
		focusTimer = setTimeout(function () { if (Date.now() - lastFullRefresh > 20000) loadSummaries(true); }, 400);
	});

	skeletons();
	lastFullRefresh = Date.now();
	refreshList();
})();
