// Left sidebar: back link, branch line + Pull / Push / Fetch, filter, and the collapsible
// Local / Remote / Tags / Stashes lists, plus the conflict banner managed by conflicts.js (it
// renders into #sbConflicts). Isolated from media/out.min.js like panel.js - own acquireHostApi()
// handle + own 'message' listener, and never touches getState()/setState(). Actions reuse the
// existing request commands, so the main frontend's own response handlers (refresh / error
// dialogs) keep working unchanged; this file only adds success toasts for what it started.
(function () {
	'use strict';

	var api = window.acquireHostApi();
	var data = { branches: [], head: null, remotes: [], stashes: [], tags: [] };
	var loaded = false;
	var collapsed = {};
	var showAllTags = false;
	var TAG_LIMIT = 40;
	var filter = '';
	var pending = {}; // command -> success text, for actions started here
	var els = {};

	function post(msg) { api.postMessage(msg); }
	function currentRepo() { return (window.gitGraph && window.gitGraph.currentRepo) || null; }
	function toast(text, kind) { if (window.GG && GG.toast) GG.toast(text, kind); }
	function confirmBox(opts) { return window.GG && GG.confirm ? GG.confirm(opts) : Promise.resolve(window.confirm(opts.message || opts.title)); }
	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function matches(name) { return filter === '' || name.toLowerCase().indexOf(filter) !== -1; }

	function row(label, opts) {
		var actions = (opts.actions || []).map(function (a) {
			return '<button type="button" class="shIconBtn sbBtn' + (a.danger ? ' danger' : '') + '" data-act="' + a.act + '" title="' + esc(a.title) + '" aria-label="' + esc(a.title) + '"><i data-icon="' + a.icon + '"></i></button>';
		}).join('');
		return '<li class="sbRow' + (opts.current ? ' sbCurrent' : '') + '" tabindex="0" data-kind="' + opts.kind + '" data-ref="' + esc(opts.ref) + '" title="' + esc(opts.tip || opts.ref) + '"' + (opts.current ? ' aria-current="true"' : '') + '>' +
			'<span class="sbLabel">' + esc(label) + '</span>' + (opts.sub ? '<span class="sbSub">' + esc(opts.sub) + '</span>' : '') +
			'<span class="sbActions">' + actions + '</span></li>';
	}

	function section(id, title, count, bodyHtml, emptyText) {
		var open = collapsed[id] !== true;
		return '<div class="sbSection"><button type="button" class="sbHeader" data-section="' + id + '" aria-expanded="' + open + '">' +
			'<i class="sbCaret" data-icon="caret-down"></i><span class="shKicker">' + esc(title) + '</span>' +
			'<span class="sbCount">' + count + '</span></button>' +
			(open ? '<ul class="sbList">' + (bodyHtml || '<li class="sbEmpty">' + esc(filter !== '' && count > 0 ? 'No matches' : emptyText) + '</li>') + '</ul>' : '') + '</div>';
	}

	function render() {
		if (!loaded) return;
		var local = data.branches.filter(function (b) { return b.indexOf('remotes/') !== 0; });
		var remote = data.branches.filter(function (b) { return b.indexOf('remotes/') === 0 && !/\/HEAD$/.test(b); });
		var checkoutTip = ' - double-click or Enter to check out';

		var localHtml = local.filter(matches).map(function (b) {
			var isHead = b === data.head;
			return row(b, {
				kind: 'local', ref: b, current: isHead, tip: b + (isHead ? ' (checked out)' : checkoutTip),
				actions: (isHead ? [] : [
					{ act: 'merge', icon: 'git-merge', title: 'Merge into ' + (data.head || 'the current branch') },
					{ act: 'delete', icon: 'trash', title: 'Delete branch', danger: true }
				])
			});
		}).join('');

		var byRemote = {};
		remote.forEach(function (b) {
			var short = b.substring('remotes/'.length);          // origin/main
			var r = short.substring(0, short.indexOf('/'));
			(byRemote[r] = byRemote[r] || []).push(short);
		});
		var remoteNames = Object.keys(byRemote).sort();
		var remoteHtml = remoteNames.map(function (r) {
			var items = byRemote[r].filter(matches).map(function (short) {
				return row(short.substring(r.length + 1), {
					kind: 'remote', ref: short, tip: short + checkoutTip,
					actions: [{ act: 'merge', icon: 'git-merge', title: 'Merge into ' + (data.head || 'the current branch') }]
				});
			}).join('');
			return items === '' ? '' : '<li class="sbRemoteName"><i data-icon="hard-drives"></i>' + esc(r) + '</li>' + items;
		}).join('');

		var tags = data.tags.filter(matches);
		var hiddenTags = filter === '' && !showAllTags && tags.length > TAG_LIMIT ? tags.length - TAG_LIMIT : 0;
		var tagHtml = tags.slice(0, tags.length - hiddenTags).map(function (t) {
			return row(t, { kind: 'tag', ref: t, actions: [{ act: 'delete', icon: 'trash', title: 'Delete tag (local only)', danger: true }] });
		}).join('') + (hiddenTags > 0 ? '<li><button type="button" class="shLink sbMore" data-more="tags">Show ' + hiddenTags + ' more</button></li>' : '');

		var stashHtml = data.stashes.filter(function (s) { return matches(s.message); }).map(function (s) {
			return row(s.message, {
				kind: 'stash', ref: s.selector, tip: s.selector + ': ' + s.message, sub: s.selector.replace(/^(refs\/)?stash/, ''),
				actions: [
					{ act: 'apply', icon: 'download-simple', title: 'Apply stash (keep it)' },
					{ act: 'pop', icon: 'arrow-u-up-left', title: 'Pop stash (apply and remove)' },
					{ act: 'drop', icon: 'trash', title: 'Drop stash', danger: true }
				]
			});
		}).join('');

		var focusKey = document.activeElement && els.body.contains(document.activeElement) ? focusKeyOf(document.activeElement) : null;
		els.body.innerHTML =
			section('local', 'Local', local.length, localHtml, 'No branches yet') +
			section('remote', 'Remote', remote.length, remoteHtml, data.remotes.length === 0 ? 'No remotes configured' : 'No remote branches') +
			section('tags', 'Tags', data.tags.length, tagHtml, 'No tags') +
			section('stashes', 'Stashes', data.stashes.length, stashHtml, 'No stashes');
		if (focusKey !== null) {
			var again = els.body.querySelector(focusKey);
			if (again) again.focus();
		}
	}

	// Keeps keyboard focus on the same header / row across re-renders.
	function focusKeyOf(el) {
		if (el.classList.contains('sbHeader')) return '.sbHeader[data-section="' + el.getAttribute('data-section') + '"]';
		var li = el.closest('.sbRow');
		return li ? '.sbRow[data-kind="' + li.getAttribute('data-kind') + '"][data-ref="' + CSS.escape(li.getAttribute('data-ref')) + '"]' : null;
	}

	function localExists(name) { return data.branches.indexOf(name) !== -1; }

	function onRowAction(kind, ref, act) {
		var repo = currentRepo();
		if (repo === null) return;
		if ((kind === 'local' || kind === 'remote') && act === 'merge') {
			confirmBox({ title: 'Merge branch', message: 'Merge "' + ref + '" into "' + data.head + '"?', confirm: 'Merge' }).then(function (ok) {
				if (!ok) return;
				pending.merge = 'Merged ' + ref + ' into ' + data.head;
				post({ command: 'merge', repo: repo, obj: ref, actionOn: kind === 'local' ? 'Branch' : 'Remote-tracking Branch', createNewCommit: true, squash: false, noCommit: false });
			});
		} else if (kind === 'local' && act === 'delete') {
			confirmBox({ title: 'Delete branch', message: 'Delete the local branch "' + ref + '"? Unmerged commits on it may be lost.', confirm: 'Delete', danger: true }).then(function (ok) {
				if (!ok) return;
				pending.deleteBranch = 'Deleted branch ' + ref;
				post({ command: 'deleteBranch', repo: repo, branchName: ref, forceDelete: false, deleteOnRemotes: [] });
			});
		} else if (kind === 'tag' && act === 'delete') {
			confirmBox({ title: 'Delete tag', message: 'Delete the tag "' + ref + '"? It is only removed locally.', confirm: 'Delete', danger: true }).then(function (ok) {
				if (!ok) return;
				pending.deleteTag = 'Deleted tag ' + ref;
				post({ command: 'deleteTag', repo: repo, tagName: ref, deleteOnRemote: null });
			});
		} else if (kind === 'stash') {
			if (act === 'apply') { pending.applyStash = 'Stash applied'; post({ command: 'applyStash', repo: repo, selector: ref, reinstateIndex: false }); }
			else if (act === 'pop') { pending.popStash = 'Stash popped'; post({ command: 'popStash', repo: repo, selector: ref, reinstateIndex: false }); }
			else if (act === 'drop') {
				confirmBox({ title: 'Drop stash', message: 'Drop ' + ref + '? This cannot be undone.', confirm: 'Drop', danger: true }).then(function (ok) {
					if (!ok) return;
					pending.dropStash = 'Stash dropped';
					post({ command: 'dropStash', repo: repo, selector: ref });
				});
			}
		}
	}

	function checkout(kind, ref) {
		var repo = currentRepo();
		if (repo === null) return;
		if (kind === 'local') {
			if (ref === data.head) return;
			pending.checkoutBranch = 'Checked out ' + ref;
			post({ command: 'checkoutBranch', repo: repo, branchName: ref, remoteBranch: null, pullAfterwards: null });
		} else if (kind === 'remote') {
			var local = ref.substring(ref.indexOf('/') + 1);
			pending.checkoutBranch = 'Checked out ' + local;
			if (localExists(local)) post({ command: 'checkoutBranch', repo: repo, branchName: local, remoteBranch: null, pullAfterwards: null });
			else post({ command: 'checkoutBranch', repo: repo, branchName: local, remoteBranch: ref, pullAfterwards: null });
		}
	}

	// Success toast for an action this sidebar started (errors are shown by the main frontend).
	function settle(command, failed) {
		if (!(command in pending)) return;
		var text = pending[command];
		delete pending[command];
		if (!failed) toast(text, 'success');
	}

	/* ---------- Pull / Push / Fetch bar ---------- */

	var sync = { status: null, busy: null };
	var syncTimer = null;

	function setBadge(btn, n, label) {
		var b = btn.querySelector('.sbBadge');
		b.hidden = !(n > 0);
		b.textContent = n > 99 ? '99+' : String(n);
		b.setAttribute('aria-label', n + ' ' + label);
	}

	function renderSync() {
		var s = sync.status;
		var pull = document.getElementById('sbPull'), push = document.getElementById('sbPush'), fetchBtn = document.getElementById('sbFetch');
		var line = document.getElementById('sbBranchLine');
		var hasRepo = currentRepo() !== null && s !== null;
		var branch = hasRepo ? s.branch : null;
		var hasRemote = hasRepo && s.remotes.length > 0;
		line.querySelector('.sbBl-branch').textContent = branch || (hasRepo ? 'Detached HEAD' : ' ');
		line.querySelector('.sbBl-up').textContent = !hasRepo || !branch ? '' : s.upstream ? s.upstream : hasRemote ? 'not published' : 'no remote';
		line.classList.toggle('noUpstream', !hasRepo || !branch || !s.upstream);
		line.classList.toggle('detached', hasRepo && !branch);
		line.classList.toggle('unpublished', hasRepo && !!branch && !s.upstream && hasRemote);
		line.title = !hasRepo ? '' : !branch ? 'HEAD is not on a branch. Check out a branch to pull or push.'
			: s.upstream ? branch + ' tracks ' + s.upstream + ': ' + s.ahead + ' to push, ' + s.behind + ' to pull'
			: hasRemote ? branch + ' has no upstream yet - Publish pushes it and sets one' : 'This repository has no remote';

		var busy = sync.busy !== null;
		pull.disabled = !hasRepo || !branch || !s.upstream || busy;
		push.disabled = !hasRepo || !branch || !hasRemote || busy;
		fetchBtn.disabled = !hasRepo || !hasRemote || busy;
		var unpublished = hasRepo && !!branch && !s.upstream && hasRemote;
		push.querySelector('span').textContent = unpublished ? 'Publish' : 'Push';
		push.title = !hasRemote && hasRepo ? 'No remote configured' : unpublished ? 'Publish this branch to the remote and set its upstream' : 'Push the current branch';
		pull.title = !hasRemote && hasRepo ? 'No remote configured' : hasRepo && branch && !s.upstream ? 'This branch has no upstream to pull from' : 'Pull (fetch and merge the upstream branch)';
		fetchBtn.title = !hasRemote && hasRepo ? 'No remote configured' : 'Fetch all remotes';
		setBadge(pull, hasRepo ? s.behind : 0, 'commits to pull');
		setBadge(push, hasRepo ? s.ahead : 0, 'commits to push');
		pull.classList.toggle('hot', hasRepo && s.behind > 0);
		push.classList.toggle('hot', hasRepo && (s.ahead > 0 || unpublished));
		pull.classList.toggle('busy', sync.busy === 'pull');
		push.classList.toggle('busy', sync.busy === 'push');
		fetchBtn.classList.toggle('busy', sync.busy === 'fetch');
		[pull, push, fetchBtn].forEach(function (b) { b.setAttribute('aria-busy', b.classList.contains('busy') ? 'true' : 'false'); });
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
		if (kind === 'fetch') post({ command: 'fetch', repo: repo, name: null, prune: false, pruneTags: false, source: 'sidebar' });
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
		// Fetches sent with source: 'sidebar' are reported only here (the graph view just refreshes).
		if (error) toast(friendlyError(kind, String(error)), 'error');
		else if (!error) toast(message || 'Fetched all remotes', 'success');
		renderSync();
		requestSyncStatus();
		if (window.gitGraph) window.gitGraph.refresh(false);
	}

	function init() {
		els.root = document.getElementById('sidebar');
		els.body = document.getElementById('sbBody');
		els.filter = document.getElementById('sbFilter');

		els.filter.addEventListener('input', function () { filter = els.filter.value.trim().toLowerCase(); render(); });
		els.filter.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && els.filter.value !== '') { e.stopPropagation(); els.filter.value = ''; filter = ''; render(); }
		});
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
			var more = e.target.closest('[data-more]');
			if (more) { showAllTags = true; render(); return; }
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
		els.body.addEventListener('keydown', function (e) {
			var li = e.target.closest('.sbRow');
			if (!li || e.target !== li) return;
			if (e.key === 'Enter') { e.preventDefault(); checkout(li.getAttribute('data-kind'), li.getAttribute('data-ref')); }
			else if (e.key === 'Delete') {
				var del = li.querySelector('[data-act="delete"], [data-act="drop"]');
				if (del) { e.preventDefault(); del.click(); }
			} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				var rows = Array.prototype.slice.call(els.body.querySelectorAll('.sbRow'));
				var next = rows[rows.indexOf(li) + (e.key === 'ArrowDown' ? 1 : -1)];
				if (next) { e.preventDefault(); next.focus(); }
			}
		});

		window.addEventListener('message', function (event) {
			var msg = event.data;
			if (!msg || typeof msg.command !== 'string') return;
			switch (msg.command) {
				case 'getSyncStatus':
					sync.status = msg.error ? null : msg.status;
					renderSync();
					return;
				case 'syncBranch': finishSync(msg.action, msg.error, msg.message); return;
				case 'fetch': if (sync.busy === 'fetch' && msg.source === 'sidebar') finishSync('fetch', msg.error, null); return;
				case 'merge': case 'deleteTag': case 'applyStash': case 'popStash': case 'dropStash':
					settle(msg.command, !!msg.error); return;
				case 'deleteBranch': case 'checkoutBranch': settle(msg.command, (msg.errors || []).some(function (x) { return x !== null; })); return;
				case 'refresh': requestSyncStatus(); return;
				case 'loadRepoInfo':
					if (msg.error !== null) return;
					requestSyncStatus();
					data.branches = msg.branches || [];
					data.head = msg.head;
					data.remotes = msg.remotes || [];
					data.stashes = msg.stashes || [];
					loaded = true;
					render();
					return;
				case 'loadCommits':
					requestSyncStatus();
					if (msg.error !== null) return;
					data.tags = (msg.tags || []).slice().sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); });
					render();
					return;
			}
		});

		renderSync();
		requestSyncStatus();
	}

	window.addEventListener('load', init);
})();
