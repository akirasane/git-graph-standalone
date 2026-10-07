// Left sidebar (GitKraken-style): local branches, remote branches, tags, stashes, plus the
// conflict list managed by conflicts.js (it renders into #sbConflicts). Isolated from
// media/out.min.js like panel.js - own acquireHostApi() handle + own 'message' listener, and
// never touches getState()/setState(). Actions reuse the existing request commands, so the main
// frontend's own response handlers (refresh / error dialogs) keep working unchanged.
(function () {
	'use strict';

	var api = window.acquireHostApi();
	var data = { branches: [], head: null, remotes: [], stashes: [], tags: [] };
	var collapsed = {};
	var filter = '';
	var els = {};

	function post(msg) { api.postMessage(msg); }
	function currentRepo() { return (window.gitGraph && window.gitGraph.currentRepo) || null; }
	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function matches(name) { return filter === '' || name.toLowerCase().indexOf(filter) !== -1; }

	function row(label, opts) {
		opts = opts || {};
		var actions = (opts.actions || []).map(function (a) {
			return '<button type="button" class="sbBtn" data-act="' + a.act + '" title="' + esc(a.title) + '">' + a.icon + '</button>';
		}).join('');
		return '<li class="sbRow' + (opts.current ? ' sbCurrent' : '') + '" data-kind="' + opts.kind + '" data-ref="' + esc(opts.ref) + '" title="' + esc(opts.tip || opts.ref) + '">' +
			(opts.current ? '<span class="sbDot">&#9679;</span>' : '') +
			'<span class="sbLabel">' + esc(label) + '</span><span class="sbActions">' + actions + '</span></li>';
	}

	function section(id, title, count, bodyHtml) {
		var isCollapsed = collapsed[id] === true;
		return '<div class="sbSection"><div class="sbHeader" data-section="' + id + '">' +
			'<span class="sbCaret">' + (isCollapsed ? '&#9656;' : '&#9662;') + '</span>' + esc(title) +
			'<span class="sbCount">' + count + '</span></div>' +
			(isCollapsed ? '' : '<ul class="sbList">' + (bodyHtml || '<li class="sbEmpty">None</li>') + '</ul>') + '</div>';
	}

	function render() {
		var local = data.branches.filter(function (b) { return b.indexOf('remotes/') !== 0; });
		var remote = data.branches.filter(function (b) { return b.indexOf('remotes/') === 0; });

		var localHtml = local.filter(matches).map(function (b) {
			var isHead = b === data.head;
			return row(b, {
				kind: 'local', ref: b, current: isHead,
				actions: (isHead ? [] : [
					{ act: 'merge', icon: '&#10549;', title: 'Merge into current branch' },
					{ act: 'delete', icon: '&#10005;', title: 'Delete branch' }
				])
			});
		}).join('');

		var byRemote = {};
		remote.forEach(function (b) {
			var short = b.substring('remotes/'.length);          // origin/main
			var slash = short.indexOf('/');
			var r = short.substring(0, slash);
			(byRemote[r] = byRemote[r] || []).push(short);
		});
		var remoteHtml = Object.keys(byRemote).sort().map(function (r) {
			var items = byRemote[r].filter(matches).map(function (short) {
				return row(short.substring(r.length + 1), {
					kind: 'remote', ref: short, tip: short,
					actions: [{ act: 'merge', icon: '&#10549;', title: 'Merge into current branch' }]
				});
			}).join('');
			return items === '' ? '' : '<li class="sbRemoteName">' + esc(r) + '</li>' + items;
		}).join('');

		var tagHtml = data.tags.filter(matches).map(function (t) {
			return row(t, { kind: 'tag', ref: t, actions: [{ act: 'delete', icon: '&#10005;', title: 'Delete tag' }] });
		}).join('');

		var stashHtml = data.stashes.filter(function (s) { return matches(s.message); }).map(function (s) {
			return row(s.message, {
				kind: 'stash', ref: s.selector,
				actions: [
					{ act: 'apply', icon: 'Apply', title: 'Apply stash' },
					{ act: 'pop', icon: 'Pop', title: 'Pop stash' },
					{ act: 'drop', icon: '&#10005;', title: 'Drop stash' }
				]
			});
		}).join('');

		els.body.innerHTML =
			section('local', 'Local', local.length, localHtml) +
			section('remote', 'Remote', remote.length, remoteHtml) +
			section('tags', 'Tags', data.tags.length, tagHtml) +
			section('stashes', 'Stashes', data.stashes.length, stashHtml);
	}

	function localExists(name) { return data.branches.indexOf(name) !== -1; }

	function onRowAction(kind, ref, act) {
		var repo = currentRepo();
		if (repo === null) return;
		if (kind === 'local' || kind === 'remote') {
			if (act === 'merge') {
				if (!window.confirm('Merge "' + ref + '" into "' + data.head + '"?')) return;
				post({
					command: 'merge', repo: repo, obj: ref,
					actionOn: kind === 'local' ? 'Branch' : 'Remote-tracking Branch',
					createNewCommit: true, squash: false, noCommit: false
				});
			} else if (act === 'delete' && kind === 'local') {
				if (!window.confirm('Delete local branch "' + ref + '"?')) return;
				post({ command: 'deleteBranch', repo: repo, branchName: ref, forceDelete: false, deleteOnRemotes: [] });
			}
		} else if (kind === 'tag' && act === 'delete') {
			if (!window.confirm('Delete tag "' + ref + '" (local only)?')) return;
			post({ command: 'deleteTag', repo: repo, tagName: ref, deleteOnRemote: null });
		} else if (kind === 'stash') {
			if (act === 'apply') post({ command: 'applyStash', repo: repo, selector: ref, reinstateIndex: false });
			else if (act === 'pop') post({ command: 'popStash', repo: repo, selector: ref, reinstateIndex: false });
			else if (act === 'drop' && window.confirm('Drop this stash?')) post({ command: 'dropStash', repo: repo, selector: ref });
		}
	}

	function checkout(kind, ref) {
		var repo = currentRepo();
		if (repo === null) return;
		if (kind === 'local') {
			if (ref === data.head) return;
			post({ command: 'checkoutBranch', repo: repo, branchName: ref, remoteBranch: null, pullAfterwards: null });
		} else if (kind === 'remote') {
			var local = ref.substring(ref.indexOf('/') + 1);
			if (localExists(local)) post({ command: 'checkoutBranch', repo: repo, branchName: local, remoteBranch: null, pullAfterwards: null });
			else post({ command: 'checkoutBranch', repo: repo, branchName: local, remoteBranch: ref, pullAfterwards: null });
		}
	}

	/* ---------- Pull / Push / Fetch bar ---------- */

	var sync = { status: null, busy: null };
	var syncTimer = null;

	function toast(text, kind) {
		var box = document.getElementById('ggToasts');
		if (!box) { box = document.createElement('div'); box.id = 'ggToasts'; document.body.appendChild(box); }
		var t = document.createElement('div');
		t.className = 'ggToast ' + (kind || '');
		t.textContent = text.length > 420 ? text.slice(0, 417) + '...' : text;
		box.appendChild(t);
		var life = kind === 'bad' ? 9000 : 3200;
		setTimeout(function () { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, life);
		setTimeout(function () { t.remove(); }, life + 400);
	}

	function setBadge(btn, n) {
		var b = btn.querySelector('.sbBadge');
		b.hidden = !(n > 0);
		b.textContent = n > 99 ? '99+' : String(n);
	}

	function renderSync() {
		var s = sync.status;
		var pull = document.getElementById('sbPull'), push = document.getElementById('sbPush'), fetchBtn = document.getElementById('sbFetch');
		var line = document.getElementById('sbBranchLine');
		var hasRepo = currentRepo() !== null && s !== null;
		var branch = hasRepo ? s.branch : null;
		line.querySelector('.sbBl-branch').textContent = branch || (hasRepo ? 'detached HEAD' : '-');
		line.querySelector('.sbBl-up').textContent = hasRepo && branch ? (s.upstream || 'not published yet') : '';
		line.classList.toggle('unpublished', hasRepo && !!branch && !s.upstream);
		line.title = hasRepo && s.upstream ? s.ahead + ' to push, ' + s.behind + ' to pull' : '';
		pull.disabled = !hasRepo || !branch || !s.upstream || sync.busy !== null;
		push.disabled = !hasRepo || !branch || s.remotes.length === 0 || sync.busy !== null;
		fetchBtn.disabled = !hasRepo || s.remotes.length === 0 || sync.busy !== null;
		var unpublished = hasRepo && !!branch && !s.upstream && s.remotes.length > 0;
		push.classList.toggle('unpublished', unpublished);
		push.querySelector('span').textContent = unpublished ? 'Publish' : 'Push';
		push.title = unpublished ? 'Publish this branch to the remote and set its upstream' : 'Push the current branch';
		setBadge(pull, hasRepo ? s.behind : 0);
		setBadge(push, hasRepo ? s.ahead : 0);
		pull.classList.toggle('hot', hasRepo && s.behind > 0);
		push.classList.toggle('hot', hasRepo && (s.ahead > 0 || (!!branch && !s.upstream && s.remotes.length > 0)));
		pull.classList.toggle('busy', sync.busy === 'pull');
		push.classList.toggle('busy', sync.busy === 'push');
		fetchBtn.classList.toggle('busy', sync.busy === 'fetch');
	}

	function requestSyncStatus() {
		clearTimeout(syncTimer);
		syncTimer = setTimeout(function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'getSyncStatus', repo: repo });
		}, 120);
	}

	function runSync(kind) {
		var repo = currentRepo();
		if (repo === null || sync.busy !== null || sync.status === null) return;
		sync.busy = kind;
		renderSync();
		if (kind === 'fetch') post({ command: 'fetch', repo: repo, name: null, prune: false, pruneTags: false });
		else post({ command: 'syncBranch', repo: repo, action: kind });
	}

	// Turns raw git output into something readable; unknown errors fall back to git's own first lines.
	function friendlyError(kind, error) {
		var title = (kind === 'fetch' ? 'Fetch' : kind === 'push' ? 'Push' : 'Pull') + ' failed';
		if (/rejected|fetch first|non-fast-forward/i.test(error)) return title + '\nThe remote has commits you don\'t have yet. Pull first, then push again.';
		if (/CONFLICT|Automatic merge failed|unmerged|merge conflict/i.test(error)) return title + '\nMerge conflicts - resolve them from the banner in the sidebar, then continue.';
		if (/Authentication failed|could not read Username|Permission denied|403|401/i.test(error)) return title + '\nAuthentication failed. Check your credentials for this remote.';
		if (/overwritten by merge|local changes/i.test(error)) return title + '\nYou have uncommitted changes that would be overwritten. Commit or stash them first.';
		var lines = error.split('\n').filter(function (l) { return !/^(hint:|To )/.test(l.trim()) && l.trim() !== ''; });
		return title + '\n' + lines.slice(0, 3).join('\n');
	}

	function finishSync(kind, error, message) {
		sync.busy = null;
		if (error) toast(friendlyError(kind, String(error)), 'bad');
		else toast(message || 'Fetched all remotes', 'good');
		renderSync();
		requestSyncStatus();
		if (window.gitGraph) window.gitGraph.refresh(false);
	}

	function init() {
		els.root = document.getElementById('sidebar');
		els.body = document.getElementById('sbBody');
		els.filter = document.getElementById('sbFilter');

		els.filter.addEventListener('input', function () { filter = els.filter.value.trim().toLowerCase(); render(); });
		document.getElementById('sbPull').addEventListener('click', function () { runSync('pull'); });
		document.getElementById('sbPush').addEventListener('click', function () { runSync('push'); });
		document.getElementById('sbFetch').addEventListener('click', function () { runSync('fetch'); });
		window.addEventListener('focus', requestSyncStatus);

		els.body.addEventListener('click', function (e) {
			var header = e.target.closest('.sbHeader');
			if (header) {
				var id = header.getAttribute('data-section');
				collapsed[id] = !collapsed[id];
				render();
				return;
			}
			var btn = e.target.closest('.sbBtn');
			var li = e.target.closest('.sbRow');
			if (btn && li) {
				e.stopPropagation();
				onRowAction(li.getAttribute('data-kind'), li.getAttribute('data-ref'), btn.getAttribute('data-act'));
			}
		});
		els.body.addEventListener('dblclick', function (e) {
			var li = e.target.closest('.sbRow');
			if (li && !e.target.closest('.sbBtn')) checkout(li.getAttribute('data-kind'), li.getAttribute('data-ref'));
		});

		window.addEventListener('message', function (event) {
			var msg = event.data;
			if (!msg || typeof msg.command !== 'string') return;
			if (msg.command === 'getSyncStatus') {
				sync.status = msg.error ? null : msg.status;
				renderSync();
				return;
			}
			if (msg.command === 'syncBranch') { finishSync(msg.action, msg.error, msg.message); return; }
			if (msg.command === 'fetch' && sync.busy === 'fetch') { finishSync('fetch', msg.error, null); return; }
			if (msg.command === 'refresh' || msg.command === 'loadCommits') requestSyncStatus();
			if (msg.command === 'loadRepoInfo' && msg.error === null) {
				requestSyncStatus();
				data.branches = msg.branches || [];
				data.head = msg.head;
				data.remotes = msg.remotes || [];
				data.stashes = msg.stashes || [];
				render();
			} else if (msg.command === 'loadCommits' && msg.error === null) {
				data.tags = (msg.tags || []).slice().sort();
				render();
			}
		});

		render();
		renderSync();
		requestSyncStatus();
	}

	window.addEventListener('load', init);
})();
