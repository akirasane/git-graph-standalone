// Diff / file viewer window (electron/src/diffWindow.ts): Monaco with a Nocturne theme whose colours
// are read from the design tokens (added / removed = --color-success / --color-danger tints).
(function () {
	'use strict';
	var ui = window.uiWindow;
	var init = ui.init;
	var d = init.data;
	var $ = function (id) { return document.getElementById(id); };
	document.title = init.title;

	// Room for the native window controls drawn over the title bar.
	(function reserve() {
		var wco = navigator.windowControlsOverlay, left = 0, right = 0;
		if (wco && wco.visible) { var r = wco.getTitlebarAreaRect(); left = r.x; right = Math.max(0, window.innerWidth - r.x - r.width); }
		if (!left && !right) { if (init.platform === 'darwin') left = 72; else right = 138; }
		document.documentElement.style.setProperty('--gg-wco-left', left + 'px');
		document.documentElement.style.setProperty('--gg-wco-right', right + 'px');
		if (wco) wco.addEventListener('geometrychange', reserve, { once: true });
	})();

	$('file').textContent = d.fileName;
	$('path').textContent = d.dir ? d.dir + '/' : '';
	$('path').title = d.filePath;
	$('desc').textContent = d.description;

	/** Resolve any CSS colour (incl. color-mix of tokens) to #rrggbbaa via a 1px canvas. */
	var probe = document.createElement('span');
	document.body.appendChild(probe);
	var ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	function hex(cssColor) {
		probe.style.color = cssColor;
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = getComputedStyle(probe).color;
		ctx.fillRect(0, 0, 1, 1);
		var p = ctx.getImageData(0, 0, 1, 1).data;
		return '#' + [p[0], p[1], p[2], p[3]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
	}
	var mix = function (token, pct) { return hex('color-mix(in srgb, var(' + token + ') ' + pct + '%, transparent)'); };
	var solid = function (token) { return hex('var(' + token + ')').slice(0, 7); };

	require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
	require(['vs/editor/editor.main'], function () {
		var c = function (t) { return solid(t).slice(1); };
		monaco.editor.defineTheme('nocturne', {
			base: 'vs-dark',
			inherit: true,
			rules: [
				{ token: '', foreground: c('--color-text') },
				{ token: 'comment', foreground: c('--color-neutral-500'), fontStyle: 'italic' },
				{ token: 'keyword', foreground: c('--color-accent-400') },
				{ token: 'string', foreground: c('--color-success') },
				{ token: 'number', foreground: c('--color-warning') },
				{ token: 'regexp', foreground: c('--color-warning') },
				{ token: 'type', foreground: c('--color-accent-2-400') },
				{ token: 'tag', foreground: c('--color-accent-400') },
				{ token: 'attribute.name', foreground: c('--color-accent-2-400') },
				{ token: 'delimiter', foreground: c('--color-neutral-400') }
			],
			colors: {
				'editor.background': solid('--color-bg'),
				'editor.foreground': solid('--color-text'),
				'editorLineNumber.foreground': mix('--color-text', 30),
				'editorLineNumber.activeForeground': mix('--color-text', 60),
				'editor.lineHighlightBackground': mix('--color-text', 4),
				'editor.lineHighlightBorder': '#00000000',
				'editor.selectionBackground': mix('--color-accent', 30),
				'editor.inactiveSelectionBackground': mix('--color-accent', 16),
				'editorCursor.foreground': solid('--color-accent'),
				'editorIndentGuide.background1': mix('--color-text', 7),
				'editorWhitespace.foreground': mix('--color-text', 14),
				'editorGutter.background': solid('--color-bg'),
				'editorWidget.background': solid('--color-surface'),
				'editorWidget.border': solid('--color-neutral-700'),
				'diffEditor.insertedTextBackground': mix('--color-success', 24),
				'diffEditor.removedTextBackground': mix('--color-danger', 24),
				'diffEditor.insertedLineBackground': mix('--color-success', 10),
				'diffEditor.removedLineBackground': mix('--color-danger', 10),
				'diffEditorGutter.insertedLineBackground': mix('--color-success', 16),
				'diffEditorGutter.removedLineBackground': mix('--color-danger', 16),
				'diffEditorOverview.insertedForeground': mix('--color-success', 60),
				'diffEditorOverview.removedForeground': mix('--color-danger', 60),
				'diffEditor.diagonalFill': mix('--color-text', 8),
				'diffEditor.border': mix('--color-text', 8),
				'diffEditor.unchangedRegionBackground': solid('--color-surface'),
				'diffEditor.unchangedRegionForeground': mix('--color-text', 55),
				'scrollbar.shadow': '#00000000',
				'scrollbarSlider.background': mix('--color-text', 14),
				'scrollbarSlider.hoverBackground': mix('--color-text', 26),
				'scrollbarSlider.activeBackground': mix('--color-accent', 40),
				'editorOverviewRuler.border': '#00000000'
			}
		});
		var font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'Consolas, monospace';
		var common = {
			theme: 'nocturne', readOnly: true, automaticLayout: true, fontFamily: font, fontSize: 12.5, lineHeight: 20,
			minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'line', smoothScrolling: true,
			padding: { top: 8 }, scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
		};
		$('loading').remove();
		$('editor').hidden = false;
		var original = monaco.editor.createModel(d.original, d.language);
		var modified = monaco.editor.createModel(d.modified, d.language);
		if (d.mode === 'diff') {
			var editor = monaco.editor.createDiffEditor($('editor'), Object.assign({ renderSideBySide: true, ignoreTrimWhitespace: false, renderOverviewRuler: true, hideUnchangedRegions: { enabled: true } }, common));
			editor.setModel({ original: original, modified: modified });
			editor.onDidUpdateDiff(function () {
				var add = 0, del = 0;
				(editor.getLineChanges() || []).forEach(function (ch) {
					if (ch.modifiedEndLineNumber >= ch.modifiedStartLineNumber && ch.modifiedEndLineNumber > 0) add += ch.modifiedEndLineNumber - ch.modifiedStartLineNumber + 1;
					if (ch.originalEndLineNumber >= ch.originalStartLineNumber && ch.originalEndLineNumber > 0) del += ch.originalEndLineNumber - ch.originalStartLineNumber + 1;
				});
				$('stat').innerHTML = '';
				var a = document.createElement('span'); a.className = 'uiw-add'; a.textContent = '+' + add;
				var r = document.createElement('span'); r.className = 'uiw-del'; r.textContent = ' -' + del;
				$('stat').appendChild(a); $('stat').appendChild(r);
			});
			$('mode').hidden = false;
			$('mode').addEventListener('change', function (e) { editor.updateOptions({ renderSideBySide: e.target.value === 'split' }); });
			editor.getModifiedEditor().focus();
		} else {
			monaco.editor.create($('editor'), Object.assign({ model: modified }, common)).focus();
		}
	});

	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ui.close(); });
})();
