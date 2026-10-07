// Small motion helpers for theme.css (React Bits-style effects, vanilla). No dependencies; every
// effect is skipped when the user prefers reduced motion.
(function () {
	'use strict';

	var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Spotlight: a soft glow follows the pointer inside rows/buttons. Class is attached lazily on
	// first hover, so re-rendered lists (innerHTML) need no re-wiring.
	var SPOT = '.card, .heroCard, .sbRow, .wcFileRow, .wcStashRow, .wcSmallBtn, .cfFile, .cfHunk, .dropdownOption, .contextMenuItem';
	var frame = null;
	if (!reduce) {
		document.addEventListener('pointermove', function (e) {
			if (frame !== null) return;
			var x = e.clientX, y = e.clientY, target = e.target;
			frame = requestAnimationFrame(function () {
				frame = null;
				var el = target && target.closest ? target.closest(SPOT) : null;
				if (!el) return;
				if (!el.classList.contains('fx-spot')) el.classList.add('fx-spot');
				var r = el.getBoundingClientRect();
				el.style.setProperty('--mx', (x - r.left) + 'px');
				el.style.setProperty('--my', (y - r.top) + 'px');
			});
		}, { passive: true });
	}

	// BlurText: split `.fx-blur-text` into words that blur-in one after another.
	function splitBlurText() {
		Array.prototype.forEach.call(document.querySelectorAll('.fx-blur-text'), function (el) {
			var words = el.textContent.trim().split(/\s+/);
			el.textContent = '';
			words.forEach(function (w, i) {
				var s = document.createElement('span');
				s.className = 'fx-blur-word';
				s.style.setProperty('--w', String(i));
				s.textContent = w;
				el.appendChild(s);
			});
		});
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', splitBlurText);
	else splitBlurText();
})();
