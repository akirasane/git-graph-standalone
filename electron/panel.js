// Working copy panel (stage / unstage / discard / commit, AI commit message) + Stash tab.
// Deliberately isolated from media/out.min.js (the main graph frontend) - see
// electron/src/dataSource.ts for the commands it uses.
//
// Talks to the same Electron IPC surface the rest of the app uses: a second call to
// window.acquireHostApi() (electron/src/preload.ts returns a fresh postMessage-only
// object per call) and its own 'message' listener alongside out.min.js's. This script
// must NEVER call getState()/setState() on its API object - that state is shared with
// GitGraphView and calling them would clobber its persisted view state.
(function () {
	'use strict';

	var api = window.acquireHostApi();
	var stashCache = [];
	var files = { unstaged: null, staged: null };
	var pending = {}; // command -> success text, for actions started here
	var els = {};

	function post(msg) { api.postMessage(msg); }
	function currentRepo() { return (window.gitGraph && window.gitGraph.currentRepo) || null; }
	function toast(text, kind) { if (window.GG && GG.toast) GG.toast(text, kind); }
	function confirmBox(opts) { return window.GG && GG.confirm ? GG.confirm(opts) : Promise.resolve(window.confirm(opts.message || opts.title)); }
	function escapeHtml(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

	var STATUS_TITLE = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', U: 'Untracked', C: 'Conflicted' };

	function pathHtml(filePath) {
		var i = filePath.lastIndexOf('/');
		return '<span class="shPath">' + (i === -1 ? '' : '<span class="dir">' + escapeHtml(filePath.substring(0, i + 1)) + '</span>') +
			'<span class="base">' + escapeHtml(filePath.substring(i + 1)) + '</span></span>';
	}

	function actionBtn(kind, icon, title, danger) {
		return '<button type="button" class="shIconBtn wcFileAction' + (danger ? ' danger' : '') + '" data-act="' + kind + '" title="' + title + '" aria-label="' + title + '"><i data-icon="' + icon + '"></i></button>';
	}

	function renderFileList(list, which) {
		var container = which === 'staged' ? els.stagedList : els.unstagedList;
		if (list.length === 0) {
			container.innerHTML = '<li class="wcEmpty">' + (which === 'staged' ? 'Nothing staged yet' : 'No unstaged changes') + '</li>';
			return;
		}
		container.innerHTML = list.map(function (f, i) {
			var hasStats = f.additions !== null && f.deletions !== null;
			var tip = (STATUS_TITLE[f.type] || f.type) + ': ' + (f.type === 'R' ? f.oldFilePath + ' → ' : '') + f.newFilePath + ' - click to view the diff';
			return '<li class="wcFileRow" tabindex="0" data-index="' + i + '" title="' + escapeHtml(tip) + '">' +
				'<span class="wcStatus s-' + f.type + '" aria-label="' + (STATUS_TITLE[f.type] || f.type) + '">' + (f.type === 'U' ? 'A' : f.type) + '</span>' +
				pathHtml(f.newFilePath) +
				(hasStats ? '<span class="wcFileStats">' + (f.type !== 'D' || f.additions > 0 ? '<span class="wcAdd">+' + f.additions + '</span>' : '') +
					(!(f.type === 'A' || f.type === 'U') || f.deletions > 0 ? '<span class="wcDel">-' + f.deletions + '</span>' : '') + '</span>' : '') +
				'<span class="wcFileActions">' +
				(which === 'unstaged' ? actionBtn('discard', 'arrow-counter-clockwise', 'Discard changes', true) + actionBtn('stage', 'plus', 'Stage file') : actionBtn('unstage', 'minus', 'Unstage file')) +
				'</span></li>';
		}).join('');
	}

	function onFileListEvent(e, which) {
		var row = e.target.closest('.wcFileRow');
		if (!row) return;
		var list = files[which] || [];
		var f = list[parseInt(row.getAttribute('data-index'), 10)];
		if (!f) return;
		var btn = e.target.closest('.wcFileAction');
		if (e.type === 'keydown') {
			if (e.target !== row) return;
			if (e.key === 'Enter') { e.preventDefault(); viewDiff(f); }
			else if (e.key === ' ') { e.preventDefault(); fileAction(which === 'staged' ? 'unstage' : 'stage', f); }
			else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				var sib = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
				if (sib && sib.classList.contains('wcFileRow')) { e.preventDefault(); sib.focus(); }
			}
			return;
		}
		if (btn) { e.stopPropagation(); fileAction(btn.getAttribute('data-act'), f); }
		else viewDiff(f);
	}

	function fileAction(act, f) {
		var repo = currentRepo();
		if (repo === null) return;
		if (act === 'stage') post({ command: 'stageFile', repo: repo, filePath: f.newFilePath });
		else if (act === 'unstage') post({ command: 'unstageFile', repo: repo, filePath: f.newFilePath, oldFilePath: f.oldFilePath !== f.newFilePath ? f.oldFilePath : null });
		else if (act === 'discard') {
			confirmBox({ title: 'Discard changes', message: 'Discard your changes to "' + f.newFilePath + '"? This cannot be undone.', confirm: 'Discard', danger: true }).then(function (ok) {
				if (!ok) return;
				pending.discardFile = 'Discarded changes to ' + f.newFilePath.substring(f.newFilePath.lastIndexOf('/') + 1);
				post({ command: 'discardFile', repo: repo, filePath: f.newFilePath });
			});
		}
	}

	function viewDiff(f) {
		var repo = currentRepo();
		if (repo === null) return;
		// Reuses the same combined HEAD-vs-working-tree diff the "Uncommitted Changes" row
		// already uses (fromHash: 'HEAD', toHash: UNCOMMITTED, i.e. '*') - an approximation
		// for staged files (which are really HEAD-vs-index), accepted as good enough for v1.
		post({ command: 'viewDiff', repo: repo, fromHash: 'HEAD', toHash: '*', oldFilePath: f.oldFilePath, newFilePath: f.newFilePath, type: f.type });
	}

	function refreshAll() {
		var repo = currentRepo();
		if (repo === null) return;
		post({ command: 'getUnstagedChanges', repo: repo });
		post({ command: 'getStagedChanges', repo: repo });
	}

	// Section visibility, counts, header actions and the commit button label follow the file lists.
	function updateState() {
		var u = files.unstaged, s = files.staged;
		if (u === null || s === null) return;
		var total = u.length + s.length;
		els.changeCount.textContent = total > 0 ? String(total) : '';
		els.clean.hidden = total > 0;
		els.unstagedSection.hidden = total === 0;
		els.stagedSection.hidden = total === 0;
		els.stageAllBtn.disabled = u.length === 0;
		els.discardAllBtn.disabled = u.length === 0;
		els.unstageAllBtn.disabled = s.length === 0;
		els.stashChangesBtn.disabled = total === 0;
		updateCommitButton();
	}

	function updateCommitButton() {
		var staged = (files.staged || []).length;
		var amend = els.amendCheckbox.checked;
		var push = els.pushCheckbox.checked;
		var label = amend ? 'Amend last commit' : staged > 0 ? 'Commit ' + plural(staged, 'file') : 'Commit';
		els.commitLabel.textContent = label + (push ? ' & push' : '');
		var busy = els.commitBusy === true;
		if (!els.aiBusy) els.aiBtn.disabled = staged === 0 && !amend;
		els.commitBtn.disabled = busy || (amend ? false : !(staged > 0 && els.summaryInput.value.trim() !== ''));
		els.commitBtn.title = busy ? 'Committing...' : amend ? 'Rewrite the last commit' + (staged > 0 ? ' with the staged changes' : '')
			: staged === 0 ? 'Stage some changes first' : els.summaryInput.value.trim() === '' ? 'Write a commit summary first' : 'Commit the staged changes (Ctrl+Enter)';
	}

	/* ---- AI commit message (Claude Code CLI) ---- */

	function setAiBusy(busy) {
		els.aiBusy = busy;
		els.aiBtn.classList.toggle('busy', busy);
		els.aiBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
		els.aiIcon.setAttribute('data-icon', busy ? 'circle-notch' : 'sparkle');
		els.aiIcon.removeAttribute('data-icon-done');
		if (window.GG && GG.hydrateIcons) GG.hydrateIcons(els.aiBtn);
		els.aiBtn.title = busy ? 'Claude is writing the message...' : 'Write the commit message with Claude Code (uses your staged changes)';
		[els.summaryInput, els.descriptionInput].forEach(function (el) { el.readOnly = busy; });
		if (busy) {
			els.summaryPlaceholder = els.summaryInput.placeholder;
			els.summaryInput.placeholder = 'Claude is writing…';
		} else if (els.summaryPlaceholder) {
			els.summaryInput.placeholder = els.summaryPlaceholder;
		}
	}

	// Types the text into the field quickly, so the result feels written rather than dropped in.
	function typeInto(el, text, done) {
		var i = 0, step = Math.max(1, Math.ceil(text.length / 36));
		el.value = '';
		if (text === '') { done(); return; }
		var timer = setInterval(function () {
			i = Math.min(text.length, i + step);
			el.value = text.substring(0, i);
			el.scrollTop = el.scrollHeight;
			if (i >= text.length) { clearInterval(timer); el.dispatchEvent(new Event('input')); done(); }
		}, 16);
	}

	function generateMessage() {
		var repo = currentRepo();
		if (repo === null || els.aiBusy) return;
		var amend = els.amendCheckbox.checked;
		if ((files.staged || []).length === 0 && !amend) {
			toast('Stage some changes first, then generate a message.', 'info');
			return;
		}
		var consented = false;
		try { consented = localStorage.getItem('ggAiConsent') === '1'; } catch (e) { /* storage unavailable */ }
		(consented ? Promise.resolve(true) : confirmBox({
			title: 'Write the message with Claude Code?',
			message: 'The diff of your staged changes is sent to Anthropic through your own Claude Code CLI (it must be installed and signed in). You will only be asked this once.',
			confirm: 'Continue'
		})).then(function (ok) {
			if (!ok) return;
			try { localStorage.setItem('ggAiConsent', '1'); } catch (e) { /* ignore */ }
			setAiBusy(true);
			post({ command: 'generateCommitMessage', repo: repo, amend: amend });
		});
	}

	function commit() {
		var repo = currentRepo();
		if (repo === null || els.commitBtn.disabled) return;
		els.commitBusy = true;
		els.commitPush = els.pushCheckbox.checked;
		els.commitAmend = els.amendCheckbox.checked;
		post({
			command: 'commitChanges', repo: repo,
			summary: els.summaryInput.value.trim(),
			description: els.descriptionInput.value.trim(),
			push: els.pushCheckbox.checked,
			amend: els.amendCheckbox.checked
		});
		updateCommitButton();
		els.commitLabel.textContent = els.commitPush ? 'Committing & pushing…' : 'Committing…';
	}

	/* ---- Stash tab ---- */

	function renderStashList() {
		els.stashCount.textContent = stashCache.length > 0 ? String(stashCache.length) : '';
		if (stashCache.length === 0) {
			els.stashList.innerHTML = '<li class="shEmpty"><i data-icon="stack"></i><b>No stashes</b><span>Stash your working copy changes to set them aside for later.</span></li>';
			return;
		}
		els.stashList.innerHTML = stashCache.map(function (s, i) {
			return '<li class="wcStashRow" data-index="' + i + '" title="' + escapeHtml(s.selector + ': ' + s.message) + '">' +
				'<i data-icon="stack"></i><span class="wcStashText"><span class="wcStashMessage">' + escapeHtml(s.message) + '</span>' +
				'<span class="wcStashMeta">' + escapeHtml(s.selector.replace(/^refs\//, '')) + '</span></span>' +
				'<span class="wcStashActions">' +
				'<button type="button" class="shIconBtn" data-action="apply" title="Apply stash (keep it)" aria-label="Apply stash"><i data-icon="download-simple"></i></button>' +
				'<button type="button" class="shIconBtn" data-action="pop" title="Pop stash (apply and remove)" aria-label="Pop stash"><i data-icon="arrow-u-up-left"></i></button>' +
				'<button type="button" class="shIconBtn danger" data-action="drop" title="Drop stash" aria-label="Drop stash"><i data-icon="trash"></i></button>' +
				'</span></li>';
		}).join('');
	}

	function onStashClick(e) {
		var btn = e.target.closest('button[data-action]');
		var row = e.target.closest('.wcStashRow');
		var repo = currentRepo();
		if (!btn || !row || repo === null) return;
		var stash = stashCache[parseInt(row.getAttribute('data-index'), 10)];
		var action = btn.getAttribute('data-action');
		if (action === 'apply') { pending.applyStash = 'Stash applied'; post({ command: 'applyStash', repo: repo, selector: stash.selector, reinstateIndex: false }); }
		else if (action === 'pop') { pending.popStash = 'Stash popped'; post({ command: 'popStash', repo: repo, selector: stash.selector, reinstateIndex: false }); }
		else if (action === 'drop') {
			confirmBox({ title: 'Drop stash', message: 'Drop "' + stash.message + '"? This cannot be undone.', confirm: 'Drop', danger: true }).then(function (ok) {
				if (!ok) return;
				pending.dropStash = 'Stash dropped';
				post({ command: 'dropStash', repo: repo, selector: stash.selector });
			});
		}
	}

	function setActiveTab(tab) {
		els.tabWorkingCopy.hidden = tab !== 'workingCopy';
		els.tabStash.hidden = tab !== 'stash';
		els.tabBtnWorkingCopy.classList.toggle('active', tab === 'workingCopy');
		els.tabBtnStash.classList.toggle('active', tab === 'stash');
		els.tabBtnWorkingCopy.setAttribute('aria-selected', String(tab === 'workingCopy'));
		els.tabBtnStash.setAttribute('aria-selected', String(tab === 'stash'));
	}

	// Success toast for an action started here (errors are shown by the main frontend's dialogs).
	function settle(command, error) {
		if (!(command in pending)) return;
		var text = pending[command];
		delete pending[command];
		if (!error) toast(text, 'success');
	}

	function init() {
		var $ = function (id) { return document.getElementById(id); };
		els.panel = $('wcPanel');
		els.tabBtnWorkingCopy = document.querySelector('.wcTab[data-tab="workingCopy"]');
		els.tabBtnStash = document.querySelector('.wcTab[data-tab="stash"]');
		els.tabWorkingCopy = $('wcTabWorkingCopy');
		els.tabStash = $('wcTabStash');
		els.unstagedList = $('wcUnstagedList');
		els.stagedList = $('wcStagedList');
		els.unstagedSection = $('wcUnstagedSection');
		els.stagedSection = $('wcStagedSection');
		els.clean = $('wcClean');
		els.changeCount = $('wcChangeCount');
		els.stashCount = $('wcStashCount');
		els.stashList = $('wcStashList');
		els.summaryInput = $('wcSummaryInput');
		els.descriptionInput = $('wcDescriptionInput');
		els.pushCheckbox = $('wcPushCheckbox');
		els.amendCheckbox = $('wcAmendCheckbox');
		els.commitBtn = $('wcCommitBtn');
		els.commitLabel = els.commitBtn.querySelector('span');
		els.aiBtn = $('wcAiBtn');
		els.aiIcon = els.aiBtn.querySelector('[data-icon]');
		els.stageAllBtn = $('wcStageAllBtn');
		els.unstageAllBtn = $('wcUnstageAllBtn');
		els.discardAllBtn = $('wcDiscardAllBtn');
		els.stashChangesBtn = $('wcStashChangesBtn');

		els.tabBtnWorkingCopy.addEventListener('click', function () { setActiveTab('workingCopy'); });
		els.tabBtnStash.addEventListener('click', function () { setActiveTab('stash'); });
		document.querySelector('.wcTabs').addEventListener('keydown', function (e) {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			var next = els.tabBtnWorkingCopy.classList.contains('active') ? 'stash' : 'workingCopy';
			setActiveTab(next);
			(next === 'stash' ? els.tabBtnStash : els.tabBtnWorkingCopy).focus();
		});

		['click', 'keydown'].forEach(function (type) {
			els.unstagedList.addEventListener(type, function (e) { onFileListEvent(e, 'unstaged'); });
			els.stagedList.addEventListener(type, function (e) { onFileListEvent(e, 'staged'); });
		});
		els.stashList.addEventListener('click', onStashClick);

		els.stageAllBtn.addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'stageAll', repo: repo });
		});
		els.unstageAllBtn.addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'unstageAll', repo: repo });
		});
		els.discardAllBtn.addEventListener('click', function () {
			var repo = currentRepo();
			if (repo === null) return;
			confirmBox({ title: 'Discard all changes', message: 'Discard ALL unstaged changes and delete untracked files? This cannot be undone.', confirm: 'Discard all', danger: true }).then(function (ok) {
				if (!ok) return;
				pending.discardAll = 'Discarded all unstaged changes';
				post({ command: 'discardAll', repo: repo });
			});
		});
		els.stashChangesBtn.addEventListener('click', function () {
			var repo = currentRepo();
			if (repo === null) return;
			pending.pushStash = 'Changes stashed';
			post({ command: 'pushStash', repo: repo, message: '', includeUntracked: true });
		});

		els.amendCheckbox.addEventListener('change', updateCommitButton);
		els.pushCheckbox.addEventListener('change', updateCommitButton);
		els.aiBtn.addEventListener('click', generateMessage);
		els.summaryInput.addEventListener('input', updateCommitButton);
		els.commitBtn.addEventListener('click', commit);
		[els.summaryInput, els.descriptionInput].forEach(function (el) {
			el.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
			});
		});

		window.addEventListener('message', function (event) {
			var msg = event.data;
			if (!msg || typeof msg.command !== 'string') return;
			switch (msg.command) {
				case 'loadRepoInfo':
					if (msg.stashes) {
						stashCache = msg.stashes;
						renderStashList();
					}
					refreshAll();
					break;
				case 'refresh':
					refreshAll();
					break;
				case 'getUnstagedChanges':
					files.unstaged = msg.files || [];
					renderFileList(files.unstaged, 'unstaged');
					updateState();
					break;
				case 'getStagedChanges':
					files.staged = msg.files || [];
					renderFileList(files.staged, 'staged');
					updateState();
					break;
				case 'generateCommitMessage':
					setAiBusy(false);
					if (msg.error) { toast(msg.error, 'error'); break; }
					typeInto(els.summaryInput, msg.summary, function () {
						typeInto(els.descriptionInput, msg.description, updateCommitButton);
					});
					break;
				case 'stageFile':
				case 'unstageFile':
				case 'stageAll':
				case 'unstageAll':
				case 'discardFile':
				case 'discardAll':
					if (msg.error) { delete pending[msg.command]; toast(msg.error, 'error'); }
					else settle(msg.command, null);
					refreshAll();
					break;
				case 'commitChanges':
					els.commitBusy = false;
					var errs = (msg.errors || []).filter(function (e) { return e !== null; });
					if (errs.length > 0) {
						toast(errs[0], 'error');
					} else {
						els.summaryInput.value = '';
						els.descriptionInput.value = '';
						els.amendCheckbox.checked = false;
						if (msg.pushSkippedReason) toast(msg.pushSkippedReason, 'info');
						else toast(els.commitAmend ? 'Amended the last commit' + (els.commitPush ? ' and pushed' : '') : 'Committed' + (els.commitPush ? ' and pushed' : ''), 'success');
					}
					updateCommitButton();
					refreshAll();
					break;
				case 'applyStash':
				case 'popStash':
				case 'dropStash':
				case 'pushStash':
					settle(msg.command, msg.error);
					break;
			}
		});

		var observer = new MutationObserver(function () {
			els.panel.hidden = document.getElementById('cdv') !== null;
		});
		observer.observe(document.body, { childList: true });

		setActiveTab('workingCopy');
		renderStashList();
		updateCommitButton();
		refreshAll();
	}

	window.addEventListener('load', init);
})();
