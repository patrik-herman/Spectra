// Dva horizontálne pruhy nad hlavným plátnom (prvkom canvas): ladenie a mriežka.
// Zdieľaný modul timeline.js slúži na vytváranie, zmenu pozície a úpravu, a tento konfiguračný súbor nastavuje ich veľkosť.

(function() {
	'use strict';

	function applyCompactConfig() {
		if (!window.Timeline) return;

		Timeline.height = 25;
		Timeline.lanes = {
			loop: { y: 0, height: 0 },
			markers: { y: 0, height: 0 },
			tuning: { y: 0, height: 12 },
			grid: { y: 12, height: 13 }
		};

		if (Timeline.canvas) {
			Timeline.canvas.style.height = Timeline.height + 'px';
			if (Timeline.resize) Timeline.resize();
		}

		// Existujúce udalosti ladenia a mriežky sú predvolene globálne a platia pre celú skladbu; pri novo vytvorených sa dá v informačnom paneli prepnúť platnosť na jednotlivú stopu.
		makeEventsGlobal();
	}

	function makeEventsGlobal() {
		var DB = window.DB;
		if (!DB) return;

		var trackEvents = DB.get('trackEvents') || {};
		var changed = false;

		for (const trackIdx in trackEvents) {
			if (trackEvents[trackIdx].tuningChanges) {
				trackEvents[trackIdx].tuningChanges.forEach(event => {
					if (!event.global) { event.global = true; changed = true; }
				});
			}
			if (trackEvents[trackIdx].gridChanges) {
				trackEvents[trackIdx].gridChanges.forEach(event => {
					if (!event.global) { event.global = true; changed = true; }
				});
			}
		}

		if (changed) DB.set('trackEvents', trackEvents);
	}

	if (window.Timeline) {
		applyCompactConfig();
	} else {
		document.addEventListener('DOMContentLoaded', function() {
			setTimeout(applyCompactConfig, 100);
		});
	}
})();
