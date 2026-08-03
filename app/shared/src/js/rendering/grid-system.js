// GridSystem obsahuje definície mriežok, výpočty a ukladanie
// typy mriežok:
// - off znamená bez mriežky
// - seconds znamená pravidelné jednosekundové intervaly
// - linear má rozostup podľa užívateľa (ms alebo BPM)
// - exponential má rozostup s exponentom
// - frequencies znamená viacero prekrývajúcich sa mriežok z frekvenčnej analýzy
// - file mapuje hustotu podľa zvukovej vlny.

// sel, showStatus pochádzajú z util.js (načítava sa skôr).


var GridSystem = {
	cache: {
		trackIdx: -1,
		viewportStart: 0,
		viewportEnd: 0,
		lines: [],      // { time: number, type: 'major'|'minor' }
		gridKey: null,
		changeTime: 0   // Čas udalosti zmeny mriežky.
	},

	segmentCaches: new Map(), // atribút: "trackIdx-gridKey-changeTime" -> { lines, viewportStart, viewportEnd }

	// Predvolené definície mriežok (nedajú sa zmazať).
	defaults: {
		'16th': {
			type: 'linear',
			name: '16th (120 BPM)',
			deletable: false,
			bpm: 120,
			subdivisions: 4
		},
		'seconds': {
			type: 'linear',
			name: 'Seconds',
			deletable: false,
			spacingMs: 1000,
			subdivisions: 4
		},
		'bpm90': {
			type: 'linear',
			name: '90 BPM',
			deletable: false,
			bpm: 90,
			subdivisions: 4
		},
		'bpm140': {
			type: 'linear',
			name: '140 BPM',
			deletable: false,
			bpm: 140,
			subdivisions: 4
		},
		'off': {
			type: 'off',
			name: 'Off',
			deletable: false
		}
	},

	init: () => {
		var DB = window.DB;
		var grids = DB?.get('grids');
		if (!grids) {
			grids = { ...GridSystem.defaults };
			if (DB) DB.set('grids', grids);
		} else {
			for (const key in GridSystem.defaults) {
				if (!grids[key]) {
					grids[key] = GridSystem.defaults[key];
				}
			}
			if (DB) DB.set('grids', grids);
		}
		window.grids = grids;

		GridSystem.editor.init();

		GridSystem.editor.updateDefaultGridSelect();
	},

	getAll: () => {
		var DB = window.DB;
		var stored = DB?.get('grids');
		if (!stored) return GridSystem.defaults;
		var merged = {};
		for (const k in GridSystem.defaults) merged[k] = stored[k] || GridSystem.defaults[k];
		for (const k in stored) if (!merged[k]) merged[k] = stored[k];
		return merged;
	},

	// Konkrétna mriežka podľa identifikátora, prípadne podľa názvu.
	get: (key) => {
		var grids = GridSystem.getAll();

		if (grids[key]) return grids[key];

		var keyLower = key ? key.toLowerCase() : '';
		for (const k in grids) {
			if (k.toLowerCase() === keyLower ||
			    (grids[k].name && grids[k].name.toLowerCase() === keyLower)) {
				return grids[k];
			}
		}

		return grids['off'];
	},

	save: (key, gridData) => {
		var DB = window.DB;
		var grids = GridSystem.getAll();
		grids[key] = gridData;
		if (DB) DB.set('grids', grids);
		window.grids = grids;
		GridSystem.refreshCache();

	},

	delete: (key) => {
		var DB = window.DB;
		var grids = GridSystem.getAll();
		if (grids[key] && grids[key].deletable !== false) {
			delete grids[key];
			if (DB) DB.set('grids', grids);
			window.grids = grids;
			GridSystem.refreshCache();

			// Ak nastavenie odkazovalo na zmazanú mriežku, vráti sa predvolená mriežka.
			var settings = window.settings;
			if (settings && settings.grid === key) {
				var remainingKeys = Object.keys(grids);
				settings.grid = remainingKeys.length > 0 ? remainingKeys[0] : 'seconds';
				if (DB) DB.set('settings', settings);
			}

			// Odstránenie referencií v trackEvents.gridChanges.
			if (DB) {
				var allTrackEvents = DB.get('trackEvents') || {};
				var changed = false;
				for (const tIdx in allTrackEvents) {
					var te = allTrackEvents[tIdx];
					if (te && te.gridChanges) {
						te.gridChanges = te.gridChanges.filter(gc => gc.gridKey !== key);
						changed = true;
					}
				}
				if (changed) DB.set('trackEvents', allTrackEvents);
			}

			return true;
		}
		return false;
	},

	refreshCache: () => {
		GridSystem.cache = {
			trackIdx: -1,
			viewportStart: 0,
			viewportEnd: 0,
			lines: [],
			gridKey: null,
			changeTime: 0
		};
		GridSystem.segmentCaches.clear();
	},

	// pole { time: number, type: 'major'|'minor' }
	_gridChangesFor: (trackIdx) => {
		// Zhromaždenie zmien mriežky z aktuálnej stopy a globálnych mriežok zo všetkých stôp.
		var allGridChanges = [];

		var Timeline = window.Timeline;
		var trackEvents = Timeline?.getTrackEvents?.(trackIdx);
		if (trackEvents && trackEvents.gridChanges) {
			for (const gc of trackEvents.gridChanges) {
				allGridChanges.push({ time: gc.time, gridKey: gc.gridKey });
			}
		}

		var DB = window.DB;
		if (DB) {
			var allTrackEvents = DB.get('trackEvents') || {};
			for (const tIdxStr in allTrackEvents) {
				var tIdx = parseInt(tIdxStr);
				if (tIdx === trackIdx) continue; // Aktuálna stopa už bola pridaná.
				var events = allTrackEvents[tIdx];
				if (events && events.gridChanges) {
					for (const gc of events.gridChanges) {
						if (gc.global) {
							allGridChanges.push({ time: gc.time, gridKey: gc.gridKey });
						}
					}
				}
			}
		}

		return allGridChanges.sort((a, b) => a.time - b.time);
	},

	getGridLines: (trackIdx, viewportStart, viewportEnd) => {
		var gridChanges = GridSystem._gridChangesFor(trackIdx);

		if (gridChanges.length === 0) {
			return [];
		}

		// Zhromaždenie všetkých čiar mriežky zo všetkých aktívnych segmentov vo viewporte.
		var allLines = [];

		for (let i = 0; i < gridChanges.length; i++) {
			var change = gridChanges[i];
			var nextChange = gridChanges[i + 1];

			var segmentStart = change.time;
			var segmentEnd = nextChange ? nextChange.time : Infinity;

			if (segmentEnd <= viewportStart) continue;
			if (segmentStart >= viewportEnd) break;

			var grid = GridSystem.get(change.gridKey);
			if (!grid || grid.type === 'off') continue;

			var visibleStart = Math.max(segmentStart, viewportStart);
			var visibleEnd = Math.min(segmentEnd, viewportEnd);

			var cacheKey = `${trackIdx}-${change.gridKey}-${segmentStart}`;
			var cached = GridSystem.segmentCaches.get(cacheKey);

			if (cached && cached.viewportStart <= visibleStart && cached.viewportEnd >= visibleEnd) {
				for (const line of cached.lines) {
					if (line.time >= visibleStart && line.time < visibleEnd) {
						allLines.push(line);
					}
				}
			} else {
				var lines = GridSystem.computeGridLines(grid, segmentStart, visibleStart, visibleEnd);

				GridSystem.segmentCaches.set(cacheKey, {
					viewportStart: visibleStart,
					viewportEnd: visibleEnd,
					lines: lines
				});

				allLines.push(...lines);
			}
		}

		return allLines;
	},

	computeGridLines: (grid, gridStartTime, rangeStart, rangeEnd) => {
		switch (grid.type) {
			case 'off':
				return [];

			case 'linear':
				return GridSystem.computeLinearGrid(grid, gridStartTime, rangeStart, rangeEnd);

			case 'exponential':
				return GridSystem.computeExponentialGrid(grid, gridStartTime, rangeStart, rangeEnd);

			case 'frequencies':
				return GridSystem.computeFrequencyGrid(grid, gridStartTime, rangeStart, rangeEnd);

			case 'file':
				return GridSystem.computeFileGrid(grid, gridStartTime, rangeStart, rangeEnd);

			case 'sequence':
				return GridSystem.computeSequenceGrid(grid, gridStartTime, rangeStart, rangeEnd);

			default:
				return [];
		}
	},

	computeSequenceGrid: (grid, gridStartTime, rangeStart, rangeEnd) => {
		var lines = [];
		var cellSec = (grid.cellMs || 2000) / 1000;
		var pat = Array.isArray(grid.pattern) && grid.pattern.length ? grid.pattern : [0];
		if (!Number.isFinite(cellSec) || cellSec <= 0) return lines;

		var cell = Math.floor((rangeStart - gridStartTime) / cellSec) - 1;
		var guard = 0;
		while (guard++ < 200000) {
			var cellStart = gridStartTime + cell * cellSec;
			if (cellStart > rangeEnd) break;
			for (let i = 0; i < pat.length; i++) {
				var t = cellStart + pat[i] * cellSec;
				if (t >= rangeStart && t < rangeEnd) {
					lines.push({ time: t, type: i === 0 ? 'major' : 'minor' });
				}
			}
			cell++;
		}
		return lines;
	},

	computeLinearGrid: (grid, gridStartTime, rangeStart, rangeEnd) => {
		var lines = [];
		var spacingMs = grid.spacingMs;

		if (grid.bpm) {
			spacingMs = (60 / grid.bpm) * 1000;
		}

		var spacingSec = spacingMs / 1000;
		var subdivisions = Math.max(1, Math.floor(grid.subdivisions || 1));
		var subSpacingSec = spacingSec / subdivisions;

		// Aby sa nespôsobil nekonečný cyklus, preto sa pri neplatných parametroch radšej nevykreslí mriežka, než by malo dôjsť k zamrznutiu.
		if (!Number.isFinite(subSpacingSec) || subSpacingSec <= 0) {
			return lines;
		}

		// Nájdenie prvej čiary po rangeStart, zarovnanej na gridStartTime.
		var offsetFromStart = rangeStart - gridStartTime;
		var firstLineIndex = Math.ceil(offsetFromStart / subSpacingSec);
		var currentTime = gridStartTime + firstLineIndex * subSpacingSec;

		while (currentTime < rangeEnd) {
			if (currentTime >= rangeStart) {
				// Určenie, či ide o hlavnú (major) alebo vedľajšiu (minor) čiaru.
				var linesSinceStart = Math.round((currentTime - gridStartTime) / subSpacingSec);
				var isMajor = linesSinceStart % subdivisions === 0;

				lines.push({
					time: currentTime,
					type: isMajor ? 'major' : 'minor'
				});
			}
			currentTime += subSpacingSec;
		}

		return lines;
	},

	// Rozostup sa progresívne zväčšuje alebo zmenšuje podľa exponentu.
	computeExponentialGrid: (grid, gridStartTime, rangeStart, rangeEnd) => {
		var lines = [];
		var baseSpacingMs = grid.baseSpacingMs || 100;
		var exponent = grid.exponent || 2;

		// Exponent 0 by dal Math.pow(n, 0) = 1 pre každé n, čím by vznikol nekonečný cyklus.
		if (exponent === 0) {
			exponent = 1; // Správa sa ako lineárny rozostup.
		}

		if (exponent < 0) {
			exponent = 1 / Math.abs(exponent);
		}

		var baseSpacingSec = baseSpacingMs / 1000;

		// Pri exponenciálnych mriežkach sa iteruje a počíta pozícia každej čiary
		// t_n = baseSpacing * n^exponent.
		var n = 0;
		var currentTime = gridStartTime;

		// Nájdenie počiatočného n.
		while (currentTime < rangeStart && n < 100000) {
			n++;
			currentTime = gridStartTime + baseSpacingSec * Math.pow(n, exponent);
		}

		// Vygenerovanie čiar v rozsahu.
		while (currentTime < rangeEnd && n < 100000) {
			if (currentTime >= rangeStart) {
				lines.push({
					time: currentTime,
					type: n % 10 === 0 ? 'major' : 'minor'
				});
			}
			n++;
			currentTime = gridStartTime + baseSpacingSec * Math.pow(n, exponent);
		}

		return lines;
	},

	// Viacero prekrývajúcich sa periodických mriežok z analyzovaných frekvencií.
	computeFrequencyGrid: (grid, gridStartTime, rangeStart, rangeEnd) => {
		var lines = [];
		var frequencies = grid.frequencies || [];
		var scalingFactor = grid.scalingFactor || 60; // Počet čiar za minútu na jeden Hz.

		for (const freq of frequencies) {
			// scalingFactor=60 znamená 100 Hz = 100 čiar/min = 1 čiara za 0.6s.
			var linesPerMinute = freq * (scalingFactor / 60);
			var periodSec = 60 / linesPerMinute;

			if (!Number.isFinite(periodSec) || periodSec <= 0) {
				continue;
			}

			var offsetFromStart = rangeStart - gridStartTime;
			var firstLineIndex = Math.ceil(offsetFromStart / periodSec);
			var currentTime = gridStartTime + firstLineIndex * periodSec;

			while (currentTime < rangeEnd) {
				if (currentTime >= rangeStart) {
					lines.push({
						time: currentTime,
						type: 'minor',
						frequency: freq
					});
				}
				currentTime += periodSec;
			}
		}

		lines.sort((a, b) => a.time - b.time);

		return lines;
	},

	// Amplitúda zvukovej vlny (-1 až 1) sa mapuje na hustotu mriežky.
	computeFileGrid: (grid, gridStartTime, rangeStart, rangeEnd) => {
		var lines = [];
		var waveformData = grid.waveformData || [];
		var minDensityMs = grid.minDensityMs || 50;
		var maxDensityMs = grid.maxDensityMs || 500;
		var duration = grid.duration || 1;

		if (waveformData.length === 0) return lines;

		// Zvuková vlna sa opakuje cyklicky.
		var getDensityAtTime = (t) => {
			// Pozícia v zvukovej vlne.
			var posInFile = ((t - gridStartTime) % duration + duration) % duration;
			var sampleIndex = Math.floor((posInFile / duration) * waveformData.length);
			var sample = waveformData[Math.min(sampleIndex, waveformData.length - 1)];

			// Mapovanie -1..1 na maxDensity..minDensity (hlasnejšie = hustejšie = menší rozostup).
			var normalized = (sample + 1) / 2; // 0..1
			var densityMs = maxDensityMs - normalized * (maxDensityMs - minDensityMs);
			return densityMs / 1000; // v sekundách
		};

		// Prejdenie rozsahu a umiestňovanie čiar podľa premenlivej hustoty.
		var currentTime = rangeStart;

		if (currentTime < gridStartTime) {
			currentTime = gridStartTime;
		}

		while (currentTime < rangeEnd) {
			if (currentTime >= rangeStart) {
				lines.push({
					time: currentTime,
					type: 'minor'
				});
			}

			// Poistka proti nule, zápornej hodnote a NaN, aby nevznikol nekonečný cyklus;
			// NaN zlyhá pri každom porovnaní, preto test !(>).
			var spacing = getDensityAtTime(currentTime);
			if (!(spacing > 0.001)) {
				currentTime += 0.001; // Minimálny rozostup 1 ms.
			} else {
				currentTime += spacing;
			}
		}

		return lines;
	},

	snapToGrid: (time, trackIdx, threshold = 0.1) => {
		var changes = GridSystem._gridChangesFor(trackIdx);
		var active = null, next = null;
		for (let i = 0; i < changes.length; i++) {
			if (changes[i].time <= time) {
				active = changes[i];
				next = changes[i + 1] || null;
			} else {
				break;
			}
		}
		if (!active) return null;

		var grid = GridSystem.get(active.gridKey);
		if (!grid || grid.type === 'off') return null;

		var lo = Math.max(active.time, time - threshold);
		var hi = next ? Math.min(next.time, time + threshold) : time + threshold;
		if (lo >= hi) return null;

		var lines = GridSystem.getGridLines(trackIdx, lo, hi);

		if (lines.length === 0) return null;

		var nearest = null;
		var nearestDist = Infinity;

		for (const line of lines) {
			var dist = Math.abs(line.time - time);
			if (dist < nearestDist && dist <= threshold) {
				nearest = line.time;
				nearestDist = dist;
			}
		}

		return nearest;
	},

	cellAt: (time, trackIdx, range = 10) => {
		var changes = GridSystem._gridChangesFor(trackIdx);
		var active = null, next = null;
		for (let i = 0; i < changes.length; i++) {
			if (changes[i].time <= time) {
				active = changes[i];
				next = changes[i + 1] || null;
			} else {
				break;
			}
		}
		if (!active) return null;

		var grid = GridSystem.get(active.gridKey);
		if (!grid || grid.type === 'off') return null;

		var lo = Math.max(active.time, time - range);
		var hi = next ? Math.min(next.time, time + range) : time + range;
		if (lo >= hi) return null;

		var lines = GridSystem.getGridLines(trackIdx, lo, hi);
		var floor = null, ceil = null;
		for (const line of lines) {
			if (line.time <= time && (floor === null || line.time > floor)) floor = line.time;
			if (line.time > time && (ceil === null || line.time < ceil)) ceil = line.time;
		}
		if (floor === null || ceil === null || ceil <= floor) return null;
		var beat = grid.bpm ? 60 / grid.bpm : (grid.spacingMs ? grid.spacingMs / 1000 : null);
		var beatEnd = beat ? floor + Math.max(beat, ceil - floor) : ceil;
		if (next && beatEnd > next.time) beatEnd = Math.max(ceil, next.time);
		return { start: floor, end: ceil, beatEnd: beatEnd };
	},

	// UI editora mriežok.
	editor: {
		currentGrid: null,

		init: () => {
			// Len naviazanie udalostí na existujúce prvky HTML.
			GridSystem.editor.bindEvents();
			GridSystem.editor.populateSelect();
		},

		bindEvents: () => {
			var typeSelect = sel('.grid-type');
			if (typeSelect) {
				typeSelect.addEventListener('change', GridSystem.editor.switchType);
			}

			var linearMode = sel('.grid-linear-mode');
			if (linearMode) {
				linearMode.addEventListener('change', (e) => {
					var msGroup = sel('.grid-linear-ms-group');
					var bpmGroup = sel('.grid-linear-bpm-group');
					if (e.target.value === 'ms') {
						msGroup.classList.remove('hidden');
						msGroup.style.display = '';
						bpmGroup.classList.add('hidden');
						bpmGroup.style.display = 'none';
					} else {
						msGroup.classList.add('hidden');
						msGroup.style.display = 'none';
						bpmGroup.classList.remove('hidden');
						bpmGroup.style.display = '';
					}
				});
			}

			var loadSelect = sel('.grid-load-select');
			if (loadSelect) {
				loadSelect.addEventListener('change', GridSystem.editor.load);
			}

			var saveBtn = sel('.grid-save');
			if (saveBtn) {
				saveBtn.addEventListener('click', GridSystem.editor.save);
			}

			var deleteBtn = sel('.grid-delete');
			if (deleteBtn) {
				deleteBtn.addEventListener('click', GridSystem.editor.delete);
			}

			var exportBtn = sel('.grid-export-btn');
			var importBtn = sel('.grid-import-btn');
			var importInput = sel('.grid-import-input');
			if (exportBtn) exportBtn.addEventListener('click', GridSystem.editor.export);
			if (importBtn) importBtn.addEventListener('click', () => importInput?.click());
			if (importInput) importInput.addEventListener('change', GridSystem.editor.import);

			var freqAnalyze = sel('.grid-freq-analyze');
			if (freqAnalyze) {
				freqAnalyze.addEventListener('click', () => {
					var AudioAnalyzer = window.AudioAnalyzer;
					if (AudioAnalyzer?.openWithCallback) {
						AudioAnalyzer.openWithCallback((frequencies) => {
							var textarea = sel('.grid-freq-textarea');
							if (textarea && frequencies && frequencies.length > 0) {
								textarea.value = frequencies.join('\n');
							}
						});
					}
				});
			}

			var fileAnalyze = sel('.grid-file-analyze');
			if (fileAnalyze) {
				fileAnalyze.addEventListener('click', () => {
					GridSystem.editor.openFileAnalyzer();
				});
			}
		},

		switchType: () => {
			var type = sel('.grid-type').value;

			sel('.grid-type-settings', true).forEach(el => {
				el.classList.add('hidden');
				el.style.display = 'none';
			});

			var settingsMap = {
				'linear': '.grid-linear-settings',
				'exponential': '.grid-exponential-settings',
				'frequencies': '.grid-frequency-settings',
				'file': '.grid-file-settings'
			};

			if (settingsMap[type]) {
				var panel = sel(settingsMap[type]);
				panel.classList.remove('hidden');
				panel.style.display = '';
			}
		},

		populateSelect: () => {
			var select = sel('.grid-load-select');
			if (!select) return;

			select.innerHTML = '<option value="_new">New Grid</option>';

			var grids = GridSystem.getAll();
			for (const key in grids) {
				var opt = document.createElement('option');
				opt.value = key;
				opt.textContent = grids[key].name + (grids[key].deletable === false ? ' (built-in)' : '');
				select.appendChild(opt);
			}
		},

		load: () => {
			var key = sel('.grid-load-select').value;

			if (key === '_new') {
				GridSystem.editor.currentGrid = null;
				sel('.grid-name').value = '';
				sel('.grid-type').value = 'linear';
				GridSystem.editor.switchType();
				return;
			}

			var grid = GridSystem.get(key);
			if (!grid) return;

			GridSystem.editor.currentGrid = key;
			sel('.grid-name').value = grid.name;
			sel('.grid-type').value = grid.type === 'off' ? 'linear' : grid.type;
			GridSystem.editor.switchType();

			switch (grid.type) {
				case 'linear':
					if (grid.bpm) {
						sel('.grid-linear-mode').value = 'bpm';
						sel('.grid-linear-bpm').value = grid.bpm;
						sel('.grid-linear-ms-group').classList.add('hidden');
						sel('.grid-linear-ms-group').style.display = 'none';
						sel('.grid-linear-bpm-group').classList.remove('hidden');
						sel('.grid-linear-bpm-group').style.display = '';
					} else {
						sel('.grid-linear-mode').value = 'ms';
						sel('.grid-linear-spacing').value = grid.spacingMs || 500;
						sel('.grid-linear-ms-group').classList.remove('hidden');
						sel('.grid-linear-ms-group').style.display = '';
						sel('.grid-linear-bpm-group').classList.add('hidden');
						sel('.grid-linear-bpm-group').style.display = 'none';
					}
					sel('.grid-linear-subdivisions').value = grid.subdivisions || 1;
					break;

				case 'exponential':
					sel('.grid-exp-base').value = grid.baseSpacingMs || 100;
					sel('.grid-exp-exponent').value = grid.exponent || 2;
					break;

				case 'frequencies':
					sel('.grid-freq-scaling').value = grid.scalingFactor || 60;
					sel('.grid-freq-textarea').value = (grid.frequencies || []).join('\n');
					break;

				case 'file':
					sel('.grid-file-min').value = grid.minDensityMs || 50;
					sel('.grid-file-max').value = grid.maxDensityMs || 500;
					if (grid.fileName) {
						sel('.grid-file-name').textContent = grid.fileName;
					}
					if (grid.waveformData) {
						GridSystem.editor.drawWaveform(grid.waveformData);
					}
					break;
			}
		},

		save: () => {
			var name = sel('.grid-name').value.trim();
			if (!name) {
				showStatus('Name the grid first', { type: 'warning' });
				return;
			}

			var type = sel('.grid-type').value;
			if (!type) {
				showStatus('This grid type cannot be edited here', { type: 'warning' });
				return;
			}
			var derivedKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
			var key;

			// Identifikátor na uloženie sa určí tak, že ak sa názov nezmenil, ponechá sa existujúci.
			if (GridSystem.editor.currentGrid) {
				const grids = GridSystem.getAll();
				const existing = grids[GridSystem.editor.currentGrid];
				if (existing && existing.name === name) {
					key = GridSystem.editor.currentGrid;
				} else if (existing && existing.name !== name) {
					// Názov sa zmenil, preto sa použije odvodený identifikátor a referencie sa premigrujú.
					var newKey = derivedKey;
					if (newKey !== GridSystem.editor.currentGrid) {
						var oldKey = GridSystem.editor.currentGrid;
						var DB = window.DB;

						// Migrácia referencie settings.grid.
						var settings = window.settings;
						if (settings && settings.grid === oldKey) {
							settings.grid = newKey;
							if (DB) DB.set('settings', settings);
						}

						// Migrácia referencií trackEvents.gridChanges bez mazania.
						if (DB) {
							var allTrackEvents = DB.get('trackEvents') || {};
							var changed = false;
							for (const tIdx in allTrackEvents) {
								var te = allTrackEvents[tIdx];
								if (te && te.gridChanges) {
									for (const gc of te.gridChanges) {
										if (gc.gridKey === oldKey) {
											gc.gridKey = newKey;
											changed = true;
										}
									}
								}
							}
							if (changed) DB.set('trackEvents', allTrackEvents);
						}

						// Zmazanie starého záznamu mriežky bez čistenia referencií, keďže už boli migrované.
						var allGrids = GridSystem.getAll();
						if (allGrids[oldKey] && allGrids[oldKey].deletable !== false) {
							delete allGrids[oldKey];
							if (DB) DB.set('grids', allGrids);
							window.grids = allGrids;
						}

						key = newKey;
					} else {
						key = GridSystem.editor.currentGrid;
					}
				} else {
					key = GridSystem.editor.currentGrid;
				}
			} else {
				key = derivedKey;
			}

			const grids = GridSystem.getAll();
			const existing = grids[key];
			if (existing && existing.deletable === false && GridSystem.editor.currentGrid !== key) {
				showStatus('Cannot overwrite a built-in grid', { type: 'warning' });
				return;
			}

			var existingMeta = grids[key] || {};

			var gridData = {
				// Zachovanie metadát zabudovanej mriežky.
				...(existingMeta.category ? { category: existingMeta.category } : {}),
				type: type,
				name: name,
				deletable: existingMeta.deletable === false ? false : true
			};

			switch (type) {
				case 'linear':
					var mode = sel('.grid-linear-mode').value;
					if (mode === 'bpm') {
						gridData.bpm = parseFloat(sel('.grid-linear-bpm').value);
					} else {
						gridData.spacingMs = parseFloat(sel('.grid-linear-spacing').value);
					}
					gridData.subdivisions = parseInt(sel('.grid-linear-subdivisions').value) || 1;
					break;

				case 'exponential':
					gridData.baseSpacingMs = parseFloat(sel('.grid-exp-base').value);
					gridData.exponent = parseFloat(sel('.grid-exp-exponent').value);
					break;

				case 'frequencies':
					gridData.scalingFactor = parseFloat(sel('.grid-freq-scaling').value);
					var freqText = sel('.grid-freq-textarea').value;
					gridData.frequencies = freqText.split(/[\n,]+/)
						.map(s => parseFloat(s.trim()))
						.filter(f => !isNaN(f) && f > 0);
					break;

				case 'file':
					gridData.minDensityMs = parseFloat(sel('.grid-file-min').value);
					gridData.maxDensityMs = parseFloat(sel('.grid-file-max').value);
					// Dáta zvukovej vlny sú už uložené.
					if (GridSystem.editor.waveformData) {
						gridData.waveformData = GridSystem.editor.waveformData;
						gridData.duration = GridSystem.editor.waveformDuration;
						gridData.fileName = GridSystem.editor.fileName;
					}
					break;
			}

			GridSystem.save(key, gridData);
			GridSystem.editor.currentGrid = key;
			GridSystem.editor.populateSelect();
			var gridLoadSelect = sel('.grid-load-select');
			if (gridLoadSelect) gridLoadSelect.value = key;

			GridSystem.editor.updateDefaultGridSelect();

			showStatus(`Grid "${name}" saved`, { type: 'success' });
		},

		delete: async () => {
			var key = GridSystem.editor.currentGrid;
			if (!key) {
				showStatus('No grid selected', { type: 'warning' });
				return;
			}

			var grid = GridSystem.get(key);
			if (grid.deletable === false) {
				showStatus('Cannot delete a built-in grid', { type: 'warning' });
				return;
			}

			var showConfirm = window.showConfirm;
			if (showConfirm && await showConfirm(`Delete grid "${grid.name}"?`, { title: 'Delete Grid', type: 'danger' })) {
				GridSystem.delete(key);
				GridSystem.editor.currentGrid = null;
				GridSystem.editor.populateSelect();
				var gridSelect = sel('.grid-load-select');
				if (gridSelect) gridSelect.value = '_new';
				GridSystem.editor.load();
				GridSystem.editor.updateDefaultGridSelect();
			}
		},

		export: () => {
			var key = GridSystem.editor.currentGrid;
			if (!key) {
				showStatus('No grid selected to export. Save the grid first.', { type: 'warning' });
				return;
			}

			var grid = GridSystem.get(key);
			if (!grid) {
				showStatus('Grid not found', { type: 'error' });
				return;
			}

			var exportData = {
				spectraType: 'grid',
				version: 1,
				name: grid.name,
				type: grid.type,
				deletable: true,
				exportedAt: new Date().toISOString()
			};

			switch (grid.type) {
				case 'lines':
					exportData.lines = grid.lines;
					break;
				case 'linear':
					if (grid.bpm) exportData.bpm = grid.bpm;
					if (grid.spacingMs) exportData.spacingMs = grid.spacingMs;
					if (grid.subdivisions) exportData.subdivisions = grid.subdivisions;
					break;
				case 'exponential':
					exportData.baseSpacingMs = grid.baseSpacingMs;
					exportData.exponent = grid.exponent;
					break;
				case 'frequencies':
					exportData.scalingFactor = grid.scalingFactor;
					exportData.frequencies = grid.frequencies;
					break;
				case 'file':
					exportData.minDensityMs = grid.minDensityMs;
					exportData.maxDensityMs = grid.maxDensityMs;
					if (grid.waveformData) exportData.waveformData = grid.waveformData;
					if (grid.duration) exportData.duration = grid.duration;
					if (grid.fileName) exportData.fileName = grid.fileName;
					break;
				case 'sequence':
					exportData.cellMs = grid.cellMs;
					exportData.pattern = grid.pattern;
					break;
			}

			var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a');
			a.href = url;
			a.download = `${grid.name.replace(/[^a-z0-9]/gi, '_')}.grid.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		},

		import: (e) => {
			var file = e.target.files[0];
			if (!file) return;

			var reader = new FileReader();
			reader.onload = async (event) => {
				try {
					var imported = JSON.parse(event.target.result);

					if (imported.spectraType !== 'grid') {
						showStatus('Invalid grid file format', { type: 'error' });
						return;
					}

					var gridType = imported.type || 'lines';
					var valid = false;
					switch (gridType) {
						case 'lines':
							valid = imported.lines && Array.isArray(imported.lines);
							break;
						case 'linear':
							valid = !!(imported.bpm || imported.spacingMs);
							break;
						case 'exponential':
							valid = !!(imported.baseSpacingMs !== undefined && imported.exponent !== undefined);
							break;
						case 'frequencies':
							valid = imported.frequencies && Array.isArray(imported.frequencies);
							break;
						case 'file':
							valid = !!(imported.minDensityMs !== undefined || imported.waveformData);
							break;
						case 'sequence':
							valid = Array.isArray(imported.pattern) && imported.pattern.length > 0;
							break;
						default:
							valid = imported.lines && Array.isArray(imported.lines);
					}
					if (!valid) {
						showStatus('Invalid grid data for type: ' + gridType, { type: 'error' });
						return;
					}

					var gridData = {
						name: imported.name,
						type: gridType,
						deletable: true
					};

					switch (gridType) {
						case 'lines':
							gridData.lines = imported.lines;
							break;
						case 'linear':
							if (imported.bpm) gridData.bpm = imported.bpm;
							if (imported.spacingMs) gridData.spacingMs = imported.spacingMs;
							if (imported.subdivisions) gridData.subdivisions = imported.subdivisions;
							break;
						case 'exponential':
							gridData.baseSpacingMs = imported.baseSpacingMs;
							gridData.exponent = imported.exponent;
							break;
						case 'frequencies':
							gridData.frequencies = imported.frequencies;
							if (imported.scalingFactor) gridData.scalingFactor = imported.scalingFactor;
							break;
						case 'file':
							if (imported.minDensityMs) gridData.minDensityMs = imported.minDensityMs;
							if (imported.maxDensityMs) gridData.maxDensityMs = imported.maxDensityMs;
							if (imported.waveformData) gridData.waveformData = imported.waveformData;
							if (imported.duration) gridData.duration = imported.duration;
							if (imported.fileName) gridData.fileName = imported.fileName;
							break;
						case 'sequence':
							if (imported.cellMs) gridData.cellMs = imported.cellMs;
							if (Array.isArray(imported.pattern)) gridData.pattern = imported.pattern;
							break;
					}

					var key = imported.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

					var existing = GridSystem.get(key);
					var showConfirm = window.showConfirm;
					if (existing && showConfirm) {
						if (!await showConfirm(`Grid "${imported.name}" already exists. Overwrite?`, { title: 'Overwrite Grid', type: 'warning' })) {
							return;
						}
					}

					GridSystem.save(key, gridData);

					GridSystem.editor.populateSelect();
					GridSystem.editor.currentGrid = key;

					var EditorLists = window.EditorLists;
					if (EditorLists) {
						EditorLists.populateGridList();
						EditorLists.selectedGrid = key;
					}

					var select = sel('.grid-load-select');
					if (select) {
						select.value = key;
						GridSystem.editor.load();
					}

					GridSystem.editor.updateDefaultGridSelect();

					showStatus(`Grid "${imported.name}" imported`, { type: 'success' });
				} catch (err) {
					Logger.error('Import error:', err);
					showStatus('Failed to import grid: ' + err.message, { type: 'error' });
				}
			};
			reader.readAsText(file);

			e.target.value = '';
		},

		updateDefaultGridSelect: () => {
			var select = sel('.default-grid');
			if (!select) return;

			var settings = window.settings;
			var DB = window.DB;
			var currentSetting = settings?.grid || 'off';
			var currentSettingLower = currentSetting.toLowerCase();

			select.innerHTML = '';

			var grids = GridSystem.getAll();
			var foundMatch = false;

			for (const key in grids) {
				var opt = document.createElement('option');
				opt.value = key;
				opt.textContent = grids[key].name;

				if (key === currentSetting ||
				    key.toLowerCase() === currentSettingLower ||
				    (grids[key].name && grids[key].name.toLowerCase() === currentSettingLower)) {
					opt.selected = true;
					foundMatch = true;
					if (settings && settings.grid !== key) {
						settings.grid = key;
						if (DB) DB.set('settings', settings);
					}
				}
				select.appendChild(opt);
			}

			if (!foundMatch && select.querySelector('option[value="off"]')) {
				select.querySelector('option[value="off"]').selected = true;
				if (settings) settings.grid = 'off';
				if (DB) DB.set('settings', settings);
			}
		},

		waveformData: null,
		waveformDuration: 0,
		fileName: '',

		openFileAnalyzer: () => {
			var input = document.createElement('input');
			input.type = 'file';
			input.accept = '.wav,.mp3,.ogg,.flac';
			input.style.display = 'none';
			document.body.appendChild(input);

			input.addEventListener('change', async (e) => {
				var file = e.target.files[0];
				if (!file) return;

				GridSystem.editor.fileName = file.name;
				sel('.grid-file-name').textContent = file.name;

				try {
					var arrayBuffer = await file.arrayBuffer();
					var audioContext = new (window.AudioContext || window.webkitAudioContext)();
					var audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

					// Extrakcia dát zvukovej vlny (downsample na 1000 vzoriek).
					var channelData = audioBuffer.getChannelData(0);
					var sampleRate = audioBuffer.sampleRate;
					var duration = audioBuffer.duration;
					var targetSamples = 1000;
					var step = Math.max(1, Math.floor(channelData.length / targetSamples));

					var waveform = [];
					for (let i = 0; i < channelData.length; i += step) {
						// RMS segmentu
						var sum = 0;
						var segmentEnd = Math.min(i + step, channelData.length);
						for (let j = i; j < segmentEnd; j++) {
							sum += channelData[j] * channelData[j];
						}
						var rms = Math.sqrt(sum / (segmentEnd - i));
						waveform.push(rms * (channelData[i] >= 0 ? 1 : -1));
					}

					var absWaveform = waveform.map(v => Math.abs(v) * 2 - 1); // Mapovanie 0..1 na -1..1.

					GridSystem.editor.waveformData = absWaveform;
					GridSystem.editor.waveformDuration = duration;

					GridSystem.editor.drawWaveform(absWaveform);

					audioContext.close();
				} catch (err) {
					Logger.error('Error loading audio file:', err);
					showStatus('Error loading audio file', { type: 'error' });
				}

				document.body.removeChild(input);
			});

			input.click();
		},

		drawWaveform: (waveformData) => {
			var canvas = sel('.grid-file-waveform');
			if (!canvas) return;

			var ctx = canvas.getContext('2d');
			var width = canvas.width;
			var height = canvas.height;

			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = '#1a1a1a';
			ctx.fillRect(0, 0, width, height);

			if (!waveformData || waveformData.length === 0) return;

			ctx.strokeStyle = '#2561c1';
			ctx.lineWidth = 1;
			ctx.beginPath();

			var centerY = height / 2;
			for (let i = 0; i < waveformData.length; i++) {
				var x = (i / waveformData.length) * width;
				var y = centerY - waveformData[i] * (height / 2 - 5);

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			ctx.stroke();

			ctx.strokeStyle = '#444';
			ctx.beginPath();
			ctx.moveTo(0, centerY);
			ctx.lineTo(width, centerY);
			ctx.stroke();
		}
	}
};