// Renders the themed secondary windows opened by electron/src/uiWindow.ts:
// "message" (appDialog.ts), "picker" + "input" (pickerWindow.ts), "credential" (askpassManager.ts).
// Keyboard everywhere: Esc closes (cancel), Enter submits, Tab stays inside the window.
(function () {
	'use strict';
	var ui = window.uiWindow;
	var init = ui.init || { view: 'message', title: 'Git Graph', data: {} };
	var data = init.data || {};
	document.title = init.title;
	document.documentElement.classList.add('gg-platform-' + init.platform);

	function h(tag, attrs, children) {
		var el = document.createElement(tag);
		if (attrs) Object.keys(attrs).forEach(function (k) {
			if (k === 'text') el.textContent = attrs[k];
			else if (k === 'class') el.className = attrs[k];
			else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
			else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
		});
		(children || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
		return el;
	}
	function icon(name, cls) { return h('i', { 'data-icon': name, class: cls || null }); }
	function closeBtn() {
		return h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Close', title: 'Close (Esc)', onclick: function () { ui.close(); } }, [icon('x')]);
	}
	function titleBar(title) {
		return h('header', { class: 'gg-titlebar uiw-bar' }, [
			h('span', { class: 'gg-titlebar-mark' }, [icon('git-branch')]),
			h('span', { class: 'gg-titlebar-title', text: title }),
			closeBtn()
		]);
	}
	function fit() {
		requestAnimationFrame(function () { ui.fit(document.documentElement.scrollHeight); });
	}
	function button(label, kind, onclick) {
		return h('button', { type: 'button', class: 'btn ' + kind, onclick: onclick, text: label });
	}
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') { e.preventDefault(); ui.close(); }
	});

	/* ---------------- message dialog ---------------- */

	var GLYPH = {
		info: ['info', ''], update: ['cloud-arrow-down', ''], question: ['warning-circle', 'gg-glyph-warning'],
		warning: ['warning', 'gg-glyph-warning'], error: ['x-circle', 'gg-glyph-danger'], success: ['check-circle', 'gg-glyph-success']
	};

	function fmtBytes(n) {
		if (!(n >= 0)) return '';
		if (n < 1024) return n + ' B';
		var u = ['KB', 'MB', 'GB'], i = -1;
		do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
		return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
	}

	function renderMessage() {
		var glyph = h('span', { class: 'gg-glyph' }, [icon('info')]);
		var titleEl = h('h1', { class: 'dialog-title', id: 'dlg-title' });
		var msgEl = h('div', { class: 'dialog-body uiw-msg-text', id: 'dlg-msg' });
		var detailEl = h('div', { class: 'uiw-detail' });
		var bar = h('div', { class: 'gg-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [h('span')]);
		var pctEl = h('b'), bytesEl = h('span');
		var progEl = h('div', { class: 'uiw-prog' }, [bar, h('div', { class: 'uiw-prog-meta' }, [pctEl, bytesEl])]);
		var actions = h('div', { class: 'dialog-actions' });
		var root = h('div', { class: 'uiw-msg', role: 'alertdialog', 'aria-labelledby': 'dlg-title', 'aria-describedby': 'dlg-msg' }, [
			h('div', { class: 'uiw-msg-head' }, [glyph, titleEl, closeBtn()]), msgEl, detailEl, progEl, actions
		]);
		document.body.appendChild(root);

		var state = {};
		function apply(patch) {
			Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
			var g = GLYPH[state.type] || GLYPH.info;
			glyph.className = 'gg-glyph ' + g[1];
			glyph.innerHTML = '';
			glyph.appendChild(icon(g[0]));
			titleEl.textContent = state.title;
			msgEl.textContent = state.message;
			detailEl.textContent = state.detail || '';
			detailEl.style.display = state.detail ? '' : 'none';
			// Multi-line "key: value" details (e.g. version info) read better as a quiet code block.
			detailEl.classList.toggle('is-mono', !!state.detail && /\n/.test(state.detail) && /:\s/.test(state.detail));
			var p = state.progress;
			progEl.style.display = p ? '' : 'none';
			if (p) {
				var known = typeof p.percent === 'number';
				bar.classList.toggle('is-indeterminate', !known);
				bar.firstChild.style.width = known ? Math.max(0, Math.min(100, p.percent)) + '%' : '';
				if (known) bar.setAttribute('aria-valuenow', String(Math.round(p.percent))); else bar.removeAttribute('aria-valuenow');
				pctEl.textContent = known ? Math.floor(p.percent) + '%' : 'Starting...';
				bytesEl.textContent = p.label || (p.total ? fmtBytes(p.transferred || 0) + ' of ' + fmtBytes(p.total) + (p.bytesPerSecond ? ' · ' + fmtBytes(p.bytesPerSecond) + '/s' : '') : '');
			}
			if (patch.buttons || !actions.firstChild) {
				actions.innerHTML = '';
				var btns = state.buttons || ['OK'];
				// Electron order (0 = default) drawn right-to-left: the default action ends up right-most.
				for (var i = btns.length - 1; i >= 0; i--) {
					(function (idx) {
						var isDefault = idx === state.defaultId;
						var kind = isDefault ? (state.danger ? 'btn-danger' : 'btn-primary') : 'btn-secondary';
						var b = button(btns[idx], kind, function () { ui.submit(idx); });
						if (isDefault) b.id = 'dlg-default';
						actions.appendChild(b);
					})(i);
				}
			}
		}
		apply(data);
		ui.onUpdate(function (patch) { apply(patch); fit(); });
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ui.submit(state.cancelId); }
			else if (e.key === 'Enter' && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) { e.preventDefault(); ui.submit(state.defaultId); }
		}, true);
		var def = document.getElementById('dlg-default');
		if (def) def.focus();
		fit();
	}

	/* ---------------- list picker ---------------- */

	function renderPicker() {
		document.body.classList.add('uiw-fill');
		var items = data.items || [];
		var input = h('input', { class: 'input', type: 'text', placeholder: 'Type to filter', spellcheck: 'false', 'aria-label': 'Filter', autocomplete: 'off' });
		var list = h('div', { class: 'uiw-list', role: 'listbox', 'aria-label': data.placeholder || init.title });
		var empty = h('div', { class: 'uiw-empty', text: 'No matching items' });
		document.body.appendChild(titleBar(init.title));
		document.body.appendChild(h('div', { class: 'uiw-search' }, [icon('magnifying-glass'), input]));
		if (data.placeholder) document.body.appendChild(h('p', { class: 'uiw-prompt', text: data.placeholder }));
		document.body.appendChild(list);
		document.body.appendChild(h('div', { class: 'uiw-foot' }, [
			h('span', null, [h('span', { class: 'kbd', text: '↑↓' }), 'move']),
			h('span', null, [h('span', { class: 'kbd', text: 'Enter' }), 'choose']),
			h('span', null, [h('span', { class: 'kbd', text: 'Esc' }), 'cancel'])
		]));

		var rows = items.map(function (it, i) {
			var row = h('div', { class: 'uiw-item', role: 'option', id: 'opt-' + i }, [
				h('div', { class: 'uiw-item-row' }, [h('span', { class: 'uiw-item-label' }), it.description ? h('span', { class: 'uiw-item-desc', text: it.description }) : null]),
				it.detail ? h('div', { class: 'uiw-item-detail', text: it.detail }) : null
			]);
			row.addEventListener('click', function () { ui.submit(i); });
			row.addEventListener('mousemove', function () { if (visible[active] !== i) setActive(visible.indexOf(i)); });
			row._label = row.querySelector('.uiw-item-label');
			list.appendChild(row);
			return row;
		});
		var visible = [], active = 0;

		function setLabel(row, label, q) {
			row._label.textContent = '';
			var at = q ? label.toLowerCase().indexOf(q) : -1;
			if (at < 0) { row._label.textContent = label; return; }
			row._label.appendChild(document.createTextNode(label.slice(0, at)));
			row._label.appendChild(h('mark', { text: label.slice(at, at + q.length) }));
			row._label.appendChild(document.createTextNode(label.slice(at + q.length)));
		}
		function filter() {
			var q = input.value.trim().toLowerCase();
			visible = [];
			items.forEach(function (it, i) {
				var hay = (it.label + ' ' + (it.description || '') + ' ' + (it.detail || '')).toLowerCase();
				var ok = q === '' || hay.indexOf(q) !== -1;
				rows[i].style.display = ok ? '' : 'none';
				if (ok) { visible.push(i); setLabel(rows[i], it.label, q); }
			});
			if (visible.length === 0) list.appendChild(empty); else if (empty.parentNode) empty.remove();
			setActive(0);
		}
		function setActive(i) {
			rows.forEach(function (r) { r.classList.remove('is-active'); r.setAttribute('aria-selected', 'false'); });
			active = Math.max(0, Math.min(i, visible.length - 1));
			var row = rows[visible[active]];
			if (row) { row.classList.add('is-active'); row.setAttribute('aria-selected', 'true'); row.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', row.id); }
		}
		input.addEventListener('input', filter);
		input.addEventListener('keydown', function (e) {
			var page = Math.max(1, Math.floor(list.clientHeight / 44));
			if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
			else if (e.key === 'PageDown') { e.preventDefault(); setActive(active + page); }
			else if (e.key === 'PageUp') { e.preventDefault(); setActive(active - page); }
			else if (e.key === 'Enter') { e.preventDefault(); if (visible.length) ui.submit(visible[active]); }
		});
		filter();
		input.focus();
	}

	/* ---------------- text prompt ---------------- */

	function renderInput() {
		var input = h('input', { class: 'input', type: 'text', placeholder: data.placeholder || '', spellcheck: 'false', id: 'v', autocomplete: 'off' });
		var ok = button('OK', 'btn-primary', submit);
		function submit() { if (input.value.trim() !== '') ui.submit(input.value); }
		function sync() { ok.disabled = input.value.trim() === ''; }
		input.addEventListener('input', sync);
		input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
		document.body.appendChild(titleBar(init.title));
		document.body.appendChild(h('div', { class: 'uiw-body' }, [
			h('div', { class: 'field' }, [h('label', { for: 'v', text: data.prompt || '' }), input]),
			h('div', { class: 'dialog-actions' }, [button('Cancel', 'btn-secondary', function () { ui.close(); }), ok])
		]));
		sync();
		input.focus();
		fit();
	}

	/* ---------------- credential prompt (GIT_ASKPASS) ---------------- */

	function renderCredential() {
		// Git asks e.g. "Password for 'https://user@github.com': " - show it without the quotes and colon.
		var request = String(data.request || '').trim().replace(/:\s*$/, '').replace(/'([^']*)'/g, '$1');
		var what = /^(\w[\w ]*?) for /.exec(request);
		var input = h('input', { class: 'input', type: data.secret ? 'password' : 'text', id: 'v', spellcheck: 'false', autocomplete: 'off', 'aria-label': request });
		var field = data.secret
			? h('div', { class: 'uiw-secret' }, [input, h('button', {
				type: 'button', class: 'btn btn-icon', 'aria-label': 'Show', title: 'Show', onclick: function () {
					var show = input.type === 'password';
					input.type = show ? 'text' : 'password';
					this.setAttribute('aria-label', show ? 'Hide' : 'Show');
					this.title = show ? 'Hide' : 'Show';
					this.innerHTML = '';
					this.appendChild(icon(show ? 'eye-slash' : 'eye'));
					input.focus();
				}
			}, [icon('eye')])])
			: input;
		function submit() { ui.submit(input.value); }
		input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
		document.body.appendChild(titleBar(init.title));
		document.body.appendChild(h('div', { class: 'uiw-body' }, [
			h('div', { class: 'uiw-cred-head' }, [
				h('span', { class: 'gg-glyph' }, [icon('lock-simple')]),
				h('div', null, [
					h('p', { class: 'uiw-label' }, ['Git needs your ', h('b', { text: what ? what[1].toLowerCase() : 'credentials' }), ' for ' + (data.host || 'this remote') + '.']),
					h('p', { class: 'uiw-sub', text: request })
				])
			]),
			field,
			h('p', { class: 'uiw-sub', text: 'Passed straight to Git - Git Graph does not store it.' }),
			h('div', { class: 'dialog-actions' }, [button('Cancel', 'btn-secondary', function () { ui.close(); }), button('Continue', 'btn-primary', submit)])
		]));
		input.focus();
		fit();
	}

	({ message: renderMessage, picker: renderPicker, input: renderInput, credential: renderCredential }[init.view] || renderMessage)();
})();
