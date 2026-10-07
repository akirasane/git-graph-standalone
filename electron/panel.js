// Working Copy panel (stage/unstage/commit + stash tab). Deliberately isolated from
// media/out.min.js (the verbatim-reused VSCode extension frontend) - see
// electron/src/dataSource.ts and the plan this was built from for the full rationale.
//
// Talks to the same Electron IPC surface the rest of the app uses: a second call to
// window.acquireVsCodeApi() (electron/src/preload.ts returns a fresh postMessage-only
// object per call) and its own 'message' listener alongside out.min.js's. This script
// must NEVER call getState()/setState() on its API object - that state is shared with
// GitGraphView and calling them would clobber its persisted view state.
(function () {
	'use strict';

	var api = window.acquireVsCodeApi();
	var stashCache = [];
	var els = {};

	function post(msg) {
		api.postMessage(msg);
	}

	function currentRepo() {
		return (window.gitGraph && window.gitGraph.currentRepo) || null;
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function fileName(filePath) {
		var i = filePath.lastIndexOf('/');
		return i === -1 ? filePath : filePath.substring(i + 1);
	}

	function renderFileList(container, files, actionIcon, actionTitle, onAction, onDiscard) {
		if (files.length === 0) {
			container.innerHTML = '<li class="wcEmpty">No changes</li>';
			return;
		}
		var html = '';
		for (var i = 0; i < files.length; i++) {
			var f = files[i];
			var hasStats = f.additions !== null && f.deletions !== null;
			html += '<li class="wcFileRow" data-index="' + i + '">' +
				'<span class="wcFileName" title="' + escapeHtml(f.newFilePath) + '">' + escapeHtml(fileName(f.newFilePath)) + '</span>' +
				(hasStats ? '<span class="wcFileStats"><span class="wcAdd">+' + f.additions + '</span><span class="wcDel">-' + f.deletions + '</span></span>' : '') +
				(onDiscard ? '<button type="button" class="wcFileAction wcDiscard" data-index="' + i + '" title="Discard Changes">↶</button>' : '') +
				'<button type="button" class="wcFileAction" data-index="' + i + '" title="' + actionTitle + '">' + actionIcon + '</button>' +
				'</li>';
		}
		container.innerHTML = html;
		Array.prototype.forEach.call(container.querySelectorAll('.wcFileAction'), function (btn) {
			btn.addEventListener('click', function (e) {
				e.stopPropagation();
				var f = files[parseInt(btn.dataset.index, 10)];
				if (btn.classList.contains('wcDiscard')) onDiscard(f); else onAction(f);
			});
		});
		Array.prototype.forEach.call(container.querySelectorAll('.wcFileRow'), function (row) {
			row.addEventListener('click', function () {
				viewDiff(files[parseInt(row.dataset.index, 10)]);
			});
		});
	}

	function viewDiff(f) {
		var repo = currentRepo();
		if (repo === null) return;
		// Reuses the same combined HEAD-vs-working-tree diff the "Uncommitted Changes" row
		// already uses (fromHash: 'HEAD', toHash: UNCOMMITTED, i.e. '*') - an approximation
		// for staged files (which are really HEAD-vs-index), accepted as good enough for v1.
		post({ command: 'viewDiff', repo: repo, fromHash: 'HEAD', toHash: '*', oldFilePath: f.oldFilePath, newFilePath: f.newFilePath, type: f.type });
	}

	function refreshUnstaged() {
		var repo = currentRepo();
		if (repo !== null) post({ command: 'getUnstagedChanges', repo: repo });
	}

	function refreshStaged() {
		var repo = currentRepo();
		if (repo !== null) post({ command: 'getStagedChanges', repo: repo });
	}

	function refreshAll() {
		refreshUnstaged();
		refreshStaged();
	}

	function updateCommitButton() {
		var amend = els.amendCheckbox && els.amendCheckbox.checked;
		els.commitBtn.disabled = amend ? false : !(els.stagedCount > 0 && els.summaryInput.value.trim() !== '');
	}

	function showMessage(text, isError) {
		els.messageArea.textContent = text;
		els.messageArea.className = 'wcMessage' + (isError ? ' wcError' : '');
		clearTimeout(els.messageTimer);
		els.messageTimer = setTimeout(function () { els.messageArea.textContent = ''; }, 6000);
	}

	function renderStashList() {
		if (stashCache.length === 0) {
			els.stashList.innerHTML = '<li class="wcEmpty">No stashes</li>';
			return;
		}
		var html = '';
		for (var i = 0; i < stashCache.length; i++) {
			var s = stashCache[i];
			html += '<li class="wcStashRow" data-index="' + i + '">' +
				'<span class="wcStashMessage" title="' + escapeHtml(s.message) + '">' + escapeHtml(s.message) + '</span>' +
				'<span class="wcStashActions">' +
				'<button type="button" class="wcSmallBtn" data-action="apply" data-index="' + i + '" title="Apply Stash">Apply</button>' +
				'<button type="button" class="wcSmallBtn" data-action="pop" data-index="' + i + '" title="Pop Stash">Pop</button>' +
				'<button type="button" class="wcSmallBtn" data-action="drop" data-index="' + i + '" title="Drop Stash">Drop</button>' +
				'</span></li>';
		}
		els.stashList.innerHTML = html;
		Array.prototype.forEach.call(els.stashList.querySelectorAll('button'), function (btn) {
			btn.addEventListener('click', function () {
				var repo = currentRepo();
				if (repo === null) return;
				var stash = stashCache[parseInt(btn.dataset.index, 10)];
				var action = btn.dataset.action;
				if (action === 'apply') post({ command: 'applyStash', repo: repo, selector: stash.selector, reinstateIndex: false });
				else if (action === 'pop') post({ command: 'popStash', repo: repo, selector: stash.selector, reinstateIndex: false });
				else if (action === 'drop') post({ command: 'dropStash', repo: repo, selector: stash.selector });
			});
		});
	}

	function setActiveTab(tab) {
		els.tabWorkingCopy.style.display = tab === 'workingCopy' ? '' : 'none';
		els.tabStash.style.display = tab === 'stash' ? '' : 'none';
		els.tabBtnWorkingCopy.classList.toggle('active', tab === 'workingCopy');
		els.tabBtnStash.classList.toggle('active', tab === 'stash');
	}

	function init() {
		els.panel = document.getElementById('wcPanel');
		els.tabBtnWorkingCopy = document.querySelector('.wcTab[data-tab="workingCopy"]');
		els.tabBtnStash = document.querySelector('.wcTab[data-tab="stash"]');
		els.tabWorkingCopy = document.getElementById('wcTabWorkingCopy');
		els.tabStash = document.getElementById('wcTabStash');
		els.unstagedList = document.getElementById('wcUnstagedList');
		els.stagedList = document.getElementById('wcStagedList');
		els.stashList = document.getElementById('wcStashList');
		els.summaryInput = document.getElementById('wcSummaryInput');
		els.descriptionInput = document.getElementById('wcDescriptionInput');
		els.pushCheckbox = document.getElementById('wcPushCheckbox');
		els.commitBtn = document.getElementById('wcCommitBtn');
		els.messageArea = document.getElementById('wcCommitMessageArea');
		els.stagedCount = 0;

		els.tabBtnWorkingCopy.addEventListener('click', function () { setActiveTab('workingCopy'); });
		els.tabBtnStash.addEventListener('click', function () { setActiveTab('stash'); });

		document.getElementById('wcStageAllBtn').addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'stageAll', repo: repo });
		});
		document.getElementById('wcUnstageAllBtn').addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'unstageAll', repo: repo });
		});
		document.getElementById('wcStashChangesBtn').addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null) post({ command: 'pushStash', repo: repo, message: '', includeUntracked: true });
		});
		els.amendCheckbox = document.getElementById('wcAmendCheckbox');
		els.amendCheckbox.addEventListener('change', updateCommitButton);
		document.getElementById('wcDiscardAllBtn').addEventListener('click', function () {
			var repo = currentRepo();
			if (repo !== null && window.confirm('Discard ALL unstaged changes and delete untracked files? This cannot be undone.')) {
				post({ command: 'discardAll', repo: repo });
			}
		});
		els.summaryInput.addEventListener('input', updateCommitButton);
		els.commitBtn.addEventListener('click', function () {
			var repo = currentRepo();
			if (repo === null) return;
			post({
				command: 'commitChanges', repo: repo,
				summary: els.summaryInput.value.trim(),
				description: els.descriptionInput.value.trim(),
				push: els.pushCheckbox.checked,
				amend: els.amendCheckbox.checked
			});
			els.commitBtn.disabled = true;
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
					renderFileList(els.unstagedList, msg.files || [], '+', 'Stage File', function (f) {
						var repo = currentRepo();
						if (repo !== null) post({ command: 'stageFile', repo: repo, filePath: f.newFilePath });
					}, function (f) {
						var repo = currentRepo();
						if (repo !== null && window.confirm('Discard changes to "' + f.newFilePath + '"? This cannot be undone.')) {
							post({ command: 'discardFile', repo: repo, filePath: f.newFilePath });
						}
					});
					break;
				case 'getStagedChanges':
					els.stagedCount = (msg.files || []).length;
					renderFileList(els.stagedList, msg.files || [], '−', 'Unstage File', function (f) {
						var repo = currentRepo();
						if (repo !== null) post({ command: 'unstageFile', repo: repo, filePath: f.newFilePath, oldFilePath: f.oldFilePath !== f.newFilePath ? f.oldFilePath : null });
					});
					updateCommitButton();
					break;
				case 'stageFile':
				case 'unstageFile':
				case 'stageAll':
				case 'unstageAll':
				case 'discardFile':
				case 'discardAll':
					if (msg.error) showMessage(msg.error, true);
					refreshAll();
					break;
				case 'commitChanges':
					var errs = (msg.errors || []).filter(function (e) { return e !== null; });
					if (errs.length > 0) {
						showMessage(errs[0], true);
					} else {
						els.summaryInput.value = '';
						els.descriptionInput.value = '';
						els.amendCheckbox.checked = false;
						showMessage(msg.pushSkippedReason || 'Committed successfully.', false);
					}
					updateCommitButton();
					refreshAll();
					break;
				case 'applyStash':
				case 'popStash':
				case 'dropStash':
				case 'pushStash':
					if (msg.error) showMessage(msg.error, true);
					break;
			}
		});

		var observer = new MutationObserver(function () {
			var cdv = document.getElementById('cdv');
			els.panel.style.display = cdv !== null ? 'none' : 'flex';
		});
		observer.observe(document.body, { childList: true });
		els.panel.style.display = 'flex';

		setActiveTab('workingCopy');
		refreshAll();
	}

	window.addEventListener('load', init);
})();
