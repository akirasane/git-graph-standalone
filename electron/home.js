// Repository hub: the first screen. Lists every known repository as a card (branch, changes,
// ahead/behind, last commit - loaded lazily), and handles open / clone / new / scan / pin / remove.
(function () {
	'use strict';

	var api = window.electronAPI.home;
	var $ = function (id) { return document.getElementById(id); };

	var state = { repos: [], summaries: {}, filter: 'all', query: '', sort: 'recent' };
	var cards = {};            // path -> element
	var statsShown = { total: 0, changes: 0 };
	var firstRender = true;

	/* ---------- helpers ---------- */

	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function tailTruncate(s, max) {
		return s.length <= max ? s : '…' + s.slice(s.length - (max - 1));
	}
	function hue(str) {
		var h = 0;
		for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
		return h;
	}
	function ago(sec) {
		var d = Math.max(0, Date.now() / 1000 - sec);
		if (d < 60) return 'just now';
		if (d < 3600) return Math.floor(d / 60) + 'm ago';
		if (d < 86400) return Math.floor(d / 3600) + 'h ago';
		if (d < 86400 * 30) return Math.floor(d / 86400) + 'd ago';
		if (d < 86400 * 365) return Math.floor(d / (86400 * 30)) + 'mo ago';
		return Math.floor(d / (86400 * 365)) + 'y ago';
	}
	function toast(msg, kind) {
		var t = document.createElement('div');
		t.className = 'toast ' + (kind || '');
		t.textContent = msg;
		$('toasts').appendChild(t);
		setTimeout(function () { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, 3200);
		setTimeout(function () { t.remove(); }, 3600);
	}
	var ICON = {
		branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 7.2v9.6M18 11.2c0 4-6 3-12 6"/></svg>',
		star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
		folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
		x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
		check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
		dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
		up: '<svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',
		down: '<svg viewBox="0 0 24 24"><path d="M12 5v14m6-6-6 6-6-6"/></svg>',
		warn: '<svg viewBox="0 0 24 24"><path d="M12 8v5m0 3.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
	};

	/* ---------- data ---------- */

	function refreshList() {
		return api.list().then(function (list) {
			state.repos = list;
			render();
			loadSummaries(false);
		});
	}

	var queue = [], active = 0;
	function loadSummaries(force) {
		state.repos.forEach(function (r) {
			if (force || !state.summaries[r.path]) queue.push(r.path);
		});
		pump();
	}
	function pump() {
		while (active < 4 && queue.length) {
			(function (p) {
				active++;
				api.summary(p).then(function (s) {
					state.summaries[p] = s;
					var repo = state.repos.filter(function (r) { return r.path === p; })[0];
					if (repo && cards[p]) fillCard(cards[p], repo);
					updateStats();
					if (state.filter === 'changes' || state.filter === 'behind') applyFilter();
				}).catch(function () { /* ignore */ }).then(function () { active--; pump(); });
			})(queue.shift());
		}
	}

	/* ---------- rendering ---------- */

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
	function sorted(list) {
		return list.slice().sort(function (a, b) {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			if (state.sort === 'recent' && a.lastOpened !== b.lastOpened) return b.lastOpened - a.lastOpened;
			return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
		});
	}

	function buildCard(r, index) {
		var el = document.createElement('div');
		el.className = 'card' + (firstRender ? ' enter' : '');
		el.tabIndex = 0;
		el.dataset.path = r.path;
		el.style.setProperty('--i', String(Math.min(index, 14)));
		el.innerHTML =
			'<div class="row1"><div class="mono"></div><div class="names"><div class="name"></div><div class="path"></div></div>' +
			'<div class="tools">' +
			'<button class="tool pin" data-act="pin" title="Pin to top">' + ICON.star + '</button>' +
			'<button class="tool" data-act="reveal" title="Show in folder">' + ICON.folder + '</button>' +
			'<button class="tool danger" data-act="remove" title="Remove from list">' + ICON.x + '</button></div></div>' +
			'<div class="pills"></div><div class="last"></div>';
		el.addEventListener('animationend', function () { el.classList.remove('enter'); });
		return el;
	}

	function fillCard(el, r) {
		var s = state.summaries[r.path];
		var h = hue(r.name);
		var mono = el.querySelector('.mono');
		mono.textContent = r.name.charAt(0);
		mono.style.background = 'linear-gradient(135deg,hsl(' + h + ' 78% 66%),hsl(' + ((h + 45) % 360) + ' 75% 58%))';
		el.querySelector('.name').textContent = r.name;
		var pathEl = el.querySelector('.path');
		pathEl.textContent = tailTruncate(r.path.replace(/\//g, '\\').replace(/^([A-Za-z]:)\\/, '$1\\'), 34);
		pathEl.title = r.path;
		el.classList.toggle('pinned', r.pinned);
		var pin = el.querySelector('.pin');
		pin.classList.toggle('on', r.pinned);
		pin.title = r.pinned ? 'Unpin' : 'Pin to top';
		el.classList.toggle('missing', !!s && !!s.error);

		var pills = el.querySelector('.pills'), last = el.querySelector('.last');
		if (!s) {
			pills.innerHTML = '<span class="pill skel" style="width:84px"></span><span class="pill skel" style="width:64px"></span>';
			last.innerHTML = '<span class="skel" style="height:12px;width:70%"></span>';
			return;
		}
		if (s.error) {
			pills.innerHTML = '<span class="pill err">' + ICON.warn + esc(s.error) + '</span>';
			last.textContent = 'You can remove it from the list.';
			return;
		}
		var html = '<span class="pill branch" title="Current branch">' + ICON.branch + esc(s.detached ? 'detached HEAD' : (s.branch || '-')) + '</span>';
		html += s.changes > 0
			? '<span class="pill dirty" title="Uncommitted changes">' + ICON.dot + s.changes + ' change' + (s.changes === 1 ? '' : 's') + '</span>'
			: '<span class="pill clean">' + ICON.check + 'Clean</span>';
		if (s.ahead > 0) html += '<span class="pill sync" title="Commits to push">' + ICON.up + s.ahead + '</span>';
		if (s.behind > 0) html += '<span class="pill sync" title="Commits to pull">' + ICON.down + s.behind + '</span>';
		pills.innerHTML = html;
		last.innerHTML = s.lastCommit
			? '<span class="subject" title="' + esc(s.lastCommit.author) + '">' + esc(s.lastCommit.subject) + '</span><span class="when">' + ago(s.lastCommit.date) + '</span>'
			: '<span class="subject">No commits yet</span>';
	}

	function render() {
		var grid = $('grid');
		var known = {};
		state.repos.forEach(function (r) { known[r.path] = true; });
		Object.keys(cards).forEach(function (p) { if (!known[p]) { cards[p].remove(); delete cards[p]; } });

		var order = sorted(state.repos);
		order.forEach(function (r, i) {
			if (!cards[r.path]) cards[r.path] = buildCard(r, i);
			fillCard(cards[r.path], r);
		});
		// Re-attach in sorted order only when it changed, so existing cards don't re-animate.
		var current = Array.prototype.map.call(grid.children, function (c) { return c.dataset.path; }).join('|');
		var wanted = order.map(function (r) { return r.path; }).join('|');
		if (current !== wanted) order.forEach(function (r) { grid.appendChild(cards[r.path]); });

		$('empty').classList.toggle('show', state.repos.length === 0);
		$('toolbar').style.display = state.repos.length === 0 ? 'none' : '';
		applyFilter();
		updateStats();
		firstRender = false;
	}

	function applyFilter() {
		var shown = 0;
		state.repos.forEach(function (r) {
			var el = cards[r.path];
			if (!el) return;
			var ok = matches(r);
			el.style.display = ok ? '' : 'none';
			if (ok) shown++;
		});
		$('nomatch').classList.toggle('show', state.repos.length > 0 && shown === 0);
	}

	/* count-up (React Bits CountUp, minimal) */
	function countTo(el, to, from) {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = to; return; }
		var start = performance.now(), dur = 600;
		(function step(now) {
			var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
			el.textContent = Math.round(from + (to - from) * e);
			if (t < 1) requestAnimationFrame(step);
		})(start);
	}
	function updateStats() {
		var total = state.repos.length;
		var changes = state.repos.filter(function (r) { var s = state.summaries[r.path]; return s && s.changes > 0; }).length;
		var box = $('stats');
		if (total === 0) { box.textContent = ''; return; }
		if (!box.firstChild) box.innerHTML = '<b id="sTotal">0</b> repositories \u00b7 <b id="sChanges">0</b> with changes';
		countTo($('sTotal'), total, statsShown.total);
		countTo($('sChanges'), changes, statsShown.changes);
		statsShown.total = total; statsShown.changes = changes;
	}

	/* ---------- actions ---------- */

	function openRepo(p) {
		api.open(p).then(function (res) { if (!res.ok) toast(res.error, 'bad'); });
	}

	function afterAdd(res) {
		if (res.cancelled) return;
		if (!res.ok) { toast(res.error, 'bad'); return; }
		toast(res.already ? 'Already in your list' : 'Repository added', res.already ? '' : 'good');
		refreshList();
	}

	function addPath(p) {
		return api.add(p).then(function (res) {
			if (!res.ok && !res.cancelled && /not a git repository/i.test(res.error)) {
				return api.scan(p).then(afterScan);
			}
			afterAdd(res);
		});
	}
	function afterScan(res) {
		if (res.cancelled) return;
		if (!res.ok) { toast(res.error, 'bad'); return; }
		toast('Found ' + (res.added + res.known) + ' repositor' + (res.added + res.known === 1 ? 'y' : 'ies') + (res.added ? ' \u00b7 ' + res.added + ' added' : ''), res.added ? 'good' : '');
		refreshList();
	}

	function confirmModal(title, message, confirmText, onConfirm) {
		modal({
			title: title, sub: message, confirmText: confirmText, danger: true, body: '',
			submit: function (done) { onConfirm(); done(); }
		});
	}

	/* ---------- modal ---------- */

	function modal(cfg) {
		var root = $('modalRoot');
		var back = document.createElement('div');
		back.className = 'backdrop';
		back.innerHTML = '<div class="modal" role="dialog"><h3>' + esc(cfg.title) + '</h3><div class="sub">' + esc(cfg.sub || '') + '</div>' +
			cfg.body + '<div class="err" id="mErr"></div><div class="foot"><button class="btn" id="mCancel">Cancel</button>' +
			'<button class="btn primary" id="mOk" style="' + (cfg.danger ? 'background:var(--danger);color:#fff' : '') + '">' + esc(cfg.confirmText) + '</button></div></div>';
		root.appendChild(back);
		var ok = back.querySelector('#mOk'), err = back.querySelector('#mErr');
		function close() { back.remove(); document.removeEventListener('keydown', onKey, true); }
		function setBusy(b) {
			ok.disabled = b; back.querySelector('#mCancel').disabled = b;
			ok.innerHTML = b ? '<span class="spin"></span>' + esc(cfg.busyText || 'Working\u2026') : esc(cfg.confirmText);
		}
		function submit() {
			err.textContent = '';
			cfg.submit(close, function (msg) { err.textContent = msg; setBusy(false); }, setBusy, back);
		}
		function onKey(e) {
			if (e.key === 'Escape' && !ok.disabled) { e.stopPropagation(); close(); }
			else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (!ok.disabled) submit(); }
		}
		document.addEventListener('keydown', onKey, true);
		back.addEventListener('mousedown', function (e) { if (e.target === back && !ok.disabled) close(); });
		back.querySelector('#mCancel').addEventListener('click', close);
		ok.addEventListener('click', submit);
		var first = back.querySelector('input[type=text]');
		if (first) setTimeout(function () { first.focus(); first.select(); }, 30);
		if (cfg.init) cfg.init(back);
		return back;
	}

	function folderField(id, label, value) {
		return '<div class="field"><label>' + label + '</label><div class="pick"><input type="text" id="' + id + '" value="' + esc(value || '') + '" placeholder="Choose a folder\u2026">' +
			'<button class="btn" type="button" data-pick="' + id + '">Browse</button></div></div>';
	}
	function wirePick(back, title) {
		Array.prototype.forEach.call(back.querySelectorAll('[data-pick]'), function (b) {
			b.addEventListener('click', function () {
				api.pickFolder(title).then(function (p) {
					if (p) { var inp = back.querySelector('#' + b.dataset.pick); inp.value = p; inp.dispatchEvent(new Event('input')); }
				});
			});
		});
	}

	function cloneModal() {
		api.defaults().then(function (d) {
			var nameTouched = false;
			modal({
				title: 'Clone a repository', sub: 'Download a repository from a URL and add it to your list.',
				confirmText: 'Clone', busyText: 'Cloning\u2026',
				body: '<div class="field"><label>Repository URL</label><input type="text" id="cUrl" placeholder="https://github.com/user/repo.git" spellcheck="false"></div>' +
					folderField('cDir', 'Clone into', d.cloneDir) +
					'<div class="field"><label>Folder name</label><input type="text" id="cName" placeholder="repo" spellcheck="false"></div>',
				init: function (back) {
					wirePick(back, 'Clone into folder');
					var url = back.querySelector('#cUrl'), name = back.querySelector('#cName');
					name.addEventListener('input', function () { nameTouched = true; });
					url.addEventListener('input', function () {
						if (!nameTouched) name.value = url.value.trim().replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/:]/).pop() || '';
					});
				},
				submit: function (done, fail, busy, back) {
					busy(true);
					api.clone({ url: back.querySelector('#cUrl').value, parent: back.querySelector('#cDir').value, name: back.querySelector('#cName').value }).then(function (res) {
						if (!res.ok) { fail(res.error); return; }
						done();
						toast('Cloned successfully', 'good');
						refreshList().then(function () { openRepo(res.path); });
					});
				}
			});
		});
	}

	function newModal() {
		api.defaults().then(function (d) {
			modal({
				title: 'New repository', sub: 'Create an empty folder and initialise it as a Git repository.',
				confirmText: 'Create', busyText: 'Creating\u2026',
				body: '<div class="field"><label>Name</label><input type="text" id="nName" placeholder="my-project" spellcheck="false"></div>' + folderField('nDir', 'Location', d.newRepoDir),
				init: function (back) { wirePick(back, 'Where should the repository be created?'); },
				submit: function (done, fail, busy, back) {
					busy(true);
					api.init({ parent: back.querySelector('#nDir').value, name: back.querySelector('#nName').value }).then(function (res) {
						if (!res.ok) { fail(res.error); return; }
						done();
						toast('Repository created', 'good');
						refreshList().then(function () { openRepo(res.path); });
					});
				}
			});
		});
	}

	/* ---------- wiring ---------- */

	$('btnOpen').addEventListener('click', function () { api.add(null).then(afterAdd); });
	$('btnScan').addEventListener('click', function () { api.scan(null).then(afterScan); });
	$('btnNew').addEventListener('click', newModal);
	$('btnClone').addEventListener('click', cloneModal);
	$('heroOpen').addEventListener('click', function () { api.add(null).then(afterAdd); });
	$('heroNew').addEventListener('click', newModal);
	$('heroClone').addEventListener('click', cloneModal);

	$('search').addEventListener('input', function (e) { state.query = e.target.value.trim(); applyFilter(); });
	$('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
	$('chips').addEventListener('click', function (e) {
		var chip = e.target.closest('.chip');
		if (!chip) return;
		state.filter = chip.dataset.f;
		Array.prototype.forEach.call($('chips').children, function (c) { c.classList.toggle('active', c === chip); });
		applyFilter();
	});

	$('grid').addEventListener('click', function (e) {
		var card = e.target.closest('.card');
		if (!card) return;
		var p = card.dataset.path;
		var btn = e.target.closest('[data-act]');
		if (!btn) { openRepo(p); return; }
		e.stopPropagation();
		var act = btn.dataset.act;
		if (act === 'pin') api.pin(p).then(function () { return refreshList(); });
		else if (act === 'reveal') api.reveal(p);
		else if (act === 'remove') {
			var name = card.querySelector('.name').textContent;
			confirmModal('Remove "' + name + '"?', 'It will be removed from this list. Nothing is deleted from disk.', 'Remove', function () {
				api.remove(p).then(function () { toast('Removed from list'); return refreshList(); });
			});
		}
	});
	$('grid').addEventListener('keydown', function (e) {
		var card = e.target.closest('.card');
		if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRepo(card.dataset.path); }
	});

	document.addEventListener('keydown', function (e) {
		var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
		if (e.key === '/' && !typing) { e.preventDefault(); $('search').focus(); }
		else if (e.key === 'Escape' && document.activeElement === $('search')) { $('search').value = ''; state.query = ''; applyFilter(); $('search').blur(); }
	});

	/* drag & drop a folder anywhere */
	var dragDepth = 0;
	window.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; $('drop').classList.add('show'); });
	window.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').classList.remove('show'); });
	window.addEventListener('dragover', function (e) { e.preventDefault(); });
	window.addEventListener('drop', function (e) {
		e.preventDefault();
		dragDepth = 0;
		$('drop').classList.remove('show');
		Array.prototype.forEach.call(e.dataTransfer.files, function (f) {
			var p = api.pathForFile(f);
			if (p) addPath(p.replace(/\\/g, '/'));
		});
	});

	api.onReposChanged(function () { refreshList(); });
	var focusTimer = null;
	window.addEventListener('focus', function () {
		clearTimeout(focusTimer);
		focusTimer = setTimeout(function () { loadSummaries(true); }, 400);
	});

	refreshList();
})();
