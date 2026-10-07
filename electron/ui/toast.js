// Shared toast: GG.toast('Saved', 'success' | 'error' | 'info', durationMs?). Needs nocturne.css (+ icons.js for the icon).
// Errors stay longer (9s) than successes (3.2s); click a toast to dismiss it.
(function () {
	'use strict';
	var GG = window.GG = window.GG || {};
	var ICON = { success: 'check-circle', error: 'x-circle', info: 'info' };

	GG.toast = function (message, kind, ms) {
		kind = kind || 'info';
		var box = document.querySelector('.gg-toasts');
		if (!box) {
			box = document.createElement('div');
			box.className = 'gg-toasts';
			box.setAttribute('role', 'status');
			box.setAttribute('aria-live', 'polite');
			document.body.appendChild(box);
		}
		var el = document.createElement('div');
		el.className = 'gg-toast gg-toast-' + kind;
		var icon = document.createElement('i');
		icon.setAttribute('data-icon', ICON[kind] || 'info');
		var text = document.createElement('span');
		text.textContent = String(message).length > 420 ? String(message).slice(0, 417) + '...' : String(message);
		el.appendChild(icon);
		el.appendChild(text);
		box.appendChild(el);
		if (GG.hydrateIcons) GG.hydrateIcons(el);

		var life = ms || (kind === 'error' ? 9000 : 3200);
		var gone = false;
		function dismiss() {
			if (gone) return;
			gone = true;
			el.style.transition = 'opacity .24s, transform .24s';
			el.style.opacity = '0';
			el.style.transform = 'translateY(6px)';
			setTimeout(function () { el.remove(); }, 260);
		}
		el.addEventListener('click', dismiss);
		setTimeout(dismiss, life);
		return dismiss;
	};
})();
