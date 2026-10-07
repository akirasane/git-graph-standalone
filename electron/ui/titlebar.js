// Window chrome for the main window's pages (home.html, index.html). Include once, after icons.js:
//   <script src="ui/titlebar.js"></script>
// It injects the fixed 36px Nocturne title bar (app mark + menu, window title) at the top of <body>,
// sets `--titlebar-h: 36px` on :root (offset layouts with `var(--titlebar-h, 0px)`), reserves room
// for the native window controls, and opens the themed app menu (same items as the hidden native
// menu, see electron/src/chrome.ts) from the app mark or by pressing Alt.
//
// Also provides GG.menu, the shared themed popup menu (.gg-menu) for context menus and dropdowns:
//   GG.menu.open({ x, y } | { anchor: el, align: 'start' | 'end' }, items, onSelect)
//   items: [{ id, label, icon?, kbd?, danger?, disabled?, checked? } | { separator: true } | { heading: 'View' }]
(function () {
	'use strict';
	var GG = window.GG = window.GG || {};

	/* ---------------- GG.menu: themed popup menu ---------------- */

	var current = null;

	function closeMenu(restoreFocus) {
		if (!current) return;
		var c = current;
		current = null;
		c.el.remove();
		document.removeEventListener('mousedown', c.onDown, true);
		window.removeEventListener('blur', c.onBlur);
		window.removeEventListener('resize', c.onBlur);
		if (c.anchor) c.anchor.setAttribute('aria-expanded', 'false');
		if (restoreFocus !== false && c.prevFocus && document.contains(c.prevFocus)) c.prevFocus.focus();
		if (c.onClose) c.onClose();
	}

	function openMenu(pos, items, onSelect, onClose) {
		closeMenu(false);
		var el = document.createElement('div');
		el.className = 'gg-menu gg-menu-popup';
		el.setAttribute('role', 'menu');
		el.tabIndex = -1;
		var rows = [];
		items.forEach(function (it) {
			if (it.separator) {
				var sep = document.createElement('div');
				sep.className = 'gg-menu-sep';
				sep.setAttribute('role', 'separator');
				el.appendChild(sep);
				return;
			}
			if (it.heading) {
				var h = document.createElement('div');
				h.className = 'gg-menu-heading';
				h.textContent = it.heading;
				el.appendChild(h);
				return;
			}
			var row = document.createElement('div');
			row.className = 'gg-menu-item' + (it.danger ? ' danger' : '');
			row.setAttribute('role', it.checked !== undefined ? 'menuitemradio' : 'menuitem');
			if (it.checked !== undefined) row.setAttribute('aria-checked', it.checked ? 'true' : 'false');
			if (it.disabled) row.setAttribute('aria-disabled', 'true');
			var icon = document.createElement('i');
			icon.setAttribute('data-icon', it.icon || 'circle');
			if (!it.icon) icon.style.visibility = 'hidden';
			var label = document.createElement('span');
			label.textContent = it.label;
			row.appendChild(icon);
			row.appendChild(label);
			if (it.checked) {
				var chk = document.createElement('i');
				chk.className = 'gg-menu-check';
				chk.setAttribute('data-icon', 'check');
				row.appendChild(chk);
			} else if (it.kbd) {
				var k = document.createElement('span');
				k.className = 'kbd';
				k.textContent = it.kbd;
				row.appendChild(k);
			}
			row.addEventListener('mousemove', function () { setActive(rows.indexOf(row)); });
			row.addEventListener('click', function () { choose(it); });
			row._item = it;
			rows.push(row);
			el.appendChild(row);
		});
		document.body.appendChild(el);
		if (GG.hydrateIcons) GG.hydrateIcons(el);

		// Position: below the anchor (or at the pointer), kept inside the viewport.
		var r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, x, y;
		if (pos.anchor) {
			var a = pos.anchor.getBoundingClientRect();
			x = pos.align === 'end' ? a.right - r.width : a.left;
			y = a.bottom + 4;
			if (y + r.height > vh - 8 && a.top - r.height - 4 > 8) y = a.top - r.height - 4;
		} else {
			x = pos.x; y = pos.y;
			if (x + r.width > vw - 8) x = Math.max(8, x - r.width);
			if (y + r.height > vh - 8) y = Math.max(8, y - r.height);
		}
		el.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
		el.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';

		var active = -1;
		function setActive(i) {
			if (active >= 0 && rows[active]) rows[active].classList.remove('is-active');
			active = i;
			if (active >= 0 && rows[active]) { rows[active].classList.add('is-active'); rows[active].scrollIntoView({ block: 'nearest' }); }
		}
		function move(dir) {
			for (var n = 0, i = active; n < rows.length; n++) {
				i = (i + dir + rows.length) % rows.length;
				if (!rows[i]._item.disabled) { setActive(i); return; }
			}
		}
		function choose(it) {
			if (it.disabled) return;
			closeMenu(true);
			if (onSelect) onSelect(it);
		}
		el.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
			else if (e.key === 'Home') { e.preventDefault(); active = -1; move(1); }
			else if (e.key === 'End') { e.preventDefault(); active = rows.length; move(-1); }
			else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (rows[active]) choose(rows[active]._item); }
			else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
			else if (e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
			else if (e.key.length === 1 && /\S/.test(e.key)) {
				var ch = e.key.toLowerCase();
				for (var n = 1; n <= rows.length; n++) {
					var i = (Math.max(active, 0) + n) % rows.length;
					if (!rows[i]._item.disabled && rows[i]._item.label.charAt(0).toLowerCase() === ch) { setActive(i); break; }
				}
			}
		});

		current = {
			el: el,
			anchor: pos.anchor || null,
			prevFocus: document.activeElement,
			onClose: onClose,
			onDown: function (e) { if (!el.contains(e.target) && !(pos.anchor && pos.anchor.contains(e.target))) closeMenu(false); },
			onBlur: function () { closeMenu(false); }
		};
		if (pos.anchor) pos.anchor.setAttribute('aria-expanded', 'true');
		document.addEventListener('mousedown', current.onDown, true);
		window.addEventListener('blur', current.onBlur);
		window.addEventListener('resize', current.onBlur);
		el.focus();
		if (pos.keyboard) move(1);
		return el;
	}

	GG.menu = {
		open: function (pos, items, onSelect, onClose) { return openMenu(pos, items, onSelect, onClose); },
		close: function () { closeMenu(true); },
		isOpen: function () { return current !== null; }
	};

	/* ---------------- title bar (main window only) ---------------- */

	var chrome = window.electronAPI && window.electronAPI.chrome;
	if (!chrome) return;

	var MENU_ICONS = {
		'repositories': 'house', 'add-repo': 'folder-open', 'clone-repo': 'download-simple', 'init-repo': 'folder-plus',
		'remove-repo': 'trash', 'fetch': 'arrows-clockwise', 'clear-avatars': 'user', 'end-all-reviews': 'eye-slash',
		'end-review': 'eye', 'check-updates': 'cloud-arrow-down', 'version': 'info', 'quit': 'sign-out',
		'reload': 'arrow-counter-clockwise', 'devtools': 'bug'
	};
	var platform = 'win32';

	function formatAccel(a) {
		if (!a) return null;
		var mac = platform === 'darwin';
		return a.split('+').map(function (p) {
			if (p === 'CmdOrCtrl' || p === 'CommandOrControl') return mac ? 'Cmd' : 'Ctrl';
			if (p === 'Alt' && mac) return 'Option';
			return p;
		}).join('+');
	}

	var bar = document.createElement('div');
	bar.className = 'gg-titlebar gg-titlebar-fixed';
	bar.id = 'gg-titlebar';
	bar.innerHTML =
		'<button type="button" class="gg-titlebar-app" aria-haspopup="menu" aria-expanded="false" aria-label="Application menu" title="Menu (Alt)">' +
		'<span class="gg-titlebar-mark"><i data-icon="git-branch"></i></span>' +
		'<span class="gg-titlebar-title"></span><i data-icon="caret-down" class="gg-titlebar-caret"></i></button>';
	var appBtn = bar.firstChild;
	var titleEl = bar.querySelector('.gg-titlebar-title');

	function setTitle(t) {
		t = String(t || 'Git Graph');
		document.title = t;
		var m = /^(.*) - Git Graph$/.exec(t);
		titleEl.textContent = '';
		if (m) {
			var b = document.createElement('b');
			b.textContent = m[1];
			titleEl.appendChild(b);
			titleEl.appendChild(document.createTextNode(' · Git Graph'));
		} else {
			titleEl.textContent = t;
		}
		titleEl.title = t;
	}

	/** Room for the native window controls: the Window Controls Overlay rect when available, else platform defaults. */
	function reserveControls() {
		var left = 0, right = 0, wco = navigator.windowControlsOverlay;
		if (wco && wco.visible && wco.getTitlebarAreaRect) {
			var r = wco.getTitlebarAreaRect();
			if (r.width > 0) { left = r.x; right = Math.max(0, window.innerWidth - (r.x + r.width)); }
		}
		if (!left && !right) { if (platform === 'darwin') left = 72; else right = 138; }
		document.documentElement.style.setProperty('--gg-wco-left', left + 'px');
		document.documentElement.style.setProperty('--gg-wco-right', right + 'px');
	}

	function openAppMenu(keyboard) {
		if (GG.menu.isOpen()) { GG.menu.close(); return; }
		chrome.menu().then(function (groups) {
			var items = [];
			groups.forEach(function (g, gi) {
				if (gi > 0) { items.push({ separator: true }); items.push({ heading: g.label }); }
				g.items.forEach(function (it) {
					if (it.separator) { if (items.length && !items[items.length - 1].separator) items.push({ separator: true }); return; }
					items.push({ id: it.id, label: it.label.replace(/&/g, ''), icon: MENU_ICONS[it.id], kbd: formatAccel(it.accelerator), disabled: !it.enabled });
				});
			});
			GG.menu.open({ anchor: appBtn, keyboard: keyboard }, items, function (it) { chrome.run(it.id); });
		});
	}

	appBtn.addEventListener('click', function (e) { openAppMenu(e.detail === 0); });

	// Alt pressed and released on its own toggles the menu (like a native menu bar).
	var altAlone = false;
	window.addEventListener('keydown', function (e) { altAlone = e.key === 'Alt' && !e.repeat ? true : (e.key === 'Alt' ? altAlone : false); }, true);
	window.addEventListener('mousedown', function () { altAlone = false; }, true);
	window.addEventListener('keyup', function (e) {
		if (e.key === 'Alt' && altAlone) { e.preventDefault(); openAppMenu(true); }
		altAlone = false;
	}, true);

	function mount() {
		document.body.insertBefore(bar, document.body.firstChild);
		document.documentElement.style.setProperty('--titlebar-h', '36px');
		document.documentElement.classList.add('gg-has-titlebar');
		reserveControls();
		if (navigator.windowControlsOverlay) navigator.windowControlsOverlay.addEventListener('geometrychange', reserveControls);
		if (GG.hydrateIcons) GG.hydrateIcons(bar);
	}
	setTitle(document.title);
	if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

	chrome.state().then(function (s) {
		platform = s.platform;
		document.documentElement.classList.add('gg-platform-' + platform);
		setTitle(s.title);
		reserveControls();
	});
	chrome.onTitle(setTitle);
})();
