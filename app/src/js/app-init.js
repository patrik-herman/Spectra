
(function() {
	var ua = navigator.userAgent;
	var isMobile = window.innerWidth < 900 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
	var isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|Opera/i.test(ua);

	if (isMobile || isSafari) {
		var fallback = document.querySelector('.mobile-fallback');
		if (fallback) {
			fallback.style.display = 'flex';

			if (isSafari && !isMobile) {
				var msg = fallback.querySelector('.fallback-message');
				var submsg = fallback.querySelector('.fallback-submessage');
				if (msg) msg.textContent = 'Safari is not supported.';
				if (submsg) submsg.textContent = 'Please use Chrome, Firefox, or Edge for the best experience.';
			}
		}

		document.addEventListener('DOMContentLoaded', function() {
			var app = document.querySelector('.header');
			var main = document.querySelector('.main');
			var overlay = document.getElementById('startOverlay');
			if (app) app.style.display = 'none';
			if (main) main.style.display = 'none';
			if (overlay) overlay.style.display = 'none';
		});
	}
})();

(function() {
	if (window.electronAPI) {
		document.documentElement.classList.add('electron-app');

		document.addEventListener('DOMContentLoaded', function() {
			document.body.classList.add('electron-app');

			var minimizeBtn = document.getElementById('titlebar-minimize');
			var maximizeBtn = document.getElementById('titlebar-maximize');
			var closeBtn = document.getElementById('titlebar-close');

			if (minimizeBtn) minimizeBtn.onclick = function() { window.electronAPI.windowMinimize(); };
			if (maximizeBtn) maximizeBtn.onclick = function() { window.electronAPI.windowMaximize(); };
			if (closeBtn) closeBtn.onclick = function() { window.electronAPI.windowClose(); };

			window.electronAPI.onWindowMaximized(function(isMaximized) {
				var btn = document.getElementById('titlebar-maximize');
				if (!btn) return;
				if (isMaximized) {
					btn.innerHTML = '<svg width="10" height="10"><rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><polyline points="2,2 2,0 10,0 10,8 8,8" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
				} else {
					btn.innerHTML = '<svg width="10" height="10"><rect width="10" height="10" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
				}
			});
		});
	}
})();
