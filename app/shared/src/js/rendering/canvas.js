// Jadro celého softvéru.

// Súbor na vykresľovanie hlavného plátna
// V lete 2025 nastal bod, keď nebolo isté, či bude možné v projekte pokračovať, pretože sa nedarilo prekonať extrémne pomalý výkon.
// Stránka sa úplne zasekla už pri vykreslení 100 nôt, teda minimálne 6400 parciálov kreslených každý snímok na jednej obrazovke.
// Napokon sa podarilo nájsť spôsob, ako bolo možné vykresliť celú skupinu parciálov naraz namiesto kreslenia po jednom a projekt mohol pokračovať.


var timeRegionHeight = 16,
	octaveSpacing = 12*20,
	octaveSpacingStep = octaveSpacing / 12,
	barSize = 200,  // Predvolená úroveň priblíženia v pixeloch na jednu dobu.
	gridSize = 8,
	resizingRegionSize = 5,
	pitchViewMax = 180,
	pitchViewMin = -36,
	pitchEditMax = pitchViewMax - 2,
	pitchEditMin = pitchViewMin + 2,
	stepY, stepH,
	lastDBsaveTime = 0,
	selectedPartialsText = "",
	partialWindowSelectedElement = sel('.partial-window-selected'),
	partialWindowSelectedElementDiv = sel('.partial-window-selected .content'),

	// Sledovanie parciálu pod kurzorom, nastavované funkciou checkPartialHover.
	partialNote = 0,
	partialNumber = 0,

	partialBrightnessStep = 0.1,
	now, newTimestamp,

	hoverTooltip = {
		visible: false,
		x: 0,
		y: 0,
		frequency: 0,
		midiPitch: 0,
		noteName: '',
		cents: 0,
		amplitude: 0
	},

	// Čiara výšky tónu pod kurzorom, zobrazená na klaviatúre pri prejdení nad parciálom.
	hoverPitchLine = {
		visible: false,
		midiPitch: 0,
		noteName: '',
		cents: 0
	},

	// Zvýraznenie stupňa ladenia pod kurzorom.
	hoverStep = {
		visible: false,
		stepIndex: -1,  // Index v stupnici alebo v adaptívnych výškach.
		y: 0,
		height: 0
	},

	// Priestorový index na rýchle zisťovanie parciálu pod kurzorom, O(1) namiesto O(n*m).
	spatialIndex = {
		cellSize: 50, // Pixelov na bunku.
		grid: new Map(), // Map<cellKey, Array<{trackIdx, noteIdx, partialIdx, bounds}>>
		lastBuildFrame: -1,
		frameCounter: 0,
		// Pole záznamov na opätovné použitie.
		entryPool: [],
		entryPoolIndex: 0
	},

	// Obmedzenie frekvencie kontrol pod kurzorom.
	lastHoverTime = 0,
	hoverThrottleMs = 16, // max 60fps na kontroly pod kurzorom.
	pendingHoverX = 0,
	pendingHoverY = 0,
	hoverRAFPending = false,

	// Cache gradientov pre obálky ADSR.
	gradientCache = new Map(),
	gradientCacheMaxSize = 2000, // Zvýšené pre veľké projekty.
	lastGradientCacheClear = 0,

	// Sledovanie výkonu pre adaptívnu kvalitu.
	lastFrameTime = 0,
	frameTimeAvg = 16,
	slowFrameCount = 0,

	// Cache rotácie odtieňa podľa amplitúdy pre parciály
	// atribút je "hexColor_rotationDegrees" -> otočená hex farba.
	partialColorCache = new Map(),
	partialColorCacheMaxSize = 500,
	partialHueRotationMax = 130, // max stupňov otočenia pri najnižšej amplitúde.
	noteShadeL = [0, 0.13, -0.14, 0.06, -0.07, 0.18, -0.2, 0.1, -0.11, 0.15, -0.17, 0.03],
	noteShadeHue = [0, 12, -12, 7, -7, 14, -14, 10, -10, 13, -13, 4],

	pathPool = [],
	pathPoolIndex = 0,

	// Vrstva sa cachuje kvôli výkonu, statické parciály sa vykresľujú do plátna mimo obrazovky.
	staticLayer = null,
	staticLayerCtx = null,
	staticLayerNeedsRefresh = true,

	// Dôležitá premenná, teda cache prepočítaných MIDI dát
	// slúži na to, aby sa predišlo zbytočným časovo náročným prepočtom.
	canvasWidth = 0,
	canvasBarlinesX = 0,
	canvasBarlines = 0,
	iC4 = 0,
	iC2 = 0,
	MIDInotePartials7,
	MIDInotePartials8,
	MIDInotePartials9,
	MIDInotePartials10,
	MIDInotePartials12,
	partialNoteRound = 0,
	orderedPartialRound = 0,
	noteW, noteH, noteX, noteY,

	// Cache okrajov pre režim magnetu, aby sa neprepočítavali pri každom snímku.
	magnetEdgeCache = null,
	magnetEdgeCacheNeedsRefresh = true;

function refreshMagnetEdgeCache() {
	magnetEdgeCacheNeedsRefresh = true;
}

function getSpectrumDataSafe(trackIdx) {
	if (!instruments || !instruments[trackIdx]) return [[1, 1]];
	var spectrumKey = instruments[trackIdx].spectrum;
	if (!spectrumKey || !spectra || !spectra[spectrumKey]) return [[1, 1]];
	var timbre = spectra[spectrumKey];
	// Použije getTimbrePartials na spracovanie starého .data aj nového .keypoints formátu.
	return typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre) : (timbre.data || [[1, 1]]);
}

// Funkcia vráti farbu otočenú v priestore OKLAB podľa amplitúdy parciálu
// pri amplitúde 1.0 zostáva pôvodná farba, zatiaľ čo pri nižších amplitúdach sa odtieň otáča.
function getPartialColorByAmplitude(baseColor, amplitude) {
	// Logaritmické škálovanie, keďže amplitúdy parciálov sledujú rozdelenie 1/x
	// vďaka tomu sú farby rozložené rovnomernejšie v typickom harmonickom rade.
	var minAmp = 0.05; // Spodná medza, aby sa predišlo extrémnym hodnotám.
	var clampedAmp = Math.max(minAmp, Math.min(1, amplitude));
	// log(1) = 0, log(minAmp) je záporné, čím sa hodnota normalizuje na rozsah 0-1.
	var logScale = -Math.log(clampedAmp) / -Math.log(minAmp);
	var rotation = Math.round(logScale * partialHueRotationMax);

	if (rotation === 0) return baseColor;

	var cacheKey = baseColor + '_' + rotation;
	if (partialColorCache.has(cacheKey)) {
		return partialColorCache.get(cacheKey);
	}

	var rotatedColor = rotateHexColor(baseColor, rotation);

	if (partialColorCache.size >= partialColorCacheMaxSize) {
		// Vymazanie najstarších záznamov (jednoducho polovica cache).
		var keysToDelete = Array.from(partialColorCache.keys()).slice(0, partialColorCacheMaxSize / 2);
		for (const key of keysToDelete) {
			partialColorCache.delete(key);
		}
	}
	partialColorCache.set(cacheKey, rotatedColor);

	return rotatedColor;
}

function getNoteIdColor(baseColor, noteIdx) {
	var bucket = ((noteIdx % 12) + 12) % 12;
	if (bucket === 0) return baseColor;
	var cacheKey = baseColor + '_n' + bucket;
	if (partialColorCache.has(cacheKey)) {
		return partialColorCache.get(cacheKey);
	}
	var shadedColor = rotateHexColor(baseColor, noteShadeHue[bucket], noteShadeL[bucket], 1 - Math.abs(noteShadeL[bucket]) * 2.2);
	partialColorCache.set(cacheKey, shadedColor);
	return shadedColor;
}

// Pomocné funkcie priestorového indexu na zisťovanie parciálu pod kurzorom v čase O(1).
function spatialCellKey(x, y) {
	var cellX = Math.floor(x / spatialIndex.cellSize);
	var cellY = Math.floor(y / spatialIndex.cellSize);
	return cellX + '_' + cellY;
}

function spatialIndexClear() {
	spatialIndex.grid.clear();
	spatialIndex.entryPoolIndex = 0;
}

function spatialIndexGetEntry() {
	if (spatialIndex.entryPoolIndex < spatialIndex.entryPool.length) {
		return spatialIndex.entryPool[spatialIndex.entryPoolIndex++];
	}
	var entry = { trackIdx: 0, noteIdx: 0, partialIdx: 0, x: 0, y: 0, w: 0, h: 0 };
	spatialIndex.entryPool.push(entry);
	spatialIndex.entryPoolIndex++;
	return entry;
}

function spatialIndexAdd(trackIdx, noteIdx, partialIdx, x, y, w, h) {
	var cellSize = spatialIndex.cellSize;
	var x1 = Math.floor(x / cellSize);
	var y1 = Math.floor(y / cellSize);
	var x2 = Math.floor((x + w) / cellSize);
	var y2 = Math.floor((y + h) / cellSize);

	var entry = spatialIndexGetEntry();
	entry.trackIdx = trackIdx;
	entry.noteIdx = noteIdx;
	entry.partialIdx = partialIdx;
	entry.x = x;
	entry.y = y;
	entry.w = w;
	entry.h = h;

	var grid = spatialIndex.grid;
	for (let cx = x1; cx <= x2; cx++) {
		for (let cy = y1; cy <= y2; cy++) {
			var key = cx + '_' + cy;
			var cell = grid.get(key);
			if (!cell) {
				cell = [];
				grid.set(key, cell);
			}
			cell.push(entry);
		}
	}
}

function spatialIndexQuery(x, y) {
	var key = spatialCellKey(x, y);
	var cell = spatialIndex.grid.get(key);
	if (!cell) return [];

	var results = [];
	for (let i = 0; i < cell.length; i++) {
		var e = cell[i];
		if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) {
			results.push(e);
		}
	}
	return results;
}

// Pomocné funkcie pre cache gradientov
// atribút musí obsahovať presnú pozíciu, keďže gradienty na plátne majú absolútne súradnice.
function getGradientCacheKey(startX, width, color, envHash, duration, alpha) {
	// Presná pozícia v pixeloch zaokrúhlená na celé číslo, lebo gradienty závisia od pozície.
	return `${Math.round(startX)}_${Math.round(width)}_${color}_${envHash}_${duration.toFixed(2)}_${alpha.toFixed(2)}`;
}

function getCachedGradient(ctx, startX, width, color, env, duration, alpha) {
	// Jednoduchý hash pre obálku so skráteným adsr namiesto 'attack', 'decay', 'sustain', 'release'.
	var envHash = env ? (env.a || 0) + '_' + (env.d || 0) + '_' + (env.s !== undefined ? env.s : 1) + '_' + (env.r || 0) : 'none';
	var key = getGradientCacheKey(startX, width, color, envHash, duration, alpha);

	var gradient = gradientCache.get(key);
	if (gradient) return gradient;

	gradient = Envelope.createGradient(ctx, startX, width, color, env, duration, alpha);

	if (gradientCache.size > gradientCacheMaxSize) {
		gradientCache.clear();
	}
	gradientCache.set(key, gradient);
	return gradient;
}

function getPooledPath() {
	if (pathPoolIndex < pathPool.length) {
		return pathPool[pathPoolIndex++];
	}
	var path = new Path2D();
	pathPool.push(path);
	pathPoolIndex++;
	return path;
}

function resetPathPool() {
	pathPoolIndex = 0;
	// Vyprázdnenie ciest na opätovné použitie.
	for (let i = 0; i < pathPool.length; i++) {
		pathPool[i] = new Path2D();
	}
}

// Pomocné funkcie na cachovanie vrstvy pre lepší výkon.
function initStaticLayer(width, height, dpr) {
	if (!staticLayer) {
		staticLayer = document.createElement('canvas');
	}
	staticLayer.width = Math.floor(width * dpr);
	staticLayer.height = Math.floor(height * dpr);
	staticLayerCtx = staticLayer.getContext('2d');
	staticLayerCtx.scale(dpr, dpr);
	staticLayerNeedsRefresh = true;
}

function markStaticLayerForRefresh() {
	staticLayerNeedsRefresh = true;
}

var Canvas = {
	offx: 0,
	rollSize: -1,
	canvas: null,
	octaveSpacing: octaveSpacing, // V pixeloch
	offy: 6.5 * octaveSpacing,  // Predvolená vertikálna pozícia, centrovaná okolo C4.
	pitchToY: (pitchValue) => Canvas.offy - pitchValue * octaveSpacingStep,
	partialBrightness: 1,
	partialBrightnessOffset: 0, // -1 až 1, pripočíta sa k vypočítanej priesvitnosti parciálu.
	barlinesOffx: 0 % barSize,
	magnetMode: true,
	snapLines: [], // Pole pozícií v časových jednotkách, kde došlo k prichyteniu.
	snapThreshold: 0.05,
	skipGradients: false, // Nastaví sa na true pri slabom výkone, aby sa preskočilo výpočtovo náročné vykresľovanie gradientov.
	forceSkipGradients: false, // Užívateľ si v nastavení zapol 'Performance mode', takže gradienty sa preskočia vždy, bez ohľadu na záťaž.
	targetFps: 60,

	// Nastavenie Performance mode. Keď je zapnutý, vykresľovanie gradientov
	// sa preskočí vždy.
	applyPerformanceMode: (enabled) => {
		Canvas.forceSkipGradients = !!enabled;
	},
	lastFrameTime: 0, // Na obmedzenie FPS.




	// Statická vrstva sa označí na prekreslenie, ktoré sa vynúti v ďalšom snímku.
	refreshCache: () => {
		staticLayerNeedsRefresh = true;
		magnetEdgeCacheNeedsRefresh = true;
	},

	// Obnovenie cache parciálov pre všetky noty na stopách používajúcich daný identifikátor farby; spúšťa sa po uložení alebo úprave farby, aby sa parciály prepočítali všetkým notám,
	refreshTimbreCache: (spectrumKey) => {
		if (!MIDI?.data || !instruments) return;
		for (let i = 0; i < MIDI.data.length; i++) {
			if (!instruments[i] || instruments[i].spectrum !== spectrumKey) continue;
			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (note && note[N_DATA]) {
					var preservedPlaying = note[N_DATA].playing;
					var preservedVelocity = note[N_DATA].velocity;
					note[N_DATA] = preservedPlaying !== undefined
						? { playing: preservedPlaying, velocity: preservedVelocity }
						: null;
				}
			}
		}
		staticLayerNeedsRefresh = true;
	},

	reset: () => {
		if (!ctx || !Canvas.canvas) return;
		ctx.clearRect(0,0, Canvas.cssWidth, Canvas.cssHeight);
	},

	dpr: window.devicePixelRatio || 1,

	// Vysoké DPI, aby sa predišlo rozmazanému zobrazeniu predošlej verzie.
	setupHighDPICanvas: function(canvas, width, height) {
		var pxW = Math.floor(width * Canvas.dpr);
		var pxH = Math.floor(height * Canvas.dpr);
		var ctx = canvas.getContext('2d');

		// Uloženie rozmerov CSS na výpočty súradníc.
		if (canvas === Canvas.canvas) {
			Canvas.cssWidth = width;
			Canvas.cssHeight = height;
		}

		// Opätovné priradenie canvas.width vymaže plátno, čím vznikalo blikanie, takže ak sa
		// veľkosť v pixeloch nezmenila, realokácia sa úplne preskočí a transformácia DPI zostane zachovaná.
		if (canvas.width === pxW && canvas.height === pxH) {
			return ctx;
		}

		canvas.width = pxW;
		canvas.height = pxH;

		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';

		ctx.scale(Canvas.dpr, Canvas.dpr);

		return ctx;
	},

	draw: {
		keyboard: () => {
			ctx.font = "13px Arial";

			// Vertikálne čiary
			canvasWidth = Canvas.cssWidth-60;
			canvasBarlines = Math.ceil(canvasWidth/barSize);

			ctx.setLineDash([]);
			ctx.strokeStyle = '#444';

			if (typeof GridSystem !== 'undefined' && typeof Timeline !== 'undefined' && Canvas.canvas && ctx) {
				const trackIdx = Timeline.getCurrentTrackIdx();

				var canvasWidth = Canvas.cssWidth - 60;
				var viewportStart = -Canvas.offx / barSize;
				var viewportEnd = viewportStart + canvasWidth / barSize;

				var gridLines = GridSystem.getGridLines(trackIdx, viewportStart, viewportEnd);

				if (gridLines.length > 0) {
					ctx.setLineDash([]);

					// Priesvitnosť mriežky počas prehrávania klesá, aby farba nebola dominantná.
					var gridOpacity = playback.playing ? 0.7 : 1.0;

					for (const line of gridLines) {
						const x = 60.5 + Canvas.offx + line.time * barSize;

						if (x < 60 || x > Canvas.cssWidth) continue;

						if (line.type === 'major') {
							ctx.strokeStyle = `rgba(80, 80, 80, ${0.35 * gridOpacity})`;
							ctx.lineWidth = 1;
						} else {
							ctx.strokeStyle = `rgba(60, 60, 60, ${0.25 * gridOpacity})`;
							ctx.lineWidth = 1;
						}

						ctx.beginPath();
						ctx.moveTo(x, 0);
						ctx.lineTo(x, Canvas.cssHeight - timeRegionHeight);
						ctx.stroke();
					}
				}
			} else if (settings.grid != "Off") {
				// Inak staršie správanie.
				for (iC4=0; iC4 < canvasBarlines; iC4++) {
					ctx.beginPath();
					canvasBarlinesX = Canvas.barlinesOffx + iC4*barSize;
					ctx.moveTo(60.5 + canvasBarlinesX, 0);
					ctx.lineTo(60.5 + canvasBarlinesX, Canvas.cssHeight);
					ctx.stroke();
				}
			}
			
			ctx.setLineDash([]);
			ctx.fillStyle = '#111';
			ctx.fillRect(0,0, 60+0.5, Canvas.cssHeight+0.5);
			ctx.fillStyle = '#333';
			ctx.fillRect(40,0, 20, Canvas.cssHeight+0.5);
			ctx.stroke();
			ctx.fillStyle = '#1a1a1a';
			ctx.strokeStyle = '#2a2a2a';
			ctx.lineWidth = 1;

			// Aktuálna stopa a zmeny ladenia vrátane globálnych ladení z iných stôp.
			const trackIdx = typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0;
			const trackEvents = typeof Timeline !== 'undefined' ? Timeline.getTrackEvents(trackIdx) : null;

			var allTuningChanges = [];
			if (trackEvents && trackEvents.tuningChanges) {
				for (const tc of trackEvents.tuningChanges) {
					allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey });
				}
			}
			var DB_kb = typeof window !== 'undefined' && window.DB;
			if (DB_kb) {
				var allTrackEvents = DB_kb.get('trackEvents') || {};
				for (const tIdxStr in allTrackEvents) {
					var tIdx = parseInt(tIdxStr);
					if (tIdx === trackIdx) continue;
					var events = allTrackEvents[tIdx];
					if (events && events.tuningChanges) {
						for (const tc of events.tuningChanges) {
							if (tc.global) {
								allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey });
							}
						}
					}
				}
			}
			var tuningChanges = allTuningChanges.length > 0
				? allTuningChanges.sort((a, b) => a.time - b.time)
				: [{ time: 0, tuningKey: scale }];

			var viewportStartTime = -Canvas.offx / barSize;
			var viewportEndTime = viewportStartTime + canvasWidth / barSize;

			// Jednotlivé klávesy sa zobrazia podľa ladenia na pozícii hlavy prehrávania.
			var keyboardTime = playback.time;
			var keyboardScale = scale;
			for (let i = tuningChanges.length - 1; i >= 0; i--) {
				if (tuningChanges[i].time <= keyboardTime) {
					keyboardScale = tuningChanges[i].tuningKey;
					break;
				}
			}

			// Kontrola, či je ladenie klaviatúry adaptívne, lebo to má prázdne pole notes zámerne.
			var isKeyboardAdaptive = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(keyboardScale);

			if (!isKeyboardAdaptive) {
				if (!scales[keyboardScale] || !scales[keyboardScale].notes || scales[keyboardScale].notes.length < 2) {
					keyboardScale = scale; // Návrat na globálnu.
				}
				if (!scales[keyboardScale] || !scales[keyboardScale].notes || scales[keyboardScale].notes.length < 2) {
					return;
				}
			}

			var canvasHeight = Canvas.cssHeight;
			var minVisibleOctave = Math.floor((Canvas.offy - canvasHeight - 50) / octaveSpacing);
			var maxVisibleOctave = Math.ceil((Canvas.offy + 50) / octaveSpacing);

			// Vykreslí všetky C-čka v každej oktáve, založené na 12-poltónových oktávach.
			for (let iC1 = minVisibleOctave; iC1 <= maxVisibleOctave; iC1++) {
				var yPos = Canvas.offy - iC1*octaveSpacing;
				if (yPos < -50 || yPos > canvasHeight + 50) continue;

				ctx.beginPath();
				ctx.strokeStyle = '#555';
				ctx.moveTo(0+0.5, yPos+0.5);
				ctx.lineTo(40+0.5, yPos+0.5);
				ctx.stroke();

				ctx.fillStyle = '#555';
				ctx.fillText("C" + (iC1-2).toString(), 5, yPos - 10);
			}

			if (hoverPitchLine.visible) {
				var hoverY = Canvas.offy - hoverPitchLine.midiPitch * octaveSpacingStep;
				if (hoverY >= -10 && hoverY <= canvasHeight + 10) {
					// Vykreslí čiaru od ľavého okraja po klaviatúru.
					ctx.strokeStyle = '#aaa';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(0, hoverY + 0.5);
					ctx.lineTo(40, hoverY + 0.5);
					ctx.stroke();

					// Vykreslí názov noty a centy s pozadím.
					ctx.font = "9px Arial";
					var centsStr = hoverPitchLine.cents >= 0 ? '+' + hoverPitchLine.cents : hoverPitchLine.cents.toString();
					var labelText = hoverPitchLine.noteName + centsStr;
					var textWidth = ctx.measureText(labelText).width;

					ctx.fillStyle = '#111';
					ctx.fillRect(2, hoverY - 12, textWidth + 2, 10);

					ctx.fillStyle = '#aaa';
					ctx.fillText(labelText, 3, hoverY - 4);

					ctx.strokeStyle = '#2a2a2a';
					ctx.lineWidth = 1;
				}
			}

			// Vykreslí hraničné čiary MIDI, červené a prerušované, cez celú šírku plátna
			// MIDI 0 = C-1, čiže nota 0 v našom systéme
			// MIDI 127 = G9, takže horná medza je na 128.
			var midi0Y = Canvas.offy - 0 * octaveSpacingStep;
			var midi128Y = Canvas.offy - 128 * octaveSpacingStep;

			ctx.strokeStyle = '#863c3c';
			ctx.lineWidth = 1;
			ctx.setLineDash([5, 3]);

			if (midi0Y >= -50 && midi0Y <= canvasHeight + 50) {
				ctx.beginPath();
				ctx.moveTo(0, midi0Y + 0.5);
				ctx.lineTo(Canvas.cssWidth, midi0Y + 0.5);
				ctx.stroke();
			}

			if (midi128Y >= -50 && midi128Y <= canvasHeight + 50) {
				ctx.beginPath();
				ctx.moveTo(0, midi128Y + 0.5);
				ctx.lineTo(Canvas.cssWidth, midi128Y + 0.5);
				ctx.stroke();
			}
			
			ctx.setLineDash([]);
			ctx.strokeStyle = '#2a2a2a';
			ctx.lineWidth = 1;
			ctx.fillStyle = '#1a1a1a';

			var freqToY = (freq) => {
				// Vypočíta poltóny od A4 = 440 Hz, keďže zobrazenie vždy používa referenciu 440 Hz.
				var semitones = 12 * Math.log2(freq / 440) + 69;
				// octaveSpacing je počet pixelov na oktávu (12 poltónov).
				return Canvas.offy - semitones * octaveSpacing / 12;
			};

			var minVisibleY = -50;
			var maxVisibleY = Canvas.cssHeight + 50;

			// Vykreslí jednotlivé klávesy klaviatúry vľavo.
			if (isKeyboardAdaptive) {
				var adaptivePitches = AdaptiveTuning.getPitchesAtTime(keyboardTime, trackIdx, keyboardScale);

				// Kontrola, či ide o zónu 12-EDO; ak má stopa noty, klaviatúra sa nekreslí.
				const trackHasNotes = MIDI.data[trackIdx] && MIDI.data[trackIdx].length > 0;
				var is12EDOZone = AdaptiveTuning.is12EDOAtTime(keyboardTime, trackIdx, keyboardScale);

				if (!is12EDOZone || !trackHasNotes) {
					for (let p = 0; p < adaptivePitches.length - 1; p++) {
						const pitch = adaptivePitches[p];
						const nextPitch = adaptivePitches[p + 1];

						const noteY = Canvas.pitchToY(pitch.midiNote);
						const nextNoteY = Canvas.pitchToY(nextPitch.midiNote);

						const stepY = 0.5 + Math.round(noteY);
						const stepH = Math.round(noteY - nextNoteY);

						const keyTop = noteY - stepH;
						const keyBottom = noteY;

						if (keyBottom < minVisibleY || keyTop > maxVisibleY) continue;

						const isPressed = window.keyboardPreview && window.keyboardPreview.active && window.keyboardPreview.keyIndex === p;
						const isHovered = hoverStep.visible && hoverStep.stepIndex === p;

						ctx.strokeStyle = '#2a2a2a';
						ctx.setLineDash([]);
						ctx.beginPath();

						ctx.fillStyle = isPressed ? '#666' : (isHovered ? '#252525' : '#1a1a1a');
						if (pitch.isBlackKey) {
							ctx.fillRect(0.5 + 40, stepY - stepH, 20, stepH);
							ctx.stroke();
						} else if (isPressed || isHovered) {
							// Biela klávesa stlačená alebo pod kurzorom -> zvýrazní sa.
							ctx.fillStyle = isPressed ? '#666' : 'rgba(255, 255, 255, 0.04)';
							ctx.fillRect(0.5 + 40, stepY - stepH, 20, stepH);
						}
						ctx.rect(0.5 + 40, stepY - stepH, 20, stepH);
						ctx.stroke();

						// Biela čiara medzi susednými čiernymi klávesami.
						if (pitch.isBlackKey && nextPitch.isBlackKey) {
							ctx.fillStyle = '#333';
							ctx.fillRect(0.5 + 40, Math.round(noteY - stepH) + 0.5, 20, 1.5);
							ctx.fillStyle = '#1a1a1a';
						}
					}
				} // Koniec if (!is12EDOZone || !trackHasNotes).
			} else {
				// Pri bežnom ladení sa použije scaleData.notes.
				var scaleData = scales[keyboardScale];

				// Pre veľké ladenia (napr. free/cent-steps) sa zistí viditeľný rozsah, aby sa neprechádzali všetky noty a ušetril sa čas.
				var iC2Start = 0;
				if (scaleData.notes.length > 500) {
					// Binárne vyhľadávanie najnižšej viditeľnej noty (spodok obrazovky = najnižšia viditeľná výška MIDI): Y = Canvas.offy - poltóny * octaveSpacingStep, teda pri Y = Canvas.cssHeight + 50 vychádza poltóny = (Canvas.offy - cssHeight - 50) / octaveSpacingStep.
					const bottomMidi = (Canvas.offy - Canvas.cssHeight - 50) / octaveSpacingStep;
					let lo = 0, hi = scaleData.notes.length - 1;
					while (lo < hi) {
						const mid = (lo + hi) >>> 1;
						if (scaleData.notes[mid][0] < bottomMidi) lo = mid + 1;
						else hi = mid;
					}
					// Posun o pár nôt späť, aby sa nevynechali hraničné prípady.
					iC2Start = Math.max(0, lo - 5);
				}

				// Pri ladeniach s krokom menším než pixel (napr. free/cent-steps) sa kreslenie klaviatúry
				// preskočí, keďže jednotlivé klávesy by boli neviditeľné. Namiesto toho sa vykreslí jednotné pozadie. Jednotlivé klávesy sa vynechajú len vtedy, keď sa nedá vykresliť ani jedna medzera: veľké ladenia (free, EDO) sú rovnomerné, takže stačí vzorka v O(1), menšie a často nerovnomerné používajú najširšiu medzeru, aby subharmonické ladenie zostalo viditeľné aj pri oddialení.
				var sampleStepH = scaleData.notes.length <= 2 ? Infinity
					: scaleData.notes.length > 512
						? Math.abs(freqToY(scaleData.notes[0][1]) - freqToY(scaleData.notes[1][1]))
						: widestNoteStepY(scaleData.notes, freqToY);
				if (sampleStepH < 1.5) {
					if (!Canvas._keyboardSkipLogged) {
						Logger.warn('Keyboard skipped: sampleStepH =', sampleStepH.toFixed(2), 'scale:', keyboardScale, 'notes:', scaleData.notes.length, 'octaveSpacing:', octaveSpacing);
						Canvas._keyboardSkipLogged = true;
					}
				} else {
					if (!Canvas._keyboardDrawLogged || Canvas._keyboardDrawLogged !== keyboardScale) {
						Logger.log('Drawing keyboard for:', keyboardScale, 'notes:', scaleData.notes.length, 'sampleStepH:', sampleStepH.toFixed(2), 'offy:', Canvas.offy, 'octaveSpacing:', octaveSpacing);
						Canvas._keyboardDrawLogged = keyboardScale;
					}
					for (let iC2 = iC2Start; iC2 < scaleData.notes.length; iC2++) {
						const frequency = scaleData.notes[iC2][1];
						const hasNext = iC2 + 1 < scaleData.notes.length;

						const noteY = freqToY(frequency);
						const nextNoteY = hasNext
							? freqToY(scaleData.notes[iC2 + 1][1])
							: (iC2 > 0 ? 2 * noteY - freqToY(scaleData.notes[iC2 - 1][1]) : noteY - octaveSpacing / 12);

						const stepY = 0.5 + Math.round(noteY);
						const stepH = Math.round(noteY - nextNoteY);

						const keyTop = noteY - stepH;
						const keyBottom = noteY;

						if (keyBottom < minVisibleY) break; // Za horným okrajom obrazovky.
						if (keyTop > maxVisibleY) continue; // Ešte nie je viditeľné.

						const isPressed = window.keyboardPreview && window.keyboardPreview.active && window.keyboardPreview.keyIndex === iC2;
						const isHovered = hoverStep.visible && hoverStep.stepIndex === iC2;

						ctx.strokeStyle = '#2a2a2a';
						ctx.setLineDash([]);
						ctx.beginPath();

						var isBlackKey = scaleData.notes[iC2][2];
						ctx.fillStyle = isPressed ? '#666' : (isHovered ? '#252525' : '#1a1a1a');
						if (isBlackKey) {
							ctx.fillRect(0.5 + 40, stepY - stepH, 20, stepH);
							ctx.stroke();
						} else if (isPressed || isHovered) {
							// Biela klávesa stlačená alebo pod kurzorom sa vyplní zvýraznením.
							ctx.fillStyle = isPressed ? '#666' : 'rgba(255, 255, 255, 0.04)';
							ctx.fillRect(0.5 + 40, stepY - stepH, 20, stepH);
						}
						ctx.rect(0.5 + 40, stepY - stepH, 20, stepH);
						ctx.stroke();

						// Biela čiara medzi dvoma po sebe idúcimi čiernymi klávesami.
						if (isBlackKey && hasNext && scaleData.notes[iC2 + 1][2]) {
							ctx.fillStyle = '#333';
							ctx.fillRect(0.5 + 40, Math.round(noteY - stepH) + 0.5, 20, 1.5);
							ctx.fillStyle = '#1a1a1a';
						}
					}
				} // Koniec cyklu for.
			} // Koniec else

			// Prekrytia ladenia a čiary výšok tónov po segmentoch podľa zmien ladenia.
			for (let i = 0; i < tuningChanges.length; i++) {
				var change = tuningChanges[i];
				var nextChange = tuningChanges[i + 1];
				
				var segmentStartTime = change.time;
				var segmentEndTime = nextChange ? nextChange.time : Infinity;
				
				if (segmentEndTime <= viewportStartTime) continue;
				if (segmentStartTime >= viewportEndTime) break;

				var visibleStartTime = Math.max(segmentStartTime, viewportStartTime);
				var visibleEndTime = Math.min(segmentEndTime, viewportEndTime);
				
				var startX = 60.5 + (visibleStartTime - viewportStartTime) * barSize;
				var endX = 60.5 + (visibleEndTime - viewportStartTime) * barSize;
				var segmentWidth = endX - startX;
				
				if (segmentWidth <= 0) continue;
				
				var segmentScaleKey = change.tuningKey;
				if (!scales[segmentScaleKey]) continue;

				var isAdaptiveScale = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(segmentScaleKey);

				if (isAdaptiveScale) {
					var adaptiveSegments = AdaptiveTuning.getSegmentsInRange(
						visibleStartTime, visibleEndTime, trackIdx, segmentScaleKey
					);

					// Zistí sa, či stopa obsahuje nejaké noty; ak áno, segmenty 12-EDO sa preskočia.
					const trackHasNotes = MIDI.data[trackIdx] && MIDI.data[trackIdx].length > 0;

					for (const adaptiveSeg of adaptiveSegments) {
						if (adaptiveSeg.is12EDO && trackHasNotes) continue;
						
						var segStartX = 60.5 + (adaptiveSeg.startTime - viewportStartTime) * barSize;
						var segEndX = 60.5 + (Math.min(adaptiveSeg.endTime, visibleEndTime) - viewportStartTime) * barSize;
						var segWidth = segEndX - segStartX;
						
						if (segWidth <= 0) continue;
						
						var pitches = adaptiveSeg.pitches;
						if (!pitches || pitches.length === 0) continue;
						
						// Každú výšku tónu tak, aby siahala po nasledujúcu výšku, rovnako ako pri harmonickom ladení.
						for (let p = 0; p < pitches.length - 1; p++) {
							const pitch = pitches[p];
							const nextPitch = pitches[p + 1];
							
							const noteY = Canvas.pitchToY(pitch.midiNote);
							const nextNoteY = Canvas.pitchToY(nextPitch.midiNote);
							
							const stepY = 0.5 + Math.round(noteY);
							const stepH = Math.round(noteY - nextNoteY);

							const keyTop = noteY - stepH;
							const keyBottom = noteY;

							if (keyBottom < minVisibleY || keyTop > maxVisibleY) continue;

							// Prekrývací obdĺžnik, čierna klávesa je tmavšia.
							if (pitch.isBlackKey) {
								ctx.fillStyle = 'rgba(0,0,0,0.1)';
								ctx.fillRect(segStartX, stepY - stepH, segWidth, stepH);
							} else {
								ctx.fillStyle = 'rgba(255,255,255,0.01)';
								ctx.fillRect(segStartX, stepY - stepH, segWidth, stepH);
							}
							
							ctx.strokeStyle = '#111';
							ctx.setLineDash([5, 3]);
							ctx.lineWidth = 1;
							ctx.beginPath();
							ctx.moveTo(segStartX, noteY);
							ctx.lineTo(segEndX, noteY);
							ctx.stroke();
						}

						// Zvislú deliacu čiaru na začiatku segmentu, ak nie je na okraji viewportu.
						if (adaptiveSeg.startTime > viewportStartTime && !adaptiveSeg.is12EDO) {
							ctx.strokeStyle = 'rgba(140, 140, 140, 0.6)';
							ctx.setLineDash([3, 3]);
							ctx.lineWidth = 1;
							ctx.beginPath();
							ctx.moveTo(segStartX, minVisibleY);
							ctx.lineTo(segStartX, maxVisibleY);
							ctx.stroke();
						}
					}
					ctx.setLineDash([]);
					continue; // Preskočiť bežné vykresľovanie stupnice pri adaptívnom ladení.
				}

				if (!scales[segmentScaleKey].notes) continue;

				var segmentScaleData = scales[segmentScaleKey];

				// Prekrytie sa pri ladeniach s drobnými krokmi (napr. free/cent-steps) nevykresľuje, rovnako ako klaviatúra; pri menších ladeniach rozhoduje najširšia medzera, pri obrovských vzorka v O(1).
				var sampleOverlayStepH = segmentScaleData.notes.length <= 2 ? Infinity
					: segmentScaleData.notes.length > 512
						? Math.abs(freqToY(segmentScaleData.notes[0][1]) - freqToY(segmentScaleData.notes[1][1]))
						: widestNoteStepY(segmentScaleData.notes, freqToY);
				if (sampleOverlayStepH < 1.5) continue;
				
				var iC2OverlayStart = 0;
				if (segmentScaleData.notes.length > 500) {
					const bottomMidi = (Canvas.offy - Canvas.cssHeight - 50) / octaveSpacingStep;
					let lo = 0, hi = segmentScaleData.notes.length - 1;
					while (lo < hi) {
						const mid = (lo + hi) >>> 1;
						if (segmentScaleData.notes[mid][0] < bottomMidi) lo = mid + 1;
						else hi = mid;
					}
					iC2OverlayStart = Math.max(0, lo - 5);
				}
				
				for (let iC2 = iC2OverlayStart; iC2 < segmentScaleData.notes.length - 1; iC2++) {
					const frequency = segmentScaleData.notes[iC2][1];
					const nextFrequency = segmentScaleData.notes[iC2 + 1][1];
					
					const noteY = freqToY(frequency);
					const nextNoteY = freqToY(nextFrequency);
					
					const stepY = 0.5 + Math.round(noteY);
					const stepH = Math.round(noteY - nextNoteY);

					const keyTop = noteY - stepH;
					const keyBottom = noteY;

					if (keyBottom < minVisibleY) break;
					if (keyTop > maxVisibleY) continue;

					if (segmentScaleData.notes[iC2][2]) {
						// Čierna klávesa dostane tmavšie prekrytie.
						ctx.fillStyle = 'rgba(0,0,0,0.1)';
						ctx.fillRect(startX, stepY - stepH, segmentWidth, stepH);
					} else {
						// Biela klávesa dostane veľmi jemné prekrytie.
						ctx.fillStyle = 'rgba(255,255,255,0.01)';
						ctx.fillRect(startX, stepY - stepH, segmentWidth, stepH);
					}

					ctx.strokeStyle = '#111';
					ctx.setLineDash([5, 3]);
					ctx.beginPath();
					ctx.moveTo(startX, noteY);
					ctx.lineTo(endX, noteY);
					ctx.stroke();
				}
			}
			
			ctx.setLineDash([]);
			
			// Čiary značiek, teda biele zvislé čiary z markerov na časovej osi.
			if (typeof Timeline !== 'undefined' && Timeline.getTrackEvents) {
				const trackEvents = Timeline.getTrackEvents(trackIdx);
				if (trackEvents && trackEvents.markers) {
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
					ctx.lineWidth = 1;
					ctx.setLineDash([]);
					
					for (const marker of trackEvents.markers) {
						const x = 60.5 + Canvas.offx + marker.time * barSize;
						if (x < 60 || x > Canvas.cssWidth) continue;
						
						ctx.beginPath();
						ctx.moveTo(x, 0);
						ctx.lineTo(x, Canvas.cssHeight);
						ctx.stroke();
					}
				}
			}
		},
		time: () => {
			ctx.clearRect(60.5, Canvas.cssHeight - timeRegionHeight, Canvas.cssWidth, timeRegionHeight);
			ctx.setLineDash([]);
			ctx.strokeStyle = '#999';
			ctx.beginPath();
			ctx.moveTo(60.5, Canvas.cssHeight - timeRegionHeight - 0.5);
			ctx.lineTo(Canvas.cssWidth, Canvas.cssHeight - timeRegionHeight - 0.5);
			ctx.stroke();


			var canvasWidth = Canvas.cssWidth - 60;
			var canvasBarlines = Math.ceil(canvasWidth/barSize) + 1;
			// barlinesOffx musí byť pred výpočtom zosynchronizovaný s offx.
			Canvas.barlinesOffx = Canvas.offx % barSize;
			var canvasBaseId = Math.round((Canvas.barlinesOffx - Canvas.offx) / barSize);

			// Nultú čiaru
			if (Canvas.offx >= 0 && Canvas.offx < Canvas.cssWidth-60-60) {
				ctx.fillStyle = '#888';
				ctx.strokeStyle = '#444';
				ctx.beginPath();
				ctx.moveTo(60.5 + Canvas.offx, 0);
				ctx.lineTo(60.5 + Canvas.offx, Canvas.cssHeight - timeRegionHeight + 5);
				ctx.stroke();
			}

			ctx.setLineDash([]);
			for (let iC4=0; iC4 < canvasBarlines; iC4++) {
				canvasBarlinesX = Canvas.barlinesOffx + iC4*barSize;
				if (canvasBarlinesX >= 0) {
					ctx.fillStyle = '#666';
					ctx.strokeStyle = '#666';
					ctx.beginPath();
					ctx.moveTo(60.5 + canvasBarlinesX, Canvas.cssHeight - timeRegionHeight);
					ctx.lineTo(60.5 + canvasBarlinesX, Canvas.cssHeight - timeRegionHeight + 5);
					ctx.stroke();

					ctx.font = '10px Arial';
					ctx.fillText(canvasBaseId + iC4, canvasBarlinesX + 60+5, Canvas.cssHeight - timeRegionHeight + 10);
				}
			}


			if (playback.playing) {
				newTimestamp = Date.now();
				var speed = settings.playbackSpeed || 1;
				var rawDelta = (newTimestamp - playback.timestamp) / 1000;
				var delta = Math.min(rawDelta, 0.1) * speed;
				var previousTime = playback.time;
				playback.time += delta;
				playback.timestamp = newTimestamp;

				// Kontrola prechodov cez čiary mriežky v rámci metronómu.

				// V režime slučky sa kontroluje, či bol dosiahnutý jej koniec a je nutné sa vrátiť na začiatok.
				var loopCheckbox = document.getElementById('playback-loop');
				if (loopCheckbox && loopCheckbox.checked && playback.loopStart !== null && playback.loopEnd !== null) {
					if (playback.time >= playback.loopEnd) {
						// Pred návratom na začiatok slučky ukončiť všetky aktuálne znejúce noty.
						if (typeof PlaybackManager !== 'undefined') {
							PlaybackManager.stopAll();
						} else {
							// Ak PlaybackManager nie je načítaný.
							var loopNow = Tone.now();
							for (let i = 0; i < MIDI.data.length; i++) {
								if (synths[i]) {
									synths[i].releaseAll(loopNow);
								}
								for (let j = 0; j < MIDI.data[i].length; j++) {
									if (MIDI.data[i][j][N_DATA] && MIDI.data[i][j][N_DATA].playing) {
										MIDI.data[i][j][N_DATA].playing = false;
									}
								}
							}
						}
						
						playback.time = playback.loopStart;


						if (typeof SpectraOSC !== 'undefined') {
							SpectraOSC.sendLoopPoint(playback.loopStart);
						}
						var loopStartScreenX = 60 + Canvas.offx + playback.loopStart * barSize;
						if (loopStartScreenX < 60 || loopStartScreenX > Canvas.cssWidth) {
							// Posunúť viewport tak, aby bol začiatok slučky blízko ľavého okraja.
							const visibleWidth = Canvas.cssWidth - 60;
							Canvas.offx = -playback.loopStart * barSize + visibleWidth * 0.1;
							Canvas.barlinesOffx = Canvas.offx % barSize;
						}
					}
				}

				// Auto-scroll, respektíve posun v momente, keď hlava prehrávania prejde mimo viditeľnú oblasť v oboch smeroch.
				var playheadScreenX = 60 + Canvas.offx + playback.time * barSize;
				var visibleRight = Canvas.cssWidth;

				if (playheadScreenX > visibleRight) {
					const visibleWidth = Canvas.cssWidth - 60;
					Canvas.offx = -playback.time * barSize + visibleWidth * 0.1; // Umiestniť hlavu prehrávania na 10% zľava.
					Canvas.barlinesOffx = Canvas.offx % barSize;
				} else if (playheadScreenX < 60) {
					// Pri spätnom prehrávaní sa všetko automaticky posunie.
					const visibleWidth = Canvas.cssWidth - 60;
					Canvas.offx = -playback.time * barSize + visibleWidth * 0.1;
					Canvas.barlinesOffx = Canvas.offx % barSize;
				}
			}

			// PlaybackManager.update() beží každý snímok, aj keď sa neprehráva
			// vďaka tomu sa zachytia prechody play/stop
			if (typeof PlaybackManager !== 'undefined') {
				PlaybackManager.update();
			}

			// Hlava prehrávania sa vykreslí vždy počas prehrávania, pri presune alebo zmene veľkosti len vtedy, keď nehrá.
			var isMovingOrResizing = select.moving || select.resizeLeft || select.resizeRight;

			// pozn.: obnovenie cache adaptívneho ladenia počas ťahania je zbytočné,
			// pretože getPitchesAtTimeExcluding, ktoré sa počas ťahania používa, cache obchádza; cache sa obnoví pri mouseUp, keď sa ťahanie skončí.

			if (!isMovingOrResizing || playback.playing) {
				var playheadX = 60.5 + Canvas.offx + playback.time * barSize;

				// Hlavu prehrávania len vo viditeľnej oblasti, nad klaviatúrou sa nekreslí.
				if (playheadX >= 60) {
					if (!select.selecting || playback.playing) {
						var playheadAlpha = playback.playing ? 1.0 : 0.1;
						ctx.fillStyle = `rgba(255,255,255,${playheadAlpha})`;
						ctx.strokeStyle = `rgba(255,255,255,${playheadAlpha})`;
						ctx.beginPath();
						ctx.moveTo(playheadX, 0);
						ctx.lineTo(playheadX, Canvas.cssHeight - timeRegionHeight);
						ctx.stroke();
					}

					ctx.fillStyle = '#fff';
					ctx.strokeStyle = '#fff';
					ctx.beginPath();
					ctx.moveTo(playheadX, Canvas.cssHeight - timeRegionHeight);
					ctx.lineTo(playheadX, Canvas.cssHeight - timeRegionHeight + 5);
					ctx.stroke();
				}
			}

			if (typeof Timeline !== 'undefined') {
				Timeline.draw();
			}

		},
		tooltip: () => {
			if (!hoverTooltip.visible) return;
			
			var padding = 4;
			var lineHeight = 12;
			var lines = [
				`${round4(hoverTooltip.frequency)} Hz`,
				`MIDI: ${hoverTooltip.midiPitch.toFixed(1)}`,
				`${hoverTooltip.noteName}${hoverTooltip.cents >= 0 ? '+' : ''}${hoverTooltip.cents}c`,
				`Amp: ${round4(hoverTooltip.amplitude)}`
			];
			
			ctx.font = '10px Arial';
			var maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
			var tooltipWidth = maxWidth + padding * 2;
			var tooltipHeight = lines.length * lineHeight + padding * 2;
			
			var tooltipX = hoverTooltip.x;
			var tooltipY = hoverTooltip.y - tooltipHeight / 2;
			
			// Udržať tooltip v rámci plátna.
			if (tooltipX + tooltipWidth > Canvas.cssWidth) {
				tooltipX = hoverTooltip.x - tooltipWidth - 10;
			}
			if (tooltipY < 0) tooltipY = 0;
			if (tooltipY + tooltipHeight > Canvas.cssHeight - timeRegionHeight) {
				tooltipY = Canvas.cssHeight - timeRegionHeight - tooltipHeight;
			}

			ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
			ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

			ctx.strokeStyle = '#666';
			ctx.lineWidth = 1;
			ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

			ctx.fillStyle = '#fff';
			lines.forEach((line, i) => {
				ctx.fillText(line, tooltipX + padding, tooltipY + padding + (i + 1) * lineHeight - 2);
			});
		},
		notes: async () => {
			// Poistka proti tomu, že MIDI.data ešte nie je inicializované.
			if (!MIDI.data) return;

			//ctx.strokeStyle = '#000000';
			//ctx.setLineDash([]);
			ctx.globalAlpha = 1.0;
			var changeDelta = false;
			var saveMIDIData = false;

			var midiDataLen = MIDI.data.length;
			var canvasWidth = Canvas.cssWidth - 60;
			var canvasHeight = Canvas.cssHeight;
			var offx = Canvas.offx;
			var offy = Canvas.offy;
			var partialBrightness = Canvas.partialBrightness;
			var partialBrightnessOffset = Canvas.partialBrightnessOffset;

			// Rýchly odhad počtu viditeľných parciálov kvôli optimalizácii výkonu
			// preskočiť gradienty, keď by príliš veľa parciálov spôsobilo zasekávanie.
			var vpStart = -offx / barSize;
			var vpEnd = vpStart + canvasWidth / barSize;
			var estimatedVisiblePartials = 0;
			for (let t = 0; t < midiDataLen; t++) {
				const track = MIDI.data[t];
				if (!track) continue;
				for (let n = 0; n < track.length; n++) {
					const note = track[n];
					if (!note) continue;
					const noteEnd = note[N_TIME] + note[N_DUR];
					if (noteEnd >= vpStart && note[N_TIME] <= vpEnd) {
						// Odhadnúť počet parciálov podľa spektra, 16 parciálov na notu.
						estimatedVisiblePartials += 16;
					}
				}
				if (estimatedVisiblePartials > 3000) break;
			}
			Canvas.skipGradients = Canvas.forceSkipGradients || estimatedVisiblePartials > 3000;

			var defaultOctaveSpacingStepCapped = Math.min(octaveSpacingStep, 10);
			var isSelecting = select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight;
			var isMovingOrResizing = select.moving || select.resizeLeft || select.resizeRight;

			var selBoxL = 0, selBoxT = 0, selBoxR = 0, selBoxB = 0;
			if (isSelecting) {
				selBoxL = Math.min(select.x, select.offsetX);
				selBoxT = Math.min(select.y, select.offsetY);
				selBoxR = Math.max(select.x, select.offsetX);
				selBoxB = Math.max(select.y, select.offsetY);
			}

			// Vybraný nástroj sa musí vykresliť ako posledný.
			var instrumentRenderingOrder = [],
				instrumentRenderingOrderSelected = [];
			for (let iC3 = 0; iC3 < midiDataLen; iC3++) {
				// Preskočiť, ak nástroj neexistuje.
				if (!instruments[iC3]) continue;
				if (instruments[iC3].selected)
					instrumentRenderingOrderSelected.push(iC3);
				else instrumentRenderingOrder.push(iC3);
			}

			instrumentRenderingOrder = instrumentRenderingOrder.concat(instrumentRenderingOrderSelected);

			selectedPartials = [];

			var highlightedPartialsForPreview = new Set();

			// V režime magnetu sa zozbierajú všetky okraje nôt na prichytávanie, s využitím cache.
			Canvas.snapLines = [];
			var allNoteEdges = [];

			// V režime magnetu sa zozbierajú okraje nôt na prichytávanie, len keď nie je držaný Shift.
			if (Canvas.magnetMode && (select.moving || select.resizeLeft || select.resizeRight) && !shiftKey) {
				if (magnetEdgeCacheNeedsRefresh || !magnetEdgeCache) {
					var edges = [];
					for (let trackIdx = 0; trackIdx < midiDataLen; trackIdx++) {
						const track = MIDI.data[trackIdx];
						if (!track) continue;
						var trackLen = track.length;
						for (let noteIdx = 0; noteIdx < trackLen; noteIdx++) {
							const note = track[noteIdx];
							// Vybrané noty sa do cache nezahŕňajú, filtrujú sa za behu.
							if (!note[N_SEL]) {
								edges.push(note[N_TIME]);
								edges.push(note[N_TIME] + note[N_DUR]);
							}
						}
					}
					magnetEdgeCache = [...new Set(edges)].sort((a, b) => a - b);
					magnetEdgeCacheNeedsRefresh = false;
				}
				allNoteEdges = magnetEdgeCache;
			}

			// Vopred sa vypočíta časový rozsah viewportu, aby sa cyklus dal ukončiť čo najskôr.
			var viewportStartTime = -offx / barSize;
			var viewportEndTime = viewportStartTime + canvasWidth / barSize;

			for (let iC3 of instrumentRenderingOrder) {
				const instrument = instruments[iC3];
				var instrumentSpectrum = instrument.spectrum;
				// Pri nevybraných stopách si aktívne parciály zachovávajú farbu, zatiaľ čo neaktívne sú sivé.
				var instrumentActualColor = instrument.color;
				var instrumentGreyColor = '#333333';
				var isTrackSelected = instrument.selected;
				// Priesvitnosť nevybraných stôp.
				var NON_SELECTED_PARTIAL_ALPHA = 0.10;
				var midiNotes = MIDI.data[iC3];
				var midiNotesLen = midiNotes.length;

				// Stopa sa preskočí, ak nemá noty alebo sú všetky mimo viditeľného rozsahu.
				if (midiNotesLen === 0) continue;

				const timbreData = spectra[instrumentSpectrum];
				const hasDynamicTimbre = typeof DynamicTimbre !== 'undefined';
				var hasEnvelopeData = typeof Envelope !== 'undefined' &&
					(timbreData?.envelope || timbreData?.partialEnvelopes);
				// Pomocná funkcia na získanie parciálov noty pri danej výške, ktorá fundamentál spätne odvodí z pomeru activePartial.
				var getPartialsForNote = (midiPitch, activePartial) => {
					if (hasDynamicTimbre) {
						return DynamicTimbre.getPartialsAtPitch(timbreData, midiPitch);
					}
					return typeof getTimbrePartials === 'function' ? getTimbrePartials(timbreData, midiPitch) : (timbreData?.data || [[1, 1]]);
				};
				var partialsData = hasDynamicTimbre
					? DynamicTimbre.getPartialsAtPitch(timbreData, 60)
					: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbreData, 60) : (timbreData?.data || [[1, 1]]));
				var partialsLen = hasDynamicTimbre
					? DynamicTimbre.getMaxPartialCount(timbreData)
					: partialsData.length;

				ctx.fillStyle = instrumentActualColor;

				// Spoločné polia, do ktorých sa tvary pridajú a neskôr nakreslia naraz.
				var stylePaths = new Map();
				var hiddenOutlinePaths = new Map(); // Pre skryté noty (V), ktoré sa vykreslia ako jemné obrysy.
				var strokePath = new Path2D();
				var dashedPath = new Path2D();
				var distancePath = new Path2D();
				var selectedPartialPath = new Path2D();
				var selectedPartialPathFaint = new Path2D(); // Pre obrysy aktívnych parciálov nevybraných stôp.
				var spotlightPath = new Path2D();

				var hasAnySelectedNote = false;

				for (let jC3 = 0; jC3 < midiNotesLen; jC3++) {
					var selectedPartialID = -1;
					var selectedPartial = false;
					var MIDInote = midiNotes[jC3];

					// Ak sú noty mimo viditeľnej oblasti, preskočiť.
					var noteStartX = offx + MIDInote[N_TIME] * barSize;
					var noteEndX = noteStartX + MIDInote[N_DUR] * barSize;
					if (noteEndX < 0 || noteStartX > canvasWidth) continue;
					//if (noteY + noteH < 0 || noteY > canvasHeight) continue;

					if (MIDInote.length > N_DATA && MIDInote[N_DATA] && MIDInote[N_DATA].partials) {
						// Štruktúra noty musí byť úplná.
						if (MIDInote.length < 6) MIDInote.push(0);
						if (MIDInote.length < 7) MIDInote.push(0);
						var isSelected = false;
						var partials = MIDInote[N_DATA].partials;
						for (let p = 0, pLen = partials.length; p < pLen; p++) {
							if (partials[p][4] || partials[p][5]) { isSelected = true; break; }
						}
						MIDInote[N_SEL] = isSelected ? 1 : 0;
						if (isSelected) hasAnySelectedNote = true;
					}

					var isHidden = MIDInote[N_HIDDEN] === 1;

					if (MIDInote.length > N_DATA && MIDInote[N_DATA] != null && MIDInote[N_DATA].spectrum !== instrumentSpectrum) {
						var preservedPlaying = MIDInote[N_DATA].playing;
						var preservedVelocity = MIDInote[N_DATA].velocity;
						MIDInote[N_DATA] = null;
						if (preservedPlaying !== undefined) {
							MIDInote[N_DATA] = { playing: preservedPlaying, velocity: preservedVelocity };
						}
					}

					// Konvertovanie dát v pixeloch.
					if (MIDInote.length > N_DATA && MIDInote[N_DATA] != null && MIDInote[N_DATA].partials &&
						MIDInote[N_DATA].partials.length > 0 && MIDInote[N_DATA].partials[0][P_H] > 1) {
						var preservedPlaying2 = MIDInote[N_DATA].playing;
						var preservedVelocity2 = MIDInote[N_DATA].velocity;
						MIDInote[N_DATA] = preservedPlaying2 !== undefined ? { playing: preservedPlaying2, velocity: preservedVelocity2 } : null;
					}


					// Konvertovanie starších dát X/W v pixeloch.
					if (MIDInote.length > N_DATA && MIDInote[N_DATA] != null && MIDInote[N_DATA].partials &&
						MIDInote[N_DATA].partials.length > 0 && MIDInote[N_DATA].partials[0][P_W] > MIDInote[N_DUR] * 2) {
						var preservedPlaying3 = MIDInote[N_DATA].playing;
						var preservedVelocity3 = MIDInote[N_DATA].velocity;
						MIDInote[N_DATA] = preservedPlaying3 !== undefined ? { playing: preservedPlaying3, velocity: preservedVelocity3 } : null;
					}
					
					// Vypočítať fundamentálnu výšku tónu na porovnanie s cache.
					var fundamentalPitchForCache = MIDInote[N_PITCH];
					if (hasDynamicTimbre && MIDInote[N_PARTIAL]) {
						var tempBaseline = DynamicTimbre.getPartialsAtPitch(timbreData, MIDInote[N_PITCH]);
						var partialIdx = Math.max(0, Math.min(MIDInote[N_PARTIAL] - 1, tempBaseline.length - 1));
						const partialRatio = tempBaseline[partialIdx] ? tempBaseline[partialIdx][0] : 1;
						fundamentalPitchForCache = freq2note(note2freq(MIDInote[N_PITCH]) / partialRatio);
					}

					// Prepočítať parciály, ak chýbajú alebo sa fundamentálna výška tónu výrazne zmenila.
					var cachedFundamental = MIDInote[N_DATA]?.cachedFundamental ?? MIDInote[N_DATA]?.cachedPitch;
					var needsRecalc = MIDInote.length < 5 || MIDInote[N_DATA] == null ||
						!MIDInote[N_DATA].partials ||
						(hasDynamicTimbre && Math.abs((cachedFundamental || 0) - fundamentalPitchForCache) > 0.5);
					if (needsRecalc) {
						// Pred prepočtom zachovať existujúci výber a stav prehrávania.
						var existingPartials = (MIDInote.length > N_DATA && MIDInote[N_DATA] && MIDInote[N_DATA].partials) ?
							MIDInote[N_DATA].partials : null;
						var existingPlaying = (MIDInote.length > N_DATA && MIDInote[N_DATA]) ? MIDInote[N_DATA].playing : undefined;
						var existingVelocity = (MIDInote.length > N_DATA && MIDInote[N_DATA]) ? MIDInote[N_DATA].velocity : undefined;

						var notePartialsData = getPartialsForNote(MIDInote[N_PITCH], MIDInote[N_PARTIAL]);
						var notePartialsLen = notePartialsData.length;
						var MIDInoteData = {
							spectrum: instrumentSpectrum,
							partials: [],
							cachedPitch: MIDInote[N_PITCH],
							cachedFundamental: fundamentalPitchForCache,
							cachedAmps: notePartialsData,  // Cache amplitúd na konzistentné vykresľovanie.
							playing: existingPlaying,
							velocity: existingVelocity
						};

						if (MIDInote[N_PARTIAL] >= notePartialsLen) {
							MIDInote[N_PARTIAL] = notePartialsLen > 0 ? notePartialsLen : 1;
						}
						if (MIDInote[N_PARTIAL] < 1) {
							MIDInote[N_PARTIAL] = 1;
						}

						var midiNote2 = MIDInote[N_PITCH];
						var midiNote3 = MIDInote[N_PARTIAL];
						var midiNote0 = MIDInote[N_TIME];
						var midiNote1 = MIDInote[N_DUR];
						const baseFreq = note2freq(midiNote2);
						var partialIndex = Math.max(0, Math.min(midiNote3 - 1, notePartialsLen - 1));
						var basePartial = notePartialsData[partialIndex] ? notePartialsData[partialIndex][0] : 1;

						for (let kC3 = 0; kC3 < notePartialsLen; kC3++) {
							const partial = notePartialsData[kC3];
							var noteWUnits = midiNote1;  // Uložiť v časových jednotkách (taktoch) namiesto pixelov.
							const noteHFactor = 1 / Math.pow(kC3 + 1, 0.3);
							var noteXUnits = midiNote0;  // Uložiť v časových jednotkách (taktoch) namiesto pixelov.
							var noteYUnits = freq2note(baseFreq / basePartial * partial[0]);  // Uložiť ako jednotky nôt (výška spodného okraja).
							var existingSelected = (existingPartials && existingPartials[kC3]) ? existingPartials[kC3][P_SEL] : 0;
							if (!existingPartials && MIDInote[N_SEL] === 1 && kC3 === midiNote3 - 1) {
								existingSelected = 1; // Automaticky vybrať aktívny parciál pre novo vybrané noty.
							}
							var existingHover = (existingPartials && existingPartials[kC3]) ? existingPartials[kC3][P_HOVER] : 0;
							var existingLocked = (existingPartials && existingPartials[kC3]) ? (existingPartials[kC3][P_LOCKED] || 0) : 0;
							MIDInoteData.partials.push([noteXUnits, noteYUnits, noteWUnits, noteHFactor, existingSelected, existingHover, existingLocked]);
						}
						if (MIDInote.length < 5)
							MIDInote.push(MIDInoteData);
						else
							MIDInote[N_DATA] = MIDInoteData;

						if (MIDInote.length < 6)
							MIDInote.push(0);

						if (MIDInote.length < 7)
							MIDInote.push(0);

					}

					var midiNoteData = MIDInote[N_DATA].partials;
					var midiNoteDataLen = midiNoteData.length;
					var noteIdColor = getNoteIdColor(instrumentActualColor, jC3);

					var marqueeWinner = -1;
					if (isSelecting && instrument.selected) {
						for (let kW = 0; kW < midiNoteDataLen; kW++) {
							const pW = midiNoteData[kW];
							if (!pW) continue;
							const hW = pW[3] * defaultOctaveSpacingStepCapped;
							const lW = 60.5 + offx + pW[0] * barSize;
							const tW = offy - pW[1] * octaveSpacingStep - hW;
							const hit = !(lW >= selBoxR || selBoxL >= lW + pW[2] * barSize || tW + hW <= selBoxT || selBoxB <= tW);
							if (hit && (partialBrightness || kW === MIDInote[N_PARTIAL] - 1)) {
								marqueeWinner = kW;
								break;
							}
						}
					}
					var notePartialsAmps = MIDInote[N_DATA].cachedAmps
						? MIDInote[N_DATA].cachedAmps
						: getPartialsForNote(MIDInote[N_PITCH]);


					var activePartialIdx = MIDInote[N_PARTIAL] - 1;

					for (let kC3 = midiNoteDataLen - 1; kC3 >= 0; kC3--) {
						const partial = midiNoteData[kC3];

						var partialTime = partial[0];
						var partialPitch = partial[1];
						var partialDur = partial[2];
						var partialHFactor = partial[3];

						let noteX = offx + partialTime * barSize;
						let noteW = partialDur * barSize;
						let noteH = partialHFactor * defaultOctaveSpacingStepCapped;
						let noteY = offy - partialPitch * octaveSpacingStep - noteH;


						// Nekresliť mimo obrazovky.
						if (noteX + noteW <= 0 || noteX >= canvasWidth) continue;
						if (noteY + noteH <= 0 || noteY >= canvasHeight) continue;

						var noteXFull = noteX;
						var noteWFull = noteW;

						if (noteX < 0) {
							noteW += noteX;
							noteX = 0;
						}

						spatialIndexAdd(iC3, jC3, kC3, 60.5 + noteX, noteY, noteW, noteH);

						if (isSelecting && instrument.selected) {
							var noteLeft = 60.5 + noteX;
							var noteRight = noteLeft + noteW;
							var noteTop = noteY;
							var noteBottom = noteY + noteH;

							selectedPartial = !(noteLeft >= selBoxR || selBoxL >= noteRight || noteBottom <= selBoxT || selBoxB <= noteTop);
							if (selectedPartial && kC3 !== marqueeWinner) selectedPartial = false;

							if (!midiNoteData[kC3][4])
								midiNoteData[kC3][5] = 0;

							if (!partialBrightness) {
								if (activePartialIdx === kC3 && (selectedPartial || midiNoteData[kC3][4])) {
									selectedPartialID = kC3;
								}
							} else if (selectedPartial || midiNoteData[kC3][4]) {
								selectedPartialID = kC3;
							}

							if (selectedPartial && !midiNoteData[kC3][4]) {
								if (partialBrightness || kC3 === activePartialIdx) {
									highlightedPartialsForPreview.add(`${iC3}-${jC3}-${kC3}`);
									// Pridať aj do selectedPartials na zobrazenie v reálnom čase v .partial-window-selected.
									selectedPartials.push(midiNoteData[kC3][1]);
								}
							}
						}

						// Pri ťahaní alebo zmene veľkosti musí byť selectedPartialID nastavený na správne vybraný parciál.
						if (isMovingOrResizing && midiNoteData[kC3][4]) {
							selectedPartialID = kC3;
						}

						// Reset výberu, ak je zvýraznený parciál v režime T (partialBrightness==false).
						if (!partialBrightness && selectedPartialID > -1 && selectedPartialID !== activePartialIdx) {
							selectedPartialID = activePartialIdx;
						}

						//if (!Canvas.partialBrightness) continue;

						// Obrys aktívneho parciálu.
						var noteIsBeingMovedForOutline = (select.moving || select.resizeLeft || select.resizeRight) && MIDInote[N_SEL];
						if (kC3 === activePartialIdx && kC3 !== selectedPartialID && !noteIsBeingMovedForOutline) {
							// Pre nevybrané stopy použiť jemnejší obrys.
							var outlinePath = isTrackSelected ? selectedPartialPath : selectedPartialPathFaint;
							Canvas.draw.rect(outlinePath,
								60 + noteX + 1,
								noteY + 0.5,
								noteW -1,
								noteH -1);
						}


						let partialAmp = notePartialsAmps[kC3]?.[1] ?? 0.5;
						var alpha = kC3 !== activePartialIdx ? partialBrightness * partialAmp * 0.8 + 0.05 + partialBrightnessOffset : 1.0;
						if (alpha > 1) alpha = 1;
						if (alpha < 0) alpha = 0;

						if (hasAnySelectedNote && !MIDInote[N_SEL]) alpha *= 0.5;


						alpha = Math.round(alpha * 100) / 100;
						// Pri nevybraných stopách si aktívne parciály zachovávajú farbu, zatiaľ čo neaktívne sú sivé.
						var isActivePartial = kC3 === activePartialIdx;
						var baseColor = isTrackSelected
							? noteIdColor
							: (isActivePartial ? noteIdColor : instrumentGreyColor);
						var partialColor = partial[6] ? '#ff4444' : baseColor;
						var partialAlphaFinal = partial[6] ? 1 : (isTrackSelected
							? (isActivePartial ? 1 : alpha)
							: alpha * NON_SELECTED_PARTIAL_ALPHA);

						var noteIsBeingMoved = (select.moving || select.resizeLeft || select.resizeRight) && MIDInote[N_SEL];

						// Skryté noty sa vykreslia len ako obrysy.
						if (isHidden) {
							// Parciály, ktoré by boli viditeľné.
							if (partialBrightness || kC3 === activePartialIdx) {
							var hiddenAlpha = 0.5 * (kC3 === activePartialIdx ? 1.0 : partialAmp * 0.6 + 0.2 + partialBrightnessOffset);
							if (hiddenAlpha > 1) hiddenAlpha = 1;
							if (hiddenAlpha < 0) hiddenAlpha = 0;
								var hiddenKey = iC3 + "_hidden_" + hiddenAlpha;
								var hiddenEntry = hiddenOutlinePaths.get(hiddenKey);
								if (!hiddenEntry) {
									hiddenEntry = {
										path: new Path2D(),
										style: rgbaWithAlpha(partialColor, hiddenAlpha)
									};
									hiddenOutlinePaths.set(hiddenKey, hiddenEntry);
								}
								Canvas.draw.rect(hiddenEntry.path,
									60.5 + noteX,
									noteY,
									noteW,
									noteH);
							}
						}
						else if (!noteIsBeingMoved && (partialBrightness || kC3 === activePartialIdx)) {

							const drawX = 60.5 + noteX;
							var drawXFull = 60.5 + noteXFull;
							if (hasEnvelopeData && noteWFull > 30 && !Canvas.skipGradients) {
								const env = Envelope.getForPartial(timbreData, kC3 + 1);
								const noteDuration = MIDInote[N_DUR] || 1;
								var gradientColor = partial[6] ? '#ff4444' : baseColor;
								const gradient = getCachedGradient(
									ctx, drawXFull, noteWFull,
									gradientColor,
									env, noteDuration,
									partialAlphaFinal
								);

								ctx.fillStyle = gradient;
								ctx.fillRect(drawX, noteY, noteW, noteH);

								// Vnútorný tmavší box pre fundamentály.
								if (kC3 == 0 && noteW > 4 && noteH > 4) {
									const inset = 3;
									ctx.fillStyle = rgbaWithAlpha('#000000', alpha * 0.3);
									ctx.fillRect(drawX + inset, noteY + inset, noteW - inset * 2, noteH - inset * 2);
								}
							} else {
								// Pre parciály bez dát obálky sa tvary zbierajú do spoločného Path2D a kreslia naraz
								// hlavný dôvod, ktorý umožnil v projekte pokračovať.
								var key = iC3 + "_" + partialColor + "_" + partialAlphaFinal;
								let entry = stylePaths.get(key);
								if (!entry) {
									entry = {
										path: new Path2D(),
										style: rgbaWithAlpha(partialColor, partialAlphaFinal)
									};
									stylePaths.set(key, entry);
								}

								//entry.path.rect(60.5 + noteX, noteY, noteW, noteH);
								Canvas.draw.rect(entry.path,
									60.5 + noteX,
									noteY,
									noteW,
									noteH);


								// Vnútorný tmavý box pre fundamentály.
								if (kC3 == 0 && noteW > 4 && noteH > 4) {
									const inset = 3;
									var innerKey = iC3 + "_inner_" + alpha;
									var innerEntry = stylePaths.get(innerKey);
									if (!innerEntry) {
										innerEntry = {
											path: new Path2D(),
											style: rgbaWithAlpha('#000000', alpha * 0.3)
										};
										stylePaths.set(innerKey, innerEntry);
									}
									Canvas.draw.rect(innerEntry.path,
										60.5 + noteX + inset,
										noteY + inset,
										noteW - inset * 2,
										noteH - inset * 2);
								}
							}

							// Zvýraznenie (kláves S).
							if (select?.spotlight?.active && Canvas._spotlightTarget) {
								const t = Canvas._spotlightTarget;
								if (iC3 === t.trackIdx && jC3 === t.noteIdx && kC3 === t.partialIdx) {
									spotlightPath.rect(60.5 + noteX, noteY, noteW, noteH);
								}
							}
						}
					}


					if (select.moving || select.resizeLeft) {
						if (selectedPartialID > -1 && midiNoteData[selectedPartialID][4]) {
							var MIDINoteXBefore = MIDInote[N_TIME];
							const MIDINoteWBefore = MIDInote[N_DUR];
							// Použiť pôvodnú pozíciu zo sledovanej noty, aby sa predišlo problémom s akumuláciou rozdielových hodnôt pri prichytávaní.
							var trackedNote = select.dragTrackedNotes?.get(iC3)?.get(jC3);
							if (!(ctrlKey && altKey && shiftKey) && trackedNote && select.initialDragX != null) {
								var originalX = trackedNote[0];
								var targetX = originalX + (select.offsetX - select.initialDragX) / barSize;

								if (!shiftKey) {
									// Pri ťahaní sa objekt prichytáva k mriežke.
									const trackIdx = typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0;
									var snappedX = snapTimeToGrid(targetX, trackIdx, Canvas.snapThreshold);
									MIDInote[N_TIME] = snappedX;
									if (snappedX !== targetX && !Canvas.snapLines.includes(snappedX)) {
										Canvas.snapLines.push(snappedX);
									}
								} else {
									MIDInote[N_TIME] = targetX;
								}
							}

							if (Canvas.magnetMode && allNoteEdges.length > 0 && !shiftKey) {
								var noteStart = MIDInote[N_TIME];

								for (let edge of allNoteEdges) {
									if (Math.abs(noteStart - edge) < Canvas.snapThreshold) {
										MIDInote[N_TIME] = edge;
										if (!Canvas.snapLines.includes(edge)) Canvas.snapLines.push(edge);
										break;
									}
								}

								// Pri presune (nie pri zmene veľkosti) skontrolovať aj opačnú hranu.
								if (select.moving && !select.resizeLeft) {
									var newEnd = MIDInote[N_TIME] + MIDInote[N_DUR];
									for (let edge of allNoteEdges) {
										if (Math.abs(newEnd - edge) < Canvas.snapThreshold) {
											MIDInote[N_TIME] = edge - MIDInote[N_DUR];
											if (!Canvas.snapLines.includes(edge)) Canvas.snapLines.push(edge);
											break;
										}
									}
								}
							}

							var resizingLeft = false;

							if (MIDInote[N_TIME] < 0) MIDInote[N_TIME] = 0;

							if (select.resizeLeft)
								MIDInote[N_DUR] = MIDINoteWBefore - (MIDInote[N_TIME] - MIDINoteXBefore);

							// Minimálna dĺžka, aby nota pri zmene veľkosti nezmizla.
							if (MIDInote[N_DUR] < NOTE_MIN_LENGTH) MIDInote[N_DUR] = NOTE_MIN_LENGTH;
							if (MIDInote[N_DUR] != MIDINoteWBefore) resizingLeft = true;

							// Obnoviť cache adaptívneho ladenia
							// musí prebehnúť ešte pred získavaním výšok na novej pozícii.
							if (MIDInote[N_TIME] !== MIDINoteXBefore && typeof AdaptiveTuning !== 'undefined') {
								AdaptiveTuning.refresh();
							}


							var trackedNoteForPitch = select.dragTrackedNotes?.get(iC3)?.get(jC3);
							if (select.moving && !(ctrlKey && altKey && shiftKey) && !select.resizeLeft && trackedNoteForPitch && select.initialDragY != null) {
								// Vypočítať celkovú vertikálnu deltu od začiatku ťahania; kladná znamená pohyb výšky nahor
								// kontrola uzamknutých parciálov, pri ktorých sa pohyb obmedzí.
								var hasLockedPartial = false;
								var lockedPartialIdx = -1;
								var movedPartialIdx = -1;
								for (let lpCheck = 0; lpCheck < midiNoteData.length; lpCheck++) {
									if (midiNoteData[lpCheck][6]) {
										hasLockedPartial = true;
										lockedPartialIdx = lpCheck;
									}
									if (midiNoteData[lpCheck][4] && !midiNoteData[lpCheck][6]) {
										movedPartialIdx = lpCheck;
									}
								}

								if (hasLockedPartial && movedPartialIdx >= 0) {
									var dragDeltaY = -(select.offsetY - select.initialDragY);
									const noteDelta = dragDeltaY / octaveSpacingStep;

									if (Math.abs(noteDelta) > 0.5) {
										const direction = noteDelta > 0 ? 1 : -1;
										var result = findLockedConstrainedPosition(iC3, jC3, direction, movedPartialIdx);
										if (result) {
											MIDInote[N_PITCH] = Math.max(pitchEditMin, Math.min(pitchEditMax, result.newNote2));
											select.dragChanged = true;
											var specData = getSpectrumDataSafe(iC3);
											const baseRatio = specData[MIDInote[N_PARTIAL]-1] ? specData[MIDInote[N_PARTIAL]-1][0] : MIDInote[N_PARTIAL];
											for (let rp = 0; rp < midiNoteData.length; rp++) {
												const specRatio = specData[rp] ? specData[rp][0] : (rp + 1);
												midiNoteData[rp][1] = freq2note(note2freq(MIDInote[N_PITCH]) / baseRatio * specRatio);
												midiNoteData[rp][4] = 0;
												midiNoteData[rp][6] = 0;
											}
											if (result.newMovedPartialIdx < midiNoteData.length) {
												midiNoteData[result.newMovedPartialIdx][4] = 1;
											}
											if (result.newLockedPartialIdx < midiNoteData.length) {
												midiNoteData[result.newLockedPartialIdx][6] = 1;
											}
											select.initialDragY = select.offsetY;
										}
									}
								}

								if (!hasLockedPartial) {
								var totalDeltaY = -(select.offsetY - select.initialDragY);

								var originalNote = trackedNoteForPitch[2];
								var originalPartial = trackedNoteForPitch[3];

								var origSpectrumData = getSpectrumDataSafe(iC3);
								var originalPartialRatio = origSpectrumData[originalPartial - 1]?.[0] || originalPartial;

								var originalFundamentalNote = freq2note(note2freq(originalNote) / originalPartialRatio);

								const noteDelta = totalDeltaY / octaveSpacingStep;

								var virtualNote = originalFundamentalNote + noteDelta;
								var virtualFreq = note2freq(virtualNote);

								var noteTuning = getTuningAtTime(MIDInote[N_TIME] + 0.0001, iC3);

								if (typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(noteTuning)) {
									var pitches = AdaptiveTuning.getPitchesAtTimeExcluding(MIDInote[N_TIME], iC3, noteTuning, jC3);

									if (pitches && pitches.length > 0) {
										var closestPitch = pitches[0];
										let closestDistance = Math.abs(virtualFreq - closestPitch.freq);
										
										for (let pIdx = 1; pIdx < pitches.length; pIdx++) {
											const distance = Math.abs(virtualFreq - pitches[pIdx].freq);
											if (distance < closestDistance) {
												closestDistance = distance;
												closestPitch = pitches[pIdx];
											}
										}
										
										var targetFreq = closestPitch.freq;
										const newNotePitch = freq2note(targetFreq);

										if (Math.abs(MIDInote[N_PITCH] - newNotePitch) > 0.001) {
											// Zachovať pôvodné číslo parciálu.
											const preservedPartialNum = originalPartial;

											const MIDInotePartialsSpec = getPartialsForNote(newNotePitch, preservedPartialNum);
											const partialRatio = MIDInotePartialsSpec[preservedPartialNum - 1] ?
												MIDInotePartialsSpec[preservedPartialNum - 1][0] : 1;

											var newNote2 = Math.max(pitchEditMin, Math.min(pitchEditMax, freq2note(targetFreq * partialRatio)));

											MIDInote[N_PITCH] = newNote2;
											MIDInote[N_PARTIAL] = preservedPartialNum;
											select.dragChanged = true;

											// Prepočítať pozície všetkých parciálov pre novú výšku.
											for (let mC = 0; mC < midiNoteData.length; mC++) {
												const pNoteW = MIDInote[N_DUR];
												const pNoteHFactor = 1 / Math.pow(mC + 1, 0.3);
												const pNoteX = MIDInote[N_TIME];
												// Ak je k dispozícii pomer zo spektra, použije sa on, inak sa použije harmonický pomer.
												const specRatio = MIDInotePartialsSpec[mC] ? MIDInotePartialsSpec[mC][0] : (mC + 1);
												const pNoteYUnits = freq2note(targetFreq * specRatio / partialRatio);

												midiNoteData[mC][0] = pNoteX;
												midiNoteData[mC][1] = pNoteYUnits;
												midiNoteData[mC][2] = pNoteW;
												midiNoteData[mC][3] = pNoteHFactor;
											}

											if (MIDInote[N_DATA]) {
												MIDInote[N_DATA].cachedAmps = MIDInotePartialsSpec;
												MIDInote[N_DATA].cachedFundamental = freq2note(targetFreq);
											}

											if (window['switch-checkbox-headphones']?.checked) {
												const previewAmp = MIDInotePartialsSpec[preservedPartialNum - 1]?.[1] ?? 1;
												Canvas.previewDragSine(targetFreq, iC3, previewAmp);
											}

											AdaptiveTuning.refresh();
										}
									}
								} else {
									// Pohyb v štandardnom ladení pomocou orderedPartials.
									const orderedPartials = DB.getOrderedPartials(noteTuning, instruments[iC3].spectrum, settings.orderedPartialsSelection);

									if (orderedPartials) {
										// Nájsť najbližší fundamentál (kde [4] == 1).
										var closestFundamental = null;
										let closestDistance = Infinity;
										
										for (let idx = 0; idx < orderedPartials.length; idx++) {
											if (orderedPartials[idx][4] === 1) { // Len fundamentály
												const distance = Math.abs(orderedPartials[idx][1] - virtualNote);
												if (distance < closestDistance) {
													closestDistance = distance;
													closestFundamental = orderedPartials[idx];
												}
											}
										}
										
										if (closestFundamental) {
											var targetFundamentalPitch = closestFundamental[1];

											const preservedPartialNum = originalPartial;

											const MIDInotePartialsSpec = getPartialsForNote(freq2note(note2freq(targetFundamentalPitch) * (preservedPartialNum)), preservedPartialNum);
											const partialRatio = MIDInotePartialsSpec[preservedPartialNum - 1]?.[0] || preservedPartialNum;
											const newNotePitch = Math.max(pitchEditMin, Math.min(pitchEditMax, freq2note(note2freq(targetFundamentalPitch) * partialRatio)));

											if (MIDInote[N_PITCH] !== newNotePitch) {
												MIDInote[N_PITCH] = newNotePitch;
												MIDInote[N_PARTIAL] = preservedPartialNum;
												select.dragChanged = true;

												// Prepočítať pozície všetkých parciálov pre novú výšku.
												for (let mC = 0; mC < midiNoteData.length; mC++) {
													const pNoteW = MIDInote[N_DUR];
													const pNoteHFactor = 1 / Math.pow(mC + 1, 0.3);
													const pNoteX = MIDInote[N_TIME];
													// Ak je k dispozícii pomer zo spektra, použije sa on, inak sa použije harmonický pomer.
													const specRatio = MIDInotePartialsSpec[mC] ? MIDInotePartialsSpec[mC][0] : (mC + 1);
													const baseRatio = MIDInotePartialsSpec[MIDInote[N_PARTIAL] - 1] ? MIDInotePartialsSpec[MIDInote[N_PARTIAL] - 1][0] : MIDInote[N_PARTIAL];
													const pNoteYUnits = freq2note(note2freq(MIDInote[N_PITCH]) / baseRatio * specRatio);

													midiNoteData[mC][0] = pNoteX;
													midiNoteData[mC][1] = pNoteYUnits;
													midiNoteData[mC][2] = pNoteW;
													midiNoteData[mC][3] = pNoteHFactor;
												}

												if (MIDInote[N_DATA]) {
													MIDInote[N_DATA].cachedAmps = MIDInotePartialsSpec;
													MIDInote[N_DATA].cachedFundamental = targetFundamentalPitch;
												}

												if (window['switch-checkbox-headphones']?.checked) {
													const previewAmp = MIDInotePartialsSpec[preservedPartialNum - 1]?.[1] ?? 1;
													Canvas.previewDragSine(note2freq(targetFundamentalPitch), iC3, previewAmp);
												}
											}
										}
									}
								}
							}
							}

							if (MIDInote.length > 4) {
								const partials6Len = midiNoteData.length;
								for (let kC3 = 0; kC3 < partials6Len; kC3++) {
									const partial = midiNoteData[kC3];
									var MIDINoteXBeforePartial = partial[0];

									
									if (!(ctrlKey && altKey && shiftKey)) {
										// Synchronizovať X parciálu s X MIDInote, ktoré sú vždy rovnaké.
										partial[0] = MIDInote[N_TIME];
									}

									if (select.resizeLeft && resizingLeft) {
										partial[2] = MIDInote[N_DUR];
									}

									const px = Canvas.offx + partial[0] * barSize;
									const pw = partial[2] * barSize;
									const defaultOctaveSpacingStep = 10;
									const ph = partial[3] * Math.min(octaveSpacingStep, defaultOctaveSpacingStep);
									const py = Canvas.offy - partial[1] * octaveSpacingStep - ph;

									// Preskočiť, ak parciál nie je viditeľný alebo je skrytý prepínačom T.
									if (px + pw >= 0 && (Canvas.partialBrightness || kC3 === MIDInote[N_PARTIAL] - 1)) {
										const drawX = px < 0 ? 60 : 60 + px;
										const drawW = px < 0 ? pw + px : pw;

										// Vypočítať priesvitnosť parciálu.
										let pAmp = notePartialsAmps[kC3]?.[1] ?? 0.5;
										let partialAlpha = kC3 !== MIDInote[N_PARTIAL] - 1 ? partialBrightness * pAmp * 0.8 + 0.05 + partialBrightnessOffset : 1.0;
										if (partialAlpha > 1) partialAlpha = 1;
										if (partialAlpha < 0) partialAlpha = 0;

										// Vyplnený box; pri nevybraných stopách si aktívne parciály zachovávajú farbu, neaktívne sú sivé.
										var moveIsActivePartial = kC3 === MIDInote[N_PARTIAL] - 1;
										var moveBaseColor = isTrackSelected
											? noteIdColor
											: (moveIsActivePartial ? noteIdColor : instrumentGreyColor);
										const fillColor = partial[6] ? '#ff4444' : moveBaseColor;
										var movePartialAlpha = isTrackSelected ? partialAlpha : partialAlpha * 0.6;
										if (hasEnvelopeData && drawW > 60) {
											const env = Envelope.getForPartial(timbreData, kC3 + 1);
											const noteDuration = MIDInote[N_DUR] || 1;
											const gradient = getCachedGradient(ctx, drawX + 0.5, drawW, fillColor, env, noteDuration, partial[6] ? 1 : movePartialAlpha);
											ctx.fillStyle = gradient;
											ctx.fillRect(drawX + 0.5, py, drawW, ph);
										} else {
											ctx.fillStyle = rgbaWithAlpha(fillColor, partial[6] ? 1 : movePartialAlpha);
											ctx.fillRect(drawX + 0.5, py, drawW, ph);
										}

										// Vnútorný tmavý box pre fundamentály.
										if (kC3 == 0 && drawW > 4 && ph > 4) {
											const inset = 3;
											ctx.fillStyle = rgbaWithAlpha('#000000', movePartialAlpha * 0.3);
											ctx.fillRect(drawX + 0.5 + inset, py + inset, drawW - inset * 2, ph - inset * 2);
										}

										// Obrys výberu iba pre vybrané parciály.
										if (partial[4] || partial[5]) {
											ctx.beginPath();
											ctx.strokeStyle = '#fff';
											ctx.setLineDash([4, 2]);
											ctx.rect(drawX + 0.5, py + 0.5, drawW - 1, ph - 1);
											ctx.stroke();
											ctx.setLineDash([]);
										}

										// Obrys aktívneho parciálu s aktualizovanou pozíciou.
										if (kC3 === MIDInote[N_PARTIAL] - 1 && !partial[4] && !partial[5]) {
											var movOutlinePath = isTrackSelected ? selectedPartialPath : selectedPartialPathFaint;
											Canvas.draw.rect(movOutlinePath,
												drawX + 1,
												py + 0.5,
												drawW - 1,
												ph - 1);
										}

									}
								}
							}

							if (round4(MIDINoteXBefore) !== round4(MIDInote[N_TIME])) {
								changeDelta = true;
								select.dragChanged = true;
							}

							saveMIDIData = true;
						}
					} else if (select.resizeRight) {
						if (selectedPartialID > -1 && midiNoteData[selectedPartialID][4]) {
							const MIDINoteWBefore = MIDInote[N_DUR];

							var resizingRight = false,
								lengthCopy = MIDInote[N_DUR];
							var trackedNoteForResize = select.dragTrackedNotes?.get(iC3)?.get(jC3);
							if (trackedNoteForResize && select.initialDragX != null) {
								var originalW = trackedNoteForResize[1];
								var targetW = originalW + (select.offsetX - select.initialDragX) / barSize;

								if (!shiftKey) {
									const trackIdx = typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0;
									var targetEnd = MIDInote[N_TIME] + targetW;
									var snappedEnd = snapTimeToGrid(targetEnd, trackIdx, Canvas.snapThreshold);
									MIDInote[N_DUR] = snappedEnd - MIDInote[N_TIME];
									if (snappedEnd !== targetEnd && !Canvas.snapLines.includes(snappedEnd)) {
										Canvas.snapLines.push(snappedEnd);
									}
								} else {
									MIDInote[N_DUR] = targetW;
								}
							}

							// Prichytávanie v režime magnetu z druhej strany.
							if (Canvas.magnetMode && allNoteEdges.length > 0 && !shiftKey) {
								const noteEnd = MIDInote[N_TIME] + MIDInote[N_DUR];
								for (let edge of allNoteEdges) {
									if (Math.abs(noteEnd - edge) < Canvas.snapThreshold) {
										MIDInote[N_DUR] = edge - MIDInote[N_TIME];
										if (!Canvas.snapLines.includes(edge)) Canvas.snapLines.push(edge);
										break;
									}
								}
							}
							
							if (MIDInote[N_DUR] < NOTE_MIN_LENGTH) MIDInote[N_DUR] = NOTE_MIN_LENGTH;

							if (MIDInote[N_DUR] != lengthCopy) resizingRight = true;

							if (MIDInote.length > 4) {
								const partials6Len = midiNoteData.length;
								for (let kC3 = 0; kC3 < partials6Len; kC3++) {
									const partial = midiNoteData[kC3];

									if (resizingRight) {
										// Zosynchronizuje sa šírka parciálu so šírkou MIDInote.
										partial[2] = MIDInote[N_DUR];
									}

									// Všetky parciály danej noty naraz (kvôli synchronizácii s aktualizáciou pozície).
									const px = Canvas.offx + partial[0] * barSize;
									const pw = partial[2] * barSize;
									const defaultOctaveSpacingStep = 10;
									const ph = partial[3] * Math.min(octaveSpacingStep, defaultOctaveSpacingStep);
									const py = Canvas.offy - partial[1] * octaveSpacingStep - ph;
									
									// Preskočiť, ak parciál nie je viditeľný alebo je skrytý prepínačom T.
									if (px + pw >= 0 && (Canvas.partialBrightness || kC3 === MIDInote[N_PARTIAL] - 1)) {
										const drawX = px < 0 ? 60 : 60 + px;
										const drawW = px < 0 ? pw + px : pw;

										// Vypočítať priesvitnosť pre daný parciál.
										let pAmp = notePartialsAmps[kC3]?.[1] ?? 0.5;
										let partialAlpha = kC3 !== MIDInote[N_PARTIAL] - 1 ? partialBrightness * pAmp * 0.8 + 0.05 + partialBrightnessOffset : 1.0;
										if (partialAlpha > 1) partialAlpha = 1;
										if (partialAlpha < 0) partialAlpha = 0;

										// Vyplnený box; pri nevybraných stopách si aktívne parciály zachovávajú farbu, neaktívne sú sivé.
										var resizeIsActivePartial = kC3 === MIDInote[N_PARTIAL] - 1;
										var resizeBaseColor = isTrackSelected
											? noteIdColor
											: (resizeIsActivePartial ? noteIdColor : instrumentGreyColor);
										const fillColor = partial[6] ? '#ff4444' : resizeBaseColor;
										var resizePartialAlpha = isTrackSelected ? partialAlpha : partialAlpha * 0.6;
										if (hasEnvelopeData && drawW > 60) {
											const env = Envelope.getForPartial(timbreData, kC3 + 1);
											const noteDuration = MIDInote[N_DUR] || 1;
											const gradient = getCachedGradient(ctx, drawX + 0.5, drawW, fillColor, env, noteDuration, partial[6] ? 1 : resizePartialAlpha);
											ctx.fillStyle = gradient;
											ctx.fillRect(drawX + 0.5, py, drawW, ph);
										} else {
											ctx.fillStyle = rgbaWithAlpha(fillColor, partial[6] ? 1 : resizePartialAlpha);
											ctx.fillRect(drawX + 0.5, py, drawW, ph);
										}

										// Tmavý obdĺžnik pre fundamentály.
										if (kC3 == 0 && drawW > 4 && ph > 4) {
											const inset = 3;
											ctx.fillStyle = rgbaWithAlpha('#000000', resizePartialAlpha * 0.3);
											ctx.fillRect(drawX + 0.5 + inset, py + inset, drawW - inset * 2, ph - inset * 2);
										}

										// Obrys výberu len pre označené parciály.
										if (partial[4] || partial[5]) {
											ctx.beginPath();
											ctx.strokeStyle = '#fff';
											ctx.setLineDash([4, 2]);
											ctx.rect(drawX + 0.5, py + 0.5, drawW - 1, ph - 1);
											ctx.stroke();
											ctx.setLineDash([]);
										}

									}
								}
							}

							if (round4(MIDINoteWBefore) !== round4(MIDInote[N_DUR])) {
								changeDelta = true;
								select.dragChanged = true;
							}

							partialWindowNote.textContent = round4( freq2note(note2freq(MIDInote[N_PITCH]) / MIDInote[N_PARTIAL]) );
							partialWindowPartial.textContent = MIDInote[N_PARTIAL];
							partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDInote[N_PITCH]));
							partialWindowTime.textContent = round4(MIDInote[N_TIME]);
							partialWindowLength.textContent = round4(MIDInote[N_DUR]);

							saveMIDIData = true;
						}
					} else {
						if (selectedPartialID > -1 
								&& (Canvas.partialBrightness
									|| (!Canvas.partialBrightness && selectedPartialID == MIDInote[N_PARTIAL]-1)
									// MIDInote[N_PARTIAL] je vybraný parciál indexovaný od 1, zatiaľ čo selectedPartialID je indexovaný od 0.
								)
							) {
							midiNoteData[selectedPartialID][5] = 1;
							saveMIDIData = true;

							// Prerušovanú čiaru okolo parciálu (parciálov).
							var defaultOctaveSpacingStepForOutline = 10;
							var cappedPartialHeight = midiNoteData[selectedPartialID][3] * Math.min(octaveSpacingStep, defaultOctaveSpacingStepForOutline);
										if (offx + midiNoteData[selectedPartialID][0] * barSize < 0)
								Canvas.draw.rect(dashedPath,
									60,
												offy - midiNoteData[selectedPartialID][1] * octaveSpacingStep - cappedPartialHeight - 0.5,
												1 + midiNoteData[selectedPartialID][2] * barSize + offx + midiNoteData[selectedPartialID][0] * barSize,
									1 + cappedPartialHeight);
							else
								Canvas.draw.rect(dashedPath,
												60 + offx + midiNoteData[selectedPartialID][0] * barSize,
												offy - midiNoteData[selectedPartialID][1] * octaveSpacingStep - cappedPartialHeight - 0.5,
												1 + midiNoteData[selectedPartialID][2] * barSize,
									1 + cappedPartialHeight);
						}
						ctx.setLineDash([]);
						for (let kC3 = midiNoteDataLen - 1; kC3 >= 0; kC3--) {
							const partial = midiNoteData[kC3];
							if (partial[4]) {
								var cappedH = partial[3] * Math.min(octaveSpacingStep, 10);
											if (Canvas.offx + partial[0] * barSize + partial[2] * barSize >= 0) {
												if (Canvas.offx + partial[0] * barSize < 0)
										Canvas.draw.rect(strokePath,
											60,
														Canvas.offy - partial[1] * octaveSpacingStep - cappedH - 0.5,
														1 + partial[2] * barSize + Canvas.offx + partial[0] * barSize,
											1 + cappedH);
									else
										Canvas.draw.rect(strokePath,
														60 + Canvas.offx + partial[0] * barSize,
														Canvas.offy - partial[1] * octaveSpacingStep - cappedH - 0.5,
														1 + partial[2] * barSize,
											1 + cappedH);

									selectedPartials.push( partial[1] );
									// * spectra[MIDInote[N_DATA].spectrum].data[kC3][0]
								}
							}
						}
					}
				}

				// Vykreslenie nazbieraných výplní.
				for (const entry of stylePaths.values()) {
					if (entry.isStroke) {
						ctx.strokeStyle = entry.style;
						ctx.lineWidth = 1;
						ctx.stroke(entry.path);
					} else {
						ctx.fillStyle = entry.style;
						ctx.fill(entry.path);
					}
				}

				// Vykreslenie nazbieraných obrysov skrytých nôt (len obtiahnuté, nevyplnené).
				ctx.setLineDash([4, 3]);
				for (const { path, style } of hiddenOutlinePaths.values()) {
					ctx.strokeStyle = style;
					ctx.lineWidth = 1;
					ctx.stroke(path);
				}
				ctx.setLineDash([]);

				// Parciály vybrané myšou.
				ctx.strokeStyle = "rgba(255,255,255,0.5)";
				ctx.setLineDash([4,2]);
				ctx.stroke(distancePath);

				ctx.strokeStyle = "#fff";
				ctx.setLineDash([4,2]);
				ctx.stroke(strokePath);

				// Aktívne parciály v spektre (pri vybraných stopách bez priesvitnosti).
				ctx.strokeStyle = "#fff";
				ctx.setLineDash([]);
				ctx.stroke(selectedPartialPath);

				ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
				ctx.stroke(selectedPartialPathFaint);

				// Prerušované prekrytie uprostred výberu.
				ctx.strokeStyle = rgbaWithAlpha("#ffffff", 0.8);
				ctx.setLineDash([4, 2]);
				ctx.stroke(dashedPath);

				// Zvýraznenia spotlight, kreslené naraz.
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
				ctx.setLineDash([]);
				ctx.lineWidth = 1.5;
				ctx.stroke(spotlightPath);

				ctx.globalAlpha = 1.0;
				ctx.setLineDash([]);
				ctx.lineWidth = 1;
			}

			if (changeDelta) {
				select.deltaX = select.offsetX;
				select.deltaY = select.offsetY;
			}

			if (saveMIDIData) {
				
				// Lokálne ukladanie spomalené na 500 ms, aby sa nezaťažovala DB.
				if (new Date().getTime() - lastDBsaveTime > 500) {
					DB.set('MIDIdata', MIDI.data);
					lastDBsaveTime = new Date().getTime();
				}
			}

			ctx.globalAlpha = 1.0;

			if (selectedPartials.length) {
				partialWindowSelectedElement.style.display = '';
				selectedPartialsText = "";
				for (kC3 = 0; kC3 < selectedPartials.length; kC3++) {
					selectedPartialsText += (selectedPartialsText.length == 0 ? "" : " ") + Math.round(selectedPartials[kC3]*100)/100;
				}
				partialWindowSelectedElementDiv.textContent = selectedPartialsText;
			} else partialWindowSelectedElement.style.display = 'none';
			
			// Aktualizácia nahrávaných nôt, ktorým sa trvanie predlžuje po aktuálnu hlavu prehrávania.
			if (window.midiRecording && window.midiRecording.active) {
				window.midiRecording.updateActiveNotes();
			}
			
			// Vykreslenie orientačných nôt zo vstupu MIDI (slabé obrysy pri držaní kláves)
			// počas nahrávania sa preskakujú a namiesto nich sa kreslia skutočné noty.
			if (window.midiInputPreview && window.midiInputPreview.notes.size > 0 && window.pageNumber === 2
				&& !(window.midiRecording && window.midiRecording.active)) {
				ctx.save();
				
				var selectedInstrumentIndex = 0;
				for (let i = 0; i < instruments.length; i++) {
					if (instruments[i].selected) {
						selectedInstrumentIndex = i;
						break;
					}
				}
				const instrument = instruments[selectedInstrumentIndex];
				var instrumentColor = instrument.color || '#666';
				const timbreData = spectra[instrument.spectrum];
				const hasDynamicTimbre = typeof DynamicTimbre !== 'undefined';

				var tempo = typeof window.tempo !== 'undefined' ? window.tempo : 120;
				var previewDuration = tempo / 60;

				for (let [midiNote, noteData] of window.midiInputPreview.notes) {
					// Použiť čas stlačenia klávesy namiesto aktuálneho playback.time.
					var noteTime = noteData.startTime !== undefined ? noteData.startTime : playback.time;
					const noteX = Canvas.offx + noteTime * barSize;
					const noteW = previewDuration * barSize;

					if (noteX + noteW < 0 || noteX > Canvas.cssWidth) continue;

					var pitchToUse = midiNote;
					if (noteData.snappedPitch !== undefined) {
						pitchToUse = noteData.snappedPitch;
					} else if (typeof AdaptiveTuning !== 'undefined') {
						const tuningKey = typeof Timeline !== 'undefined'
							? Timeline.getTuningAtTime(noteTime, selectedInstrumentIndex)
							: settings.scale;
						if (AdaptiveTuning.isAdaptive(tuningKey)) {
							var scale = scales[tuningKey];
							if (scale && scale.applyToPreview !== false) {
								// Pri zapnutom applyToPreview sa prichytí k dostupným výškam v čase noty (keď bola klávesa stlačená).
								pitchToUse = AdaptiveTuning.snapMidiNote(midiNote, noteTime, selectedInstrumentIndex, tuningKey);
							} else {
								// Pri vypnutom sa kvôli konzistentnosti použije rovnaký okamih stlačenia.
								pitchToUse = AdaptiveTuning.snapMidiNote(midiNote, noteTime, selectedInstrumentIndex, tuningKey);
							}
						}
					}

					const spectrumData = hasDynamicTimbre
						? DynamicTimbre.getPartialsAtPitch(timbreData, pitchToUse)
						: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbreData, pitchToUse) : (timbreData?.data || [[1, 1]]));

					const baseFreq = note2freq(pitchToUse);

					for (let k = 0; k < spectrumData.length; k++) {
						const partial = spectrumData[k];
						if (!partial) continue;
						const partialFreq = baseFreq * partial[0];
						var partialNote = freq2note(partialFreq);
						const noteHFactor = 1 / Math.pow(k + 1, 0.3);
						
						const defaultOctaveSpacingStep = 10;
						const noteH = noteHFactor * Math.min(octaveSpacingStep, defaultOctaveSpacingStep);
						const noteY = Canvas.offy - partialNote * octaveSpacingStep - noteH;

						if (noteY + noteH < 0 || noteY > Canvas.cssHeight) continue;

						const drawX = noteX < 0 ? 60 : 60 + noteX;
						const drawW = noteX < 0 ? noteW + noteX : noteW;

						if (drawW <= 0) continue;

						ctx.globalAlpha = k === 0 ? 0.3 : 0.15; // Silnejšie pre fundamentál.
						ctx.fillStyle = instrumentColor;
						ctx.fillRect(drawX + 0.5, noteY, drawW, noteH);

						ctx.globalAlpha = k === 0 ? 0.6 : 0.3;
						ctx.strokeStyle = instrumentColor;
						ctx.lineWidth = 1;
						ctx.setLineDash([4, 4]);
						ctx.strokeRect(drawX + 0.5, noteY + 0.5, drawW - 1, noteH - 1);
					}
				}
				
				ctx.globalAlpha = 1.0;
				ctx.setLineDash([]);
				ctx.restore();
			}
			
			
			// Prerušované čiary prichytenia pri režime magnetu alebo pri prichytávaní k mriežke cez Shift+ťahanie.
			if (Canvas.snapLines.length > 0 && isMovingOrResizing && (Canvas.magnetMode || !shiftKey)) {
				ctx.save();
				ctx.strokeStyle = '#888';
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);
				
				for (let snapX of Canvas.snapLines) {
					var screenX = 60.5 + Canvas.offx + snapX * barSize;
					if (screenX >= 60 && screenX <= Canvas.cssWidth) {
						ctx.beginPath();
						ctx.moveTo(screenX, 0);
						ctx.lineTo(screenX, Canvas.cssHeight);
						ctx.stroke();
					}
				}
				
				ctx.restore();
			}

			
			if (select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight) {
				Canvas.updateSelectionPreview(highlightedPartialsForPreview);
			} else if (Canvas._selectionOscs.size > 0) {
				Canvas.stopSelectionPreview();
			}

		},

		selectBox: () => {
			if (!select.selecting || select.moving || select.resizeLeft || select.resizeRight) return;

			ctx.beginPath();
			ctx.lineWidth = 1;
			ctx.setLineDash([5,2]);
			ctx.strokeStyle = '#eee';
			ctx.rect(select.x+0.5, select.y+0.5, select.offsetX - select.x, select.offsetY - select.y);
			ctx.stroke();
		},

		loopGuideLines: () => {
			if (typeof Spectra !== 'undefined' && Spectra.edition === 'mini') return;
			if (typeof Timeline === 'undefined' || !Timeline.interaction.loopDragging) return;
			if (Timeline.interaction.loopDragging !== 'start' && Timeline.interaction.loopDragging !== 'end') return;
			if (typeof playback === 'undefined' || playback.loopStart === null || playback.loopEnd === null) return;

			ctx.save();
			ctx.setLineDash([4, 4]);
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';

			var loopStartX = 60.5 + Canvas.offx + playback.loopStart * barSize;
			if (loopStartX >= 60 && loopStartX <= Canvas.cssWidth) {
				ctx.beginPath();
				ctx.moveTo(loopStartX, 0);
				ctx.lineTo(loopStartX, Canvas.cssHeight - timeRegionHeight);
				ctx.stroke();
			}

			var loopEndX = 60.5 + Canvas.offx + playback.loopEnd * barSize;
			if (loopEndX >= 60 && loopEndX <= Canvas.cssWidth) {
				ctx.beginPath();
				ctx.moveTo(loopEndX, 0);
				ctx.lineTo(loopEndX, Canvas.cssHeight - timeRegionHeight);
				ctx.stroke();
			}

			ctx.restore();
		},

		rect: (path, note_x, note_y, note_w, note_h) => {
			path.rect(note_x, note_y, note_w, note_h);
		}
	},
	// Pauza v rámci vykresľovania kvôli záťaži CPU.
	paused: false,

	pause: () => {
		Canvas.paused = true;
	},

	resume: () => {
		if (Canvas.paused) {
			Canvas.paused = false;
			requestAnimationFrame(Canvas.step);
		}
	},

	// Jedno úplné vykreslenie, napríklad po zmene veľkosti okna, aby sa
	// práve vyprázdnené plátno nikdy nezobrazilo ako prázdny snímok (blikanie).
	clampVerticalView: () => {
		var h = Canvas.cssHeight || 0;
		var range = pitchViewMax - pitchViewMin;
		if (h > 0 && octaveSpacingStep * range < h) {
			octaveSpacingStep = h / range;
			octaveSpacing = octaveSpacingStep * 12;
		}
		var step = octaveSpacingStep;
		if (!(step > 0)) return;
		var maxOffy = pitchViewMax * step;
		var minOffy = h + pitchViewMin * step;
		Canvas.offy = Math.min(maxOffy, Math.max(minOffy, Canvas.offy));
	},

	renderFrame: () => {
		if (!ctx || !Canvas.canvas) return;
		Canvas.clampVerticalView();
		Canvas.reset();
		spatialIndexClear();
		spatialIndex.frameCounter++;
		Canvas.draw.keyboard();
		Canvas.draw.notes();
		Canvas.draw.selectBox();
		Canvas.draw.loopGuideLines();
		Canvas.draw.time();
		Canvas.draw.tooltip();
	},

	step: () => {
		if (Canvas.paused) {
			return;
		}

		var now = performance.now();
		var minFrameTime = 1000 / Canvas.targetFps;
		if (now - Canvas.lastFrameTime < minFrameTime) {
			requestAnimationFrame(Canvas.step);
			return;
		}
		Canvas.lastFrameTime = now;

		// Treba počkať, až kým plátno skutočne existuje.
		if (!ctx || !Canvas.canvas) {
			requestAnimationFrame(Canvas.step);
			return;
		}

		Canvas.renderFrame();

		// Timeline.draw() sa spúšťa vnútri Canvas.draw.time(), takže tu ho netreba spúšťať znova

		UI.playback.updateTime();

		requestAnimationFrame(Canvas.step);
		//setTimeout(Canvas.step, 100); // kód bol ponechaný pre miernu nostalgiu.
	},

	checkPartialHover: (x, y) => {
		if (!Canvas.canvas) return;

		partialNote = 0;
		partialNumber = 0;
		hoverTooltip.visible = false;
		hoverPitchLine.visible = false;
		hoverStep.visible = false;

		// Výpočet, nad ktorou klávesou klaviatúry sa kurzor nachádza
		// týmto sa poskytuje užívateľovi orientácia bez ohľadu na to, či je nad parciálom.
		if (x >= 60 && typeof scales !== 'undefined') {
			var trackIdx = typeof Timeline !== 'undefined' && Timeline.getCurrentTrackIdx ? Timeline.getCurrentTrackIdx() : 0;

			var keyboardScale = getTuningAtTime(playback.time, trackIdx);

			var isAdaptive = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(keyboardScale);

			var freqToY = (freq) => {
				var semitones = 12 * Math.log2(freq / 440) + 69;
				return Canvas.offy - semitones * octaveSpacing / 12;
			};

			if (isAdaptive) {
				var adaptivePitches = AdaptiveTuning.getPitchesAtTime(playback.time, trackIdx, keyboardScale);
				if (adaptivePitches && adaptivePitches.length > 1) {
					for (let p = 0; p < adaptivePitches.length - 1; p++) {
						const noteY = Canvas.pitchToY(adaptivePitches[p].midiNote);
						const nextNoteY = Canvas.pitchToY(adaptivePitches[p + 1].midiNote);
						const stepH = Math.abs(noteY - nextNoteY);

						if (y >= nextNoteY && y < noteY) {
							hoverStep.visible = true;
							hoverStep.stepIndex = p;
							hoverStep.y = nextNoteY;
							hoverStep.height = stepH;
							break;
						}
					}
				}
			} else if (scales[keyboardScale] && scales[keyboardScale].notes) {
				var scaleNotes = scales[keyboardScale].notes;
				for (let i = 0; i < scaleNotes.length; i++) {
					const hasNext = i + 1 < scaleNotes.length;
					const noteY = freqToY(scaleNotes[i][1]);
					const nextNoteY = hasNext ? freqToY(scaleNotes[i + 1][1]) : 2 * noteY - freqToY(scaleNotes[i - 1][1]);
					const stepH = Math.abs(noteY - nextNoteY);

					if (y >= nextNoteY && y < noteY) {
						hoverStep.visible = true;
						hoverStep.stepIndex = i;
						hoverStep.y = nextNoteY;
						hoverStep.height = stepH;
						break;
					}
				}
			}
		}

		var overResizeEdge = false;

		// x teraz zahŕňa offset klaviatúry (60,5 px).
		if (x >= 60) {
			// Priestorový index na vyhľadanie O(1) namiesto iterovania cez všetky parciály.
			var hits = spatialIndexQuery(x, y);

			// Kontrola hrán na zmenu veľkosti v okolitých bunkách.
			var nearbyHits = new Set();
			for (let dx = -1; dx <= 1; dx++) {
				var cellX = Math.floor((x + dx * resizingRegionSize) / spatialIndex.cellSize);
				var key = cellX + '_' + Math.floor(y / spatialIndex.cellSize);
				var cell = spatialIndex.grid.get(key);
				if (cell) {
					for (const entry of cell) nearbyHits.add(entry);
				}
			}

			for (const hit of hits) {
				const { trackIdx: iC5, noteIdx: jC5, partialIdx: kC5 } = hit;
				const note = MIDI.data[iC5]?.[jC5];
				if (!note || note.length < 5 || !note[N_DATA]) continue;

				const partials = note[N_DATA].partials;
				if (!partials || !partials[kC5]) continue;
				const p = partials[kC5];

				// V režime T (partialBrightness vypnuté) sa neaktívne parciály preskakujú, keďže sú neviditeľné.
				if (!Canvas.partialBrightness && kC5 !== (note[N_PARTIAL] - 1)) continue;

				partialNote = note;
				partialNumber = kC5 + 1;

				// Dáta čiary výšky tónu na klaviatúre sa počítajú vždy.
				var spectrumDataForLine = getSpectrumDataSafe(iC5);
				if (spectrumDataForLine && spectrumDataForLine[kC5] && spectrumDataForLine[note[N_PARTIAL]-1]) {
					var partialRatioForLine = spectrumDataForLine[kC5][0];
					var fundamentalFreqForLine = note2freq(note[N_PITCH]) / spectrumDataForLine[note[N_PARTIAL]-1][0];
					var partialFreqForLine = fundamentalFreqForLine * partialRatioForLine;
					var partialMidiPitchForLine = freq2note(partialFreqForLine);
					var partialNoteNameForLine = note2name(Math.floor(partialMidiPitchForLine));
					var partialCentsForLine = Math.round(((partialMidiPitchForLine % 1) + 1) % 1 * 100);

					hoverPitchLine.visible = true;
					hoverPitchLine.midiPitch = partialMidiPitchForLine;
					hoverPitchLine.noteName = partialNoteNameForLine;
					hoverPitchLine.cents = partialCentsForLine;
				}

				// Výpočet dát tooltipu pre konkrétny parciál, ktorý sa zobrazuje len pri stlačenom Ctrl a bez ťahania.
				if (ctrlKey && !select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight) {
					var spectrumData = getSpectrumDataSafe(iC5);
					if (spectrumData[kC5]) {
						var partialRatio = spectrumData[kC5][0];
						var fundamentalFreq = note2freq(note[N_PITCH]) / spectrumData[note[N_PARTIAL]-1][0];
						var partialFreq = fundamentalFreq * partialRatio;
						var partialMidiPitch = freq2note(partialFreq);
						var partialNoteName = note2name(Math.floor(partialMidiPitch));
						var partialCents = Math.round(((partialMidiPitch % 1) + 1) % 1 * 100);
						var partialAmplitude = spectrumData[kC5][1];

						hoverTooltip.visible = true;
						hoverTooltip.x = hit.x + hit.w + 5; // Pravá strana parciálu + offset.
						hoverTooltip.y = hit.y + hit.h / 2; // Vertikálne centrované
						hoverTooltip.frequency = partialFreq;
						hoverTooltip.midiPitch = partialMidiPitch;
						hoverTooltip.noteName = partialNoteName;
						hoverTooltip.cents = partialCents;
						hoverTooltip.amplitude = partialAmplitude;
					}
				}
				break;
			}

			for (const entry of nearbyHits) {
				const { trackIdx: iC5, noteIdx: jC5, partialIdx: kC5, x: px, w: pw, y: py, h: ph } = entry;
				const note = MIDI.data[iC5]?.[jC5];
				if (!note || note.length < 5 || !note[N_DATA]) continue;
				const partials = note[N_DATA].partials;
				if (!partials || !partials[kC5]) continue;
				const p = partials[kC5];

				if (!Canvas.partialBrightness && kC5 !== (note[N_PARTIAL] - 1)) continue;

				if (y < py || y > py + ph) continue;

				// Kurzor nad ľavým rohom.
				if (px - resizingRegionSize < x && x < px + resizingRegionSize) {
					Canvas.canvas.style.cursor = 'ew-resize';
					overResizeEdge = true;
				}
				// Kurzor nad pravým rohom.
				else if (px + pw - resizingRegionSize < x && x < px + pw + resizingRegionSize) {
					Canvas.canvas.style.cursor = 'ew-resize';
					overResizeEdge = true;
				}
			}
		}

		select.hoverNote = !!partialNumber;

		if (partialNumber) {
			var freq = note2freq(partialNote[N_PITCH]) / partialNote[N_PARTIAL];
			var noteVal = freq2note(freq);
			var chromatic = Math.floor(freq2note(note2freq(partialNote[N_PITCH]) / partialNote[N_PARTIAL] * partialNumber));
			var time = round4(partialNote[N_TIME]);
			var length = round4(partialNote[N_DUR]);

			if (partialWindowNote.textContent !== round4(noteVal))
				partialWindowNote.textContent = round4(noteVal);
			if (partialWindowPartial.textContent !== partialNumber)
				partialWindowPartial.textContent = partialNumber;
			if (partialWindowClosestChromatic.textContent !== note2name(chromatic))
				partialWindowClosestChromatic.textContent = note2name(chromatic);
			if (partialWindowTime.textContent !== time)
				partialWindowTime.textContent = time;
			if (partialWindowLength.textContent !== length)
				partialWindowLength.textContent = length;
		}

		// Obnovenie kurzoru, ak nie je nad hranou na zmenu veľkosti a práve neprebieha presun ani zmena veľkosti nôt.
		if (!overResizeEdge && !select.keyboard && !select.moving && !select.resizeLeft && !select.resizeRight) {
			Canvas.canvas.style.cursor = 'default';
		}
	},

	// Krok vzad pre movePartial.
	_movePartialUndoState: null,
	_movePartialUndoTimer: null,
	_movePartialUndoDebounce: 500, // Ms, koľko čakať pred potvrdením kroku vzad.
	_movePartialChangedNotes: null, // Map "trackIdx,noteIdx" -> stav pred zmenou.

	_startMovePartialUndo: function(description) {
		if (this._movePartialUndoTimer) {
			clearTimeout(this._movePartialUndoTimer);
			this._movePartialUndoTimer = null;
		}
		if (!this._movePartialUndoState && typeof UndoManager !== 'undefined') {
			this._movePartialUndoState = { description: description };
			this._movePartialChangedNotes = new Map();
		}
	},

	// Spúšťa sa ešte pred pozmenením noty a klonuje len jednu konkrétnu notu.
	_captureNoteBefore: function(trackIdx, noteIdx) {
		if (!this._movePartialChangedNotes) return;
		var key = trackIdx + ',' + noteIdx;
		if (!this._movePartialChangedNotes.has(key)) {
			this._movePartialChangedNotes.set(key, structuredClone(MIDI.data[trackIdx][noteIdx]));
		}
	},

	_commitMovePartialUndo: function() {
		if (this._movePartialUndoTimer) {
			clearTimeout(this._movePartialUndoTimer);
		}
		this._movePartialUndoTimer = setTimeout(() => {
			if (this._movePartialUndoState && this._movePartialChangedNotes &&
				this._movePartialChangedNotes.size > 0 && typeof UndoManager !== 'undefined') {

				var beforeData = structuredClone(MIDI.data);
				for (const [key, originalNote] of this._movePartialChangedNotes) {
					var [trackIdx, noteIdx] = key.split(',').map(Number);
					if (beforeData[trackIdx]) {
						beforeData[trackIdx][noteIdx] = originalNote;
					}
				}

				var afterData = structuredClone(MIDI.data);
				UndoManager.recordSnapshot(
					this._movePartialUndoState.description,
					['MIDIdata'],
					{ MIDIdata: beforeData },
					{ MIDIdata: afterData }
				);
			}
			this._movePartialUndoState = null;
			this._movePartialChangedNotes = null;
			this._movePartialUndoTimer = null;
		}, this._movePartialUndoDebounce);
	},

	// Posunutie vybraných nôt o zadanú výšku (0.01 = 1 cent).
	nudgeSelectedNotes: (amount) => {
		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;
		var changed = false;

		Canvas._startMovePartialUndo('Nudge pitch');

		for (let i = trackStart; i < trackEnd; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (note.length < 5 || !note[N_SEL]) continue;

				Canvas._captureNoteBefore(i, j);

				var clampedPitch = Math.max(pitchEditMin, Math.min(pitchEditMax, note[N_PITCH] + amount));
				var appliedAmount = clampedPitch - note[N_PITCH];
				if (appliedAmount === 0) continue;
				note[N_PITCH] = clampedPitch;
				changed = true;

				if (note[N_DATA] && note[N_DATA].partials) {
					for (let k = 0; k < note[N_DATA].partials.length; k++) {
						note[N_DATA].partials[k][P_Y] += appliedAmount;
					}
				}
			}
		}

		Canvas._commitMovePartialUndo();

		if (changed) {
			DB.set('MIDIdata', MIDI.data, { skipUndo: true });
			if (typeof AdaptiveTuning !== 'undefined') {
				AdaptiveTuning.refresh();
			}
			Canvas.staticLayerNeedsRefresh = true;
			Canvas.step();
		}
	},

	// Výber parciálu hore (+1) alebo dole (-1) na všetkých vybraných notách
	// mení iba označenie P_SEL, nemení N_PITCH ani N_PARTIAL.
	shiftPartialSelection: (direction) => {
		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;

		for (let i = trackStart; i < trackEnd; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (note.length < 5 || !note[N_SEL]) continue;
				if (!note[N_DATA] || !note[N_DATA].partials) continue;

				var partials = note[N_DATA].partials;
				var partialCount = partials.length;
				if (partialCount === 0) continue;

				var selectedIndices = [];
				for (let k = 0; k < partialCount; k++) {
					if (partials[k][P_SEL]) selectedIndices.push(k);
				}

				// Ak nie je explicitne vybraný žiadny parciál, použije sa aktívny parciál noty.
				if (selectedIndices.length === 0) {
					var activeIdx = (note[N_PARTIAL] || 1) - 1;
					if (activeIdx >= 0 && activeIdx < partialCount) {
						selectedIndices.push(activeIdx);
					}
				}

				if (selectedIndices.length === 0) continue;

				// Kontrola rozsahu
				if (direction > 0 && Math.max(...selectedIndices) >= partialCount - 1) continue;
				if (direction < 0 && Math.min(...selectedIndices) <= 0) continue;

				// Zrušiť výber starých a vybrať nové.
				for (const idx of selectedIndices) {
					partials[idx][P_SEL] = 0;
				}
				for (const idx of selectedIndices) {
					partials[idx + direction][P_SEL] = 1;
				}
			}
		}

		Canvas.staticLayerNeedsRefresh = true;
		Canvas.step();
	},

	// Toto je jedna z najdôležitejších funkcií a je pre tento softvér unikátna, nakoľko spôsobuje posúvanie nôt nie v systéme chromatických nôt,
	// ale v systéme absolútnych frekvenčných výšok parciálov.
	// To znamená, že ak má nástroj farbu sínusoidy (iba 1 parciál), posun nahor je chromatický (ak ide o 12-EDO systém)
	// ak by sa k tejto sínusoide pridali ďalšie parciály (napríklad ďalšie 2, t.j. farba by mala spolu 3 parciály),
	// posun tónu C3 nahor by smeroval k 3. parciálu, keďže 3. parciál od tónu F1 je len o 2 centy vyšší ako C3, lebo sa hľadá nasledujúca absolútna výška.
	movePartialUp: (e) => {
		bypass.up = true;

		Canvas._startMovePartialUndo('Move partial up');

		var iC6, jC6, kC6, lC6, mC6, orderedPartials;

		// Kvôli výkonu sa kontroluje iba primárna stopa, kde sa vybrané noty zvyčajne nachádzajú.
		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;

		for (iC6 = trackStart; iC6 < trackEnd; iC6++) {
			for (jC6 = 0; jC6 < MIDI.data[iC6].length; jC6++) {
				if (MIDI.data[iC6][jC6].length < 5) continue;

				// Najprv sa skontroluje označenie N_SEL, aby sa nemuselo iterovať cez parciály.
				if (!MIDI.data[iC6][jC6][N_SEL]) continue;

				if (!MIDI.data[iC6][jC6][N_DATA] || !MIDI.data[iC6][jC6][N_DATA].partials) continue;

				MIDInotePartials7 = MIDI.data[iC6][jC6][N_DATA].partials;

				// Uloží sa nota pred akoukoľvek zmenou, aby bol možný inkrementálny krok vzad.
				Canvas._captureNoteBefore(iC6, jC6);

				// Kontrola uzamknutých parciálov, pri ktorých sa použije obmedzený pohyb.
				var hasLocked = false;
				var lockedIdx = -1;
				var selectedIdx = -1;
				for (let lp = 0; lp < MIDInotePartials7.length; lp++) {
					if (MIDInotePartials7[lp][6]) {
						hasLocked = true;
						lockedIdx = lp;
					}
					if (MIDInotePartials7[lp][4] && !MIDInotePartials7[lp][6]) {
						selectedIdx = lp;
					}
				}
				
				if (hasLocked && selectedIdx >= 0 && !e.shiftKey) {
					var result = findLockedConstrainedPosition(iC6, jC6, 1, selectedIdx);
					if (result) {
						MIDI.data[iC6][jC6][N_PITCH] = result.newNote2;
						var specData = getSpectrumDataSafe(iC6);
						const baseRatio = specData[MIDI.data[iC6][jC6][N_PARTIAL]-1] ? specData[MIDI.data[iC6][jC6][N_PARTIAL]-1][0] : MIDI.data[iC6][jC6][N_PARTIAL];
						for (let rp = 0; rp < MIDInotePartials7.length; rp++) {
							const specRatio = specData[rp] ? specData[rp][0] : (rp + 1);
							MIDInotePartials7[rp][1] = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / baseRatio * specRatio);
							MIDInotePartials7[rp][4] = 0;
							MIDInotePartials7[rp][6] = 0;
						}
						if (result.newMovedPartialIdx < MIDInotePartials7.length) {
							MIDInotePartials7[result.newMovedPartialIdx][4] = 1;
						}
						if (result.newLockedPartialIdx < MIDInotePartials7.length) {
							MIDInotePartials7[result.newLockedPartialIdx][6] = 1;
						}
					}
					continue;
				}
				for (kC6=0; kC6 < MIDInotePartials7.length; kC6++) {
					if (MIDInotePartials7[kC6][4]) { // Ide o vybraný parciál.

						partialNote = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / MIDI.data[iC6][jC6][N_PARTIAL] * (kC6 + 1));
						partialNoteRound = round4(partialNote);
						orderedPartialRound = -1;

						if (e.ctrlKey && e.shiftKey) {
							if (MIDI.data[iC6][jC6][N_PITCH] + 12 > pitchEditMax) continue;
							MIDI.data[iC6][jC6][N_PITCH] += 12;
							for (mC6=0; mC6 < MIDInotePartials7.length; mC6++) {
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][1] += 12  // Pridá sa 12 poltónov.
							}
							continue;
						}

						// Pri Shift+Hore sa fundamentál posunie na nasledujúci krok.
						if (e.shiftKey) {
							// Najprv sa zozbierajú všetky indexy vybraných parciálov danej noty.
							var selectedPartialIndices = new Set();
							for (let pIdx = 0; pIdx < MIDInotePartials7.length; pIdx++) {
								if (MIDInotePartials7[pIdx][4]) {
									selectedPartialIndices.add(pIdx + 1);
								}
							}
							
							MIDInotePartials8 = getSpectrumDataSafe(iC6);
							var partialRatio = MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1][0];
							var currentFundamentalNote = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / partialRatio);
							var fundamentalNoteRound = round4(currentFundamentalNote);
							
							var tuningKey = getTuningAtTime(MIDI.data[iC6][jC6][N_TIME], iC6);
							var isAdaptive = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(tuningKey);

							var nextFundamental = null;

							if (isAdaptive) {
								// Pri adaptívnom ladení sa berú výšky z ostatných nôt.
								var currentFundamentalFreq = note2freq(currentFundamentalNote);
								var pitches = AdaptiveTuning.getPitchesAtTimeExcluding(MIDI.data[iC6][jC6][N_TIME], iC6, tuningKey, jC6);
								if (pitches && pitches.length > 0) {
									// Výšky zoradené podľa frekvencie kvôli správnej navigácii po krokoch.
									var sortedPitches = [...pitches].sort((a, b) => a.freq - b.freq);
									// Ďalšia výška nad aktuálnou.
									for (let pi = 0; pi < sortedPitches.length; pi++) {
										if (sortedPitches[pi].freq > currentFundamentalFreq + 0.1) {
											nextFundamental = { note: freq2note(sortedPitches[pi].freq) };
											break;
										}
									}
								}
							}

							// Ak nie je adaptívne, alebo adaptívne ladenie výšku nenašlo, použije sa orderedPartials.
							if (!nextFundamental) {
								var scaleKey = isAdaptive ? 'edo12' : tuningKey;
								orderedPartials = DB.getOrderedPartials(scaleKey, instruments[iC6].spectrum, settings.orderedPartialsSelection);

								if (orderedPartials) {
									for (lC6=0; lC6 < orderedPartials.length; lC6++) {
										if (orderedPartials[lC6][4] !== 1) continue;
										var orderedFundamentalRound = round4(orderedPartials[lC6][1]);
										if (orderedFundamentalRound > fundamentalNoteRound) {
											nextFundamental = { note: orderedPartials[lC6][1] };
											break;
										}
									}
								}
							}

							if (nextFundamental) {
								// Nová výška noty tak, aby fundamentál bol na pozícii nextFundamental.
								MIDI.data[iC6][jC6][N_PITCH] = freq2note(note2freq(nextFundamental.note) * partialRatio);
								// Nemení MIDI.data[iC6][jC6][N_PARTIAL], číslo parciálu zostáva.

								// Pozície všetkých parciálov, so skutočným počtom parciálov kvôli dynamickej farbe.
								var actualPartialsLen = MIDI.data[iC6][jC6][N_DATA].partials.length;
								for (mC6=0; mC6 < actualPartialsLen; mC6++) {
									noteW = MIDI.data[iC6][jC6][N_DUR];
									noteH = 1 / Math.pow(mC6 + 1, 0.3);
									noteX = MIDI.data[iC6][jC6][N_TIME];
									const specRatio = MIDInotePartials8[mC6] ? MIDInotePartials8[mC6][0] : (mC6 + 1);
									const baseRatio = MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1] ? MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1][0] : MIDI.data[iC6][jC6][N_PARTIAL];
									noteY = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / baseRatio * specRatio);
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][0] = noteX;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][1] = noteY;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][2] = noteW;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][3] = noteH;
									
									// Zachová sa výber všetkých pôvodne vybraných parciálov.
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][4] = selectedPartialIndices.has(mC6 + 1) ? 1 : 0;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][5] = 0;
								}

								// Obnoví cache adaptívneho ladenia, keďže sa zmenila výška.
								if (typeof AdaptiveTuning !== 'undefined') {
									AdaptiveTuning.refresh();
								}

								partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / MIDI.data[iC6][jC6][N_PARTIAL]));
								partialWindowPartial.textContent = MIDI.data[iC6][jC6][N_PARTIAL];
								partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC6][jC6][N_PITCH]));
								partialWindowTime.textContent = round4(MIDI.data[iC6][jC6][N_TIME]);
								partialWindowLength.textContent = round4(MIDI.data[iC6][jC6][N_DUR]);
							}
							break;
						}

						// Bez Shiftu sa nájde najbližší parciál v zoradenom zozname,
						// avšak najprv sa skontroluje, či sa vybraný parciál líši od parciálu noty
						// ak áno, výber sa najskôr potvrdí a až potom sa vyhľadáva.
						var selectedPartialNum = kC6 + 1;
						if (selectedPartialNum !== MIDI.data[iC6][jC6][N_PARTIAL]) {
							// Potvrdenie výberu zmení note[N_PARTIAL] na vybraný parciál a fundamentál ponechá na mieste.
							MIDInotePartials8 = getSpectrumDataSafe(iC6);
							var oldPartialRatio = MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1][0];
							var newPartialRatio = MIDInotePartials8[selectedPartialNum-1][0];
							var fundamentalFreq = note2freq(MIDI.data[iC6][jC6][N_PITCH]) / oldPartialRatio;
							
							// Nota sa aktualizuje na nový parciál a fundamentál zostáva na mieste.
							MIDI.data[iC6][jC6][N_PITCH] = freq2note(fundamentalFreq * newPartialRatio);
							MIDI.data[iC6][jC6][N_PARTIAL] = selectedPartialNum;

							// Pozície všetkých parciálov so skutočným počtom parciálov kvôli dynamickej farbe.
							var actualPartialsLen2 = MIDI.data[iC6][jC6][N_DATA].partials.length;
							for (mC6=0; mC6 < actualPartialsLen2; mC6++) {
								noteW = MIDI.data[iC6][jC6][N_DUR];
								noteH = 1 / Math.pow(mC6 + 1, 0.3);
								noteX = MIDI.data[iC6][jC6][N_TIME];
								var specRatio2 = MIDInotePartials8[mC6] ? MIDInotePartials8[mC6][0] : (mC6 + 1);
								var baseRatio2 = MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1] ? MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1][0] : MIDI.data[iC6][jC6][N_PARTIAL];
								noteY = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / baseRatio2 * specRatio2);
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][0] = noteX;
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][1] = noteY;
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][2] = noteW;
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][3] = noteH;
								
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][4] = (mC6 + 1 == selectedPartialNum) ? 1 : 0;
								MIDI.data[iC6][jC6][N_DATA].partials[mC6][5] = 0;
							}
							
							partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / MIDI.data[iC6][jC6][N_PARTIAL]));
							partialWindowPartial.textContent = MIDI.data[iC6][jC6][N_PARTIAL];
							partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC6][jC6][N_PITCH]));
							partialWindowTime.textContent = round4(MIDI.data[iC6][jC6][N_TIME]);
							partialWindowLength.textContent = round4(MIDI.data[iC6][jC6][N_DUR]);
							
							break; // Nehľadať ďalší, iba potvrdiť výber.
						}

						// Teraz hľadá ďalší parciál, keďže vybraný už zodpovedá note[N_PARTIAL].
						var tuningKey3 = getTuningAtTime(MIDI.data[iC6][jC6][N_TIME], iC6);
						orderedPartials = DB.getOrderedPartials(tuningKey3, instruments[iC6].spectrum, settings.orderedPartialsSelection);
						if (!orderedPartials) break;
						for (lC6=0; lC6 < orderedPartials.length; lC6++) {
							if (window.partialLimit > 0 && orderedPartials[lC6][4] > window.partialLimit) continue;
							orderedPartialRound = round4(orderedPartials[lC6][1]);
							if (partialNoteRound < orderedPartialRound ||
								(partialNoteRound == orderedPartialRound && orderedPartials[lC6][4] > MIDI.data[iC6][jC6][N_PARTIAL])) {
								// Najbližší vyšší parciál má index o jeden vyšší.
								MIDI.data[iC6][jC6][N_PITCH] = orderedPartials[lC6][1];
								MIDI.data[iC6][jC6][N_PARTIAL] = orderedPartials[lC6][4];


								MIDInotePartials8 = getSpectrumDataSafe(iC6);

								var actualPartialsLen3 = MIDI.data[iC6][jC6][N_DATA].partials.length;
								for (mC6=0; mC6 < actualPartialsLen3; mC6++) {
												noteW = MIDI.data[iC6][jC6][N_DUR];
												noteH = 1 / Math.pow(mC6 + 1, 0.3);
												noteX = MIDI.data[iC6][jC6][N_TIME];
												
												var specRatio3 = MIDInotePartials8[mC6] ? MIDInotePartials8[mC6][0] : (mC6 + 1);
												var baseRatio3 = MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1] ? MIDInotePartials8[MIDI.data[iC6][jC6][N_PARTIAL]-1][0] : MIDI.data[iC6][jC6][N_PARTIAL];
												noteY = freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / baseRatio3 * specRatio3);
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][0] = noteX;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][1] = noteY;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][2] = noteW;
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][3] = noteH;

									if (mC6 + 1 == MIDI.data[iC6][jC6][N_PARTIAL]) {
										MIDI.data[iC6][jC6][N_DATA].partials[mC6][4] = 1;
									}
									else {
										MIDI.data[iC6][jC6][N_DATA].partials[mC6][4] = 0;
									}
									MIDI.data[iC6][jC6][N_DATA].partials[mC6][5] = 0;
								}

								partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC6][jC6][N_PITCH]) / MIDI.data[iC6][jC6][N_PARTIAL]));
								partialWindowPartial.textContent = MIDI.data[iC6][jC6][N_PARTIAL];
								partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC6][jC6][N_PITCH]));
								partialWindowTime.textContent = round4(MIDI.data[iC6][jC6][N_TIME]);
								partialWindowLength.textContent = round4(MIDI.data[iC6][jC6][N_DUR]);

								break;
							}
						}
						break;

					}
				}
			}
		}
		// Potvrdí krok vzad po uplynutí debounce.
		Canvas._commitMovePartialUndo();

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });
		bypass.up = false;
	},
	movePartialDown: (e) => {
		bypass.down = true;

		Canvas._startMovePartialUndo('Move partial down');

		var iC7, jC7, kC7, lC7, mC7,
			orderedPartials;

		// Kvôli výkonu sa kontroluje iba primárna stopa.
		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;

		for (iC7=trackStart; iC7 < trackEnd; iC7++) {
			for (jC7=0; jC7 < MIDI.data[iC7].length; jC7++) {
				if (MIDI.data[iC7][jC7].length < 5) continue;

				if (!MIDI.data[iC7][jC7][N_SEL]) continue;

				if (!MIDI.data[iC7][jC7][N_DATA] || !MIDI.data[iC7][jC7][N_DATA].partials) continue;

				MIDInotePartials9 = MIDI.data[iC7][jC7][N_DATA].partials;

				Canvas._captureNoteBefore(iC7, jC7);

				// Kontrola uzamknutých parciálov.
				var hasLocked = false;
				var lockedIdx = -1;
				var selectedIdx = -1;
				for (let lp = 0; lp < MIDInotePartials9.length; lp++) {
					if (MIDInotePartials9[lp][6]) {
						hasLocked = true;
						lockedIdx = lp;
					}
					if (MIDInotePartials9[lp][4] && !MIDInotePartials9[lp][6]) {
						selectedIdx = lp;
					}
				}

				if (hasLocked && selectedIdx >= 0 && !e.shiftKey) {
					var result = findLockedConstrainedPosition(iC7, jC7, -1, selectedIdx);
					if (result) {
						MIDI.data[iC7][jC7][N_PITCH] = result.newNote2;
						var specData = getSpectrumDataSafe(iC7);
						const baseRatio = specData[MIDI.data[iC7][jC7][N_PARTIAL]-1] ? specData[MIDI.data[iC7][jC7][N_PARTIAL]-1][0] : MIDI.data[iC7][jC7][N_PARTIAL];
						for (let rp = 0; rp < MIDInotePartials9.length; rp++) {
							const specRatio = specData[rp] ? specData[rp][0] : (rp + 1);
							MIDInotePartials9[rp][1] = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / baseRatio * specRatio);
							MIDInotePartials9[rp][4] = 0;
							MIDInotePartials9[rp][6] = 0;
						}
						if (result.newMovedPartialIdx < MIDInotePartials9.length) {
							MIDInotePartials9[result.newMovedPartialIdx][4] = 1;
						}
						if (result.newLockedPartialIdx < MIDInotePartials9.length) {
							MIDInotePartials9[result.newLockedPartialIdx][6] = 1;
						}
					}
					continue;
				}
				for (kC7=0; kC7 < MIDInotePartials9.length; kC7++) {
					if (MIDInotePartials9[kC7][4]) {
						// To znamená, že ide o vybraný parciál;
						// takže sa parciál presunie na najbližší.

						partialNote = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / MIDI.data[iC7][jC7][N_PARTIAL] * (kC7 + 1));
						partialNoteRound = round4(partialNote);
						orderedPartialRound = -1;

						if (e.ctrlKey && e.shiftKey) {
							if (MIDI.data[iC7][jC7][N_PITCH] - 12 < pitchEditMin) continue;
							MIDI.data[iC7][jC7][N_PITCH] -= 12;
							for (mC7=0; mC7 < MIDInotePartials9.length; mC7++) {
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][1] -= 12  // odčíta 12 poltónov (jednotky nôt);
							}
							continue;
						}

						// Pri Shift+Dole sa fundamentál posunie na predchádzajúci tón.
						if (e.shiftKey) {
							// Najprv sa zozbierajú všetky indexy vybraných parciálov danej noty.
							var selectedPartialIndices = new Set();
							for (let pIdx = 0; pIdx < MIDInotePartials9.length; pIdx++) {
								if (MIDInotePartials9[pIdx][4]) {
									selectedPartialIndices.add(pIdx + 1);
								}
							}
							
							MIDInotePartials10 = getSpectrumDataSafe(iC7);
							var partialRatio = MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1][0];
							var currentFundamentalNote = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / partialRatio);
							var fundamentalNoteRound = round4(currentFundamentalNote);
							
							const tuningKey2 = getTuningAtTime(MIDI.data[iC7][jC7][N_TIME], iC7);
							var isAdaptive2 = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(tuningKey2);
							
							var prevFundamental = null;
							
							if (isAdaptive2) {
								// Pri adaptívnom ladení sa berú výšky z ostatných nôt, táto sa vynechá.
								var currentFundamentalFreq2 = note2freq(currentFundamentalNote);
								var pitches = AdaptiveTuning.getPitchesAtTimeExcluding(MIDI.data[iC7][jC7][N_TIME], iC7, tuningKey2, jC7);
								if (pitches && pitches.length > 0) {
									var sortedPitches = [...pitches].sort((a, b) => a.freq - b.freq);
									// Predchádzajúca výška pod aktuálnou, keďže sa iteruje od najvyššej po najnižšiu.
									for (let pi = sortedPitches.length - 1; pi >= 0; pi--) {
										if (sortedPitches[pi].freq < currentFundamentalFreq2 - 0.1) {
											prevFundamental = { note: freq2note(sortedPitches[pi].freq) };
											break;
										}
									}
								}
							}
							
							// Ak nie je adaptívne, alebo adaptívne ladenie výšku nenašlo, použije sa orderedPartials.
							if (!prevFundamental) {
								var scaleKey2 = isAdaptive2 ? 'edo12' : tuningKey2;
								orderedPartials = DB.getOrderedPartials(scaleKey2, instruments[iC7].spectrum, settings.orderedPartialsSelection);
								
								if (orderedPartials) {
									for (lC7=orderedPartials.length-1; lC7 >= 0; lC7--) {
										if (orderedPartials[lC7][4] !== 1) continue;
										var orderedFundamentalRound = round4(orderedPartials[lC7][1]);
										if (orderedFundamentalRound < fundamentalNoteRound) {
											prevFundamental = { note: orderedPartials[lC7][1] };
											break;
										}
									}
								}
							}
							
							if (prevFundamental) {
								// Nová výška noty tak, aby bol fundamentál na pozícii prevFundamental.
								MIDI.data[iC7][jC7][N_PITCH] = freq2note(note2freq(prevFundamental.note) * partialRatio);
								// Nemení MIDI.data[iC7][jC7][N_PARTIAL], číslo parciálu zostáva.

								var actualPartialsLen = MIDI.data[iC7][jC7][N_DATA].partials.length;
								for (mC7=0; mC7 < actualPartialsLen; mC7++) {
									noteW = MIDI.data[iC7][jC7][N_DUR];
									noteH = 1 / Math.pow(mC7 + 1, 0.3);
									noteX = MIDI.data[iC7][jC7][N_TIME];
									
									const specRatio = MIDInotePartials10[mC7] ? MIDInotePartials10[mC7][0] : (mC7 + 1);
									const baseRatio = MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1] ? MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1][0] : MIDI.data[iC7][jC7][N_PARTIAL];
									noteY = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / baseRatio * specRatio);
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][0] = noteX;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][1] = noteY;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][2] = noteW;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][3] = noteH;
									
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][4] = selectedPartialIndices.has(mC7 + 1) ? 1 : 0;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][5] = 0;
								}

								// Obnovenie cache po zmene výšky.
								if (typeof AdaptiveTuning !== 'undefined') {
									AdaptiveTuning.refresh();
								}

								partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / MIDI.data[iC7][jC7][N_PARTIAL]));
								partialWindowPartial.textContent = MIDI.data[iC7][jC7][N_PARTIAL];
								partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC7][jC7][N_PITCH]));
								partialWindowTime.textContent = round4(MIDI.data[iC7][jC7][N_TIME]);
								partialWindowLength.textContent = round4(MIDI.data[iC7][jC7][N_DUR]);
							}
							break;
						}

						// Bez Shiftu sa nájde najbližší parciál v zoradenom zozname,
						// a najprv sa skontroluje, či sa vybraný parciál líši od parciálu noty
						// ak áno, výber sa najskôr potvrdí a až potom sa vyhľadáva.
						var selectedPartialNum = kC7 + 1;
						if (selectedPartialNum !== MIDI.data[iC7][jC7][N_PARTIAL]) {
							MIDInotePartials10 = getSpectrumDataSafe(iC7);
							var oldPartialRatio = MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1][0];
							var newPartialRatio = MIDInotePartials10[selectedPartialNum-1][0];
							var fundamentalFreq = note2freq(MIDI.data[iC7][jC7][N_PITCH]) / oldPartialRatio;
							
							MIDI.data[iC7][jC7][N_PITCH] = freq2note(fundamentalFreq * newPartialRatio);
							MIDI.data[iC7][jC7][N_PARTIAL] = selectedPartialNum;

							var actualPartialsLen2 = MIDI.data[iC7][jC7][N_DATA].partials.length;
							for (mC7=0; mC7 < actualPartialsLen2; mC7++) {
								noteW = MIDI.data[iC7][jC7][N_DUR];
								noteH = 1 / Math.pow(mC7 + 1, 0.3);
								noteX = MIDI.data[iC7][jC7][N_TIME];
								
								var specRatio2 = MIDInotePartials10[mC7] ? MIDInotePartials10[mC7][0] : (mC7 + 1);
								var baseRatio2 = MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1] ? MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1][0] : MIDI.data[iC7][jC7][N_PARTIAL];
								noteY = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / baseRatio2 * specRatio2);
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][0] = noteX;
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][1] = noteY;
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][2] = noteW;
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][3] = noteH;
								
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][4] = (mC7 + 1 == selectedPartialNum) ? 1 : 0;
								MIDI.data[iC7][jC7][N_DATA].partials[mC7][5] = 0;
							}
							
							partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / MIDI.data[iC7][jC7][N_PARTIAL]));
							partialWindowPartial.textContent = MIDI.data[iC7][jC7][N_PARTIAL];
							partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC7][jC7][N_PITCH]));
							partialWindowTime.textContent = round4(MIDI.data[iC7][jC7][N_TIME]);
							partialWindowLength.textContent = round4(MIDI.data[iC7][jC7][N_DUR]);
							
							break; // Nehľadať ďalší, iba potvrdiť výber.
						}

						const tuningKey2 = getTuningAtTime(MIDI.data[iC7][jC7][N_TIME], iC7);
							orderedPartials = DB.getOrderedPartials(tuningKey2, instruments[iC7].spectrum, settings.orderedPartialsSelection);

							if (!orderedPartials) {
								break;
							}
						for (lC7=orderedPartials.length-1; lC7 >= 0; lC7--) {
							if (window.partialLimit > 0 && orderedPartials[lC7][4] > window.partialLimit) continue;
							orderedPartialRound = round4(orderedPartials[lC7][1]);
							if (orderedPartialRound < partialNoteRound
								|| (partialNoteRound == orderedPartialRound
									&& orderedPartials[lC7][4] < MIDI.data[iC7][jC7][N_PARTIAL] )) {
								MIDI.data[iC7][jC7][N_PITCH] = orderedPartials[lC7][1];
								MIDI.data[iC7][jC7][N_PARTIAL] = orderedPartials[lC7][4];



								MIDInotePartials10 = getSpectrumDataSafe(iC7);

								var actualPartialsLen3 = MIDI.data[iC7][jC7][N_DATA].partials.length;
								for (mC7=0; mC7 < actualPartialsLen3; mC7++) {
									noteW = MIDI.data[iC7][jC7][N_DUR];
									noteH = 1 / Math.pow(mC7 + 1, 0.3);
									noteX = MIDI.data[iC7][jC7][N_TIME];

									var specRatio3 = MIDInotePartials10[mC7] ? MIDInotePartials10[mC7][0] : (mC7 + 1);
									var baseRatio3 = MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1] ? MIDInotePartials10[MIDI.data[iC7][jC7][N_PARTIAL]-1][0] : MIDI.data[iC7][jC7][N_PARTIAL];
									noteY = freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / baseRatio3 * specRatio3);
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][0] = noteX;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][1] = noteY;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][2] = noteW;
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][3] = noteH;

									if (mC7 + 1 == MIDI.data[iC7][jC7][N_PARTIAL]) {
										MIDI.data[iC7][jC7][N_DATA].partials[mC7][4] = 1;
									}
									else {
										MIDI.data[iC7][jC7][N_DATA].partials[mC7][4] = 0;
									}
									MIDI.data[iC7][jC7][N_DATA].partials[mC7][5] = 0;
								}

								partialWindowNote.textContent = round4(freq2note(note2freq(MIDI.data[iC7][jC7][N_PITCH]) / MIDI.data[iC7][jC7][N_PARTIAL]));
								partialWindowPartial.textContent = MIDI.data[iC7][jC7][N_PARTIAL];
								partialWindowClosestChromatic.textContent = note2name(Math.floor(MIDI.data[iC7][jC7][N_PITCH]));
								partialWindowTime.textContent = round4(MIDI.data[iC7][jC7][N_TIME]);
								partialWindowLength.textContent = round4(MIDI.data[iC7][jC7][N_DUR]);

								break;
							}
						}
						break;

					}
				}
			}
		}
		// Potvrdí krok vzad po uplynutí debounce.
		Canvas._commitMovePartialUndo();

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });
		bypass.down = false;
	},

	movePartialLeft: () => {
		bypass.left = true;

		Canvas._startMovePartialUndo('Move partial left');

		var iC8, jC8, kC8, lC8, mC8;

		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;

		for (iC8=trackStart; iC8 < trackEnd; iC8++) {
			for (jC8=0; jC8 < MIDI.data[iC8].length; jC8++) {
				if (MIDI.data[iC8][jC8].length < 5) continue;

				// Najprv sa skontroluje označenie N_SEL.
				if (!MIDI.data[iC8][jC8][N_SEL]) continue;

				MIDInotePartials12 = MIDI.data[iC8][jC8][N_DATA].partials;

				// Uloží sa nota pred akoukoľvek zmenou.
				Canvas._captureNoteBefore(iC8, jC8);

				{
					if (shiftKey) {
						var minLength = (typeof NOTE_MIN_LENGTH !== 'undefined') ? NOTE_MIN_LENGTH : (1 / gridSize);
						var newLength = MIDI.data[iC8][jC8][N_DUR] - 1 / gridSize;
						if (newLength >= minLength) {
							MIDI.data[iC8][jC8][N_DUR] = Math.round(newLength * gridSize) / gridSize;
							for (kC8=0; kC8 < MIDInotePartials12.length; kC8++)
										MIDI.data[iC8][jC8][N_DATA].partials[kC8][2] = MIDI.data[iC8][jC8][N_DUR];
						}
					} else {
						MIDI.data[iC8][jC8][N_TIME] -= 1 / gridSize;
						MIDI.data[iC8][jC8][N_TIME] = Math.max(0, Math.round(MIDI.data[iC8][jC8][N_TIME] * gridSize)/gridSize);

						for (kC8=0; kC8 < MIDInotePartials12.length; kC8++)
									MIDI.data[iC8][jC8][N_DATA].partials[kC8][0] = MIDI.data[iC8][jC8][N_TIME];
					}
				}
			}
		}

		// Potvrdí sa krok vzad po debounce.
		Canvas._commitMovePartialUndo();

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });

		// Obnoví cache adaptívneho ladenia, keďže sa zmenili pozície nôt.
		if (typeof AdaptiveTuning !== 'undefined') {
			AdaptiveTuning.refresh();
		}

		bypass.left = false;
	},
	movePartialRight: () => {
		bypass.right = true;

		Canvas._startMovePartialUndo('Move partial right');

		var iC9, jC9, kC9, lC9, mC9,
			selectedNoteC9;

		// Kvôli výkonu sa kontroluje iba primárna stopa, kde sa vybrané noty zvyčajne nachádzajú.
		var trackStart = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0;
		var trackEnd = typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex + 1 : MIDI.data.length;

		for (iC9=trackStart; iC9 < trackEnd; iC9++) {
			for (jC9=0; jC9 < MIDI.data[iC9].length; jC9++) {
				if (MIDI.data[iC9][jC9].length < 5) continue;

				if (!MIDI.data[iC9][jC9][N_SEL]) continue;

				selectedNoteC9 = true;
				MIDInotePartials12 = MIDI.data[iC9][jC9][N_DATA].partials;

				// Uloží sa nota pred akoukoľvek zmenou, aby bol možný inkrementálny krok vzad.
				Canvas._captureNoteBefore(iC9, jC9);

				if (selectedNoteC9) {
					if (shiftKey) {
						MIDI.data[iC9][jC9][N_DUR] += 1 / gridSize;
						MIDI.data[iC9][jC9][N_DUR] = Math.round(MIDI.data[iC9][jC9][N_DUR] * gridSize)/gridSize;
						for (kC9=0; kC9 < MIDInotePartials12.length; kC9++)
							MIDI.data[iC9][jC9][N_DATA].partials[kC9][2] = MIDI.data[iC9][jC9][N_DUR];
					} else {
						MIDI.data[iC9][jC9][N_TIME] += 1 / gridSize;
						MIDI.data[iC9][jC9][N_TIME] = Math.round(MIDI.data[iC9][jC9][N_TIME] * gridSize)/gridSize;

						for (kC9=0; kC9 < MIDInotePartials12.length; kC9++)
							MIDI.data[iC9][jC9][N_DATA].partials[kC9][0] = MIDI.data[iC9][jC9][N_TIME];
					}
				}
			}
		}

		// Potvrdí sa krok vzad po uplynutí debounce.
		Canvas._commitMovePartialUndo();

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });

		// Obnoví sa cache adaptívneho ladenia, keďže sa zmenili pozície nôt.
		if (typeof AdaptiveTuning !== 'undefined') {
			AdaptiveTuning.refresh();
		}

		bypass.right = false;
	},

	deletePartials: () => {
		var iC8, jC8, kC8, MIDInotePartials10;
		var deleteNote = false;
		var deletedNotes = {}; // Eviduje zmazané noty podľa stopy na krok vzad.

		for (iC8=0; iC8 < MIDI.data.length; iC8++) {
			for (jC8=MIDI.data[iC8].length-1; jC8 >= 0; jC8--) {
				if (MIDI.data[iC8][jC8].length < 5) continue;

				deleteNote = false;

				// Keďže sa N_DATA vytvára až pri prvom vykreslení, nová nota ho má najprv ako null
				// ak nemá parciály, preskočí sa celý blok.
				var noteData8 = MIDI.data[iC8][jC8][N_DATA];
				if (!noteData8 || !noteData8.partials) continue;
				MIDInotePartials10 = noteData8.partials;

				for (kC8 = MIDInotePartials10.length - 1; kC8 >= 0; kC8--) {
					if (MIDInotePartials10[kC8][4]) {
						deleteNote = true;
					}
				}

				if (deleteNote) {
					// Zachytí notu na krok vzad pred zmazaním.
					if (!deletedNotes[iC8]) deletedNotes[iC8] = [];
					deletedNotes[iC8].push({
						noteIndex: jC8,
						before: structuredClone(MIDI.data[iC8][jC8]),
						after: null
					});

					// Zastaví notu, ak práve hrá, pred jej zmazaním.
					if (typeof PlaybackManager !== 'undefined') {
						PlaybackManager.stopNote(iC8, jC8);
					}
					MIDI.data[iC8].splice(jC8, 1);
				}
			}
		}

		// Zapíše krok vzad, ak boli noty zmazané.
		if (typeof UndoManager !== 'undefined' && Object.keys(deletedNotes).length > 0) {
			UndoManager.recordMultiTrackDelta('Delete notes', deletedNotes);
		}

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });

		// Obnoví cache adaptívneho ladenia, aby sa prepočítali dostupné výšky tónov.
		if (typeof AdaptiveTuning !== 'undefined') {
			AdaptiveTuning.refresh();
		}
	},

	// Jednoduchý sínusový syntetizátor na predprehrávanie (vytvorený podľa potreby).
	_previewSynth: null,
	_getPreviewSynth: () => {
		if (!Canvas._previewSynth && typeof Tone !== 'undefined') {
			Canvas._previewSynth = new Tone.PolySynth({
				maxPolyphony: 128,
				voice: Tone.Synth,
				options: {
					oscillator: { type: 'sine' },
					envelope: { attack: 0.15, decay: 0.1, sustain: 0.8, release: 0.3 },
					volume: -12
				}
			}).connect(masterLimiter || Tone.Destination);
		}
		return Canvas._previewSynth;
	},

	// Klávesa P prehrá iba základnú frekvenciu ako sínusovú vlnu.
	previewChord: () => {
		var previewSynth = Canvas._getPreviewSynth();
		if (!previewSynth) return;

		var iC9, jC9, kC9, nC9, now, playbackNotes, MIDInotePartialsC1, MIDInotePartialsC1Plaback;
		now = Tone.now();
		playbackNotes = [];
		for (iC9 = 0; iC9 < MIDI.data.length; iC9++) {
			for (jC9 = 0; jC9 < MIDI.data[iC9].length; jC9++) {
				if (!MIDI.data[iC9][jC9][N_DATA] || !MIDI.data[iC9][jC9][N_DATA].partials) continue;
				MIDInotePartialsC1 = MIDI.data[iC9][jC9][N_DATA].partials;
				MIDInotePartialsC1Plaback = false;

				for (kC9 = MIDInotePartialsC1.length - 1; kC9 >= 0; kC9--) {
					if (MIDInotePartialsC1[kC9][4] || MIDInotePartialsC1[kC9][5]) {
						MIDInotePartialsC1Plaback = true;
					}
				}

				if (MIDInotePartialsC1Plaback) {
					var fundamentalFreq = note2freq(MIDI.data[iC9][jC9][N_PITCH]) / MIDI.data[iC9][jC9][N_PARTIAL];
					previewSynth.triggerAttackRelease(fundamentalFreq, "8n", now);
					playbackNotes.push(freq2note(fundamentalFreq));
				}
			}
		}

		if (playbackNotes.length) {
			playbackNotes.sort();
			for (nC9=0; nC9 < playbackNotes.length; nC9++) {
				playbackNotes[nC9] = note2name(Math.floor(playbackNotes[nC9])) + "+"+Math.round(((playbackNotes[nC9] - Math.floor(playbackNotes[nC9]))*100));
			}
			Logger.log(playbackNotes.join(' '));
		}
	},

	// Klávesa O prehrá iba frekvenciu aktívneho parciálu ako sínusovú vlnu.
	previewChordPartials: () => {
		var previewSynth = Canvas._getPreviewSynth();
		if (!previewSynth) return;

		var iC13, jC13, kC13, nC13, now, playbackNotes, MIDInotePartialsC2;
		now = Tone.now();

		// Stíšenie predošlého
		try {
			previewSynth.volume.rampTo(-60, 0.03);
			var oldSynth = previewSynth;
			setTimeout(() => { try { oldSynth.dispose(); } catch(e) {} }, 120);
		} catch(e) { try { previewSynth.dispose(); } catch(e2) {} }
		Canvas._previewSynth = null;
		var freshSynth = Canvas._getPreviewSynth();
		if (!freshSynth) return;

		playbackNotes = [];

		// V prvom kole sa spočítajú noty s vybranými parciálmi na škálovanie zisku.
		var selectedNoteCount = 0;
		for (iC13 = 0; iC13 < MIDI.data.length; iC13++) {
			for (jC13 = 0; jC13 < MIDI.data[iC13].length; jC13++) {
				// Spustí sa 10 ms po aplikovaní kroku vzad, keďže séria krokov vzad môže vytvoriť prázdne priestory.
				if (!MIDI.data[iC13][jC13] || !MIDI.data[iC13][jC13][N_DATA] || !MIDI.data[iC13][jC13][N_DATA].partials) continue;
				MIDInotePartialsC2 = MIDI.data[iC13][jC13][N_DATA].partials;
				for (kC13 = 0; kC13 < MIDInotePartialsC2.length; kC13++) {
					if (MIDInotePartialsC2[kC13][4] || MIDInotePartialsC2[kC13][5]) { selectedNoteCount++; break; }
				}
			}
		}

		var noteComp = 1 / Math.max(1, selectedNoteCount);

		for (iC13 = 0; iC13 < MIDI.data.length; iC13++) {
			for (jC13 = 0; jC13 < MIDI.data[iC13].length; jC13++) {
				if (!MIDI.data[iC13][jC13] || !MIDI.data[iC13][jC13][N_DATA] || !MIDI.data[iC13][jC13][N_DATA].partials) continue;
				MIDInotePartialsC2 = MIDI.data[iC13][jC13][N_DATA].partials;

				var specDataC2 = getSpectrumDataSafe(iC13);
				var trackDbC2 = instruments?.[iC13]?.volume || 0;
				var trackLinearC2 = Math.pow(10, trackDbC2 / 20);

				// Prehrá každý vybraný aj zvýraznený parciál samostatne s jeho skutočnou amplitúdou zo spektra.
				for (kC13 = 0; kC13 < MIDInotePartialsC2.length; kC13++) {
					if (MIDInotePartialsC2[kC13][4] || MIDInotePartialsC2[kC13][5]) {
						var partialFreq = note2freq(MIDInotePartialsC2[kC13][1]);
						// Preskočia sa nepočuteľné parciály.
						if (partialFreq < 20 || partialFreq > 20000) continue;
						var partialAmpC2 = specDataC2[kC13] ? specDataC2[kC13][1] : 1 / (kC13 + 1);
						var velocity = Math.min(1, Math.max(0.02, partialAmpC2 * trackLinearC2 * 0.48 * noteComp));
						freshSynth.triggerAttackRelease(partialFreq, "8n", now, velocity);
						playbackNotes.push(MIDInotePartialsC2[kC13][1]);
					}
				}
			}
		}

		if (playbackNotes.length) {
			playbackNotes.sort();
			for (nC13=0; nC13 < playbackNotes.length; nC13++) {
				playbackNotes[nC13] = note2name(Math.floor(playbackNotes[nC13])) + "+"+Math.round(((playbackNotes[nC13] - Math.floor(playbackNotes[nC13]))*100));
			}
			//Logger.log(playbackNotes.join(' '));
		}
	},

	// Stav predprehrávania pri priblížení.
	_zoomSynth: null,
	_zoomFadeTimer: null,
	_zoomActiveNotes: [],


	_scrubOscs: [],
	_lastScrubFreqs: [],


	stopScrubPreview: () => {
		var ctx = Tone.context?.rawContext;
		if (!ctx) return;
		var now = ctx.currentTime;

		for (const { osc, gain } of Canvas._scrubOscs) {
			var fadeStart = now + 0.02;
			var fadeEnd = fadeStart + 0.08;
			gain.gain.setValueAtTime(gain.gain.value, fadeStart);
			gain.gain.linearRampToValueAtTime(0, fadeEnd);
			try { osc.stop(fadeEnd + 0.05); } catch(e){}
			setTimeout(() => { try { osc.disconnect(); gain.disconnect(); } catch(e){} }, 200);
		}
		Canvas._scrubOscs = [];
		Canvas._lastScrubFreqs = [];
	},

	// Prehrá notu s plnou farbou a ADSR (pri vytváraní noty a ukončení po ťahaní).
	previewNoteWithTimbre: (trackIdx, fundamentalPitch, duration = 0.5, noteCount = 1) => {
		if (!instruments[trackIdx]) return;

		var ctx = Tone.context?.rawContext;
		if (!ctx || ctx.state !== 'running') {
			// Ak kontext ešte nie je pripravený, použije sa ako náhrada bežný syntetizátor.
			if (synths[trackIdx]) {
				const fundamentalFreq = note2freq(fundamentalPitch);
				synths[trackIdx].triggerAttackRelease(fundamentalFreq, duration, Tone.now(), 1);
			}
			return;
		}

		var now = ctx.currentTime;
		var timbre = spectra[instruments[trackIdx].spectrum];
		const fundamentalFreq = note2freq(fundamentalPitch);

		// Zohľadňuje sa hlasitosť stopy a hlavná hlasitosť (prevod dB na lineárnu hodnotu).
		var trackDb = instruments?.[trackIdx]?.volume || 0;
		var trackLinear = Math.pow(10, trackDb / 20);
		var masterDb = typeof masterVolumeValue !== 'undefined' ? masterVolumeValue : -6;
		var masterLinear = masterDb <= -70 ? 0 : Math.pow(10, masterDb / 20);
		var gainCompensation = 1 / Math.max(1, noteCount);
		var volumeScale = trackLinear * masterLinear * 0.12 * gainCompensation;

		var partialsData = timbre
			? (typeof DynamicTimbre !== 'undefined'
				? DynamicTimbre.getPartialsAtPitch(timbre, fundamentalPitch)
				: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, fundamentalPitch) : (timbre.data || [[1, 1]])))
			: null;

		if (partialsData && partialsData.length > 0) {
			var env = timbre.envelope || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
			var attackTime = Math.max(0.005, env.attack || 0.01);
			var decayTime = Math.max(0.005, env.decay || 0.1);
			var sustainRatio = env.sustain !== undefined ? env.sustain : 0.7;
			var releaseTime = Math.max(0.01, env.release || 0.2);

			var totalDuration = duration + releaseTime;

			var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
				? window.nativeMasterBus
				: ctx.destination;

			var createdOscillators = [];

			for (let i = 0; i < partialsData.length; i++) {
				var partialRatio = partialsData[i][0];
				var partialAmp = partialsData[i][1];
				var partialFreq = fundamentalFreq * partialRatio;

				// Preskočí nepočuteľné parciály.
				if (partialFreq > 20000 || partialAmp < 0.001) continue;

				try {
					var osc = ctx.createOscillator();
					var gain = ctx.createGain();

					osc.type = 'sine';
					osc.frequency.value = partialFreq;
					osc.connect(gain);
					gain.connect(destination);

					var peakAmp = partialAmp * volumeScale;
					var sustainAmp = peakAmp * sustainRatio;

					// Aplikuje obálku ADSR.
					gain.gain.setValueAtTime(0, now);
					gain.gain.linearRampToValueAtTime(peakAmp, now + attackTime);
					gain.gain.linearRampToValueAtTime(sustainAmp, now + attackTime + decayTime);
					// Úroveň držania sa udrží až po samotné doznenie.
					gain.gain.setValueAtTime(sustainAmp, now + duration);
					gain.gain.linearRampToValueAtTime(0, now + totalDuration);

					osc.start(now);
					osc.stop(now + totalDuration + 0.05);

					createdOscillators.push({ osc, gain });
				} catch (e) {
					Logger.warn('previewNoteWithTimbre: Could not create partial', i, e.message);
				}
			}

			if (createdOscillators.length > 0) {
				setTimeout(() => {
					for (const { osc, gain } of createdOscillators) {
						try {
							osc.disconnect();
							gain.disconnect();
						} catch (e) {}
					}
				}, totalDuration * 1000 + 100);
				return;
			}
		}

		// Ako náhradné riešenie sa použije bežný syntetizátor.
		if (synths[trackIdx]) {
			synths[trackIdx].triggerAttackRelease(fundamentalFreq, duration, Tone.now(), volumeScale / 0.3);
		}
	},

	// Stav priebežného predprehrávania počas ťahania, teda jeden sínusový oscilátor.
	_dragPreviewOsc: null,
	_dragPreviewGain: null,

	// Priebežné predprehrávanie pri ťahaní výšky tónu
	// prehráva jednoduchú sínusovú vlnu s plynulým nábehom a doznením
	// parameter amp používa skutočnú amplitúdu parciálu zo spektra.
	previewDragSine: (freq, trackIdx, amp = 1.0) => {
		var ctx = Tone.context.rawContext;
		if (!ctx || ctx.state !== 'running') return;

		var now = ctx.currentTime;
		// Faktor škálovania 0.12 kvôli zhode s nastavením zisku skutočných syntetizátorov na prehrávanie.
		var trackDb = instruments?.[trackIdx]?.volume || 0;
		var trackLinear = Math.pow(10, trackDb / 20);
		var masterDb = typeof masterVolumeValue !== 'undefined' ? masterVolumeValue : -6;
		var masterLinear = masterDb <= -70 ? 0 : Math.pow(10, masterDb / 20);
		var targetGain = amp * trackLinear * masterLinear * 0.12;

		// Ak práve hrá predprehrávanie parciálu, prevezme sa ako predprehrávanie ťahania.
		if (Canvas._partialPreviewOsc && !Canvas._dragPreviewOsc) {
			Canvas._dragPreviewOsc = Canvas._partialPreviewOsc;
			Canvas._dragPreviewGain = Canvas._partialPreviewGain;
			Canvas._partialPreviewOsc = null;
			Canvas._partialPreviewGain = null;
			Canvas._dragPreviewOsc.frequency.setValueAtTime(freq, now);
			Canvas._dragPreviewGain.gain.linearRampToValueAtTime(targetGain, now + 0.015);
			return;
		}

		// Pri prvom spustení vytvorí oscilátor.
		if (!Canvas._dragPreviewOsc) {
			Canvas._dragPreviewGain = ctx.createGain();
			try {
				var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
					? window.nativeMasterBus
					: ctx.destination;
				Canvas._dragPreviewGain.connect(destination);
			} catch (e) {
				try {
					Canvas._dragPreviewGain.connect(ctx.destination);
				} catch (e2) {
					Logger.warn('previewDragSine: Could not connect audio', e2.message);
					return;
				}
			}

			// Zisk sa zastaví na 0 a potom sa postupne zvýši.
			Canvas._dragPreviewGain.gain.value = 0;

			Canvas._dragPreviewOsc = ctx.createOscillator();
			Canvas._dragPreviewOsc.type = 'sine';
			Canvas._dragPreviewOsc.frequency.value = freq;
			Canvas._dragPreviewOsc.connect(Canvas._dragPreviewGain);
			Canvas._dragPreviewOsc.start(now);

			// Plynulé zvýšenie po krátkom oneskorení.
			var rampStart = now + 0.02;
			Canvas._dragPreviewGain.gain.setValueAtTime(0, rampStart);
			Canvas._dragPreviewGain.gain.linearRampToValueAtTime(Math.max(0.0001, targetGain), rampStart + 0.06);
		} else {
			var rampTime = now + 0.02;
			Canvas._dragPreviewOsc.frequency.setValueAtTime(Canvas._dragPreviewOsc.frequency.value, rampTime);
			Canvas._dragPreviewOsc.frequency.linearRampToValueAtTime(freq, rampTime + 0.015);
			Canvas._dragPreviewGain.gain.setValueAtTime(Canvas._dragPreviewGain.gain.value, rampTime);
			Canvas._dragPreviewGain.gain.linearRampToValueAtTime(targetGain, rampTime + 0.02);
		}
	},

	stopDragSine: () => {
		if (Canvas._dragPreviewOsc) {
			var oscToStop = Canvas._dragPreviewOsc;
			var gainToStop = Canvas._dragPreviewGain;
			Canvas._dragPreviewOsc = null;
			Canvas._dragPreviewGain = null;

			try {
				var ctx = Tone.context.rawContext;
				var now = ctx.currentTime;
				var currentGain = gainToStop.gain.value;
				var fadeStart = now + 0.02;
				var fadeEnd = fadeStart + 0.08;
				gainToStop.gain.setValueAtTime(currentGain, fadeStart);
				gainToStop.gain.linearRampToValueAtTime(0, fadeEnd);
				try { oscToStop.stop(fadeEnd + 0.05); } catch(e){}
				setTimeout(() => {
					try {
						oscToStop.disconnect();
						gainToStop.disconnect();
					} catch (e) {}
				}, 200);
			} catch (e) {}
		}
	},

	// Stav predprehrávania jedného parciálu sínusovkou (mousedown na parciáli).
	_partialPreviewOsc: null,
	_partialPreviewGain: null,

	// Jednoduché predprehratie jednou sínusovou vlnou na danej frekvencii (pri mousedown na parciáli)
	// parameter amp používa skutočnú amplitúdu parciálu zo spektra (predvolene 1.0, ak nie je zadaná).
	previewPartialSine: (freq, amp = 1.0, trackIdx = 0) => {
		var ctx = Tone.context?.rawContext;
		if (!ctx || ctx.state !== 'running') return;
		// Nežene oscilátor za Nyquista (vysoké neharmonické parciály), ktoré by Tone orezal a ohlásil.
		if (!(freq >= 20 && freq <= 20000)) return;

		var now = ctx.currentTime;
		// Faktor škálovania 0.12 kvôli zhode s nastavením zisku skutočných syntetizátorov na prehrávanie.
		var trackDb = instruments?.[trackIdx]?.volume || 0;
		var trackLinear = Math.pow(10, trackDb / 20);
		var masterDb = typeof masterVolumeValue !== 'undefined' ? masterVolumeValue : -6;
		var masterLinear = masterDb <= -70 ? 0 : Math.pow(10, masterDb / 20);
		var targetGain = Math.max(0.0001, amp * trackLinear * masterLinear * 0.12);

		// Ak oscilátor už existuje, iba sa aktualizuje frekvencia a zisk.
		if (Canvas._partialPreviewOsc) {
			var rampTime = now + 0.02;
			Canvas._partialPreviewOsc.frequency.setValueAtTime(Canvas._partialPreviewOsc.frequency.value, rampTime);
			Canvas._partialPreviewOsc.frequency.linearRampToValueAtTime(freq, rampTime + 0.015);
			var g = Canvas._partialPreviewGain.gain;
			g.cancelScheduledValues(now);
			g.setValueAtTime(g.value, rampTime);
			g.linearRampToValueAtTime(targetGain, rampTime + 0.02);
			g.setTargetAtTime(targetGain * 0.35, rampTime + 0.06, 0.3);
			return;
		}

		try {
			Canvas._partialPreviewGain = ctx.createGain();
			var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
				? window.nativeMasterBus
				: ctx.destination;
			Canvas._partialPreviewGain.connect(destination);

			Canvas._partialPreviewGain.gain.value = 0;

			Canvas._partialPreviewOsc = ctx.createOscillator();
			Canvas._partialPreviewOsc.type = 'sine';
			Canvas._partialPreviewOsc.frequency.value = freq;
			Canvas._partialPreviewOsc.connect(Canvas._partialPreviewGain);
			Canvas._partialPreviewOsc.start(now);

			var rampStart = now + 0.02;
			Canvas._partialPreviewGain.gain.setValueAtTime(0, rampStart);
			Canvas._partialPreviewGain.gain.linearRampToValueAtTime(targetGain, rampStart + 0.06);
			Canvas._partialPreviewGain.gain.setTargetAtTime(targetGain * 0.35, rampStart + 0.12, 0.3);
		} catch (e) {
			Logger.warn('previewPartialSine: Could not start audio', e.message);
			Canvas._partialPreviewOsc = null;
			Canvas._partialPreviewGain = null;
		}
	},

	stopPartialSine: () => {
		if (Canvas._partialPreviewOsc) {
			// Uloží referencie pred odstránením, aby setTimeout zastavil správny oscilátor.
			var oscToStop = Canvas._partialPreviewOsc;
			var gainToStop = Canvas._partialPreviewGain;
			Canvas._partialPreviewOsc = null;
			Canvas._partialPreviewGain = null;

			try {
				var ctx = Tone.context?.rawContext;
				var now = ctx.currentTime;
				var currentGain = gainToStop.gain.value;
				var fadeStart = now + 0.02;
				var fadeEnd = fadeStart + 0.08;
				gainToStop.gain.setValueAtTime(currentGain, fadeStart);
				gainToStop.gain.linearRampToValueAtTime(0, fadeEnd);
				try { oscToStop.stop(fadeEnd + 0.05); } catch(e){}
				setTimeout(() => {
					try {
						oscToStop.disconnect();
						gainToStop.disconnect();
					} catch (e) {}
				}, 200);
			} catch (e) {}
		}
	},

	_calcPartialFreqAndAmp: (trackIdx, noteIdx, partialIdx) => {
		var note = MIDI.data[trackIdx]?.[noteIdx];
		if (!note || !note[N_DATA]?.partials?.[partialIdx]) return null;

		var inst = instruments[trackIdx];
		var timbre = spectra[inst?.spectrum];
		var partialsData = (timbre && typeof DynamicTimbre !== 'undefined')
			? DynamicTimbre.getPartialsAtPitch(timbre, note[N_PITCH])
			: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, note[N_PITCH]) : (timbre?.data || [[1, 1]]));
		var activePartialIdx = (note[N_PARTIAL] || 1) - 1;
		var activePartialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
		var fundamentalFreq = note2freq(note[N_PITCH]) / activePartialRatio;
		var partialRatio = partialsData?.[partialIdx]?.[0] || (partialIdx + 1);
		var partialAmp = partialsData?.[partialIdx]?.[1] ?? 0.5;
		return { freq: fundamentalFreq * partialRatio, amp: partialAmp };
	},

	_selectionOscs: new Map(),
	_selectionPreviewLastUpdate: 0,

	// Predprehrávanie výberu, jedna sínusovka na notu (najnižší parciál).
	updateSelectionPreview: (highlightedPartials) => {
		if (!window['switch-checkbox-headphones']?.checked) return;

		var ctx = Tone.context?.rawContext;
		if (!ctx || ctx.state !== 'running') return;
		var now = ctx.currentTime;

		// Obmedzí sa vytváranie nových oscilátorov na najviac raz za 50 ms, aby sa predišlo zvukovým artefaktom
		// aktualizácie zisku len keď sa zmení počet nôt.
		var timeSinceLastUpdate = (now - Canvas._selectionPreviewLastUpdate) * 1000;
		var throttled = timeSinceLastUpdate < 50 && Canvas._selectionOscs.size > 0;

		// Zoskupí podľa noty, pre každú si ponechá najnižší index parciálu.
		var noteToPartial = new Map();
		for (const key of highlightedPartials) {
			const [trackIdx, noteIdx, partialIdx] = key.split('-').map(Number);
			const noteKey = `${trackIdx}-${noteIdx}`;
			if (!noteToPartial.has(noteKey) || partialIdx < noteToPartial.get(noteKey)) {
				noteToPartial.set(noteKey, partialIdx);
			}
		}

		// Stíši oscilátory pre noty, ktoré už nie sú vybrané; debounce predchádza zvukovým artefaktom a klikom.
		for (const [noteKey, oscData] of Canvas._selectionOscs) {
			if (!noteToPartial.has(noteKey) && !oscData.fadingOut) {
				// Debounce označí notu na stíšenie, ale samotné stíšenie odloží.
				if (!oscData.pendingFadeOut) {
					oscData.pendingFadeOut = now;
					continue;
				}
				// Stíšenie sa spustí, iba ak je nota mimo výberu dlhšie ako 30 ms.
				if (now - oscData.pendingFadeOut < 0.03) {
					continue;
				}
				oscData.fadingOut = true;
				oscData.pendingFadeOut = null;
				oscData.gain.gain.cancelScheduledValues(now);
				oscData.gain.gain.setTargetAtTime(0, now, 0.04);
				try { oscData.osc.stop(now + 0.25); } catch(e){}
				const oscToClean = oscData.osc;
				const gainToClean = oscData.gain;
				const keyToDelete = noteKey;
				setTimeout(() => {
					var current = Canvas._selectionOscs.get(keyToDelete);
					if (current && current.osc === oscToClean) {
						try {
							oscToClean.disconnect();
							gainToClean.disconnect();
						} catch(e){}
						Canvas._selectionOscs.delete(keyToDelete);
					}
				}, 200);
			} else if (noteToPartial.has(noteKey) && oscData.pendingFadeOut) {
				// Ak sa nota vrátila skôr, než stíšenie začalo, naplánované stíšenie sa zruší.
				oscData.pendingFadeOut = null;
			}
		}

		// Zohľadňuje sa hlavná hlasitosť (prevod dB na lineárnu hodnotu).
		var masterDb = typeof masterVolumeValue !== 'undefined' ? masterVolumeValue : -6;
		var masterLinear = masterDb <= -70 ? 0 : Math.pow(10, masterDb / 20);

		// Automatické zníženie zisku podľa počtu vybraných nôt (predchádza orezaniu).
		var noteCount = noteToPartial.size;
		var autoGain = noteCount > 0 ? Math.max(0.05, 1 / noteCount) : 1;

		// Výstup (destination), kam audio putuje, uprednostní sa master bus kvôli konzistentnej hlasitosti.
		var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
			? window.nativeMasterBus
			: ctx.destination;

		// Pridá alebo aktualizuje oscilátory pre vybrané noty a prepočíta všetky zisky s aktuálnym počtom nôt.
		for (const [noteKey, partialIdx] of noteToPartial) {
			var existing = Canvas._selectionOscs.get(noteKey);
			const [trackIdx, noteIdx] = noteKey.split('-').map(Number);
			var partialData = Canvas._calcPartialFreqAndAmp(trackIdx, noteIdx, partialIdx);
			if (!partialData) continue;
			var { freq, amp } = partialData;

			var trackDb = instruments?.[trackIdx]?.volume || 0;
			var trackLinear = Math.pow(10, trackDb / 20);

			var previewGain = Math.max(0.0001, amp * trackLinear * masterLinear * autoGain * 0.12);
			var bedGain = previewGain * 0.35;

			if (existing) {
				if (existing.fadingOut) {
					// Obnoví sa stíšujúci sa oscilátor a použije sa setTargetAtTime na plynulý prechod.
					existing.gain.gain.cancelScheduledValues(now);
					existing.gain.gain.setTargetAtTime(bedGain, now, 0.03);
					existing.osc.frequency.setTargetAtTime(freq, now, 0.02);
					existing.fadingOut = false;
					existing.pendingFadeOut = null;
					existing.partialIdx = partialIdx;
					existing.targetGain = bedGain;
				} else {
					// Zisk sa aktualizuje vždy, aby odrážal aktuálnu kompenzáciu podľa noteCount.
					existing.gain.gain.cancelScheduledValues(now);
					existing.gain.gain.setTargetAtTime(bedGain, now, 0.03);
					existing.targetGain = bedGain;
					if (existing.partialIdx !== partialIdx) {
						// Parciál sa zmenil, preto plynulý prechod frekvencie.
						existing.osc.frequency.setTargetAtTime(freq, now, 0.02);
						existing.partialIdx = partialIdx;
					}
				}
				continue;
			}

			if (throttled) continue;
			var osc = ctx.createOscillator();
			var gain = ctx.createGain();

			// Začne sa potichu, nabehne na špičku a klesne na tiché ležiace pásmo ako pri držanom kliku.
			gain.gain.value = 0;
			osc.type = 'sine';
			osc.frequency.value = freq;
			osc.connect(gain);
			gain.connect(destination);
			osc.start(now);
			gain.gain.setTargetAtTime(previewGain, now, 0.03);
			gain.gain.setTargetAtTime(bedGain, now + 0.15, 0.3);

			Canvas._selectionOscs.set(noteKey, { osc, gain, partialIdx, fadingOut: false, targetGain: bedGain });
			Canvas._selectionPreviewLastUpdate = now;
		}
	},

	stopSelectionPreview: () => {
		var ctx = Tone.context?.rawContext;
		if (!ctx) return;
		var now = ctx.currentTime;

		for (const [key, { osc, gain }] of Canvas._selectionOscs) {
			var currentGain = gain.gain.value;
			var fadeStart = now + 0.02;
			var fadeEnd = fadeStart + 0.08;
			gain.gain.setValueAtTime(currentGain, fadeStart);
			gain.gain.linearRampToValueAtTime(0, fadeEnd);
			try { osc.stop(fadeEnd + 0.05); } catch(e){}
			setTimeout(() => {
				try {
					osc.disconnect();
					gain.disconnect();
				} catch(e){}
			}, 200);
		}
		Canvas._selectionOscs.clear();
	},

	// Stav spotlightu, ktorý klávesa S zameria na zvýraznený alebo vybraný parciál.
	_spotlightOsc: null,
	_spotlightGain: null,
	_spotlightNoteKey: null,
	_spotlightTarget: null,  // { trackIdx, noteIdx, partialIdx }

	// Nota pod pozíciou kurzora.
	_findNoteAtPosition: (mouseX, mouseY) => {
		// mouseX je už upravené (offsetX - 60).
		for (let i = 0; i < MIDI.data.length; i++) {
			if (!instruments[i]?.selected) continue;

			var notes = MIDI.data[i];
			for (let j = 0; j < notes.length; j++) {
				var note = notes[j];
				if (!note[N_DATA]?.partials?.length) continue;

				// Okraje noty podľa jej parciálov a najbližší parciál ku kurzoru.
				var partials = note[N_DATA].partials;
				var minY = Infinity, maxY = -Infinity;
				var noteStartX = Infinity, noteEndX = -Infinity;
				var closestPartialIdx = 0;
				var closestPartialDist = Infinity;

				// V režime T sa zohľadňuje iba aktívny parciál.
				var activePartialIdx = note[N_PARTIAL] - 1;

				for (let k = 0; k < partials.length; k++) {
					if (!Canvas.partialBrightness && k !== activePartialIdx) continue;

					var p = partials[k];
					var px = Canvas.offx + p[0] * barSize;
					var pw = p[2] * barSize;
					var ph = p[3] * Math.min(octaveSpacingStep, 10);
					var py = Canvas.offy - p[1] * octaveSpacingStep - ph;
					var pCenterY = py + ph / 2;

					if (px < noteStartX) noteStartX = px;
					if (px + pw > noteEndX) noteEndX = px + pw;
					if (py < minY) minY = py;
					if (py + ph > maxY) maxY = py + ph;

					// Sleduje parciál najbližšie k Y súradnici kurzora.
					var dist = Math.abs(mouseY - pCenterY);
					if (dist < closestPartialDist) {
						closestPartialDist = dist;
						closestPartialIdx = k;
					}
				}

				// Kontrola, či je kurzor vnútri noty (s určitým odsadením).
				var padding = 5;
				if (mouseX >= noteStartX - padding && mouseX <= noteEndX + padding &&
					mouseY >= minY - padding && mouseY <= maxY + padding) {
					return { trackIdx: i, noteIdx: j, note, partialIdx: closestPartialIdx };
				}
			}
		}
		return null;
	},

	// Prvý vybraný parciál pre spotlight.
	_getFirstSelectedPartial: () => {
		for (let i = 0; i < MIDI.data.length; i++) {
			if (!instruments[i]?.selected) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (!note[N_DATA]?.partials) continue;

				// V režime T sa zohľadňuje iba aktívny parciál.
				var activePartialIdx = note[N_PARTIAL] - 1;

				for (let k = 0; k < note[N_DATA].partials.length; k++) {
					if (!Canvas.partialBrightness && k !== activePartialIdx) continue;

					if (note[N_DATA].partials[k][P_SEL]) {
						return { trackIdx: i, noteIdx: j, partialIdx: k, note };
					}
				}
			}
		}
		return null;
	},

	_getNoteFreq: (trackIdx, note, partialIdx) => {
		var inst = instruments[trackIdx];
		var timbre = spectra[inst?.spectrum];
		var partialsData = (timbre && typeof DynamicTimbre !== 'undefined')
			? DynamicTimbre.getPartialsAtPitch(timbre, note[N_PITCH])
			: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, note[N_PITCH]) : (timbre?.data || [[1, 1]]));

		var activePartialIdx = (note[N_PARTIAL] || 1) - 1;
		var activePartialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
		var fundamentalFreq = note2freq(note[N_PITCH]) / activePartialRatio;

		var pIdx = partialIdx !== undefined ? partialIdx : activePartialIdx;
		var partialRatio = partialsData?.[pIdx]?.[0] || (pIdx + 1);
		return fundamentalFreq * partialRatio;
	},

	startSpotlightPreview: () => {
		var ctx = Tone.context?.rawContext;
		if (!ctx) return;

		var freq = null;
		var noteKey = null;
		var target = null;

		// Je kurzor konkrétne nad parciálom?
		if (partialNote && partialNumber) {
			var trackIdx = -1;
			var noteIdx = 0;
			for (let i = 0; i < MIDI.data.length; i++) {
				var idx = MIDI.data[i].indexOf(partialNote);
				if (idx >= 0) {
					trackIdx = i;
					noteIdx = idx;
					break;
				}
			}
			if (trackIdx >= 0 && instruments[trackIdx]?.selected) {
				// V režime T sa spotlight zameria iba na aktívny parciál.
				var activePartialIdx = partialNote[N_PARTIAL] - 1;
				var partialIdx = partialNumber - 1;
				if (Canvas.partialBrightness || partialIdx === activePartialIdx) {
					freq = Canvas._getNoteFreq(trackIdx, partialNote, partialIdx);
					noteKey = `${trackIdx}-${noteIdx}-${partialNumber}`;
					target = { trackIdx, noteIdx, partialIdx };
				}
			}
		}
		// Skontroluje sa nota pod kurzorom (s väčšou toleranciou) a použije sa najbližší parciál.
		if (!freq && select?.offsetX !== undefined && select?.offsetY !== undefined) {
			var noteInfo = Canvas._findNoteAtPosition(select.offsetX - 60, select.offsetY);
			if (noteInfo) {
				freq = Canvas._getNoteFreq(noteInfo.trackIdx, noteInfo.note, noteInfo.partialIdx);
				noteKey = `${noteInfo.trackIdx}-${noteInfo.noteIdx}-${noteInfo.partialIdx}`;
				target = { trackIdx: noteInfo.trackIdx, noteIdx: noteInfo.noteIdx, partialIdx: noteInfo.partialIdx };
			}
		}

		// Ak sa nič nenašlo, použije sa vybraný parciál ako náhrada.
		if (!freq) {
			var selected = Canvas._getFirstSelectedPartial();
			if (selected) {
				freq = Canvas._getNoteFreq(selected.trackIdx, selected.note, selected.partialIdx);
				noteKey = `selected-${selected.trackIdx}-${selected.noteIdx}-${selected.partialIdx}`;
				target = { trackIdx: selected.trackIdx, noteIdx: selected.noteIdx, partialIdx: selected.partialIdx };
			}
		}

		if (!freq) {
			Canvas._spotlightTarget = null;
			return;
		}

		Canvas._spotlightTarget = target;

		var now = ctx.currentTime;
		Canvas._spotlightOsc = ctx.createOscillator();
		Canvas._spotlightGain = ctx.createGain();
		Canvas._spotlightOsc.type = 'sine';
		Canvas._spotlightOsc.frequency.value = freq;
		Canvas._spotlightGain.gain.value = 0;
		Canvas._spotlightOsc.connect(Canvas._spotlightGain);
		Canvas._spotlightGain.connect(ctx.destination);
		Canvas._spotlightOsc.start(now);

		var rampStart = now + 0.02;
		Canvas._spotlightGain.gain.setValueAtTime(0, rampStart);
		Canvas._spotlightGain.gain.linearRampToValueAtTime(0.25, rampStart + 0.06);

		Canvas._spotlightNoteKey = noteKey;
	},

	// Predprehrávanie spotlightu pri zmene tónu pod kurzorom.
	updateSpotlightPreview: () => {
		if (!select?.spotlight?.active) return;

		var ctx = Tone.context?.rawContext;
		if (!ctx) return;

		var freq = null;
		var noteKey = null;
		var target = null;

		// Kontrola, či kurzor nie je práve nad konkrétnym parciálom.
		if (partialNote && partialNumber) {
			var trackIdx = -1;
			var noteIdx = 0;
			for (let i = 0; i < MIDI.data.length; i++) {
				var idx = MIDI.data[i].indexOf(partialNote);
				if (idx >= 0) {
					trackIdx = i;
					noteIdx = idx;
					break;
				}
			}
			if (trackIdx >= 0 && instruments[trackIdx]?.selected) {
				// V režime T mieri spotlight len na aktívny parciál.
				var activePartialIdx = partialNote[N_PARTIAL] - 1;
				var partialIdx = partialNumber - 1;
				if (Canvas.partialBrightness || partialIdx === activePartialIdx) {
					freq = Canvas._getNoteFreq(trackIdx, partialNote, partialIdx);
					noteKey = `${trackIdx}-${noteIdx}-${partialNumber}`;
					target = { trackIdx, noteIdx, partialIdx };
				}
			}
		}
		// Skontroluje sa tón pod kurzorom a použije sa najbližší parciál.
		else if (select?.offsetX !== undefined && select?.offsetY !== undefined) {
			var noteInfo = Canvas._findNoteAtPosition(select.offsetX - 60, select.offsetY);
			if (noteInfo) {
				freq = Canvas._getNoteFreq(noteInfo.trackIdx, noteInfo.note, noteInfo.partialIdx);
				noteKey = `${noteInfo.trackIdx}-${noteInfo.noteIdx}-${noteInfo.partialIdx}`;
				target = { trackIdx: noteInfo.trackIdx, noteIdx: noteInfo.noteIdx, partialIdx: noteInfo.partialIdx };
			}
		}

		// Inak sa použije vybraný parciál.
		if (!freq) {
			var selected = Canvas._getFirstSelectedPartial();
			if (selected) {
				freq = Canvas._getNoteFreq(selected.trackIdx, selected.note, selected.partialIdx);
				noteKey = `selected-${selected.trackIdx}-${selected.noteIdx}-${selected.partialIdx}`;
				target = { trackIdx: selected.trackIdx, noteIdx: selected.noteIdx, partialIdx: selected.partialIdx };
			}
		}

		// Žiadny výstup, teda len nechať doznieť.
		if (!freq) {
			Canvas._spotlightTarget = null;
			if (Canvas._spotlightOsc && Canvas._spotlightGain) {
				const now = ctx.currentTime;
				var fadeStart = now + 0.02;
				Canvas._spotlightGain.gain.setValueAtTime(Canvas._spotlightGain.gain.value, fadeStart);
				Canvas._spotlightGain.gain.linearRampToValueAtTime(0, fadeStart + 0.08);
			}
			return;
		}

		Canvas._spotlightTarget = target;

		// Výstup je rovnaký.
		if (noteKey === Canvas._spotlightNoteKey && Canvas._spotlightOsc) {
			const now = ctx.currentTime;
			const rampTime = now + 0.02;
			Canvas._spotlightGain.gain.setValueAtTime(Canvas._spotlightGain.gain.value, rampTime);
			Canvas._spotlightGain.gain.linearRampToValueAtTime(0.25, rampTime + 0.04);
			return;
		}

		// Iný výstup, teda crossfade na novú frekvenciu.
		if (Canvas._spotlightOsc) {
			const now = ctx.currentTime;
			const rampTime = now + 0.02;
			Canvas._spotlightOsc.frequency.setValueAtTime(Canvas._spotlightOsc.frequency.value, rampTime);
			Canvas._spotlightOsc.frequency.linearRampToValueAtTime(freq, rampTime + 0.03);
			Canvas._spotlightGain.gain.setValueAtTime(Canvas._spotlightGain.gain.value, rampTime);
			Canvas._spotlightGain.gain.linearRampToValueAtTime(0.25, rampTime + 0.04);
		} else {
			Canvas.startSpotlightPreview();
		}

		Canvas._spotlightNoteKey = noteKey;
	},

	stopSpotlightPreview: () => {
		Canvas._spotlightTarget = null;
		if (!Canvas._spotlightOsc) return;

		var ctx = Tone.context?.rawContext;
		if (!ctx) return;

		try {
			var now = ctx.currentTime;
			var currentGain = Canvas._spotlightGain.gain.value;
			var fadeStart = now + 0.02;
			var fadeEnd = fadeStart + 0.08;
			Canvas._spotlightGain.gain.setValueAtTime(currentGain, fadeStart);
			Canvas._spotlightGain.gain.linearRampToValueAtTime(0, fadeEnd);
			try { Canvas._spotlightOsc.stop(fadeEnd + 0.05); } catch(e){}
			setTimeout(() => {
				try {
					Canvas._spotlightOsc?.disconnect();
					Canvas._spotlightGain?.disconnect();
				} catch (e) {}
				Canvas._spotlightOsc = null;
				Canvas._spotlightGain = null;
				Canvas._spotlightNoteKey = null;
			}, 200);
		} catch (e) {
			Canvas._spotlightOsc = null;
			Canvas._spotlightGain = null;
			Canvas._spotlightNoteKey = null;
		}
	},

	// Prepnutie zámku na vybraných parciáloch
	// uzamknuté parciály (parciál[6] = 1) zostávajú na mieste, keď sa presúvajú ostatné parciály.
	togglePartialLock: () => {
		var lockedCount = 0;
		var unlockedCount = 0;

		// Na začiatku sa spočítajú uzamknuté a odomknuté vybrané parciály.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (!MIDI.data[i][j][N_DATA] || !MIDI.data[i][j][N_DATA].partials) continue;
				
				const partials = MIDI.data[i][j][N_DATA].partials;
				for (let k = 0; k < partials.length; k++) {
					if (partials[k][4] || partials[k][5]) {
						if (partials[k][6]) {
							lockedCount++;
						} else {
							unlockedCount++;
						}
					}
				}
			}
		}
		
		var newLockState = unlockedCount > 0 ? 1 : 0;

		// V druhom cykle sa nastaví zámok.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (!MIDI.data[i][j][N_DATA] || !MIDI.data[i][j][N_DATA].partials) continue;
				
				const partials = MIDI.data[i][j][N_DATA].partials;
				for (let k = 0; k < partials.length; k++) {
					if (partials[k][4] || partials[k][5]) {
						partials[k][6] = newLockState;
					}
				}
			}
		}
		
		Logger.log("Partial lock: " + (newLockState ? "locked" : "unlocked") + " " + (lockedCount + unlockedCount) + " partials");
	},
	duplicateNotes: () => {
		var iC12, jC12, kC12, lC12, partialDataDup, MIDInotePartials3, MIDInotePartialsC3;
		// Na krok vzad sa kvôli výkonu sledujú len zmenené a nové noty namiesto celého MIDI.data.
		var trackChanges = {};  // trackIdx -> pole zmien.
		var hasChanges = false;

		for (iC12 = 0; iC12 < MIDI.data.length; iC12++) {
			var trackLen = MIDI.data[iC12].length;
			for (jC12 = trackLen - 1; jC12 >= 0; jC12--) {
				// Keďže sa N_DATA vytvára až pri prvom vykreslení, nové noty bez partials sa preskočia.
				if (!MIDI.data[iC12][jC12] || !MIDI.data[iC12][jC12][N_DATA] || !MIDI.data[iC12][jC12][N_DATA].partials) continue;
				MIDInotePartialsC3 = MIDI.data[iC12][jC12][N_DATA].partials;

				for (kC12 = MIDInotePartialsC3.length - 1; kC12 >= 0; kC12--) {
					// Duplikovať podľa výberu [4]; zvýraznenie [5] sa neberie do úvahy.
					if (MIDInotePartialsC3[kC12][4]) {
						hasChanges = true;

						// Klonovanie stavu pôvodnej noty ešte pred úpravou na krok vzad.
						var sourceNoteBefore = typeof UndoManager !== 'undefined' ? structuredClone(MIDI.data[iC12][jC12]) : null;

						partialDataDup = structuredClone(MIDI.data[iC12][jC12][N_DATA]);

						MIDInotePartials3 = getSpectrumDataSafe(iC12);

						for (lC12 = 0; lC12 < MIDI.data[iC12][jC12][N_DATA].partials.length; lC12++) {
							partialDataDup.partials[lC12][0] = MIDI.data[iC12][jC12][N_TIME] + MIDI.data[iC12][jC12][N_DUR];  // Uložené v jednotkách času.
						}

						var srcNote = MIDI.data[iC12][jC12];
							var newNote = [
								srcNote[N_TIME] + srcNote[N_DUR],
								srcNote[N_DUR],
								srcNote[N_PITCH],
								srcNote[N_PARTIAL],
								partialDataDup,
								0,                      // N_SEL, úroveň noty; výber parciálov je v partialDataDup.
								srcNote[N_DEPTH] || 0,  // N_DEPTH bolo vynechané, čím sa kópia sploští na hĺbku 0.
								srcNote[N_HIDDEN] || 0  // N_HIDDEN
							];
						var newNoteIdx = MIDI.data[iC12].length;
						MIDI.data[iC12].push(newNote);

						// Vymazanie výberu z pôvodnej noty.
						MIDI.data[iC12][jC12][N_DATA].partials[kC12][4] = 0;
						MIDI.data[iC12][jC12][N_DATA].partials[kC12][5] = 0;

						if (typeof UndoManager !== 'undefined') {
							if (!trackChanges[iC12]) trackChanges[iC12] = [];
							trackChanges[iC12].push({
								noteIndex: jC12,
								before: sourceNoteBefore,
								after: structuredClone(MIDI.data[iC12][jC12])
							});
							trackChanges[iC12].push({
								noteIndex: newNoteIdx,
								before: null,
								after: structuredClone(newNote)
							});
						}
					}
				}
			}
		}

		if (hasChanges && typeof UndoManager !== 'undefined' && Object.keys(trackChanges).length > 0) {
			UndoManager.recordMultiTrackDelta('Duplicate notes', trackChanges);
		}

		DB.set('MIDIdata', MIDI.data, { skipUndo: true });
	},

	// Kvantizácia v čase do mriežky.
	quantizeToGrid: () => {
		if (typeof GridSystem === 'undefined' || typeof Timeline === 'undefined') return;

		var beforeState = typeof UndoManager !== 'undefined' ? structuredClone(MIDI.data) : null;

		var quantizedCount = 0;

		for (let i = 0; i < MIDI.data.length; i++) {
			if (!MIDI.data[i]) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (!note || note.length < 5 || !note[N_DATA] || !note[N_DATA].partials) continue;

				var isSelected = false;
				for (let k = 0; k < note[N_DATA].partials.length; k++) {
					if (note[N_DATA].partials[k] && note[N_DATA].partials[k][4]) {
						isSelected = true;
						break;
					}
				}

				if (isSelected) {
					// Použiť dostatočný rozsah hľadania. 10 sekúnd ako rezervu.
					var changed = false;
					var snapped = GridSystem.snapToGrid(note[N_TIME], i, 10);
					if (snapped !== null && snapped !== note[N_TIME]) {
						note[N_TIME] = snapped;
						for (let k = 0; k < note[N_DATA].partials.length; k++) {
							if (note[N_DATA].partials[k]) {
								note[N_DATA].partials[k][0] = snapped;
							}
						}
						changed = true;
					}
					var snappedEnd = GridSystem.snapToGrid(note[N_TIME] + note[N_DUR], i, 10);
					if (snappedEnd !== null && snappedEnd > note[N_TIME] && snappedEnd !== note[N_TIME] + note[N_DUR]) {
						note[N_DUR] = snappedEnd - note[N_TIME];
						for (let k = 0; k < note[N_DATA].partials.length; k++) {
							if (note[N_DATA].partials[k]) {
								note[N_DATA].partials[k][2] = note[N_DUR];
							}
						}
						changed = true;
					}
					if (changed) quantizedCount++;
				}
			}
		}
		
		if (quantizedCount > 0) {
			if (beforeState && typeof UndoManager !== 'undefined') {
				var afterState = structuredClone(MIDI.data);
				UndoManager.recordSnapshot('Quantize to grid', ['MIDIdata'], { MIDIdata: beforeState }, { MIDIdata: afterState });
			}

			DB.set('MIDIdata', MIDI.data, { skipUndo: true });
			Logger.log(`Quantized ${quantizedCount} note(s) to grid`);
		}
	},

	// Kvantizácia frekvenčných výšok vybraných nôt na aktuálne ladenie.
	quantizeToTuning: () => {
		if (typeof Timeline === 'undefined') return;

		var beforeState = typeof UndoManager !== 'undefined' ? structuredClone(MIDI.data) : null;

		var quantizedCount = 0;

		for (let i = 0; i < MIDI.data.length; i++) {
			if (!MIDI.data[i] || !instruments[i]) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (!note || note.length < 5 || !note[N_DATA] || !note[N_DATA].partials) continue;

				var isSelected = false;
				for (let k = 0; k < note[N_DATA].partials.length; k++) {
					if (note[N_DATA].partials[k] && note[N_DATA].partials[k][4]) {
						isSelected = true;
						break;
					}
				}

				if (isSelected) {
					var tuningKey = Timeline.getTuningAtTime(note[N_TIME], i);
					var scaleData = scales[tuningKey];

					if (!scaleData || !scaleData.notes || scaleData.notes.length === 0) continue;

					var spectrumData = getSpectrumDataSafe(i);
					var partialRatio = spectrumData[note[N_PARTIAL] - 1] ?
						spectrumData[note[N_PARTIAL] - 1][0] : 1;
					var currentFreq = note2freq_440(note[N_PITCH]) / partialRatio;
					var currentNote440 = freq2note_440(currentFreq);

					var nearestNote = scaleData.notes[0];
					var nearestDist = Math.abs(currentNote440 - nearestNote[0]);

					for (let n = 1; n < scaleData.notes.length; n++) {
						var dist = Math.abs(currentNote440 - scaleData.notes[n][0]);
						if (dist < nearestDist) {
							nearestDist = dist;
							nearestNote = scaleData.notes[n];
						}
					}

					var targetFreq440 = nearestNote[1] * partialRatio;
					var newNote2 = Math.max(pitchEditMin, Math.min(pitchEditMax, freq2note_440(targetFreq440)));
					if (Math.abs(newNote2 - note[N_PITCH]) > 0.001) {
						note[N_PITCH] = newNote2;
						for (let k = 0; k < note[N_DATA].partials.length; k++) {
							if (note[N_DATA].partials[k]) {
								var pRatio = spectrumData[k] ? spectrumData[k][0] : (k + 1);
								note[N_DATA].partials[k][1] = freq2note_440(nearestNote[1] * pRatio);
							}
						}
						quantizedCount++;
					}
				}
			}
		}
		
		if (quantizedCount > 0) {
			if (beforeState && typeof UndoManager !== 'undefined') {
				var afterState = structuredClone(MIDI.data);
				UndoManager.recordSnapshot('Quantize to tuning', ['MIDIdata'], { MIDIdata: beforeState }, { MIDIdata: afterState });
			}

			DB.set('MIDIdata', MIDI.data, { skipUndo: true });
			if (typeof AdaptiveTuning !== 'undefined') {
				AdaptiveTuning.refresh();
			}
			Logger.log(`Quantized ${quantizedCount} note(s) to tuning`);
		}
	},

	keepPlayheadInView: () => {
		var playheadScreenX = 60 + Canvas.offx + playback.time * barSize;
		var visibleWidth = Canvas.cssWidth - 60;
		var visibleRight = Canvas.cssWidth;

		if (playheadScreenX < 60 || playheadScreenX > visibleRight) {
			Canvas.offx = -playback.time * barSize + visibleWidth * 0.5;
			Canvas.barlinesOffx = Canvas.offx % barSize;
		}
	}
};






function getTuningAtTime(time, trackIdx) {
	if (typeof Timeline === 'undefined') {
		return settings.scale || scale;
	}

	if (typeof trackIdx === 'undefined') {
		trackIdx = Timeline.getCurrentTrackIdx();
	}

	// Zhromaždiť zmeny ladenia z aktuálnej stopy a globálne ladenia zo všetkých stôp.
	var allTuningChanges = [];

	var trackEvents = Timeline.getTrackEvents(trackIdx);
	if (trackEvents && trackEvents.tuningChanges) {
		for (const tc of trackEvents.tuningChanges) {
			allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey });
		}
	}

	var DB = typeof window !== 'undefined' && window.DB;
	if (DB) {
		var allTrackEvents = DB.get('trackEvents') || {};
		for (const tIdxStr in allTrackEvents) {
			var tIdx = parseInt(tIdxStr);
			if (tIdx === trackIdx) continue; // Preskočiť aktuálnu stopu (už pridaná).
			var events = allTrackEvents[tIdx];
			if (events && events.tuningChanges) {
				for (const tc of events.tuningChanges) {
					if (tc.global) {
						allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey });
					}
				}
			}
		}
	}

	if (allTuningChanges.length === 0) {
		return settings.scale || scale;
	}

	// Zoradiť podľa času a nájsť aktívne ladenie.
	allTuningChanges.sort((a, b) => a.time - b.time);

	var activeTuning = settings.scale || scale;
	for (let i = allTuningChanges.length - 1; i >= 0; i--) {
		if (allTuningChanges[i].time <= time) {
			activeTuning = allTuningChanges[i].tuningKey;
			break;
		}
	}

	if (!scales[activeTuning]) {
		return settings.scale || scale;
	}

	return activeTuning;
}


function snapTimeToGrid(time, trackIdx, threshold = 0.05) {
	if (typeof GridSystem === 'undefined') {
		// Staré prichytávanie podľa gridSize.
		return Math.round(time * gridSize) / gridSize;
	}
	
	var snapped = GridSystem.snapToGrid(time, trackIdx, threshold);
	return snapped !== null ? snapped : time;
}


// Canvas.snapLines na vizualizáciu režimu magnetu
// zhromažďuje pozície prichytenia pre aktuálny viewport.
function updateSnapLines() {
	if (!Canvas.magnetMode) {
		Canvas.snapLines = [];
		return;
	}
	
	var trackIdx = Timeline.getCurrentTrackIdx();
	var canvasWidth = Canvas.cssWidth - 60;
	var viewportStart = -Canvas.offx / barSize;
	var viewportEnd = viewportStart + canvasWidth / barSize;
	
	var gridLines = GridSystem.getGridLines(trackIdx, viewportStart, viewportEnd);

	var snapPositions = new Set();

	for (const line of gridLines) {
		snapPositions.add(line.time);
	}

	for (let i = 0; i < MIDI.data.length; i++) {
		for (let j = 0; j < MIDI.data[i].length; j++) {
			var note = MIDI.data[i][j];
			if (note && note.length >= 2) {
				snapPositions.add(note[N_TIME]);           // Začiatok
				snapPositions.add(note[N_TIME] + note[N_DUR]); // Koniec
			}
		}
	}
	
	Canvas.snapLines = Array.from(snapPositions).sort((a, b) => a - b);
}



// Najširšia medzera v pixeloch medzi susednými notami (zoradenými vzostupne).
function widestNoteStepY(notes, freqToY) {
	var maxGap = 0;
	for (var i = 1; i < notes.length; i++) {
		var g = Math.abs(freqToY(notes[i - 1][1]) - freqToY(notes[i][1]));
		if (g > maxGap) maxGap = g;
	}
	return maxGap;
}

// Inicializácia ovládacích prvkov rýchlosti prehrávania.
function initPlaybackSpeedControls() {
	var speedInput = sel('.playback-speed-input');
	var presetButtons = sel('.playback-speed-preset', true);
	
	if (speedInput) {
		speedInput.value = settings.playbackSpeed || 1;

		speedInput.addEventListener('change', (e) => {
			var speed = parseFloat(e.target.value);
			if (isNaN(speed) || speed <= 0) speed = 1;

			settings.playbackSpeed = speed;
			DB.set('settings', settings);

			updateSpeedPresetButtons(speed);
		});
	}
	
	if (presetButtons) {
		presetButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				var speed = parseFloat(btn.dataset.speed);
				if (!isNaN(speed)) {
					settings.playbackSpeed = speed;
					DB.set('settings', settings);
					
					if (speedInput) speedInput.value = speed;
					updateSpeedPresetButtons(speed);
				}
			});
		});
	}
}

function updateSpeedPresetButtons(currentSpeed) {
	var presetButtons = sel('.playback-speed-preset', true);
	if (presetButtons) {
		presetButtons.forEach(btn => {
			var speed = parseFloat(btn.dataset.speed);
			if (speed === currentSpeed) {
				btn.classList.add('active');
			} else {
				btn.classList.remove('active');
			}
		});
	}
}


// Aktualizovať veľkosť plátna tak, aby zohľadňovala časovú os.
function updateCanvasSizeWithTimeline() {
	// Pôvodná logika zmeny veľkosti plátna s podporou high-DPI.
	var center = sel('.center');
	if (center && Canvas.canvas) {
		var timelineHeight = (typeof Timeline !== 'undefined' ? Timeline.height : 0) || 40;
		ctx = Canvas.setupHighDPICanvas(Canvas.canvas, center.offsetWidth, center.offsetHeight - timelineHeight);
		// Inicializovať statickú vrstvu na cachovanie (s identickou veľkosťou ako hlavné plátno).
		initStaticLayer(center.offsetWidth, center.offsetHeight - timelineHeight, Canvas.dpr);
	}

	if (typeof Timeline !== 'undefined') {
		Timeline.resize();
	}
}


function drawTimeline() {
	if (typeof Timeline !== 'undefined') {
		Timeline.draw();
	}
}


function initTimeline() {
	if (typeof Timeline !== 'undefined') {
		Timeline.init();
	}

	if (typeof GridSystem !== 'undefined') {
		GridSystem.init();
	}
}


function onTrackSwitch(newTrackIdx) {
	if (typeof Timeline !== 'undefined') {
		Timeline.draw();
	}

	if (typeof GridSystem !== 'undefined') {
		GridSystem.refreshCache();
	}
}


function onTrackDelete(deletedTrackIdx) {
	if (typeof Timeline !== 'undefined') {
		Timeline.handleTrackDelete(deletedTrackIdx);
	}
}


function onTrackAdd(newTrackIdx) {
	if (typeof Timeline !== 'undefined') {
		Timeline.handleTrackAdd(newTrackIdx);
	}
}

// Pomocná funkcia na nájdenie novej pozície noty, ktorá zachová frekvenciu uzamknutého parciálu
// vráti { newNote2, newNote3 } alebo null, ak sa nenašla pozícia.
function findLockedConstrainedPosition(trackIdx, noteIdx, targetDirection, movedPartialIdx) {
	var note = MIDI.data[trackIdx][noteIdx];
	var partials = note[N_DATA].partials;
	var specData = getSpectrumDataSafe(trackIdx);

	var lockedIdx = -1;
	for (let i = 0; i < partials.length; i++) {
		if (partials[i][6]) {
			lockedIdx = i;
			break;
		}
	}

	if (lockedIdx === -1) return null; // Žiadny uzamknutý parciál.

	var lockedRatio = specData[lockedIdx] ? specData[lockedIdx][0] : (lockedIdx + 1);
	var movedRatio = specData[movedPartialIdx] ? specData[movedPartialIdx][0] : (movedPartialIdx + 1);

	// Vypočítať aktuálny interval v centoch medzi uzamknutým a presúvaným parciálom.
	var currentIntervalCents = 1200 * Math.log2(movedRatio / lockedRatio);

	// zostaviť zoznam všetkých možných intervalov z daného spektra
	// každý interval je: { cents, lockedPartialNum, movedPartialNum, lockedRatio, movedRatio }
	var intervals = [];

	for (let i = 0; i < specData.length; i++) {
		for (let j = 0; j < specData.length; j++) {
			if (i === j) continue;
			var r1 = specData[i][0];
			var r2 = specData[j][0];
			var cents = 1200 * Math.log2(r2 / r1);
			intervals.push({
				cents: cents,
				lockedPartialNum: i + 1,
				movedPartialNum: j + 1,
				lockedRatio: r1,
				movedRatio: r2
			});
		}
	}

	intervals.sort((a, b) => a.cents - b.cents);

	// Nájsť pozíciu aktuálneho intervalu, pričom sa páruje podľa čísel parciálov namiesto centov.
	var currentIdx = -1;
	for (let i = 0; i < intervals.length; i++) {
		if (intervals[i].lockedPartialNum === lockedIdx + 1 &&
			intervals[i].movedPartialNum === movedPartialIdx + 1) {
			currentIdx = i;
			break;
		}
	}

	if (currentIdx === -1) {
		// Presná kombinácia parciálov sa nenašla, hľadá sa teda podľa najbližších centov.
		var minDiff = Infinity;
		for (let i = 0; i < intervals.length; i++) {
			var diff = Math.abs(intervals[i].cents - currentIntervalCents);
			if (diff < minDiff) {
				minDiff = diff;
				currentIdx = i;
			}
		}
	}

	// Nájsť nasledujúci alebo predchádzajúci záznam v zoradenom zozname namiesto hodnoty centov.
	var nextIdx;
	if (targetDirection > 0) {
		// Posun nahor znamená nasledujúci záznam, teda väčší interval.
		nextIdx = currentIdx + 1;
	} else {
		// Posun nadol znamená predchádzajúci záznam, teda menší interval.
		nextIdx = currentIdx - 1;
	}

	if (nextIdx < 0 || nextIdx >= intervals.length) {
		return null; // Nenašiel sa žiadny platný interval.
	}

	var nextInterval = intervals[nextIdx];

	// Vypočítať aktuálnu absolútnu frekvenciu uzamknutého parciálu.
	var currentPartialRatio = specData[note[N_PARTIAL] - 1] ? specData[note[N_PARTIAL] - 1][0] : note[N_PARTIAL];
	var fundamentalFreq = note2freq(note[N_PITCH]) / currentPartialRatio;
	var lockedFreq = fundamentalFreq * lockedRatio;

	// Vypočítať nový základný tón, ktorý umiestni nový uzamknutý parciál na rovnakú frekvenciu.
	var newFundamental = lockedFreq / nextInterval.lockedRatio;

	var newNote2 = freq2note(newFundamental * currentPartialRatio);
	
	return {
		newNote2: newNote2,
		newNote3: note[N_PARTIAL],
		newLockedPartialIdx: nextInterval.lockedPartialNum - 1,
		newMovedPartialIdx: nextInterval.movedPartialNum - 1
	};
}
