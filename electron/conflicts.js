// Merge-conflict resolution: a status block at the top of the sidebar (#sbConflicts) listing
// conflicted files with Continue/Abort(/Skip) for the in-progress operation, and a full-window
// 3-pane-style editor overlay (ours | theirs | editable output) per file. Isolated from
// media/out.min.js like panel.js/sidebar.js (own API handle + listener, no getState/setState).
(function () {
	'use strict';

	var api = window.acquireHostApi();
	var state = { operation: null, files: [] };
	var editor = null; // { repo, filePath, eol, segments, manual }
	var els = {};
	var pollTimer = null;

	function post(msg) { api.postMessage(msg); }
	function currentRepo() { return (window.gitGraph && window.gitGraph.currentRepo) || null; }
	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function poll() {
		var repo = currentRepo();
		if (repo !== null) post({ command: 'getConflicts', repo: repo });
	}

	/* ---------- sidebar block ---------- */

	var OP_LABEL = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };

	function renderBlock() {
		if (state.operation === null) {
			els.block.style.display = 'none';
			els.block.innerHTML = '';
			return;
		}
		var op = state.operation;
		var n = state.files.length;
		els.block.style.display = '';
		els.block.innerHTML =
			'<div class="cfTitle">&#9888; ' + esc(OP_LABEL[op]) + ' in progress</div>' +
			'<div class="cfSub">' + (n === 0 ? 'All conflicts resolved.' : n + ' conflicted file' + (n === 1 ? '' : 's') + ':') + '</div>' +
			'<ul class="cfList">' + state.files.map(function (f, i) {
				return '<li class="cfFile" data-index="' + i + '" title="Click to resolve: ' + esc(f) + '">' + esc(f) + '</li>';
			}).join('') + '</ul>' +
			'<div class="cfButtons">' +
			'<button type="button" class="wcSmallBtn" data-act="continue"' + (n > 0 ? ' disabled title="Resolve all conflicts first"' : '') + '>Continue</button>' +
			(op === 'rebase' ? '<button type="button" class="wcSmallBtn" data-act="skip">Skip</button>' : '') +
			'<button type="button" class="wcSmallBtn" data-act="abort">Abort</button></div>' +
			'<div class="cfMessage" id="cfMessage"></div>';
	}

	function showBlockMessage(text) {
		var m = document.getElementById('cfMessage');
		if (m) m.textContent = text;
	}

	/* ---------- parsing / building ---------- */

	function parseConflicts(content) {
		var eol = content.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
		var lines = content.split(/\r?\n/);
		var segments = [];
		var text = [];
		var i = 0;
		function flush() { if (text.length) { segments.push({ type: 'text', lines: text }); text = []; } }
		while (i < lines.length) {
			var m = /^<<<<<<<(?: (.*))?$/.exec(lines[i]);
			if (!m) { text.push(lines[i]); i++; continue; }
			var seg = { type: 'conflict', oursLabel: m[1] || 'ours', theirsLabel: 'theirs', ours: [], base: null, theirs: [], choice: null };
			var j = i + 1, part = 'ours', closed = false;
			for (; j < lines.length; j++) {
				var l = lines[j];
				if (/^\|\|\|\|\|\|\|/.test(l)) { part = 'base'; seg.base = []; continue; }
				if (l === '=======' && part !== 'theirs') { part = 'theirs'; continue; }
				var e = /^>>>>>>>(?: (.*))?$/.exec(l);
				if (e && part === 'theirs') { seg.theirsLabel = e[1] || 'theirs'; closed = true; break; }
				seg[part].push(l);
			}
			if (!closed) { text.push(lines[i]); i++; continue; } // malformed: keep literally
			flush();
			segments.push(seg);
			i = j + 1;
		}
		flush();
		return { eol: eol, segments: segments };
	}

	function segmentOutput(seg) {
		if (seg.type === 'text') return seg.lines;
		switch (seg.choice) {
			case 'ours': return seg.ours;
			case 'theirs': return seg.theirs;
			case 'both': return seg.ours.concat(seg.theirs);
			case 'both-rev': return seg.theirs.concat(seg.ours);
			case 'none': return [];
			default: // unresolved: keep markers
				return ['<<<<<<< ' + seg.oursLabel].concat(seg.ours,
					seg.base !== null ? ['||||||| base'].concat(seg.base) : [], ['======='], seg.theirs, ['>>>>>>> ' + seg.theirsLabel]);
		}
	}

	function buildOutput() {
		var out = [];
		editor.segments.forEach(function (s) { out = out.concat(segmentOutput(s)); });
		return out.join('\n');
	}

	function conflictSegments() { return editor.segments.filter(function (s) { return s.type === 'conflict'; }); }
	function unresolvedCount() { return conflictSegments().filter(function (s) { return s.choice === null; }).length; }

	/* ---------- overlay editor ---------- */

	function hunkHtml(seg, idx) {
		function pane(title, lines, cls) {
			return '<div class="cfPane ' + cls + '"><div class="cfPaneTitle">' + esc(title) + '</div><pre>' + (lines.length ? esc(lines.join('\n')) : '<i>(empty)</i>') + '</pre></div>';
		}
		function btn(choice, label) {
			return '<button type="button" class="wcSmallBtn' + (seg.choice === choice ? ' cfActive' : '') + '" data-hunk="' + idx + '" data-choice="' + choice + '">' + label + '</button>';
		}
		return '<div class="cfHunk' + (seg.choice === null ? ' cfOpen' : '') + '">' +
			'<div class="cfHunkHead">Conflict ' + (idx + 1) + '<span class="cfChoices">' +
			btn('ours', 'Use ours') + btn('theirs', 'Use theirs') + btn('both', 'Both (ours first)') + btn('both-rev', 'Both (theirs first)') + btn('none', 'Neither') +
			'</span></div><div class="cfPanes">' +
			pane('Ours: ' + seg.oursLabel, seg.ours, 'cfOurs') + pane('Theirs: ' + seg.theirsLabel, seg.theirs, 'cfTheirs') +
			'</div></div>';
	}

	function refreshEditorStatus() {
		var left = unresolvedCount();
		document.getElementById('cfStatus').textContent = left === 0 ? 'All conflicts in this file resolved.' : left + ' conflict(s) still unresolved.';
	}

	function renderEditor() {
		var hunks = conflictSegments();
		var body = document.getElementById('cfEditorBody');
		document.getElementById('cfEditorTitle').textContent = editor.filePath;
		body.innerHTML = '<div class="cfHunks">' + (hunks.length ? hunks.map(hunkHtml).join('') : '<div class="cfNote">No conflict markers found in this file (e.g. modify/delete or binary conflict). Pick a side for the whole file:</div>') + '</div>' +
			'<div class="cfOutputWrap"><div class="cfPaneTitle">Output (editable)</div><textarea id="cfOutput" spellcheck="false"></textarea></div>';
		var out = document.getElementById('cfOutput');
		out.value = buildOutput();
		out.addEventListener('input', function () { editor.manual = true; });
		refreshEditorStatus();
	}

	function openEditor(filePath) {
		var repo = currentRepo();
		if (repo === null) return;
		editor = { repo: repo, filePath: filePath, eol: '\n', segments: [], manual: false };
		els.overlay.style.display = 'flex';
		document.getElementById('cfEditorTitle').textContent = filePath;
		document.getElementById('cfEditorBody').innerHTML = '<div class="cfNote">Loading...</div>';
		post({ command: 'getConflictFile', repo: repo, filePath: filePath });
	}

	function closeEditor() {
		editor = null;
		els.overlay.style.display = 'none';
	}

	function saveEditor() {
		var out = document.getElementById('cfOutput');
		if (!editor || !out) return;
		var text = out.value;
		if (/^(<<<<<<<|=======$|>>>>>>>)/m.test(text) &&
			!window.confirm('The output still contains conflict markers. Save and mark resolved anyway?')) return;
		post({
			command: 'saveConflictFile', repo: editor.repo, filePath: editor.filePath,
			content: editor.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text
		});
	}

	function init() {
		els.block = document.getElementById('sbConflicts');
		els.overlay = document.getElementById('cfOverlay');

		els.block.addEventListener('click', function (e) {
			var file = e.target.closest('.cfFile');
			if (file) { openEditor(state.files[parseInt(file.getAttribute('data-index'), 10)]); return; }
			var btn = e.target.closest('button[data-act]');
			if (!btn || btn.disabled) return;
			var repo = currentRepo();
			var act = btn.getAttribute('data-act');
			if (repo === null || state.operation === null) return;
			if (act === 'abort' && !window.confirm('Abort the ' + state.operation + ' and discard its progress?')) return;
			post({ command: 'conflictOperation', repo: repo, operation: state.operation, action: act });
		});

		document.getElementById('cfCloseBtn').addEventListener('click', closeEditor);
		document.getElementById('cfSaveBtn').addEventListener('click', saveEditor);
		document.getElementById('cfTakeOursBtn').addEventListener('click', function () {
			if (editor && window.confirm('Take OUR version of the whole file?')) post({ command: 'resolveConflictSide', repo: editor.repo, filePath: editor.filePath, side: 'ours' });
		});
		document.getElementById('cfTakeTheirsBtn').addEventListener('click', function () {
			if (editor && window.confirm('Take THEIR version of the whole file?')) post({ command: 'resolveConflictSide', repo: editor.repo, filePath: editor.filePath, side: 'theirs' });
		});
		document.getElementById('cfEditorBody').addEventListener('click', function (e) {
			var btn = e.target.closest('button[data-hunk]');
			if (!btn || !editor) return;
			if (editor.manual && !window.confirm('This replaces your manual edits to the output. Continue?')) return;
			var seg = conflictSegments()[parseInt(btn.getAttribute('data-hunk'), 10)];
			seg.choice = btn.getAttribute('data-choice');
			editor.manual = false;
			renderEditor();
		});
		document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && editor) closeEditor(); });

		window.addEventListener('message', function (event) {
			var msg = event.data;
			if (!msg || typeof msg.command !== 'string') return;
			switch (msg.command) {
				case 'loadRepoInfo':
				case 'refresh':
					poll();
					break;
				case 'getConflicts':
					if (msg.error) return;
					state.operation = msg.operation;
					state.files = msg.files || [];
					renderBlock();
					if (editor && state.files.indexOf(editor.filePath) === -1 && state.operation === null) closeEditor();
					break;
				case 'getConflictFile':
					if (!editor || msg.filePath !== editor.filePath) return;
					if (msg.error) { document.getElementById('cfEditorBody').innerHTML = '<div class="cfNote cfErr">' + esc(msg.error) + '</div>'; return; }
					var parsed = parseConflicts(msg.content === null ? '' : msg.content);
					editor.eol = parsed.eol;
					editor.segments = parsed.segments;
					renderEditor();
					break;
				case 'saveConflictFile':
				case 'resolveConflictSide':
					if (msg.error) { window.alert('Unable to resolve file: ' + msg.error); return; }
					closeEditor();
					poll();
					if (window.gitGraph) window.gitGraph.refresh(false);
					break;
				case 'conflictOperation':
					if (msg.error) { showBlockMessage(msg.error); window.alert('Unable to ' + msg.action + ': ' + msg.error); }
					poll();
					if (window.gitGraph) window.gitGraph.refresh(false);
					break;
			}
		});

		// Conflicts are created by operations that fail from the main frontend's point of view
		// (so it never refreshes), hence the light polling + focus check.
		pollTimer = setInterval(function () { if (!document.hidden) poll(); }, 4000);
		window.addEventListener('focus', poll);
		setTimeout(poll, 1500);
	}

	window.addEventListener('load', init);
})();
