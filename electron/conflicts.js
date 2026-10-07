// Merge-conflict resolution: a banner at the top of the sidebar (#sbConflicts) listing
// conflicted files with Continue / Abort (/ Skip) for the in-progress operation, and a full-window
// editor overlay per file (ours | theirs per hunk, plus an editable output). Isolated from
// media/out.min.js like panel.js/sidebar.js (own API handle + listener, no getState/setState).
(function () {
	'use strict';

	var api = window.acquireHostApi();
	var state = { operation: null, files: [] };
	var editor = null; // { repo, filePath, eol, segments, manual }
	var els = {};
	var lastBlockHtml = null;
	var lastOp = null;

	function post(msg) { api.postMessage(msg); }
	function currentRepo() { return (window.gitGraph && window.gitGraph.currentRepo) || null; }
	function toast(text, kind) { if (window.GG && GG.toast) GG.toast(text, kind); }
	function confirmBox(opts) { return window.GG && GG.confirm ? GG.confirm(opts) : Promise.resolve(window.confirm(opts.message || opts.title)); }
	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function poll() {
		var repo = currentRepo();
		if (repo !== null) post({ command: 'getConflicts', repo: repo });
	}

	/* ---------- sidebar banner ---------- */

	var OP_LABEL = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert', resolve: 'Conflict resolution' };

	function renderBlock() {
		if (state.operation === null) {
			els.block.hidden = true;
			els.block.innerHTML = '';
			lastBlockHtml = null;
			return;
		}
		var op = state.operation;
		var n = state.files.length;
		var html =
			'<div class="cfTitle"><i data-icon="warning"></i>' + esc(OP_LABEL[op] || op) + ' in progress</div>' +
			'<div class="cfSub">' + (n === 0 ? 'All conflicts resolved - continue to finish.' : n + ' conflicted file' + (n === 1 ? '' : 's') + '. Click one to resolve it.') + '</div>' +
			(n > 0 ? '<ul class="cfList">' + state.files.map(function (f, i) {
				return '<li class="cfFile" tabindex="0" role="button" data-index="' + i + '" title="Resolve ' + esc(f) + '"><i data-icon="file-text"></i><span class="shPath"><span class="base">' + esc(f) + '</span></span></li>';
			}).join('') + '</ul>' : '') +
			'<div class="cfButtons">' +
			'<button type="button" class="btn btn-primary btn-sm" data-act="continue"' + (n > 0 ? ' disabled title="Resolve all conflicts first"' : ' title="Commit the resolution and continue the ' + esc(op) + '"') + '>Continue</button>' +
			(op === 'rebase' || op === 'cherry-pick' || op === 'revert' ? '<button type="button" class="btn btn-secondary btn-sm" data-act="skip" title="Skip this commit">Skip</button>' : '') +
			'<button type="button" class="btn btn-danger btn-sm" data-act="abort" title="Abort the ' + esc(op) + ' and restore the previous state">Abort</button></div>' +
			'<div class="cfMessage" id="cfMessage"></div>';
		els.block.hidden = false;
		if (html === lastBlockHtml) return; // polled every few seconds: keep focus / hover stable
		lastBlockHtml = html;
		els.block.innerHTML = html;
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

	var CHOICES = [['ours', 'Ours'], ['theirs', 'Theirs'], ['both', 'Both', 'Ours first, then theirs'], ['both-rev', 'Both (reversed)', 'Theirs first, then ours'], ['none', 'Neither']];

	function hunkHtml(seg, idx) {
		function pane(kind, label, lines) {
			return '<div class="cfPane cf' + kind + '"><div class="cfPaneTitle"><span class="shKicker">' + kind + '</span><span class="text-muted" style="font-size:12px">' + esc(label) + '</span></div>' +
				'<pre>' + (lines.length ? esc(lines.join('\n')) : '<i>(empty)</i>') + '</pre></div>';
		}
		var seg$ = '<div class="seg" role="radiogroup" aria-label="Resolution for conflict ' + (idx + 1) + '">' + CHOICES.map(function (c) {
			return '<label class="seg-opt"' + (c[2] ? ' title="' + c[2] + '"' : '') + '><input type="radio" name="cfHunk' + idx + '" data-hunk="' + idx + '" value="' + c[0] + '"' + (seg.choice === c[0] ? ' checked' : '') + '>' + c[1] + '</label>';
		}).join('') + '</div>';
		return '<div class="cfHunk' + (seg.choice === null ? ' cfOpen' : '') + '">' +
			'<div class="cfHunkHead"><b>Conflict ' + (idx + 1) + '</b>' +
			(seg.choice === null ? '<span class="tag tag-warning">Unresolved</span>' : '<span class="tag tag-success">Resolved</span>') + seg$ + '</div>' +
			'<div class="cfPanes">' + pane('Ours', seg.oursLabel, seg.ours) + pane('Theirs', seg.theirsLabel, seg.theirs) + '</div></div>';
	}

	function refreshEditorStatus() {
		var total = conflictSegments().length;
		var left = unresolvedCount();
		var st = document.getElementById('cfStatus');
		st.className = total === 0 ? '' : 'tag ' + (left === 0 ? 'tag-success' : 'tag-warning');
		st.textContent = total === 0 ? '' : left === 0 ? 'All resolved' : left + ' of ' + total + ' unresolved';
	}

	function setTitle(filePath) {
		var i = filePath.lastIndexOf('/');
		document.getElementById('cfEditorTitle').innerHTML = (i === -1 ? '' : '<span class="dir">' + esc(filePath.substring(0, i + 1)) + '</span>') + esc(filePath.substring(i + 1));
		document.getElementById('cfEditorTitle').title = filePath;
	}

	function renderEditor() {
		var hunks = conflictSegments();
		var body = document.getElementById('cfEditorBody');
		var scroll = body.querySelector('.cfHunks') ? body.querySelector('.cfHunks').scrollTop : 0;
		setTitle(editor.filePath);
		body.innerHTML = '<div class="cfHunks">' + (hunks.length ? hunks.map(hunkHtml).join('')
			: '<div class="cfNote">No conflict markers found in this file (for example a modify/delete or binary conflict). Use <b>Whole file: Use ours / Use theirs</b> above, or edit the output below.</div>') + '</div>' +
			'<div class="cfOutputWrap"><span class="shKicker">Output (editable)</span><textarea id="cfOutput" spellcheck="false" aria-label="Resolved output"></textarea></div>';
		body.querySelector('.cfHunks').scrollTop = scroll;
		var out = document.getElementById('cfOutput');
		out.value = buildOutput();
		out.addEventListener('input', function () { editor.manual = true; });
		refreshEditorStatus();
	}

	function openEditor(filePath) {
		var repo = currentRepo();
		if (repo === null) return;
		editor = { repo: repo, filePath: filePath, eol: '\n', segments: [], manual: false, opener: document.activeElement };
		els.overlay.style.display = 'flex';
		setTitle(filePath);
		document.getElementById('cfStatus').textContent = '';
		document.getElementById('cfStatus').className = '';
		document.getElementById('cfEditorBody').innerHTML = '<div class="shSkel" style="padding:16px"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
		document.getElementById('cfSaveBtn').focus();
		post({ command: 'getConflictFile', repo: repo, filePath: filePath });
	}

	function closeEditor() {
		var opener = editor && editor.opener;
		editor = null;
		els.overlay.style.display = 'none';
		if (opener && document.body.contains(opener)) opener.focus();
	}

	function saveEditor() {
		var out = document.getElementById('cfOutput');
		if (!editor || !out) return;
		var text = out.value;
		var hasMarkers = /^(<<<<<<<|=======$|>>>>>>>)/m.test(text);
		(hasMarkers ? confirmBox({ title: 'Conflict markers left', message: 'The output still contains conflict markers. Save it and mark the file resolved anyway?', confirm: 'Save anyway' }) : Promise.resolve(true)).then(function (ok) {
			if (!ok || !editor) return;
			post({
				command: 'saveConflictFile', repo: editor.repo, filePath: editor.filePath,
				content: editor.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text
			});
		});
	}

	function takeSide(side) {
		if (!editor) return;
		confirmBox({ title: 'Use ' + (side === 'ours' ? 'our' : 'their') + ' version', message: 'Resolve the whole of "' + editor.filePath + '" with ' + (side === 'ours' ? 'our' : 'their') + ' version?', confirm: 'Use ' + side }).then(function (ok) {
			if (ok && editor) post({ command: 'resolveConflictSide', repo: editor.repo, filePath: editor.filePath, side: side });
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
			var op = state.operation;
			if (repo === null || op === null) return;
			(act === 'abort' ? confirmBox({ title: 'Abort ' + (OP_LABEL[op] || op).toLowerCase(), message: 'Abort the ' + op + ' and discard its progress?', confirm: 'Abort', danger: true }) : Promise.resolve(true)).then(function (ok) {
				if (!ok) return;
				lastOp = op;
				post({ command: 'conflictOperation', repo: repo, operation: op, action: act });
			});
		});
		els.block.addEventListener('keydown', function (e) {
			if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cfFile')) { e.preventDefault(); e.target.click(); }
		});

		document.getElementById('cfCloseBtn').addEventListener('click', closeEditor);
		document.getElementById('cfSaveBtn').addEventListener('click', saveEditor);
		document.getElementById('cfTakeOursBtn').addEventListener('click', function () { takeSide('ours'); });
		document.getElementById('cfTakeTheirsBtn').addEventListener('click', function () { takeSide('theirs'); });
		document.getElementById('cfEditorBody').addEventListener('change', function (e) {
			var input = e.target.closest('input[data-hunk]');
			if (!input || !editor) return;
			var seg = conflictSegments()[parseInt(input.getAttribute('data-hunk'), 10)];
			(editor.manual ? confirmBox({ title: 'Replace your edits?', message: 'Choosing a side rebuilds the output and replaces your manual edits.', confirm: 'Replace' }) : Promise.resolve(true)).then(function (ok) {
				if (!editor) return;
				if (ok) { seg.choice = input.value; editor.manual = false; }
				renderEditor();
			});
		});
		document.addEventListener('keydown', function (e) {
			if (!editor) return;
			if (e.key === 'Escape') closeEditor();
			else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); }
		});

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
					if (msg.error) { toast('Unable to resolve the file\n' + msg.error, 'error'); return; }
					toast('Marked ' + msg.filePath + ' as resolved', 'success');
					closeEditor();
					poll();
					if (window.gitGraph) window.gitGraph.refresh(false);
					break;
				case 'conflictOperation':
					if (msg.error) { showBlockMessage(msg.error); toast('Unable to ' + msg.action + '\n' + msg.error, 'error'); }
					else toast(msg.action === 'skip' ? 'Skipped the commit' : (OP_LABEL[lastOp] || 'Operation') + (msg.action === 'abort' ? ' aborted' : lastOp === 'rebase' ? ' continued' : ' completed'), 'success');
					poll();
					if (window.gitGraph) window.gitGraph.refresh(false);
					break;
			}
		});

		// Conflicts are created by operations that fail from the main frontend's point of view
		// (so it never refreshes), hence the light polling + focus check.
		setInterval(function () { if (!document.hidden) poll(); }, 4000);
		window.addEventListener('focus', poll);
		setTimeout(poll, 1500);
	}

	window.addEventListener('load', init);
})();
