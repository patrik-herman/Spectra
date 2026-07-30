// sel pochádza z util.js (načítava sa skôr).

var Timeline = {
	canvas: null,
	ctx: null,
	height: 50,

	lanes: {
		// Výšky pruhov sú predvolene 0, čiže skryté
		// cez Timeline.enableEventLanes().
		loop: { y: 0, height: 0 },
		markers: { y: 0, height: 0 },
		tuning: { y: 0, height: 0 },
		grid: { y: 0, height: 0 }
	},

	enableEventLanes: function() {
		Timeline.lanes.loop = { y: 0, height: 10 };
		Timeline.lanes.markers = { y: 10, height: 13 };
		Timeline.lanes.tuning = { y: 23, height: 13 };
		Timeline.lanes.grid = { y: 36, height: 14 };
	},

	eventsBound: false,
	boundClickHandler: null,

	// Cachované dáta popiskov pre draw(), aby sa predišlo vyhľadávaniu v DB pri každom snímku.
	_cachedScales: null,
	_cachedGrids: null,

	// Obnovenie cachovaných dát popiskov, spúšťa sa pri zmene scales/grids.
	refreshLabelCache: () => {
		Timeline._cachedScales = null;
		Timeline._cachedGrids = null;
	},

	// Polomer detekcie kliknutia na udalosti časovej osi v pixeloch.
	HIT_RADIUS: 8,

	interaction: {
		dragging: null,
		hovered: null,
		dragStartX: 0,
		dragStartTime: 0,
		excludeGridIndex: null,
		cachedSnapLines: null,
		loopDragging: null,
		loopHovered: null,
		loopDragStartTime: 0,
		loopDragStartEnd: 0,
		loopDragOffsetTime: 0
	},

	infoPane: {
		visible: false,
		lane: null,
		index: null,
		eventRef: null,
		isNew: false,
		x: 0,
		y: 0
	},

	init: () => {
		if (Timeline.canvas) return;
		Timeline.createCanvas();
		Timeline.bindEvents();
		Timeline.draw();
	},

	createCanvas: () => {
		var center = sel('.center');
		if (!center) return;

		var existing = document.getElementById('timelineCanvas');
		if (existing) {
			Timeline.canvas = existing;
			Timeline.cssWidth = center.offsetWidth;
			Timeline.cssHeight = Timeline.height;
			Timeline.ctx = Timeline.setupHighDPI(existing, Timeline.cssWidth, Timeline.cssHeight);
			return;
		}

		Timeline.canvas = document.createElement('canvas');
		Timeline.canvas.id = 'timelineCanvas';
		Timeline.canvas.className = 'timeline-canvas';
		Timeline.canvas.tabIndex = -1;
		Timeline.cssWidth = center.offsetWidth;
		Timeline.cssHeight = Timeline.height;

		var mainCanvas = sel('#canvasElement');
		if (mainCanvas) {
			center.insertBefore(Timeline.canvas, mainCanvas);
		} else {
			center.appendChild(Timeline.canvas);
		}

		Timeline.ctx = Timeline.setupHighDPI(Timeline.canvas, Timeline.cssWidth, Timeline.cssHeight);
	},

	setupHighDPI: (canvas, width, height) => {
		var dpr = window.devicePixelRatio || 1;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		var ctx = canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		return ctx;
	},

	resize: () => {
		if (!Timeline.canvas) return;

		var center = sel('.center');
		if (center) {
			Timeline.cssWidth = center.offsetWidth;
			Timeline.cssHeight = Timeline.height;
			Timeline.ctx = Timeline.setupHighDPI(Timeline.canvas, Timeline.cssWidth, Timeline.cssHeight);
		}

		Timeline.draw();
	},

	bindEvents: () => {
		if (!Timeline.canvas) return;
		if (Timeline.eventsBound) return;
		Timeline.eventsBound = true;

		Timeline.canvas.addEventListener('mousedown', Timeline.onMouseDown);
		Timeline.canvas.addEventListener('mousemove', Timeline.onMouseMove);
		Timeline.canvas.addEventListener('mouseup', Timeline.onMouseUp);
		Timeline.canvas.addEventListener('mouseleave', Timeline.onMouseLeave);
		Timeline.canvas.addEventListener('dblclick', Timeline.onDoubleClick);

		document.addEventListener('mousemove', Timeline.onDocumentMouseMove);
		document.addEventListener('mouseup', Timeline.onDocumentMouseUp);

		Timeline.boundClickHandler = (e) => {
			if (Timeline.infoPane.visible) {
				var pane = sel('.timeline-info-pane');
				if (pane && !pane.contains(e.target) && e.target !== Timeline.canvas) {
					Timeline.closeInfoPane();
				}
			}
		};
		document.addEventListener('click', Timeline.boundClickHandler);

		// Drag & drop MIDI a audio súborov.
		Timeline.canvas.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			Timeline.canvas.style.outline = '1px solid rgba(255,255,255,0.2)';
		});
		Timeline.canvas.addEventListener('dragleave', (e) => {
			Timeline.canvas.style.outline = '';
		});
		Timeline.canvas.addEventListener('drop', (e) => {
			e.preventDefault();
			Timeline.canvas.style.outline = '';
			var file = e.dataTransfer.files[0];
			if (!file) return;
			var name = file.name.toLowerCase();

			if (name.endsWith('.mid') || name.endsWith('.midi')) {
				var reader = new FileReader();
				reader.onload = (evt) => {
					try {
						var parsedMIDI = window.parseMIDIFile(evt.target.result);
						var nonEmptyTracks = parsedMIDI.tracks.filter(t => t && t.length > 0);
						if (nonEmptyTracks.length === 0) {
							if (typeof window.showStatus === 'function') window.showStatus('MIDI file contains no notes', { type: 'error' });
							return;
						}

						var MIDI = window.MIDI;
						var DB = window.DB;
						var instruments = window.instruments;

						// Pripojenie nových stôp, existujúce zostanú zachované.
						for (let i = 0; i < nonEmptyTracks.length; i++) {
							window.UI.instruments.add();
							MIDI.data[MIDI.data.length - 1] = [...nonEmptyTracks[i]];
						}

						DB.set('MIDIdata', MIDI.data);

						if (window.UI && window.UI.instruments) window.UI.instruments.refresh();
						Timeline.draw();
						if (window.Canvas) window.Canvas.step();
						if (typeof window.showStatus === 'function') window.showStatus(`Added ${nonEmptyTracks.length} track${nonEmptyTracks.length > 1 ? 's' : ''} from MIDI file`);
					} catch (err) {
						Logger.error('Error importing MIDI:', err);
						if (typeof window.showStatus === 'function') window.showStatus('Error importing MIDI: ' + err.message, { type: 'error' });
					}
				};
				reader.readAsArrayBuffer(file);
			} else if (name.endsWith('.wav') || name.endsWith('.mp3') || name.endsWith('.ogg') || name.endsWith('.flac') || name.endsWith('.aif') || name.endsWith('.aiff')) {
				// Pretiahnutie audio súboru, ktorého spracovanie preberá AudioDropAnalyzer.
				if (typeof AudioDropAnalyzer !== 'undefined' && AudioDropAnalyzer.openAnalysisDialog) {
					AudioDropAnalyzer.openAnalysisDialog(file);
				} else {
					if (typeof window.showStatus === 'function') window.showStatus('Audio analyzer not loaded', { type: 'error' });
				}
			}
		});
	},

	unbindEvents: () => {
		if (!Timeline.eventsBound) return;
		Timeline.eventsBound = false;

		if (Timeline.canvas) {
			Timeline.canvas.removeEventListener('mousedown', Timeline.onMouseDown);
			Timeline.canvas.removeEventListener('mousemove', Timeline.onMouseMove);
			Timeline.canvas.removeEventListener('mouseup', Timeline.onMouseUp);
			Timeline.canvas.removeEventListener('mouseleave', Timeline.onMouseLeave);
			Timeline.canvas.removeEventListener('dblclick', Timeline.onDoubleClick);
		}

		document.removeEventListener('mousemove', Timeline.onDocumentMouseMove);
		document.removeEventListener('mouseup', Timeline.onDocumentMouseUp);

		if (Timeline.boundClickHandler) {
			document.removeEventListener('click', Timeline.boundClickHandler);
			Timeline.boundClickHandler = null;
		}
	},

	getCurrentTrackIdx: () => {
		var primaryTrackIndex = window.primaryTrackIndex;
		if (primaryTrackIndex !== undefined && primaryTrackIndex >= 0) {
			return primaryTrackIndex;
		}
		var instruments = window.instruments;
		if (!instruments) return 0;
		for (let i = 0; i < instruments.length; i++) {
			if (instruments[i].selected) return i;
		}
		return 0;
	},

	getTrackEvents: (trackIdx) => {
		if (typeof trackIdx === 'undefined') {
			trackIdx = Timeline.getCurrentTrackIdx();
		}

		var DB = window.DB;
		var settings = window.settings;
		var GridSystem = window.GridSystem;
		var trackEvents = DB?.get('trackEvents') || {};

		if (!trackEvents[trackIdx]) {
			// Nikdy nevytvárať a neukladať udalosti pre stopu, ktorá neexistuje.
			var instrumentsList = window.instruments;
			if (!instrumentsList || trackIdx >= instrumentsList.length) {
				return { markers: [], tuningChanges: [], gridChanges: [] };
			}

			var defaultGridKey = settings?.grid || 'seconds';
			if (GridSystem) {
				var grid = GridSystem.get(defaultGridKey);
				if (grid && grid.type === 'off' && defaultGridKey !== 'off') {
					defaultGridKey = 'seconds';
				}
			}

			trackEvents[trackIdx] = {
				markers: [],
				tuningChanges: [
					{ time: 0, tuningKey: settings?.scale || 'free' }
				],
				gridChanges: [
					{ time: 0, gridKey: defaultGridKey }
				]
			};
			if (DB) DB.set('trackEvents', trackEvents);

		}

		return trackEvents[trackIdx];
	},

	saveTrackEvents: (trackIdx, events, options) => {
		options = options || {};
		var DB = window.DB;
		var trackEvents = DB?.get('trackEvents') || {};
		trackEvents[trackIdx] = events;
		if (DB) DB.set('trackEvents', trackEvents, { skipUndo: true });

		Timeline.refreshLabelCache();

		var GridSystem = window.GridSystem;
		if (GridSystem) GridSystem.refreshCache();

	},

	captureTrackEventsState: () => {
		var DB = window.DB;
		return structuredClone(DB?.get('trackEvents') || {});
	},

	recordTrackEventsUndo: (description, beforeState) => {
		var UndoManager = window.UndoManager;
		if (!UndoManager) return;
		var afterState = Timeline.captureTrackEventsState();

		if (JSON.stringify(beforeState) === JSON.stringify(afterState)) {
			return;
		}

		UndoManager.recordSnapshot(
			description,
			['trackEvents'],
			{ trackEvents: beforeState },
			{ trackEvents: afterState }
		);
	},

	getTuningAtTime: (time, trackIdx) => {
		var allTuningChanges = [];

		var events = Timeline.getTrackEvents(trackIdx);
		for (const tc of events.tuningChanges) {
			allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey, isPerTrack: true });
		}

		var DB = window.DB;
		if (DB) {
			var allTrackEvents = DB.get('trackEvents') || {};
			for (const tIdxStr in allTrackEvents) {
				var tIdx = parseInt(tIdxStr);
				if (tIdx === trackIdx) continue;
				var trackEvt = allTrackEvents[tIdx];
				if (trackEvt && trackEvt.tuningChanges) {
					for (const tc of trackEvt.tuningChanges) {
						if (tc.global) {
							allTuningChanges.push({ time: tc.time, tuningKey: tc.tuningKey, isPerTrack: false });
						}
					}
				}
			}
		}

		allTuningChanges.sort((a, b) => a.time - b.time || (a.isPerTrack ? 1 : 0) - (b.isPerTrack ? 1 : 0));
		var settings = window.settings;
		var activeTuning = settings?.scale || 'free';
		for (const change of allTuningChanges) {
			if (change.time <= time) {
				activeTuning = change.tuningKey;
			} else {
				break;
			}
		}

		return activeTuning;
	},

	getGridAtTime: (time, trackIdx) => {
		var allGridChanges = [];

		var events = Timeline.getTrackEvents(trackIdx);
		for (const gc of events.gridChanges) {
			allGridChanges.push({ time: gc.time, gridKey: gc.gridKey, isPerTrack: true });
		}

		var DB = window.DB;
		if (DB) {
			var allTrackEvents = DB.get('trackEvents') || {};
			for (const tIdxStr in allTrackEvents) {
				var tIdx = parseInt(tIdxStr);
				if (tIdx === trackIdx) continue;
				var trackEvt = allTrackEvents[tIdx];
				if (trackEvt && trackEvt.gridChanges) {
					for (const gc of trackEvt.gridChanges) {
						if (gc.global) {
							allGridChanges.push({ time: gc.time, gridKey: gc.gridKey, isPerTrack: false });
						}
					}
				}
			}
		}

		allGridChanges.sort((a, b) => a.time - b.time || (a.isPerTrack ? 1 : 0) - (b.isPerTrack ? 1 : 0));
		var settings = window.settings;
		var activeGrid = settings?.grid || 'off';
		for (const change of allGridChanges) {
			if (change.time <= time) {
				activeGrid = change.gridKey;
			} else {
				break;
			}
		}

		return activeGrid;
	},

	getAllMarkers: () => {
		var allMarkers = [];
		var DB = window.DB;
		var trackEvents = DB?.get('trackEvents') || {};

		for (const trackIdxStr in trackEvents) {
			const trackIdx = parseInt(trackIdxStr);
			var events = trackEvents[trackIdx];
			if (events && events.markers) {
				events.markers.forEach((marker, index) => {
					allMarkers.push({
						time: marker.time,
						name: marker.name,
						trackIdx: trackIdx,
						index: index
					});
				});
			}
		}

		allMarkers.sort((a, b) => a.time - b.time);
		return allMarkers;
	},

	getAllTuningChanges: (currentTrackIdx) => {
		var allTunings = [];
		var DB = window.DB;
		var trackEvents = DB?.get('trackEvents') || {};

		for (const trackIdxStr in trackEvents) {
			const trackIdx = parseInt(trackIdxStr);
			var events = trackEvents[trackIdx];
			if (events && events.tuningChanges) {
				events.tuningChanges.forEach((tuning, index) => {
					var isCurrentTrack = trackIdx === currentTrackIdx;
					allTunings.push({
						time: tuning.time,
						tuningKey: tuning.tuningKey,
						global: tuning.global || false,
						trackIdx: trackIdx,
						index: index,
						isCurrentTrack: isCurrentTrack
					});
				});
			}
		}

		allTunings.sort((a, b) => a.time - b.time);
		return allTunings;
	},

	getAllGridChanges: (currentTrackIdx) => {
		var allGrids = [];
		var DB = window.DB;
		var trackEvents = DB?.get('trackEvents') || {};

		for (const trackIdxStr in trackEvents) {
			const trackIdx = parseInt(trackIdxStr);
			var events = trackEvents[trackIdx];
			if (events && events.gridChanges) {
				events.gridChanges.forEach((grid, index) => {
					var isCurrentTrack = trackIdx === currentTrackIdx;
					allGrids.push({
						time: grid.time,
						gridKey: grid.gridKey,
						global: grid.global || false,
						trackIdx: trackIdx,
						index: index,
						isCurrentTrack: isCurrentTrack
					});
				});
			}
		}

		allGrids.sort((a, b) => a.time - b.time);
		return allGrids;
	},

	xToTime: (x) => {
		var Canvas = window.Canvas;
		var barSize = window.barSize;
		return (x - 60.5 - (Canvas?.offx || 0)) / (barSize || 100);
	},

	timeToX: (time) => {
		var Canvas = window.Canvas;
		var barSize = window.barSize;
		return 60.5 + (Canvas?.offx || 0) + time * (barSize || 100);
	},

	getLaneAtY: (y) => {
		var lanes = Timeline.lanes;
		if (lanes.loop.height > 0 && y < lanes.loop.y + lanes.loop.height) return 'loop';
		if (lanes.markers.height > 0 && y < lanes.markers.y + lanes.markers.height) return 'markers';
		if (lanes.tuning.height > 0 && y < lanes.tuning.y + lanes.tuning.height) return 'tuning';
		if (lanes.grid.height > 0) return 'grid';
		return null;
	},

	findEventAt: (x, y) => {
		var lane = Timeline.getLaneAtY(y);
		var time = Timeline.xToTime(x);
		var trackIdx = Timeline.getCurrentTrackIdx();

		var barSize = window.barSize || 100;
		var hitTime = Timeline.HIT_RADIUS / barSize;

		if (lane === 'markers') {
			var allMarkers = Timeline.getAllMarkers();
			for (const marker of allMarkers) {
				if (Math.abs(marker.time - time) < hitTime) {
					return { lane, index: marker.index, trackIdx: marker.trackIdx, event: marker };
				}
			}
			return null;
		}

		if (lane === 'tuning') {
			var allTunings = Timeline.getAllTuningChanges(trackIdx);
			for (const tuning of allTunings) {
				if (Math.abs(tuning.time - time) < hitTime && tuning.trackIdx === trackIdx) {
					return { lane, index: tuning.index, trackIdx: tuning.trackIdx, event: tuning };
				}
			}
			for (const tuning of allTunings) {
				if (Math.abs(tuning.time - time) < hitTime) {
					return { lane, index: tuning.index, trackIdx: tuning.trackIdx, event: tuning };
				}
			}
			return null;
		}

		if (lane === 'grid') {
			var allGrids = Timeline.getAllGridChanges(trackIdx);
			for (const grid of allGrids) {
				if (Math.abs(grid.time - time) < hitTime && grid.trackIdx === trackIdx) {
					return { lane, index: grid.index, trackIdx: grid.trackIdx, event: grid };
				}
			}
			for (const grid of allGrids) {
				if (Math.abs(grid.time - time) < hitTime) {
					return { lane, index: grid.index, trackIdx: grid.trackIdx, event: grid };
				}
			}
			return null;
		}

		return null;
	},

	findLoopHitAt: (x, y) => {
		if (Timeline.lanes.loop.height === 0) return null;
		if (y >= Timeline.lanes.markers.y) return null;

		var playback = window.playback;
		if (!playback || playback.loopStart === null || playback.loopEnd === null) {
			return null;
		}

		var loopStartX = Timeline.timeToX(playback.loopStart);
		var loopEndX = Timeline.timeToX(playback.loopEnd);
		var edgeHitRadius = 6;

		if (Math.abs(x - loopStartX) <= edgeHitRadius) return 'start';
		if (Math.abs(x - loopEndX) <= edgeHitRadius) return 'end';
		if (x > loopStartX + edgeHitRadius && x < loopEndX - edgeHitRadius) {
			return 'move';
		}

		return null;
	},

	onMouseDown: (e) => {
		var rect = Timeline.canvas.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var y = e.clientY - rect.top;

		Timeline.closeInfoPane();

		var loopHit = Timeline.findLoopHitAt(x, y);
		if (loopHit) {
			var playback = window.playback;
			Timeline.interaction.loopDragging = loopHit;
			Timeline.interaction.loopDragStartTime = playback?.loopStart || 0;
			Timeline.interaction.loopDragStartEnd = playback?.loopEnd || 0;
			Timeline.interaction.loopBeforeDragStart = playback?.loopStart;
			Timeline.interaction.loopBeforeDragEnd = playback?.loopEnd;
			var clickTime = Timeline.xToTime(x);
			Timeline.interaction.loopDragOffsetTime = clickTime - (playback?.loopStart || 0);

			if (loopHit === 'start' || loopHit === 'end') {
				Timeline.canvas.style.cursor = 'ew-resize';
			} else {
				Timeline.canvas.style.cursor = 'grabbing';
			}
			return;
		}

		var hit = Timeline.findEventAt(x, y);

		if (hit) {
			Timeline.interaction.dragging = { lane: hit.lane, index: hit.index, trackIdx: hit.trackIdx };
			Timeline.interaction.dragStartX = x;
			Timeline.interaction.dragStartTime = hit.event.time;
			Timeline.interaction.beforeDragState = Timeline.captureTrackEventsState();
			Timeline.canvas.style.cursor = 'grabbing';

			var GridSystem = window.GridSystem;
			if (hit.lane === 'grid' && GridSystem) {
				Timeline.interaction.excludeGridIndex = hit.index;

				var trackIdx = Timeline.getCurrentTrackIdx();
				var events = Timeline.getTrackEvents(trackIdx);
				var draggedChange = events.gridChanges[hit.index];

				var otherGrids = events.gridChanges
					.filter(c => c !== draggedChange)
					.sort((a, b) => a.time - b.time);

				var cachedLines = [];
				for (let i = 0; i < otherGrids.length; i++) {
					var change = otherGrids[i];
					var nextChange = otherGrids[i + 1];
					var grid = GridSystem.get(change.gridKey);
					if (!grid || grid.type === 'off') continue;

					var segmentStart = change.time;
					var segmentEnd = nextChange ? nextChange.time : 10000;
					var lines = GridSystem.computeGridLines(grid, segmentStart, Math.max(0, segmentStart - 1), segmentEnd);
					cachedLines.push(...lines);
				}
				Timeline.interaction.cachedSnapLines = cachedLines;
			} else {
				Timeline.interaction.excludeGridIndex = null;
				Timeline.interaction.cachedSnapLines = null;
			}
		}
	},

	onMouseMove: (e) => {
		var rect = Timeline.canvas.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var y = e.clientY - rect.top;

		if (Timeline.interaction.dragging || Timeline.interaction.loopDragging) {
			return;
		} else {
			var loopHit = Timeline.findLoopHitAt(x, y);
			if (loopHit) {
				Timeline.interaction.loopHovered = loopHit;
				Timeline.interaction.hovered = null;
				if (loopHit === 'start' || loopHit === 'end') {
					Timeline.canvas.style.cursor = 'ew-resize';
				} else {
					Timeline.canvas.style.cursor = 'grab';
				}
				Timeline.draw();
				return;
			}
			Timeline.interaction.loopHovered = null;

			var hit = Timeline.findEventAt(x, y);

			if (hit) {
				Timeline.interaction.hovered = { lane: hit.lane, index: hit.index, trackIdx: hit.trackIdx };
				Timeline.canvas.style.cursor = 'pointer';
			} else {
				Timeline.interaction.hovered = null;
				Timeline.canvas.style.cursor = 'default';
			}

			Timeline.draw();
		}
	},

	onMouseUp: (e) => {
		if (Timeline.interaction.loopDragging) {
			Timeline.onDocumentMouseUp(e);
			return;
		}

		if (Timeline.interaction.dragging) {
			var rect = Timeline.canvas.getBoundingClientRect();
			var x = e.clientX - rect.left;
			var dist = Math.abs(x - Timeline.interaction.dragStartX);

			if (dist < 3) {
				var { lane, index, trackIdx } = Timeline.interaction.dragging;
				Timeline.openInfoPane(lane, index, false, x, e.clientY, trackIdx);
			}

			Timeline.onDocumentMouseUp(e);
			return;
		}

		Timeline.canvas.style.cursor = 'default';
	},

	onMouseLeave: () => {
		Timeline.interaction.hovered = null;
		Timeline.interaction.loopHovered = null;
		if (!Timeline.interaction.dragging && !Timeline.interaction.loopDragging) {
			Timeline.draw();
		}
	},

	onDocumentMouseMove: (e) => {
		if (!Timeline.canvas) return;

		if (Timeline.interaction.loopDragging) {
			const rect = Timeline.canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			var currentTime = Timeline.xToTime(x);
			const trackIdx = Timeline.getCurrentTrackIdx();
			var playback = window.playback;
			const GridSystem = window.GridSystem;

			var newStart = playback?.loopStart || 0;
			var newEnd = playback?.loopEnd || 0;

			if (Timeline.interaction.loopDragging === 'start') {
				newStart = currentTime;
				if (e.shiftKey && GridSystem) {
					const snapped = GridSystem.snapToGrid(newStart, trackIdx, 0.5);
					if (snapped !== null) newStart = snapped;
				}
				newStart = Math.max(0, Math.min(newStart, (playback?.loopEnd || 0) - 0.01));
			} else if (Timeline.interaction.loopDragging === 'end') {
				newEnd = currentTime;
				if (e.shiftKey && GridSystem) {
					const snapped = GridSystem.snapToGrid(newEnd, trackIdx, 0.5);
					if (snapped !== null) newEnd = snapped;
				}
				newEnd = Math.max((playback?.loopStart || 0) + 0.01, newEnd);
			} else if (Timeline.interaction.loopDragging === 'move') {
				var duration = Timeline.interaction.loopDragStartEnd - Timeline.interaction.loopDragStartTime;
				newStart = currentTime - Timeline.interaction.loopDragOffsetTime;
				if (e.shiftKey && GridSystem) {
					const snapped = GridSystem.snapToGrid(newStart, trackIdx, 0.5);
					if (snapped !== null) newStart = snapped;
				}
				newStart = Math.max(0, newStart);
				newEnd = newStart + duration;
			}

			if (playback) {
				playback.loopStart = newStart;
				playback.loopEnd = newEnd;
			}
			Timeline.draw();
			return;
		}

		if (!Timeline.interaction.dragging) return;

		const rect = Timeline.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		var barSize = window.barSize || 100;
		const GridSystem = window.GridSystem;

		var { lane, index, trackIdx: dragTrackIdx } = Timeline.interaction.dragging;
		const trackIdx = dragTrackIdx !== undefined ? dragTrackIdx : Timeline.getCurrentTrackIdx();
		var events = Timeline.getTrackEvents(trackIdx);

		var items;
		switch (lane) {
			case 'markers': items = events.markers; break;
			case 'tuning': items = events.tuningChanges; break;
			case 'grid': items = events.gridChanges; break;
		}

		if (items && items[index]) {
			var dragDelta = (x - Timeline.interaction.dragStartX) / barSize;
			var newTime = Timeline.interaction.dragStartTime + dragDelta;

			if (e.shiftKey && GridSystem) {
				if (lane === 'grid' && Timeline.interaction.cachedSnapLines) {
					var nearestSnap = null;
					var nearestDist = 0.2;

					for (const line of Timeline.interaction.cachedSnapLines) {
						var dist = Math.abs(line.time - newTime);
						if (dist < nearestDist) {
							nearestDist = dist;
							nearestSnap = line.time;
						}
					}

					if (nearestSnap !== null) {
						newTime = nearestSnap;
					}
				} else {
					const snapped = GridSystem.snapToGrid(newTime, trackIdx, 0.2);
					if (snapped !== null) {
						newTime = snapped;
					}
				}
			}

			newTime = Math.max(0, newTime);

			items[index].time = newTime;
			Timeline.saveTrackEvents(trackIdx, events);
			Timeline.draw();
		}
	},

	onDocumentMouseUp: (e) => {
		if (Timeline.interaction.loopDragging) {
			var playback = window.playback;
			var beforeStart = Timeline.interaction.loopBeforeDragStart;
			var beforeEnd = Timeline.interaction.loopBeforeDragEnd;
			var changed = playback && (playback.loopStart !== beforeStart || playback.loopEnd !== beforeEnd);

			if (changed) {
				var DB = window.DB;
				if (DB) {
					DB.set('loopStart', playback.loopStart);
					DB.set('loopEnd', playback.loopEnd);
				}
				var UndoManager = window.UndoManager;
				if (UndoManager) {
					UndoManager.recordSnapshot('Move loop region', ['loopStart', 'loopEnd'],
						{ loopStart: beforeStart, loopEnd: beforeEnd },
						{ loopStart: playback.loopStart, loopEnd: playback.loopEnd }
					);
				}
			}

			Timeline.interaction.loopDragging = null;
			Timeline.interaction.loopDragStartTime = 0;
			Timeline.interaction.loopDragStartEnd = 0;
			Timeline.interaction.loopDragOffsetTime = 0;
			Timeline.interaction.loopBeforeDragStart = null;
			Timeline.interaction.loopBeforeDragEnd = null;
			if (Timeline.canvas) {
				Timeline.canvas.style.cursor = 'default';
			}
			Timeline.draw();
			return;
		}

		if (!Timeline.interaction.dragging) return;

		var { lane, index, trackIdx: dragTrackIdx } = Timeline.interaction.dragging;
		var beforeState = Timeline.interaction.beforeDragState;
		var dragStartTime = Timeline.interaction.dragStartTime;

		var trackIdx = dragTrackIdx !== undefined ? dragTrackIdx : Timeline.getCurrentTrackIdx();
		var events = Timeline.getTrackEvents(trackIdx);

		var items;
		switch (lane) {
			case 'markers': items = events.markers; break;
			case 'tuning': items = events.tuningChanges; break;
			case 'grid': items = events.gridChanges; break;
		}

		var currentTime = items && items[index] ? items[index].time : null;
		var actuallyMoved = currentTime !== null && currentTime !== dragStartTime;

		if (actuallyMoved) {
			Timeline.saveTrackEvents(trackIdx, events);
			if (beforeState) {
				var laneNames = { markers: 'marker', tuning: 'tuning change', grid: 'grid change' };
				Timeline.recordTrackEventsUndo('Move ' + (laneNames[lane] || 'event'), beforeState);
			}
		}

		Timeline.interaction.dragging = null;
		Timeline.interaction.excludeGridIndex = null;
		Timeline.interaction.cachedSnapLines = null;
		Timeline.interaction.beforeDragState = null;
		Timeline.interaction.dragStartTime = null;
		if (Timeline.canvas) {
			Timeline.canvas.style.cursor = 'default';
		}
		Timeline.draw();
	},

	onDoubleClick: (e) => {
		var rect = Timeline.canvas.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var y = e.clientY - rect.top;

		if (x < 60) return;

		var lane = Timeline.getLaneAtY(y);
		if (!lane) return;
		var time = Math.max(0, Timeline.xToTime(x));
		var trackIdx = Timeline.getCurrentTrackIdx();
		var settings = window.settings;

		var beforeState = Timeline.captureTrackEventsState();

		var events = Timeline.getTrackEvents(trackIdx);

		var newIndex;

		switch (lane) {
			case 'markers':
				newIndex = events.markers.length;
				events.markers.push({ time, name: 'Marker' });
				break;
			case 'tuning':
				newIndex = events.tuningChanges.length;
				events.tuningChanges.push({ time, tuningKey: settings?.scale || 'edo12' });
				break;
			case 'grid':
				newIndex = events.gridChanges.length;
				events.gridChanges.push({ time, gridKey: settings?.grid || 'off' });
				break;
		}

		Timeline.saveTrackEvents(trackIdx, events);
		Timeline.draw();

		var laneNames = { markers: 'marker', tuning: 'tuning change', grid: 'grid change' };
		Timeline.recordTrackEventsUndo('Add ' + (laneNames[lane] || 'event'), beforeState);

		Timeline.openInfoPane(lane, newIndex, true, x, e.clientY);
	},

	openInfoPane: (lane, index, isNew, x, y, eventTrackIdx) => {
		Timeline.closeInfoPane();

		var trackIdx = eventTrackIdx !== undefined ? eventTrackIdx : Timeline.getCurrentTrackIdx();
		var events = Timeline.getTrackEvents(trackIdx);

		var items;
		switch (lane) {
			case 'markers': items = events.markers; break;
			case 'tuning': items = events.tuningChanges; break;
			case 'grid': items = events.gridChanges; break;
		}

		if (!items || !items[index]) return;

		var event = items[index];

		var pane = sel('.timeline-info-pane');
		if (!pane) {
			pane = document.createElement('div');
			pane.className = 'timeline-info-pane';
			document.body.appendChild(pane);
		}

		var content = '';

		var DB = window.DB;
		var GridSystem = window.GridSystem;

		// Pomocná funkcia na spracovanie znakov v štýle HTML.
		var escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

		switch (lane) {
			case 'markers':
				content = `
					<input type="text" class="timeline-info-name" value="${escAttr(event.name || '')}" style="width: 140px;" placeholder="Marker name">
					<input type="number" class="timeline-info-time" value="${event.time.toFixed(3)}" step="0.001" style="width: 70px;" title="Time (s)">
				`;
				break;

			case 'tuning':
				var scales = DB?.get('scales') || {};
				var tuningOptions = '';
				for (const key in scales) {
					const selected = key === event.tuningKey ? 'selected' : '';
					tuningOptions += `<option value="${key}" ${selected}>${scales[key].name}</option>`;
				}

				content = `
					<select class="timeline-info-tuning" style="width: 180px;">
						${tuningOptions}
					</select>
					<input type="number" class="timeline-info-time" value="${event.time.toFixed(3)}" step="0.001" style="width: 70px;" title="Time (s)">
					<label class="timeline-info-global-label" style="display: flex; align-items: center; margin-top: 8px; cursor: pointer;">
						<input type="checkbox" class="timeline-info-global" ${event.global ? 'checked' : ''} style="margin-right: 6px;">
						<span>Global (applies to all tracks)</span>
					</label>
				`;
				break;

			case 'grid':
				var grids = GridSystem?.getAll() || {};
				var gridOptions = '';
				for (const key in grids) {
					const selected = key === event.gridKey ? 'selected' : '';
					gridOptions += `<option value="${key}" ${selected}>${grids[key].name}</option>`;
				}

				content = `
					<select class="timeline-info-grid" style="width: 180px;">
						${gridOptions}
					</select>
					<input type="number" class="timeline-info-time" value="${event.time.toFixed(3)}" step="0.001" style="width: 70px;" title="Time (s)">
					<label class="timeline-info-global-label" style="display: flex; align-items: center; margin-top: 8px; cursor: pointer;">
						<input type="checkbox" class="timeline-info-global" ${event.global ? 'checked' : ''} style="margin-right: 6px;">
						<span>Global (applies to all tracks)</span>
					</label>
				`;
				break;
		}

		content += `
			<div class="timeline-info-actions">
				<button class="timeline-info-apply">Apply</button>
				<button class="timeline-info-delete" style="margin-left: 10px;">Delete</button>
			</div>
		`;

		pane.innerHTML = content;

		pane.style.left = Math.min(x, window.innerWidth - 280) + 'px';
		pane.style.top = (y + 10) + 'px';
		pane.style.display = 'block';

		Timeline.infoPane = {
			visible: true,
			lane,
			index,
			eventRef: event,
			isNew,
			trackIdx
		};

		var applyBtn = pane.querySelector('.timeline-info-apply');
		var deleteBtn = pane.querySelector('.timeline-info-delete');

		applyBtn.addEventListener('click', () => {
			Timeline.applyInfoPane();
		});

		deleteBtn.addEventListener('click', () => {
			Timeline.deleteEvent(lane, Timeline.infoPane.eventRef, trackIdx);
			Timeline.closeInfoPane();
		});

		var allInputs = pane.querySelectorAll('input, select');
		allInputs.forEach(input => {
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					Timeline.applyInfoPane();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					Timeline.closeInfoPane();
				}
			});
		});

		if (isNew && lane === 'markers') {
			var nameInput = pane.querySelector('.timeline-info-name');
			if (nameInput) {
				nameInput.focus();
				nameInput.select();
			}
		} else if (isNew && (lane === 'tuning' || lane === 'grid')) {
			var firstSelect = pane.querySelector('select');
			if (firstSelect) {
				firstSelect.focus();
				setTimeout(() => {
					if (typeof firstSelect.showPicker === 'function') {
						try { firstSelect.showPicker(); } catch (e) {}
					}
				}, 50);
			}
		} else {
			var firstInput = pane.querySelector('input, select');
			if (firstInput) firstInput.focus();
		}
	},

	applyInfoPane: () => {
		if (!Timeline.infoPane.visible) return;

		var { lane, eventRef, trackIdx: paneTrackIdx } = Timeline.infoPane;
		var trackIdx = paneTrackIdx !== undefined ? paneTrackIdx : Timeline.getCurrentTrackIdx();

		var beforeState = Timeline.captureTrackEventsState();

		var events = Timeline.getTrackEvents(trackIdx);

		var items;
		switch (lane) {
			case 'markers': items = events.markers; break;
			case 'tuning': items = events.tuningChanges; break;
			case 'grid': items = events.gridChanges; break;
		}

		// Nájdenie aktuálneho indexu podľa referencie.
		var index = eventRef ? items?.indexOf(eventRef) : -1;
		if (!items || index === -1) {
			if (typeof showStatus === 'function') showStatus('Event no longer exists.', { type: 'warning' });
			Timeline.closeInfoPane();
			return;
		}

		var pane = sel('.timeline-info-pane');
		if (!pane) return;

		var timeInput = pane.querySelector('.timeline-info-time');
		if (timeInput) {
			items[index].time = Math.max(0, parseFloat(timeInput.value) || 0);
		}

		switch (lane) {
			case 'markers':
				var nameInput = pane.querySelector('.timeline-info-name');
				if (nameInput) {
					items[index].name = nameInput.value;
				}
				break;

			case 'tuning':
				var tuningSelect = pane.querySelector('.timeline-info-tuning');
				if (tuningSelect) {
					items[index].tuningKey = tuningSelect.value;
				}
				var tuningGlobalCheckbox = pane.querySelector('.timeline-info-global');
				if (tuningGlobalCheckbox) {
					items[index].global = tuningGlobalCheckbox.checked;
				}
				break;

			case 'grid':
				var gridSelect = pane.querySelector('.timeline-info-grid');
				if (gridSelect) {
					items[index].gridKey = gridSelect.value;
				}
				var gridGlobalCheckbox = pane.querySelector('.timeline-info-global');
				if (gridGlobalCheckbox) {
					items[index].global = gridGlobalCheckbox.checked;
				}
				break;
		}

		Timeline.saveTrackEvents(trackIdx, events);
		Timeline.closeInfoPane();
		Timeline.draw();

		var laneNames = { markers: 'marker', tuning: 'tuning change', grid: 'grid change' };
		Timeline.recordTrackEventsUndo('Edit ' + (laneNames[lane] || 'event'), beforeState);
	},

	deleteEvent: (lane, indexOrRef, eventTrackIdx) => {
		var trackIdx = eventTrackIdx !== undefined ? eventTrackIdx : Timeline.getCurrentTrackIdx();
		var events = Timeline.getTrackEvents(trackIdx);

		var items;
		switch (lane) {
			case 'markers': items = events.markers; break;
			case 'tuning': items = events.tuningChanges; break;
			case 'grid': items = events.gridChanges; break;
		}

		// Ak je indexOrRef objekt, nájde sa jeho aktuálny index.
		var index;
		if (typeof indexOrRef === 'object' && indexOrRef !== null) {
			index = items ? items.indexOf(indexOrRef) : -1;
		} else {
			index = indexOrRef;
		}

		if (items && index >= 0 && items[index]) {
			var beforeState = Timeline.captureTrackEventsState();

			items.splice(index, 1);
			Timeline.saveTrackEvents(trackIdx, events);
			Timeline.draw();

			var laneNames = { markers: 'marker', tuning: 'tuning change', grid: 'grid change' };
			Timeline.recordTrackEventsUndo('Delete ' + (laneNames[lane] || 'event'), beforeState);
		} else if (typeof indexOrRef === 'object') {
			if (typeof showStatus === 'function') showStatus('Event no longer exists.', { type: 'warning' });
		}
	},

	closeInfoPane: () => {
		var pane = sel('.timeline-info-pane');
		if (pane) {
			pane.style.display = 'none';
		}
		Timeline.infoPane.visible = false;
	},

	draw: () => {
		if (!Timeline.ctx || !Timeline.canvas) return;

		var ctx = Timeline.ctx;
		var width = Timeline.cssWidth;
		var height = Timeline.cssHeight;

		ctx.fillStyle = '#1a1a1a';
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = '#111';
		ctx.fillRect(0, 0, 60, height);

		// Popisky pruhov
		ctx.fillStyle = '#666';
		ctx.font = '9px Arial';
		if (Timeline.lanes.loop.height > 0) {
			ctx.fillText('L', 5, Timeline.lanes.loop.y + Timeline.lanes.loop.height / 2 + 3);
		}
		if (Timeline.lanes.markers.height > 0) {
			ctx.fillText('M', 5, Timeline.lanes.markers.y + Timeline.lanes.markers.height / 2 + 3);
		}
		if (Timeline.lanes.tuning.height > 0) {
			ctx.fillText('T', 5, Timeline.lanes.tuning.y + Timeline.lanes.tuning.height / 2 + 3);
		}
		if (Timeline.lanes.grid.height > 0) {
			ctx.fillText('G', 5, Timeline.lanes.grid.y + Timeline.lanes.grid.height / 2 + 3);
		}

		// Oddeľovače len pri pruhoch s nenulovou výškou.
		ctx.strokeStyle = '#333';
		ctx.lineWidth = 1;
		ctx.beginPath();
		if (Timeline.lanes.markers.height > 0 && Timeline.lanes.markers.y > 0) {
			ctx.moveTo(60, Timeline.lanes.markers.y);
			ctx.lineTo(width, Timeline.lanes.markers.y);
		}
		if (Timeline.lanes.tuning.height > 0 && Timeline.lanes.tuning.y > 0) {
			ctx.moveTo(60, Timeline.lanes.tuning.y);
			ctx.lineTo(width, Timeline.lanes.tuning.y);
		}
		if (Timeline.lanes.grid.height > 0 && Timeline.lanes.grid.y > 0) {
			ctx.moveTo(60, Timeline.lanes.grid.y);
			ctx.lineTo(width, Timeline.lanes.grid.y);
		}
		ctx.stroke();

		ctx.strokeStyle = '#000';
		ctx.beginPath();
		ctx.moveTo(60, 0);
		ctx.lineTo(60, height);
		ctx.stroke();

		var trackIdx = Timeline.getCurrentTrackIdx();

		// Markery zo všetkých stôp, keďže majú byť viditeľné globálne.
		var allMarkers = Timeline.getAllMarkers();
		Timeline.drawMarkers(allMarkers, trackIdx);

		// Zmeny ladenia zo všetkých stôp, čiže globálne aj z aktuálnej stopy.
		var allTunings = Timeline.getAllTuningChanges(trackIdx);
		Timeline.drawTuningChanges(allTunings, trackIdx);

		// Zmeny mriežky zo všetkých stôp, čiže globálne aj z aktuálnej stopy.
		var allGrids = Timeline.getAllGridChanges(trackIdx);
		Timeline.drawGridChanges(allGrids, trackIdx);

		// Zóna slučky v hornom pruhu, iba ak je pruh viditeľný.
		var playback = window.playback;
		var loopLaneVisible = Timeline.lanes.loop.height > 0;
		if (loopLaneVisible && playback && playback.loopStart !== null && playback.loopEnd !== null) {
			var loopCheckbox = document.getElementById('playback-loop');
			var loopEnabled = loopCheckbox && loopCheckbox.checked;
			var loopStartX = Timeline.timeToX(playback.loopStart);
			var loopEndX = Timeline.timeToX(playback.loopEnd);
			const loopLane = Timeline.lanes.loop;
			if (loopStartX < width && loopEndX > 60) {
				var drawStartX = Math.max(60, loopStartX);
				var drawEndX = Math.min(width, loopEndX);
				var loopHover = Timeline.interaction.loopHovered;

				var bandAlpha = loopEnabled ? 0.14 : 0.05;
				if (loopHover === 'move') bandAlpha += 0.06;
				ctx.fillStyle = `rgba(255, 255, 255, ${bandAlpha})`;
				ctx.fillRect(drawStartX, loopLane.y, drawEndX - drawStartX, loopLane.height);

				// Okraje, úchytky na ťahanie.
				var edgeAlpha = loopEnabled ? 0.75 : 0.3;
				if (loopStartX >= 60 && loopStartX <= width) {
					ctx.fillStyle = `rgba(255, 255, 255, ${loopHover === 'start' ? 1 : edgeAlpha})`;
					ctx.fillRect(loopStartX, loopLane.y, 2, loopLane.height);
				}
				if (loopEndX >= 60 && loopEndX <= width) {
					ctx.fillStyle = `rgba(255, 255, 255, ${loopHover === 'end' ? 1 : edgeAlpha})`;
					ctx.fillRect(loopEndX - 2, loopLane.y, 2, loopLane.height);
				}
			}
		}

		// Dočasný začiatok a koniec slučky predstavujú predbežný výber, uplatní sa cez Ctrl+L.
		var select = window.select;
		if (select && select.tempLoopStart !== null && select.tempLoopEnd !== null) {
			const loopLane = Timeline.lanes.loop;
			var tempStartX = Timeline.timeToX(select.tempLoopStart);
			var tempEndX = Timeline.timeToX(select.tempLoopEnd);

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
			ctx.lineWidth = 2;
			ctx.setLineDash([3, 3]);

			if (tempStartX >= 60 && tempStartX <= width) {
				ctx.beginPath();
				ctx.moveTo(tempStartX, loopLane.y);
				ctx.lineTo(tempStartX, loopLane.y + loopLane.height);
				ctx.stroke();
			}

			if (tempEndX >= 60 && tempEndX <= width) {
				ctx.beginPath();
				ctx.moveTo(tempEndX, loopLane.y);
				ctx.lineTo(tempEndX, loopLane.y + loopLane.height);
				ctx.stroke();
			}

			ctx.setLineDash([]);
		}

		if (playback) {
			var playheadX = Timeline.timeToX(playback.time);
			if (playheadX >= 60 && playheadX <= width) {
				ctx.strokeStyle = playback.playing ? '#fff' : 'rgba(255,255,255,0.3)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(playheadX, 0);
				ctx.lineTo(playheadX, height);
				ctx.stroke();
			}
		}
	},

	// Markery sú pravouhlé trojuholníkové vlajky s vertikálnymi čiarami
	// zobrazenie markerov zo všetkých stôp, pričom markery aktuálnej stopy sú výraznejšie.
	drawMarkers: (markers, currentTrackIdx) => {
		if (!markers) return;
		if (Timeline.lanes.markers.height <= 0) return;

		var ctx = Timeline.ctx;
		var lane = Timeline.lanes.markers;
		var centerY = lane.y + lane.height / 2;
		var flagWidth = 8;
		var flagHeight = 10;

		for (let i = 0; i < markers.length; i++) {
			var marker = markers[i];
			var x = Timeline.timeToX(marker.time);

			if (x < 60 || x > Timeline.cssWidth) continue;

			var isCurrentTrack = (marker.trackIdx === currentTrackIdx);

			// Na zistenie toho, či sa prešlo kurzorom, treba zhodu trackIdx aj indexu.
			var isHovered = Timeline.interaction.hovered &&
				Timeline.interaction.hovered.lane === 'markers' &&
				Timeline.interaction.hovered.trackIdx === marker.trackIdx &&
				Timeline.interaction.hovered.index === marker.index;

			var baseAlpha = isCurrentTrack ? 1 : 0.4;

			// Vertikálna čiara je kreslená cez celú časovú os, od vrchu vlajky nadol.
			ctx.strokeStyle = isHovered ? '#fff' : `rgba(255, 255, 255, ${0.6 * baseAlpha})`;
			ctx.lineWidth = isHovered ? 2 : 1;
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(x, lane.y);
			ctx.lineTo(x, Timeline.cssHeight);
			ctx.stroke();

			ctx.fillStyle = isHovered ? '#fff' : `rgba(255, 255, 255, ${0.9 * baseAlpha})`;
			ctx.beginPath();
			ctx.moveTo(x, lane.y);               // Ľavý horný roh.
			ctx.lineTo(x + flagWidth, lane.y);   // Pravý horný roh.
			ctx.lineTo(x, lane.y + flagHeight);  // Ľavý dolný roh.
			ctx.closePath();
			ctx.fill();

			// Názov je posunutý doprava, aby sa neprekrýval s vlajkou.
			if (marker.name) {
				ctx.fillStyle = isHovered ? '#fff' : `rgba(255, 255, 255, ${0.7 * baseAlpha})`;
				ctx.font = '10px Arial';
				ctx.fillText(marker.name, x + flagWidth + 4, centerY + 3);
			}
		}
	},

	// Zmeny ladenia sú zobrazené ako diamanty
	// udalosti z aktuálnej stopy sú zobrazené naplno, zatiaľ čo udalosti z iných stôp sotva viditeľné, pokiaľ nie sú globálne.
	drawTuningChanges: (tuningChanges, currentTrackIdx) => {
		if (!tuningChanges) return;
		if (Timeline.lanes.tuning.height <= 0) return;

		var ctx = Timeline.ctx;
		var lane = Timeline.lanes.tuning;
		var centerY = lane.y + lane.height / 2;
		var DB = window.DB;

		for (let i = 0; i < tuningChanges.length; i++) {
			var change = tuningChanges[i];
			var x = Timeline.timeToX(change.time);

			if (x < 60 || x > Timeline.cssWidth) continue;

			var isCurrentTrack = change.isCurrentTrack;
			var isGlobal = change.global;

			var baseAlpha = (isCurrentTrack || isGlobal) ? 1 : 0.4;

			var isHovered = Timeline.interaction.hovered &&
				Timeline.interaction.hovered.lane === 'tuning' &&
				Timeline.interaction.hovered.trackIdx === change.trackIdx &&
				Timeline.interaction.hovered.index === change.index;

			// Globálne udalosti majú mierne odlišnú farbu.
			var diamondColor;
			if (isHovered) {
				diamondColor = '#ffcc88';
			} else if (isGlobal) {
				diamondColor = '#ee9966'; // Jasnejšia a sýtejšia pre globálnu.
			} else if (isCurrentTrack) {
				diamondColor = '#aa6633';
			} else {
				diamondColor = `rgba(170, 102, 51, ${baseAlpha})`;
			}
			ctx.fillStyle = diamondColor;
			ctx.beginPath();
			ctx.moveTo(x, lane.y + 2);
			ctx.lineTo(x + 5, centerY);
			ctx.lineTo(x, lane.y + lane.height - 2);
			ctx.lineTo(x - 5, centerY);
			ctx.closePath();
			ctx.fill();

			// Názov ladenia sa berie z cache, aby sa nevyhľadával v DB pri každom snímku.
			if (!Timeline._cachedScales) Timeline._cachedScales = DB?.get('scales') || {};
			var scaleName = Timeline._cachedScales[change.tuningKey]?.name || change.tuningKey;
			ctx.fillStyle = isHovered ? '#fff' : `rgba(255, 255, 255, ${0.7 * baseAlpha})`;
			ctx.font = '10px Arial';
			ctx.fillText(scaleName, x + 8, centerY + 3);
		}
	},

	// Zmeny mriežky sú zobrazené ako diamanty
	// udalosti z aktuálnej stopy sú zobrazené naplno, zatiaľ čo udalosti z iných stôp sotva viditeľné, pokiaľ nie sú globálne.
	drawGridChanges: (gridChanges, currentTrackIdx) => {
		if (!gridChanges) return;
		if (Timeline.lanes.grid.height <= 0) return;

		var ctx = Timeline.ctx;
		var lane = Timeline.lanes.grid;
		var centerY = lane.y + lane.height / 2;
		var GridSystem = window.GridSystem;

		for (let i = 0; i < gridChanges.length; i++) {
			var change = gridChanges[i];
			var x = Timeline.timeToX(change.time);

			if (x < 60 || x > Timeline.cssWidth) continue;

			var isCurrentTrack = change.isCurrentTrack;
			var isGlobal = change.global;

			var baseAlpha = (isCurrentTrack || isGlobal) ? 1 : 0.4;

			var isHovered = Timeline.interaction.hovered &&
				Timeline.interaction.hovered.lane === 'grid' &&
				Timeline.interaction.hovered.trackIdx === change.trackIdx &&
				Timeline.interaction.hovered.index === change.index;

			// Globálne udalosti majú odlišnú farbu.
			var diamondColor;
			if (isHovered) {
				diamondColor = '#8cf';
			} else if (isGlobal) {
				diamondColor = '#6cf'; // Jasnejšia a azúrová pre globálnu.
			} else if (isCurrentTrack) {
				diamondColor = '#36a';
			} else {
				diamondColor = `rgba(51, 102, 170, ${baseAlpha})`;
			}
			ctx.fillStyle = diamondColor;
			ctx.beginPath();
			ctx.moveTo(x, lane.y + 2);
			ctx.lineTo(x + 5, centerY);
			ctx.lineTo(x, lane.y + lane.height - 2);
			ctx.lineTo(x - 5, centerY);
			ctx.closePath();
			ctx.fill();

			// Názov mriežky sa berie z cache, aby sa nevyhľadával v GridSystem pri každom snímku.
			if (!Timeline._cachedGrids) Timeline._cachedGrids = GridSystem?.getAll() || {};
			var gridName = Timeline._cachedGrids[change.gridKey]?.name || change.gridKey;
			ctx.fillStyle = isHovered ? '#fff' : `rgba(255, 255, 255, ${0.7 * baseAlpha})`;
			ctx.font = '10px Arial';
			ctx.fillText(gridName, x + 8, centerY + 3);
		}
	},

	// Pri zmazaní stopy sa odstránia jej udalosti a indexy sa prečíslujú.
	handleTrackDelete: (deletedTrackIdx) => {
		var DB = window.DB;
		if (!DB) return;

		var trackEvents = DB.get('trackEvents') || {};

		delete trackEvents[deletedTrackIdx];

		// Preindexovanie zostávajúcich stôp.
		var newTrackEvents = {};
		for (const key in trackEvents) {
			var idx = parseInt(key);
			if (idx > deletedTrackIdx) {
				newTrackEvents[idx - 1] = trackEvents[key];
			} else {
				newTrackEvents[idx] = trackEvents[key];
			}
		}

		DB.set('trackEvents', newTrackEvents);
	},

	handleTrackAdd: (trackIdx) => {
		var DB = window.DB;
		var settings = window.settings;
		if (!DB) return;

		var trackEvents = DB.get('trackEvents') || {};

		trackEvents[trackIdx] = {
			markers: [],
			tuningChanges: [
				{ time: 0, tuningKey: settings?.scale || 'free' }
			],
			gridChanges: [
				{ time: 0, gridKey: settings?.grid || 'off' }
			]
		};

		DB.set('trackEvents', trackEvents);
	},

	createEventAtPlayhead: (lane) => {
		var laneInfo = Timeline.lanes[lane];
		if (!laneInfo || laneInfo.height === 0) return;

		var playback = window.playback;
		var settings = window.settings;
		var time = playback?.time || 0;
		var trackIdx = Timeline.getCurrentTrackIdx();

		var beforeState = Timeline.captureTrackEventsState();

		var events = Timeline.getTrackEvents(trackIdx);

		var newIndex;

		switch (lane) {
			case 'markers':
				newIndex = events.markers.length;
				events.markers.push({ time, name: 'Marker' });
				break;
			case 'tuning':
				newIndex = events.tuningChanges.length;
				events.tuningChanges.push({ time, tuningKey: settings?.scale || 'edo12' });
				break;
			case 'grid':
				newIndex = events.gridChanges.length;
				// Ak je toto prvá udalosť mriežky, použije sa 'seconds' namiesto 'off'.
				var defaultGrid = (events.gridChanges.length === 0 && settings?.grid === 'off')
					? 'seconds'
					: (settings?.grid || 'off');
				events.gridChanges.push({ time, gridKey: defaultGrid });
				break;
			default:
				return;
		}

		Timeline.saveTrackEvents(trackIdx, events);
		Timeline.draw();

		var laneNames = { markers: 'marker', tuning: 'tuning change', grid: 'grid change' };
		Timeline.recordTrackEventsUndo('Add ' + (laneNames[lane] || 'event'), beforeState);

		var x = Timeline.timeToX(time);
		var y = Timeline.canvas.getBoundingClientRect().top + 50;

		Timeline.openInfoPane(lane, newIndex, true, x, y);

		// Po krátkom oneskorení nastavenie zamerania na príslušný element, aby bol DOM pripravený.
		setTimeout(() => {
			if (lane === 'markers') {
				var nameInput = document.querySelector('.timeline-info-name');
				if (nameInput) {
					nameInput.focus();
					nameInput.select();
				}
			} else {
				var selector = lane === 'tuning' ? '.timeline-info-tuning' : '.timeline-info-grid';
				var dropdown = document.querySelector(selector);
				if (dropdown) {
					dropdown.focus();
					if (typeof dropdown.showPicker === 'function') {
						try {
							dropdown.showPicker();
						} catch (e) {
							// Chyba
						}
					}
				}
			}
		}, 50);
	}
};