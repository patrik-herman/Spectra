// Jeden z prvých súborov, ktorý vznikol v rámci celého projektu.


var ctx,
	initDone = false,
	pageNumber = 2;
window.pageNumber = 2;

window.keyboardPreview = {
	active: false,
	note: null,       // Číslo MIDI noty alebo frekvencia, ktorá sa prehráva.
	freq: null,
	instIdx: 0,
	keyIndex: -1,     // Index v stupnici na zvýraznenie.
	osc: null,
	gain: null
};
var masterLimiter = null,
	masterVolume = null,
	masterMeter = null,
	masterMuted = false,
	masterVolumeValue = 0, // Predvolená hlasitosť v dB.
	viewStateSaveTimer = null;
// Keď je MIDI Partial Mode zapnutý, MIDI klávesy prehrávajú zoradené parciály namiesto stupňov ladenia.
window.midiPartialMode = false;
// Keď je Computer Keyboard Mode zapnutý, počítačová klávesnica funguje ako MIDI klávesnica.
window.computerKeyboardMode = false;
window.computerKeyboardOctave = 4;
var headerButtons = sel('.header-button', true),
	pages = sel('.page', true),
	helpSection = sel('.helpSection'),
	exportSection = sel('.exportSection'),
	playbackPitch = 0,
	scales = {},
	scale = 'edo12',
	scrollSize = 28,
	infoWindowNote = sel('.info-window-note'),
	infoWindowFrequency = sel('.info-window-frequency'),
	infoWindowClosest = sel('.info-window-closest'),
	infoWindowTime = sel('.info-window-time'),
	partialWindow = sel('.partial-window'),
	partialWindowNote = sel('.partial-window-note'),
	partialWindowFundamental = sel('.partial-window-fundamental'),
	partialWindowPartial = sel('.partial-window-partial'),
	partialWindowClosestChromatic = sel('.partial-window-closest-chromatic'),
	partialWindowTime = sel('.partial-window-time'),
	partialWindowLength = sel('.partial-window-length'),
	playbackUIPlay = sel('.playback-ui-play'),
	playbackUITime = sel('.playback-time'),
	playbackUIMenu = sel('.playback-options-menu'),
	select = {selecting: false,
		x: 0, y: 0,
		offsetX: 0, offsetY: 0,
		deltaX: 0, deltaY: 0,
		moving: false,
		resizeLeft: false,
		resizeRight: false,
		dragTrackedNotes: null,  // Štruktúra trackIdx -> noteIdx -> [x, šírka, výška, parciál, vybraný, zvýraznený].
		dragTrackedBefore: null, // Pre krok vzad: trackIdx -> [{noteIndex, before}].
		dragChanged: false,
		timeline: false,
		hoverNote: false,  
		// Ťahanie s dvojklikom na vytvorenie noty s vlastnou dĺžkou.
		dblClickCreating: false,
		dblClickNote: null,  // {instIdx, noteIdx, startTime}
		// Ťahanie v režime scrollovania na zmenu výšky.
		scrollCreating: false,
		scrollNote: null,  // {instIdx, noteIdx, startY, startPitch, lastPitchStep}
		scrollPitchThreshold: 12,  // Počet pixelov vertikálneho pohybu pred zmenou výšky.
		scrollMoveStep: 0,  // Sledovanie posunu pri ťahaní existujúcej noty v režime scrollovania.
		// Sledovanie klikov na manuálne zisťovanie dvojkliku.
		lastClickTime: 0,
		lastClickX: 0,
		lastClickY: 0,
		// Dočasný začiatok a koniec slučky zobrazené počas výberu, ktoré sa uplatnia pri zapnutí slučky.
		tempLoopStart: null,
		tempLoopEnd: null,
		// Debounce na vytváranie nôt, aby nevznikali duplicitné noty.
		lastNoteCreationTime: 0,
		// Podržané predprehrávanie parciálu pre tok mousedown->mouseup.
		heldPartialPreview: null,
		momentaryLoop: {
			keyHeld: false,
			active: false,
			startX: null,
			savedLoopStart: null,
			savedLoopEnd: null,
			savedTime: 0,
			wasPlaying: false,
			loopCheckboxWasOn: false
		},
	},
	shiftKey = false,
	altKey = false,
	ctrlKey = false,
	bypass = {
		up: false,
		down: false
	},
	playback = {
		time: 0,
		timeOld: 0,
		midiTime: 0,  // Stabilný čas na prichytávanie výšky MIDI, ktorý sa nemení počas ťahania výberu.
		playing: false,
		timestamp: 0,
		bpm: 120,     // Tempo na synchronizáciu MIDI clock.
		loopStart: null,
		loopEnd: null,
		loopLocked: false
	},
	scalesExt = window.scalesExt || {};
// Playback sa sprístupní globálne, aby ho videli aj iné moduly.
window.playback = playback;

function showSaveNotification(message = 'Project saved', isError = false) {
	if (typeof showStatus === 'function') {
		showStatus(message, { type: isError ? 'error' : 'success', duration: 1500 });
	}
}

function showStatus(message, options = {}) {
	var type = options.type || 'info';
	var duration = options.duration !== undefined ? options.duration : 3000;
	var dismissible = options.dismissible !== false;

	document.querySelectorAll('.spectra-status-notification').forEach(m => {
		if (m.textContent === message) m.remove();
	});

	var status = document.createElement('div');
	status.className = 'spectra-status-notification spectra-status-' + type;
	if (!dismissible) status.classList.add('not-dismissible');
	status.textContent = message;

	document.body.appendChild(status);

	requestAnimationFrame(() => status.classList.add('visible'));

	var removeStatus = () => {
		status.classList.remove('visible');
		setTimeout(() => status.remove(), 150);
	};

	if (dismissible) status.onclick = removeStatus;
	if (duration > 0) setTimeout(removeStatus, duration);

	return status;
}

// Dialóg s textovým poľom, ktorý vráti zadanú hodnotu alebo null.
function showPrompt(message, defaultValue = '', options = {}) {
	return new Promise((resolve) => {
		var title = options.title || 'Input';
		var confirmText = options.confirmText || 'OK';
		var cancelText = options.cancelText || 'Cancel';

		var overlay = cloneTemplate('tpl-dialog-prompt', {
			'.spectra-dialog-title': title,
			'.spectra-dialog-message': message,
			'.dialog-cancel': cancelText,
			'.dialog-confirm': confirmText
		});

		if (!overlay) {
			resolve(prompt(message, defaultValue));
			return;
		}

		var input = overlay.querySelector('.spectra-dialog-input');
		input.value = defaultValue;

		var cleanup = (result) => {
			overlay.classList.remove('visible');
			setTimeout(() => {
				overlay.remove();
				resolve(result);
			}, 150);
		};

		overlay.querySelector('.dialog-cancel').onclick = () => { document.removeEventListener('keydown', handleKeydown); cleanup(null); };
		overlay.querySelector('.dialog-confirm').onclick = () => { document.removeEventListener('keydown', handleKeydown); cleanup(input.value); };
		overlay.onclick = (e) => {
			if (e.target === overlay) cleanup(null);
		};

		var handleKeydown = (e) => {
			if (e.key === 'Escape') {
				cleanup(null);
				document.removeEventListener('keydown', handleKeydown);
			} else if (e.key === 'Enter') {
				cleanup(input.value);
				document.removeEventListener('keydown', handleKeydown);
			}
		};
		document.addEventListener('keydown', handleKeydown);

		document.body.appendChild(overlay);

		requestAnimationFrame(() => {
			overlay.classList.add('visible');
			input.focus();
			input.select();
		});
	});
}

// Potvrdzovacie okno
function showConfirm(message, options = {}) {
	return new Promise((resolve) => {
		var title = options.title || 'Confirm';
		var confirmText = options.confirmText || 'OK';
		var cancelText = options.cancelText || 'Cancel';
		var isDanger = options.type === 'danger';

		var overlay = cloneTemplate('tpl-dialog', {
			'.spectra-dialog-title': title,
			'.spectra-dialog-message': message,
			'.dialog-cancel': cancelText,
			'.dialog-confirm': confirmText
		});

		if (!overlay) {
			resolve(confirm(message));
			return;
		}

		var dialog = overlay.querySelector('.spectra-dialog');
		dialog.classList.add('confirm');

		var cancelBtn = overlay.querySelector('.dialog-cancel');
		var confirmBtn = overlay.querySelector('.dialog-confirm');

		if (isDanger) {
			confirmBtn.classList.remove('spectra-dialog-btn-primary');
			confirmBtn.classList.add('spectra-dialog-btn-danger');
		}

		var cleanup = (result) => {
			overlay.classList.remove('visible');
			resolve(result);
			setTimeout(() => {
				overlay.remove();
			}, 150);
		};

		cancelBtn.onclick = () => cleanup(false);
		confirmBtn.onclick = () => cleanup(true);
		overlay.onclick = (e) => {
			if (e.target === overlay) cleanup(false);
		};

		var handleKeydown = (e) => {
			if (e.key === 'Escape') {
				cleanup(false);
				document.removeEventListener('keydown', handleKeydown);
			} else if (e.key === 'Enter') {
				cleanup(true);
				document.removeEventListener('keydown', handleKeydown);
			}
		};
		document.addEventListener('keydown', handleKeydown);

		document.body.appendChild(overlay);

		requestAnimationFrame(() => {
			overlay.classList.add('visible');
			confirmBtn.focus();
		});
	});
}

function hasSelectedNotes() {
	if (typeof MIDI === 'undefined' || !MIDI.data) return false;

	for (let track = 0; track < MIDI.data.length; track++) {
		if (!MIDI.data[track]) continue;
		for (let note = 0; note < MIDI.data[track].length; note++) {
			// Zistí, či je nota vybraná; index 5 je N_SEL.
			if (MIDI.data[track][note] && MIDI.data[track][note][5]) {
				return true;
			}
		}
	}
	return false;
}

function moveCursorToPreviousGridStep() {
	if (typeof GridSystem === 'undefined' || typeof Timeline === 'undefined') return;

	var currentTime = playback.time;
	var trackIdx = Timeline.getCurrentTrackIdx();

	var searchStart = Math.max(0, currentTime - 60); // Hľadá až 60 sekúnd dozadu.
	var gridLines = GridSystem.getGridLines(trackIdx, searchStart, currentTime - 0.001);

	if (gridLines.length > 0) {
		var nearest = gridLines[0];
		for (const line of gridLines) {
			if (line.time < currentTime && line.time > nearest.time) {
				nearest = line;
			}
		}

		playback.time = nearest.time;
		playback.midiTime = nearest.time;

		if (typeof Canvas !== 'undefined') {
			Canvas.keepPlayheadInView();
		}
	}
}

function moveCursorToNextGridStep() {
	if (typeof GridSystem === 'undefined' || typeof Timeline === 'undefined') return;

	var currentTime = playback.time;
	var trackIdx = Timeline.getCurrentTrackIdx();

	var searchEnd = currentTime + 60; // Hľadá až 60 sekúnd dopredu.
	var gridLines = GridSystem.getGridLines(trackIdx, currentTime + 0.001, searchEnd);

	if (gridLines.length > 0) {
		var nearest = gridLines[0];
		for (const line of gridLines) {
			if (line.time > currentTime && line.time < nearest.time) {
				nearest = line;
			}
		}

		playback.time = nearest.time;
		playback.midiTime = nearest.time;

		if (typeof Canvas !== 'undefined') {
			Canvas.keepPlayheadInView();
		}
	}
}

// Predchádzajúca udalosť na časovej osi (marker, zmena ladenia alebo zmena mriežky).
function moveCursorToPreviousEvent() {
	if (typeof Timeline === 'undefined') return;

	var currentTime = playback.time;
	var trackIdx = Timeline.getCurrentTrackIdx();
	var events = Timeline.getTrackEvents(trackIdx);

	var allEvents = [];

	if (events.markers) {
		for (const m of events.markers) {
			allEvents.push({ time: m.time, type: 'marker' });
		}
	}
	if (events.tuningChanges) {
		for (const t of events.tuningChanges) {
			allEvents.push({ time: t.time, type: 'tuning' });
		}
	}
	if (events.gridChanges) {
		for (const g of events.gridChanges) {
			allEvents.push({ time: g.time, type: 'grid' });
		}
	}

	// Zostupne podľa času, aby sa našla predchádzajúca.
	allEvents.sort((a, b) => b.time - a.time);

	for (const evt of allEvents) {
		if (evt.time < currentTime - 0.001) {
			playback.time = evt.time;
			playback.midiTime = evt.time;

			if (typeof Canvas !== 'undefined') {
				Canvas.keepPlayheadInView();
			}
			return;
		}
	}

	playback.time = 0;
	playback.midiTime = 0;
	if (typeof Canvas !== 'undefined') {
		Canvas.keepPlayheadInView();
	}
}

// Nasledujúca udalosť na časovej osi (marker, zmena ladenia alebo zmena mriežky).
function moveCursorToNextEvent() {
	if (typeof Timeline === 'undefined') return;

	var currentTime = playback.time;
	var trackIdx = Timeline.getCurrentTrackIdx();
	var events = Timeline.getTrackEvents(trackIdx);

	var allEvents = [];

	if (events.markers) {
		for (const m of events.markers) {
			allEvents.push({ time: m.time, type: 'marker' });
		}
	}
	if (events.tuningChanges) {
		for (const t of events.tuningChanges) {
			allEvents.push({ time: t.time, type: 'tuning' });
		}
	}
	if (events.gridChanges) {
		for (const g of events.gridChanges) {
			allEvents.push({ time: g.time, type: 'grid' });
		}
	}

	// Zoradí vzostupne podľa času, aby sa našla nasledujúca.
	allEvents.sort((a, b) => a.time - b.time);

	for (const evt of allEvents) {
		if (evt.time > currentTime + 0.001) {
			playback.time = evt.time;
			playback.midiTime = evt.time;

			if (typeof Canvas !== 'undefined') {
				Canvas.keepPlayheadInView();
			}
			return;
		}
	}
}

async function exportProject() {
	var projectData = {
		version: typeof Config !== 'undefined' ? Config.version : '1.0',
		exportedAt: new Date().toISOString(),

		// Základné hudobné dáta.
		midiData: window.MIDI?.data || [[]],
		instruments: window.instruments || [],

		// Ladenia, farby, mriežky.
		scales: window.scales || {},
		spectra: window.spectra || {},
		grids: window.grids || {},

		// Udalosti časovej osi.
		trackEvents: window.trackEvents || {},

		// Nastavenia
		settings: window.settings || (typeof Config !== 'undefined' ? Config.defaultSettings : {}),
		playbackPitch: window.playbackPitch ?? 0,

		// Stav zobrazenia
		viewState: {
			scrollPosition: typeof Canvas !== 'undefined' ? Canvas.offx : 0,
			playheadPosition: typeof playback !== 'undefined' ? playback.time : 0,
			selectedTrack: typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0
		},

		// Nastavenia MIDI I/O.
		midiSettings: {
			inputIds: typeof WebMIDI !== 'undefined' ? WebMIDI.selectedInputs.map(i => i.id) : [],
			outputId: typeof WebMIDI !== 'undefined' && WebMIDI.selectedOutput ? WebMIDI.selectedOutput.id : '',
			channel: typeof WebMIDI !== 'undefined' ? WebMIDI.channel : 0,
			bpm: typeof playback !== 'undefined' ? playback.bpm : 120
		}
	};
	
	// V Electrone sa použije okno Uložiť ako.
	if (window.electronAPI?.isElectron) {
		var defaultName = (window.ProjectManager?.currentProject?.name || 'spectra-project') + '.spectra';
		window.electronAPI.showSaveDialog(defaultName).then(result => {
			if (result.success && result.filePath) {
				window.electronAPI.saveFile(result.filePath, JSON.stringify(projectData, null, 2)).then(saveResult => {
					if (saveResult.success) {
						if (typeof showStatus === 'function') {
							showStatus('Project exported to: ' + result.filePath, { type: 'success' });
						}
					} else {
						if (typeof showStatus === 'function') {
							showStatus('Failed to export: ' + saveResult.error, { type: 'error' });
						}
					}
				});
			}
		});
		return;
	}

	// V prehliadači sa použije sťahovanie.
	var fileName = await showPrompt('Enter filename:', 'spectra-project', { title: 'Export Project' });
	if (fileName) {
		download(JSON.stringify(projectData, null, 2), fileName + '.spectra', 'application/json');
	}
}

function importProject(jsonData) {
	try {
		var project = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

		if (project.midiData) {
			MIDI.data = project.midiData;
			DB.set('MIDIdata', MIDI.data);
		}

		if (typeof UndoManager !== 'undefined' && UndoManager.clear) UndoManager.clear();

		if (project.instruments) {
			window.instruments = project.instruments;
			DB.set('instruments', project.instruments);
		}

		if (project.scales) {
			window.scales = project.scales;
			DB.set('scales', project.scales);
		}

		if (project.spectra) {
			window.spectra = project.spectra;
			DB.set('spectra', project.spectra);
		}

		if (project.grids) {
			window.grids = project.grids;
			DB.set('grids', project.grids);
		}

		if (project.trackEvents) {
			window.trackEvents = project.trackEvents;
			DB.set('trackEvents', project.trackEvents);
		}

		if (project.settings) {
			window.settings = project.settings;
			DB.set('settings', project.settings);
		}

		if (project.playbackPitch !== undefined) {
			window.playbackPitch = project.playbackPitch;
		} else if (project.referenceA) {
			window.playbackPitch = 12 * Math.log2(project.referenceA / 440);
		}
		if (typeof setPlaybackPitch === 'function') {
			setPlaybackPitch(window.playbackPitch ?? 0);
		}
		var pitchInput = sel('.playback-pitch-input');
		if (pitchInput) pitchInput.value = window.playbackPitch ?? 0;

		var impMidiPitchCenter = project.midiPitchCenter !== undefined
			? project.midiPitchCenter : project.settings?.midiPitchCenter;
		if (impMidiPitchCenter !== undefined) {
			window.midiPitchCenter = impMidiPitchCenter;
			var pitchCenterInput = sel('.midiPitchCenterInput');
			if (pitchCenterInput) pitchCenterInput.value = impMidiPitchCenter;
		}

		// Načítanie limitu parciálov.
		var impPartialLimit = project.partialLimit !== undefined
			? project.partialLimit : project.settings?.partialLimit;
		if (impPartialLimit !== undefined) {
			window.partialLimit = impPartialLimit;
			var partialLimitInput = sel('.partialLimitInput');
			if (partialLimitInput) partialLimitInput.value = impPartialLimit;
		}

		// Prepočíta zoradené parciály pre načítané ladenia.
		if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
			DB.calculateOrderedPartials();
		}

		if (typeof UI !== 'undefined') {
			if (UI.instruments && UI.instruments.rebuildPane) {
				UI.instruments.rebuildPane();
			}
			if (UI.setup && UI.setup.refresh) {
				UI.setup.refresh();
			}
		}

		if (typeof initSynthsForInstruments === 'function') {
			initSynthsForInstruments();
		}

		if (typeof Timeline !== 'undefined' && Timeline.refresh) {
			Timeline.refresh();
		}

		if (project.viewState) {
			if (typeof Canvas !== 'undefined') {
				var vs = project.viewState;
				if (vs.barSize) window.barSize = vs.barSize;
				Canvas.offx = vs.scrollTime !== undefined ? -(vs.scrollTime * (window.barSize || 200)) : (vs.scrollPosition || 0);
				Canvas.offy = vs.verticalScroll || 0;
			}
			if (typeof playback !== 'undefined' && project.viewState.playheadPosition !== undefined) {
				playback.time = project.viewState.playheadPosition;
			}
		}


		if (typeof Setup !== 'undefined') {
			if (Setup.tuning && Setup.tuning.populateSelect) Setup.tuning.populateSelect();
			if (Setup.timbre && Setup.timbre.populateSelect) Setup.timbre.populateSelect();
			if (Setup.grid && Setup.grid.populateSelect) Setup.grid.populateSelect();
		}

		if (typeof EditorLists !== 'undefined') {
			if (EditorLists.populateTuningList) EditorLists.populateTuningList();
			if (EditorLists.populateTimbreList) EditorLists.populateTimbreList();
			if (EditorLists.populateGridList) EditorLists.populateGridList();
		}

		if (typeof Canvas !== 'undefined' && Canvas.step) {
			Canvas.step();
		}

		Logger.log('Project imported successfully');
		return true;
	} catch (error) {
		Logger.error('Error importing project:', error);
		showStatus('Error importing project: ' + error.message, { type: 'error' });
		return false;
	}
}

var lastClickedInstrumentIndex = 0;
var primaryTrackIndex = 0;
window.primaryTrackIndex = primaryTrackIndex;

function clickPaneInstrument(t, e) {
	t.dataset.mark = '1';
	var paneInstruments = sel('.pane-content .pane-instrument', true);
	paneInstruments.forEach((paneInstrument, clickedIndex) => {
		if (paneInstrument.dataset.mark === '1') {
			paneInstrument.dataset.mark = null;

			var isCtrl = e && (e.ctrlKey || e.metaKey);
			var isShift = e && e.shiftKey;

			var updatePrimaryIndicator = () => {
				window.primaryTrackIndex = primaryTrackIndex;

				for (let i = 0; i < paneInstruments.length; i++) {
					if (i === primaryTrackIndex) {
						paneInstruments[i].classList.add('primary');
					} else {
						paneInstruments[i].classList.remove('primary');
					}
				}
			};

			if (isCtrl) {
				// Pri Ctrl+kliku sa prepne výber stopy, primárna zostáva.
				instruments[clickedIndex].selected = !instruments[clickedIndex].selected;

				if (instruments[clickedIndex].selected) {
					paneInstruments[clickedIndex].classList.add('selected');
				} else {
					paneInstruments[clickedIndex].classList.remove('selected');
				}

				// Aspoň jedna stopa musí zostať vybraná.
				var anySelected = instruments.some(inst => inst.selected);
				if (!anySelected) {
					instruments[clickedIndex].selected = true;
					paneInstruments[clickedIndex].classList.add('selected');
				}

				// Ak primárna stopa už nie je vybraná, primárnou sa stane kliknutá stopa.
				if (!instruments[primaryTrackIndex] || !instruments[primaryTrackIndex].selected) {
					primaryTrackIndex = clickedIndex;
				}
				updatePrimaryIndicator();

			} else if (isShift) {
				// Pri Shift+kliku sa vyberie rozsah od naposledy kliknutej po túto, primárna zostáva.
				var minIdx = Math.min(lastClickedInstrumentIndex, clickedIndex);
				var maxIdx = Math.max(lastClickedInstrumentIndex, clickedIndex);

				for (let i = 0; i < instruments.length; i++) {
					instruments[i].selected = (i >= minIdx && i <= maxIdx);
					if (instruments[i].selected) {
						paneInstruments[i].classList.add('selected');
					} else {
						paneInstruments[i].classList.remove('selected');
					}
				}

				// Ak primárna stopa už nie je vybraná, primárnou sa stane prvá v rozsahu.
				if (!instruments[primaryTrackIndex] || !instruments[primaryTrackIndex].selected) {
					primaryTrackIndex = minIdx;
				}
				updatePrimaryIndicator();

			} else {
				var oldPrimaryIndex = primaryTrackIndex;
				var clickedIsSelected = instruments[clickedIndex] && instruments[clickedIndex].selected;
				var clickedIsPrimary = clickedIndex === primaryTrackIndex;

				// Znovu spustí podržané MIDI vstupné noty na novom nástroji.
				if (window.midiInputPreview && window.midiInputPreview.notes.size > 0 && oldPrimaryIndex !== clickedIndex) {
					var now = Tone.now();
					for (let [note, noteData] of window.midiInputPreview.notes) {
						if (window.synths && window.synths[oldPrimaryIndex]) {
							window.synths[oldPrimaryIndex].triggerRelease(note2freq(note), now);
						}
					}
					for (let [note, noteData] of window.midiInputPreview.notes) {
						if (window.synths && window.synths[clickedIndex]) {
							window.synths[clickedIndex].triggerAttack(note2freq(note), now, noteData.velocity / 127);
						}
					}
				}

				if (clickedIsSelected && !clickedIsPrimary) {
					// Ak sa kliklo na inú stopu v rámci viacnásobného výberu, zmení sa len primárna.
					primaryTrackIndex = clickedIndex;
					updatePrimaryIndicator();
				} else {
					// Ak sa kliklo na primárnu alebo na nevybranú stopu, výber sa zresetuje na jednoduchý typ.
					primaryTrackIndex = clickedIndex;

					for (let i = 0; i < instruments.length; i++) {
						instruments[i].selected = (i === clickedIndex);
						if (instruments[i].selected) {
							paneInstruments[i].classList.add('selected');
						} else {
							paneInstruments[i].classList.remove('selected');
						}
					}
					updatePrimaryIndicator();
				}
			}

			lastClickedInstrumentIndex = clickedIndex;

			// Zrušenie výberu všetkých nôt na nevybraných stopách.
			for (let instIdx = 0; instIdx < MIDI.data.length; instIdx++) {
				if (!instruments[instIdx] || !instruments[instIdx].selected) {
					for (let noteIdx = 0; noteIdx < MIDI.data[instIdx].length; noteIdx++) {
						if (MIDI.data[instIdx][noteIdx].length > 4 && MIDI.data[instIdx][noteIdx][N_DATA]) {
							var partials = MIDI.data[instIdx][noteIdx][N_DATA].partials;
							if (partials) {
								for (let partialIdx = 0; partialIdx < partials.length; partialIdx++) {
									partials[partialIdx][P_SEL] = 0;
									partials[partialIdx][P_HOVER] = 0;
								}
							}
						}
					}
				}
			}

			DB.set('instruments', instruments);
		}
	});
}
function debouncedSaveViewState() {
	if (viewStateSaveTimer) {
		clearTimeout(viewStateSaveTimer);
	}
	viewStateSaveTimer = setTimeout(() => {
		DB.saveViewState();
	}, 500);
}
window.addEventListener('load', () => {
	setTimeout(() => {
		if (typeof viewState !== 'undefined' && viewState) {
			if (typeof Canvas !== 'undefined') {
				if (viewState.barSize) window.barSize = viewState.barSize;
				Canvas.offx = viewState.scrollTime !== undefined ? -(viewState.scrollTime * (window.barSize || 200)) : (viewState.scrollPosition || 0);
				Canvas.offy = viewState.verticalScroll || 0;
			}
			if (typeof playback !== 'undefined' && viewState.playheadPosition !== undefined) {
				playback.time = viewState.playheadPosition;
				playback.midiTime = viewState.playheadPosition;
			}
		}
	}, 100);
});
window.addEventListener('beforeunload', () => {
	// Okamžité uloženie pri odchode.
	if (typeof DB !== 'undefined') {
		if (DB.saveViewState) {
			DB.saveViewState();
		}
		// Uloženie do IndexedDB, ak sa používa ProjectManager.
		if (DB.forceSave) {
			DB.forceSave();
		}
	}
});
document.addEventListener('click', e => {
	var t = e.target;
	if (!t || !t.classList) return;
	if (t.classList.contains("fa")) t = t.parentNode;
	if (!t || !t.classList) return;
	var paneHeader = t.closest?.('.pane > h2');
	if (paneHeader) UI.pane.toggle(paneHeader.querySelector('.pane-toggle'));
	if (t.classList.contains('header-button')) {
		if (t.dataset.page) {
			pageNumber = t.dataset.page;
			window.pageNumber = parseInt(pageNumber);
			UI.page.toggle(pageNumber);
			UI.page.toggleUI(pageNumber);
			updateCanvasSize();
			t.blur();
			if (document.activeElement && document.activeElement !== document.body) {
				document.activeElement.blur();
			}
		}
		if (t.id === 'header-save') {
			t.blur();
			UI.export.open();
		}
		else if (t.id === 'header-back') {
			t.blur();
			// Návrat na obrazovku výberu projektu.
			if (typeof ProjectManager !== 'undefined') {
				// Najprv uloží aktuálny projekt, ale len ak existuje platné ID projektu.
				const savePromise = (ProjectManager.currentProjectId && ProjectManager.currentProject && ProjectManager.currentProject.id)
					? ProjectManager.saveCurrentProject().then(() => {
						Logger.log('Project saved before returning to menu');
					}).catch(err => {
						Logger.warn('Could not save project:', err);
					})
					: Promise.resolve();

				savePromise.then(() => {
					var overlay = document.getElementById('startOverlay');
					if (overlay) {
						overlay.style.display = '';
						// Reset indikátora, aby sa UI mohlo znovu zostaviť.
						ProjectManager.startupUIShown = false;
						ProjectManager.showStartupUI();
						if (window.Setup?.resetEditors) window.Setup.resetEditors();
					}
				});
			}
		}
		else if (t.id === 'header-load-project') {
			sel('.load-midi').click();
		}
		else if (t.id === 'header-save-project') {
			t.blur();
			// Uloženie (rovnako ako Ctrl+S).
			if (typeof DB !== 'undefined' && DB.useProjectManager && typeof ProjectManager !== 'undefined') {
				if (DB.autoSaveTimer) {
					clearTimeout(DB.autoSaveTimer);
					DB.autoSaveTimer = null;
				}

				const savePromise = ProjectManager.saveCurrentProject();

				savePromise.then(() => {
					showSaveNotification();
				}).catch(err => {
					Logger.error('Save failed:', err);
					showSaveNotification('Save failed!', true);
				});
			} else {
				// Inak sa len zobrazí upozornenie, keďže auto-save rieši localStorage.
				showSaveNotification();
			}
		}
	}
	else if (t.classList.contains('save-project-button')) {
		t.blur();
		exportProject();
	} else if (t.classList.contains('infoButton')) {
		UI.info.open();
	}
	else if (t.classList.contains('close') && t.parentNode.parentNode.classList.contains('helpSection')) {
		UI.info.close();
	}
	else if (t.classList.contains('close') && t.parentNode.parentNode.classList.contains('exportSection')) {
		UI.export.close();
	}
	else if (t.classList.contains('helpSection')) {
		UI.info.close();
	}
	else if (t.classList.contains('exportSection')) {
		UI.export.close();
	}
	else if (t.id === 'analyzerOverlay') {
		UI.analyzer.close();
	}
	else if (t.classList.contains('add-instrument')) {
		UI.instruments.add();
	}
	else if (t.classList.contains('pane-instrument')) {
		clickPaneInstrument(t, e);
	}
	else if (t.classList.contains('pane-instrument-close')) {
		UI.instruments.delete(t);
	}
	else if (t.classList.contains('pane-instrument-strip')) {
		t.parentNode.dataset.mark = '1';
		sel('.pane-content .pane-instrument', true).forEach((paneInstrument, i5) => {
			if (paneInstrument.dataset.mark === '1') {
				paneInstrument.dataset.mark = null;
				var colorPicker = sel('#c');
				colorPicker.focus();
				colorPicker.value = rgb2hex(t.style.background);
				colorPicker.dataset.instrumentId = i5;
				t.classList.add('pane-instrument-strip-selected');
				colorPicker.click();
			}
		});
	}
	else if (t.classList.contains('partials-table-toggle')
			|| (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('partials-table-toggle'))) {
		if (t.classList.contains('partials-table-toggle'))
			t.classList.toggle('s');
		else if (t.parentNode && t.parentNode.classList) t.parentNode.classList.toggle('s');
		sel('.partials-table').style.display = sel('.partials-table').style.display === 'none' ? '' : 'none';
		
	}
	else if (t.classList.contains('analyzerOpen'))
		UI.analyzer.open();
	else if (t.classList.contains('close') && t?.parentNode?.parentNode?.id === 'analyzerOverlay')
		UI.analyzer.close();
	else if (t.classList.contains('playTimbre'))
		previewTimbre();
	else if (t.classList.contains('switch-T')) {
		if (t.classList.contains('switch-T')) {
			Canvas.partialBrightness = !Canvas.partialBrightness;
		}
	}
	else if (t.classList.contains('radio-selectionMode')) {
		var radioButtons = sel('.radio-selectionMode', true);
		var currentSelection = settings.orderedPartialsSelection || 0;
		if (radioButtons[currentSelection]) {
			radioButtons[currentSelection].classList.remove('selected');
		}
		settings.orderedPartialsSelection = parseInt(t.dataset.id);
		if (radioButtons[settings.orderedPartialsSelection]) {
			radioButtons[settings.orderedPartialsSelection].classList.add('selected');
		}
	}
	else if (t.classList.contains('setup-tab')) {
		t.blur();
		let selBtn = sel('.setup-tab.selected'),
			setupSections = sel('.setup-section', true);
		var oldTabId = parseInt(selBtn.dataset.id);
		var newTabId = parseInt(t.dataset.id);
		if (setupSections[oldTabId]) setupSections[oldTabId].style.display = 'none';
		if (setupSections[newTabId]) setupSections[newTabId].style.display = 'block';
		selBtn.classList.remove('selected');
		t.classList.add('selected');

		var tuningListContainer = sel('.tuning-list-container');
		var timbreListContainer = sel('.timbre-list-container');
		var gridListContainer = sel('.grid-list-container');
		if (tuningListContainer) tuningListContainer.style.display = (newTabId === 0) ? 'block' : 'none';
		if (timbreListContainer) timbreListContainer.style.display = (newTabId === 1) ? 'block' : 'none';
		if (gridListContainer) gridListContainer.style.display = (newTabId === 2) ? 'block' : 'none';
		
		if (newTabId === 1) {
			setTimeout(() => {
				if (typeof EnvelopeUI !== 'undefined' && EnvelopeUI._resizeCanvas) {
					EnvelopeUI._resizeCanvas();
				}
				if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan && DynamicTimbre.partialPan._resizeCurveCanvas) {
					DynamicTimbre.partialPan._resizeCurveCanvas();
				}
			}, 50);
		}
	}
	else if (t.classList.contains('io-tab')) {
		t.blur();
		let selBtn = sel('.io-tab.selected'),
			ioSections = sel('.io-section', true);
		if (selBtn) {
			ioSections[parseInt(selBtn.dataset.id)].style.display = 'none';
			selBtn.classList.remove('selected');
		}
		ioSections[parseInt(t.dataset.id)].style.display = 'block';
		t.classList.add('selected');
		
		if (t.dataset.id === '3' && typeof SpatialImager !== 'undefined') {
			setTimeout(() => SpatialImager.refresh(), 50);
		}
	}
	else if (t.classList.contains('delete-all')) {
		(async () => {
			if (await showConfirm('Are you sure?\n\nThis will delete all your data!', { title: 'Delete All Data', type: 'danger', confirmText: 'Delete All' })) {
				localStorage.clear();
				t.blur();
			}
		})();
	}
	else if (t.classList.contains('delete-except-settings')) {
		(async () => {
			if (await showConfirm('Are you sure?\n\nThis will delete all notes, instruments, tunings, and timbres in the current project, but keep your settings.', { title: 'Reset Project', type: 'danger', confirmText: 'Reset' })) {
				if (typeof ProjectManager !== 'undefined' && ProjectManager.currentProjectId) {
					window.MIDI.data = [[]];
					window.instruments = [{
						name: 'Track 1',
						spectrum: DEFAULT_SPECTRUM,
						color: '#eba52c',
						fundamentalColor: '#eba52c',
						selected: true
					}];
					window.scales = ProjectManager.createDefaultScales();
					window.spectra = ProjectManager.createDefaultSpectra();
					window.grids = ProjectManager.createDefaultGrids();
					window.trackEvents = {};

					if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
						DB.calculateOrderedPartials();
					}

					ProjectManager.saveCurrentProject();
					UI.instruments.refresh();
					loadSynths();
				} else {
					// Staršie nastavenia sa prenesú z localStorage a ten sa potom vyprázdni.
					var currentSettings = DB.get('settings');
					localStorage.clear();
					if (currentSettings) {
						DB.set('settings', currentSettings);
					}
					location.reload();
				}
			}
		})();
	}
	else if (t.classList.contains('playback-options-menu-item')) {
		playbackUIPlay.dataset.type = t.dataset.type;
		sel('.playback-options-menu-item', true).forEach(el => {
			el.classList.remove('selected');
		});
		t.classList.add('selected');
		sel('.playback-options-menu').style.display = 'none';
		settingsList = DB.get('settings');
		settingsList.playbackType = t.dataset.type;
		DB.set('settings', settingsList);
	}
	else if (t.classList.contains('playback-options-caret')) {
		playbackUIMenu.style.display = playbackUIMenu.style.display === 'none' ? '' : 'none';
	}
	else if (t.classList.contains('playback-tostart') || t.closest?.('.playback-tostart')) {
		playback.time = 0;
		playback.midiTime = 0;
		playback.timeOld = 0;
		if (typeof Canvas !== 'undefined') Canvas.keepPlayheadInView();
		var tostartBtn = t.classList.contains('playback-tostart') ? t : t.closest('.playback-tostart');
		tostartBtn.blur();
		Canvas.canvas.focus();
	}
	else if (t.classList.contains('playback-stop-button')) {
		if (!playback.playing) return;
		
		togglePlayback();
		t.blur();
		Canvas.canvas.focus();
	}
	else if (t.classList.contains('playback-play')) {
		togglePlayback();
		t.blur();
		Canvas.canvas.focus();
	}
	else if (t.classList.contains('ui-choice-option')) {
		t.parentNode.querySelectorAll('.ui-choice-option').forEach(el => {
			el.classList.remove('selected');
		});
		t.classList.add('selected');
		if (t.parentNode.classList.contains('export-from-tracks')) {
			sel('.export-tracks-custom').style.display = t.dataset.value === 'custom' ? 'block' : 'none';
		} else if (t.parentNode.classList.contains('export-from-partials')) {
			sel('.export-partials-custom').style.display = t.dataset.value === 'custom' ? 'block' : 'none';
		} else if (t.parentNode.classList.contains('export-format')) {
			if (typeof UI !== 'undefined' && UI.export && UI.export.updateMusicXMLOptions) {
				UI.export.updateMusicXMLOptions();
			}
			if (typeof UI !== 'undefined' && UI.export && UI.export.applyDefaultPartialsForFormat) {
				UI.export.applyDefaultPartialsForFormat(t.dataset.value);
			}
		} else if (t.parentNode.classList.contains('musicxml-quantize')) {
			if (typeof UI !== 'undefined' && UI.export && UI.export.updateQuantizeTuningSelect) {
				UI.export.updateQuantizeTuningSelect();
			}
		}
	}
	else if (t.classList.contains('export-button')) {
		UI.export.doExport();
	}
	else if (t.classList.contains('export-select-all-tracks')) {
		var isChecked = t.checked;
		sel('.export-track-checkbox', true).forEach(cb => {
			cb.checked = isChecked;
		});
	}
	else if (t.classList.contains('export-track-checkbox')) {
		var allCheckboxes = sel('.export-track-checkbox', true);
		var allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
		sel('.export-select-all-tracks').checked = allChecked;
	}
	// Ovládacie prvky priblíženia a posunu celého plátna.
	else if (t.classList.contains('canvas-nav-btn') || t.closest('.canvas-nav-btn')) {
		var btn = t.classList.contains('canvas-nav-btn') ? t : t.closest('.canvas-nav-btn');
		var id = btn.id;
		var zoomFactor = 1.2;
		var panAmount = 100; // Pixely

		switch (id) {
			case 'zoom-h-in':
				barSize = Math.min(5000, barSize * zoomFactor);
				Canvas.barlinesOffx = Canvas.offx % barSize;
				debouncedSaveViewState();
				break;
			case 'zoom-h-out':
				barSize = Math.max(5, barSize / zoomFactor);
				Canvas.barlinesOffx = Canvas.offx % barSize;
				debouncedSaveViewState();
				break;
			case 'zoom-v-in':
				octaveSpacing = Math.min(4000, octaveSpacing * zoomFactor);
				octaveSpacingStep = octaveSpacing / 12;
				debouncedSaveViewState();
				break;
			case 'zoom-v-out':
				octaveSpacing = Math.max(20, octaveSpacing / zoomFactor);
				octaveSpacingStep = octaveSpacing / 12;
				debouncedSaveViewState();
				break;
			case 'nav-left':
				Canvas.offx += panAmount;
				Canvas.barlinesOffx = Canvas.offx % barSize;
				debouncedSaveViewState();
				break;
			case 'nav-right':
				Canvas.offx -= panAmount;
				Canvas.barlinesOffx = Canvas.offx % barSize;
				debouncedSaveViewState();
				break;
			case 'nav-up':
				Canvas.offy += panAmount;
				debouncedSaveViewState();
				break;
			case 'nav-down':
				Canvas.offy -= panAmount;
				debouncedSaveViewState();
				break;
		}
		btn.blur();
		if (Canvas.canvas) Canvas.canvas.focus();
	}
	else {
		if (!t.classList?.contains('playback-options-menu')
				&& (!t.parentNode?.classList?.contains('playback-options-menu')))
			playbackUIMenu.style.display = 'none';
	}
}, false);
document.addEventListener('change', e => {
	var t = e.target;

	if (t.id === 'switch-checkbox-magnet') {
		Canvas.magnetMode = t.checked;
	}

	if (t.tagName && t.tagName.toLowerCase() === 'select') {
		if (t.classList.contains('default-scale')) {
			let settingsList = DB.get('settings'),
				scalesList = DB.get('scales'),
				scalesListKeys = scalesList ? Object.keys(scalesList) : [];
			settingsList.scale = scalesListKeys[t.selectedIndex];
			DB.set('settings', settingsList);
			window.scale = settingsList.scale;
			window.scales = scalesList;

			var trackEventsList = DB.get('trackEvents') || {};
			for (const teIdx in trackEventsList) {
				var tcList = trackEventsList[teIdx].tuningChanges;
				if (!tcList) continue;
				var baseTc = tcList.find(tc => tc.time === 0);
				if (baseTc) baseTc.tuningKey = settingsList.scale;
				else tcList.push({ time: 0, tuningKey: settingsList.scale });
			}
			DB.set('trackEvents', trackEventsList);

			if (typeof AdaptiveTuning !== 'undefined') AdaptiveTuning.refresh();
			if (typeof Canvas !== 'undefined' && Canvas.refreshCache) Canvas.refreshCache();
		}
		else if (t.classList.contains('default-grid')) {
			let settingsList = DB.get('settings');
			settingsList.grid = t.value;
			DB.set('settings', settingsList);
		}
		else {
			t.dataset.mark = '1';
			sel('.pane-content .pane-instrument', true).forEach((paneInstrument, i3) => {
				paneInstrument.querySelectorAll('select').forEach(paneInstrumentSelect => {
					if (paneInstrumentSelect.dataset.mark === '1') {
						paneInstrumentSelect.dataset.mark = null;
						// Index stopy je v i3.
						var instrumentList = DB.get('instruments'),
							spectraList = DB.get('spectra');

						// Uloží sa stav pred zmenou kvôli kroku vzad.
						var beforeInstruments = structuredClone(instrumentList);

						instrumentList[i3].spectrum = (spectraList ? Object.keys(spectraList) : [])[t.selectedIndex];
						DB.set('instruments', instrumentList, { skipUndo: true });

						if (typeof UndoManager !== 'undefined') {
							UndoManager.recordSnapshot('Change track timbre', ['instruments'],
								{ instruments: beforeInstruments },
								{ instruments: structuredClone(instrumentList) }
							);
						}

						instruments = instrumentList;

						// Opätovné vytvorenie syntetizátora sa odloží na ďalší snímok, aby UI odpovedalo okamžite.
						var trackIdx = i3;
						requestAnimationFrame(() => {
							if (window.synths && window.synths[trackIdx]) {
								window.synths[trackIdx].releaseAll();
							}

							// Všetky noty sa označia ako neznejúce, aby ich cyklus prehrávania znovu spustil.
							if (MIDI.data[trackIdx]) {
								for (let j = 0; j < MIDI.data[trackIdx].length; j++) {
									if (MIDI.data[trackIdx][j][4]) {
										MIDI.data[trackIdx][j][4].playing = false;
									}
								}
							}
							// Starý syntetizátor sa zruší a vytvorí sa nový s aktualizovanou farbou.
							if (window.synths && window.synths[trackIdx]) {
								window.synths[trackIdx].dispose();
							}

							var timbre = spectraList[instrumentList[trackIdx].spectrum];
							// Stredné C (60) sa použije ako referenčná výška pre parciály.
							var partialsData = typeof DynamicTimbre !== 'undefined'
								? DynamicTimbre.getPartialsAtPitch(timbre, 60)
								: getTimbrePartials(timbre, 60);
							var spectraPartials = partialsData.map(m => {return m[1]});

							if (!window.trackPanners) window.trackPanners = [];
							if (!window.trackPanners[trackIdx]) {
								var pan = (instrumentList[trackIdx] && instrumentList[trackIdx].pan) || 0;
								window.trackPanners[trackIdx] = new Tone.Panner(pan).connect(masterLimiter || Tone.Destination);
							}

							var env = timbre?.envelope || {};
							var envAttack = env.a !== undefined ? env.a : 0.01;
							var envDecay = env.d !== undefined ? env.d : 0.1;
							var envSustain = env.s !== undefined ? env.s : 0.8;
							var envRelease = env.r !== undefined ? env.r : 0.3;

							if (!window.synths) window.synths = [];
							window.synths[trackIdx] = new Tone.PolySynth({
								volume: (instrumentList[trackIdx] && instrumentList[trackIdx].volume) || -12
							}).connect(window.trackPanners[trackIdx]);

							window.synths[trackIdx].set({
								oscillator: {
									type: 'custom',
									partials: spectraPartials
								},
								envelope: {
									attack: envAttack,
									decay: envDecay,
									sustain: envSustain,
									release: envRelease
								}
							});

							// Ak stopa hrá, znovu sa spustí, aby zvuk zodpovedal novej farbe.
							if (typeof PlaybackManager !== 'undefined') {
								PlaybackManager.retriggerTrack(trackIdx);
							}
						});

					}
				});
			});
		}
	}
	// colorPicker
	if (t.id === 'c') {
		// Index stopy je v i3.
		var instrumentList = DB.get('instruments');
		instrumentList[parseInt(c.dataset.instrumentId)].color = t.value;
		instrumentList[parseInt(c.dataset.instrumentId)].fundamentalColor = t.value;
		var instrumentStripSelected = sel('.pane-instrument-strip-selected');
		instrumentStripSelected.style.background = t.value;
		DB.set('instruments', instrumentList);
		instrumentStripSelected.classList.remove('pane-instrument-strip-selected');
	}
	if (t.classList.contains('playback-pitch-input')) {
		let settingsList = DB.get('settings');
		settingsList.playbackPitch = parseFloat(t.value) || 0;
		DB.set('settings', settingsList);
		window.playbackPitch = settingsList.playbackPitch;
		if (typeof setPlaybackPitch === 'function') {
			setPlaybackPitch(settingsList.playbackPitch);
		}
	}
	if (t.classList.contains('midiPitchCenterInput')) {
		let settingsList = DB.get('settings');
		settingsList.midiPitchCenter = parseInt(t.value) || 69;
		DB.set('settings', settingsList);
		window.midiPitchCenter = settingsList.midiPitchCenter;
	}
	if (t.classList.contains('partialLimitInput')) {
		let settingsList = DB.get('settings');
		settingsList.partialLimit = parseInt(t.value) || 0;
		DB.set('settings', settingsList);
		window.partialLimit = settingsList.partialLimit;
	}
	if (t.classList.contains('performanceModeToggle')) {
		let settingsList = DB.get('settings');
		settingsList.performanceMode = t.checked;
		DB.set('settings', settingsList);
		if (typeof Canvas !== 'undefined' && Canvas.applyPerformanceMode) {
			Canvas.applyPerformanceMode(t.checked);
		}
	}
	if (t.classList.contains('audio-latency-input')) {
		let settingsList = DB.get('settings');
		var ms = parseFloat(t.value) || 0;
		settingsList.audioLatency = ms;
		DB.set('settings', settingsList);
		// Nastaví sa aj AUDIO_LATENCY_OVERRIDE, aby measureLatency() (prvé prehratie) rešpektovala manuálnu hodnotu.
		window.AUDIO_LATENCY_OVERRIDE = ms / 1000;
		if (typeof PlaybackManager !== 'undefined' && PlaybackManager.setLatency) {
			PlaybackManager.setLatency(ms);
		}
	}
	if (t.classList.contains('load-midi')) {
		var selectedFile = t.files[0];
		if (!selectedFile) return;

		var reader = new FileReader();
		var fileName = selectedFile.name.toLowerCase();
		var isMIDI = fileName.endsWith('.mid') || fileName.endsWith('.midi');
		var isSpectraProject = fileName.endsWith('.spectra');

		var startOverlay = document.getElementById('startOverlay');
		var isStartScreen = startOverlay && startOverlay.style.display !== 'none';

		if (isMIDI) {
			reader.onload = async function(event) {
				if (isStartScreen) {
					var projectName = selectedFile.name.replace(/\.(mid|midi)$/i, '');
					try {
						var projectId = await ProjectManager.createNewProject(projectName);

						// Načítanie projektu inicializuje aj audio a syntetizátory.
						await ProjectManager.handleOpenProject(projectId);

						const success = loadMIDIFile(event.target.result, {
							MIDI,
							DB,
							UI,
							instruments,
							showStatus
						});
						if (success) {
							Logger.log('MIDI file loaded into new project');
							UI.instruments.refresh();
							if (typeof Timeline !== 'undefined') Timeline.draw();
							Canvas.step();
						}
					} catch (error) {
						Logger.error('Error creating project for MIDI:', error);
						showStatus('Error loading MIDI file: ' + error.message, { type: 'error' });
					}
				} else {
					const success = loadMIDIFile(event.target.result, {
						MIDI,
						DB,
						UI,
						instruments,
						showStatus
					});
					if (success) {
						Logger.log('MIDI file loaded successfully');
					}
				}
				t.value = '';
			};
			reader.readAsArrayBuffer(selectedFile);
		} else if (isSpectraProject) {
			reader.onload = async function(event) {
				if (isStartScreen) {
					var projectName = selectedFile.name.replace(/\.spectra(\.json)?$/i, '');
					try {
						var projectId = await ProjectManager.createNewProject(projectName);
						await ProjectManager.handleOpenProject(projectId);
						importProject(event.target.result);
					} catch (error) {
						Logger.error('Error creating project for Spectra file:', error);
						showStatus('Error loading project: ' + error.message, { type: 'error' });
					}
				} else {
					importProject(event.target.result);
				}
				t.value = '';
			};
			reader.readAsText(selectedFile);
		} else {
			// Načíta sa ako JSON súbor, ktorý môže byť celý projekt alebo len MIDI dáta.
			reader.onload = async function(event) {
				try {
					var jsonData = JSON.parse(event.target.result);

					if (jsonData.midiData || jsonData.instruments || jsonData.scales) {
						if (isStartScreen) {
							const projectName = selectedFile.name.replace(/\.json$/i, '');
							try {
								const projectId = await ProjectManager.createNewProject(projectName);
								await ProjectManager.handleOpenProject(projectId);
								importProject(jsonData);
							} catch (error) {
								Logger.error('Error creating project for JSON:', error);
								showStatus('Error loading project: ' + error.message, { type: 'error' });
							}
						} else {
							importProject(jsonData);
						}
					} else {
						// Starší formát obsahuje len MIDI dáta.
						if (isStartScreen) {
							const projectName = selectedFile.name.replace(/\.json$/i, '');
							try {
								const projectId = await ProjectManager.createNewProject(projectName);
								await ProjectManager.handleOpenProject(projectId);
								MIDI.data = jsonData.data || jsonData;
								DB.set('MIDIdata', MIDI.data);
							} catch (error) {
								Logger.error('Error creating project for legacy JSON:', error);
								showStatus('Error loading file: ' + error.message, { type: 'error' });
							}
						} else {
							MIDI.data = jsonData.data || jsonData;
							DB.set('MIDIdata', MIDI.data);
						}
						Logger.log('JSON file loaded successfully');
					}
				} catch (error) {
					Logger.error('Error loading JSON file:', error);
					showStatus('Error loading JSON file: ' + error.message, { type: 'error' });
				}
				t.value = '';
			};
			reader.readAsText(selectedFile);
		}
	}
	UI.checkNameChange(e);
});
document.addEventListener('keypress', (e) => {
	UI.checkNameChange(e);
});
async function togglePlayback() {
	playback.playing = !playback.playing;
	playbackUIPlay.dataset.playing = playback.playing;
	playback.timestamp = Date.now();
	playbackUIPlay.querySelector('i').classList.toggle('fa-play');
	playbackUIPlay.querySelector('i').classList.toggle('fa-pause');

	if (playback.playing) {
		// AudioWorklet musí byť pripravený skôr, než sa spustí prvá nota.
		if (!PlaybackManager.workletReady && !PlaybackManager.workletInitFailed) {
			try {
				await PlaybackManager.initWorklet();
			} catch (e) {
				Logger.warn('Worklet init during play failed:', e);
			}
		}
		if (ctrlKey) playback.time = playback.timeOld;
		playback.timeOld = playback.time;
		if (typeof WebMIDI !== 'undefined' && WebMIDI.transportSync?.enabled) {
			WebMIDI.sendTransport('start', playback.time);
		}
		if (typeof SpectraOSC !== 'undefined') {
			SpectraOSC.sendTransportStart(playback.time);
		}
	} else {
		if (typeof window.midiRecording !== 'undefined' && window.midiRecording && window.midiRecording.active) {
			window.midiRecording.stop();
		}
		playback.midiTime = playback.time;
		var now = Tone.now();
		for (let i = 0; i < MIDI.data.length; i++) {
			if (window.synths && window.synths[i]) window.synths[i].releaseAll(now);
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j][4]?.playing) {
					MIDI.data[i][j][4].playing = false;
					if (typeof OSC !== 'undefined') OSC.send.noteOff(i, MIDI.data[i][j]);
				}
			}
		}
		debouncedSaveViewState();
		if (typeof WebMIDI !== 'undefined' && WebMIDI.transportSync?.enabled) {
			WebMIDI.sendTransport('stop', playback.time);
		}
		if (typeof SpectraOSC !== 'undefined') {
			SpectraOSC.sendTransportStop(playback.time);
		}
		if (playbackUIPlay.dataset.type === 'return') playback.time = playback.timeOld;
	}
}
document.addEventListener('keydown', e => {

	var isInInput = e.target && e.target.tagName &&
		(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) &&
		!e.target.readOnly;

	// Skratky, ktoré musia fungovať aj v inputoch, bez výnimky: Ctrl+1/2/3 (navigácia), Ctrl+S (uložiť)
	// 49=1, 50=2, 51=3, 83=S.
	var isNavigationShortcut = (e.ctrlKey || e.metaKey) && (e.keyCode === 49 || e.keyCode === 50 || e.keyCode === 51);
	var isSaveShortcut = (e.ctrlKey || e.metaKey) && e.keyCode === 83;

	// Ak je aktívne vstupné pole a nejde o navigačnú skratku ani o skratku na uloženie, ponechá sa to na prehliadači (kvôli úprave textu).
	if (isInInput && !isNavigationShortcut && !isSaveShortcut) {
		return;
	}

	if (window.computerKeyboardMode && !(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
		var ckKey = e.key?.toLowerCase();
		if (ckKey && ckKey.length === 1 && ckKey >= 'a' && ckKey <= 'z' && ckKey !== 'm') {
			return;
		}
	}

	if (Spectra.callHooks('keyDown', e, { shiftKey: shiftKey, ctrlKey: ctrlKey, altKey: altKey })) {
		shiftKey = e.shiftKey;
		altKey = e.altKey;
		ctrlKey = (e.ctrlKey || e.metaKey);
		return;
	}

	// Ctrl+1/2/3 na prepínanie záložiek musí fungovať vždy
	// 49=1, 50=2, 51=3.
	if ((e.ctrlKey || e.metaKey) && (e.keyCode === 49 || e.keyCode === 50 || e.keyCode === 51)) {
		e.preventDefault();
		var buttons = sel('.header-section-tabs .header-button[data-page]', true);
		if (e.keyCode === 49 && buttons[0]) buttons[0].click(); // I/O
		else if (e.keyCode === 50 && buttons[1]) buttons[1].click(); // Setup
		else if (e.keyCode === 51 && buttons[2]) buttons[2].click(); // Write
		return;
	}

	// Ctrl+Z - Undo (90=Z).
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.keyCode === 90) {
		e.preventDefault();
		if (typeof UndoManager !== 'undefined') {
			UndoManager.undo();
		}
		return;
	}

	// Ctrl+Y alebo Ctrl+Shift+Z - Redo (89=Y, 90=Z).
	if (((e.ctrlKey || e.metaKey) && e.keyCode === 89) || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.keyCode === 90)) {
		e.preventDefault();
		if (typeof UndoManager !== 'undefined') {
			UndoManager.redo();
		}
		return;
	}

	// Ctrl+Shift+K spustí panic pre MIDI aj zvuk a zastaví všetky znejúce noty (75=K).
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.keyCode === 75) {
		e.preventDefault();
		// Zastavia sa všetky noty z PlaybackManager, teda z AudioWorkletu aj z Tone.js.
		if (typeof PlaybackManager !== 'undefined') {
			PlaybackManager.stopAll();
		}
		// Použije sa dôkladný MIDI panic predprehrávania (rieši midiOscillators, allMidiOscillators,
		// nativeMasterBus, synths, midiNoteMapping, midiInputPreview).
		if (typeof window.midiPreviewPanic === 'function') {
			window.midiPreviewPanic();
		}
		if (typeof WebMIDI !== 'undefined' && WebMIDI.sendPanic) {
			WebMIDI.sendPanic();
		}
		if (typeof OSC !== 'undefined' && OSC.send && OSC.send.panic) {
			OSC.send.panic();
		}
		// Zastavia sa oscilátory predprehrávania v Canvase.
		if (typeof Canvas !== 'undefined') {
			if (Canvas._dragPreviewOsc) {
				try { Canvas._dragPreviewOsc.stop(); } catch(e) {}
				Canvas._dragPreviewOsc = null;
				Canvas._dragPreviewGain = null;
			}
			if (Canvas._partialPreviewOsc) {
				try { Canvas._partialPreviewOsc.stop(); } catch(e) {}
				Canvas._partialPreviewOsc = null;
				Canvas._partialPreviewGain = null;
			}
			if (Canvas._zoomSynth) {
				try { Canvas._zoomSynth.releaseAll(); } catch(e) {}
			}
			if (Canvas._previewSynth) {
				try { Canvas._previewSynth.releaseAll(); } catch(e) {}
			}
		}
		if (typeof showStatus === 'function') showStatus('All notes killed', { type: 'info' });
		return;
	}

	// Ctrl+C/V/X/S musia fungovať vždy, nezávisle od toho, čo je momentálne aktívne (67=C, 86=V, 88=X, 83=S).
	var isGlobalShortcut = (e.ctrlKey || e.metaKey) && (e.keyCode === 67 || e.keyCode === 86 || e.keyCode === 88 || e.keyCode === 83);

	if (!isGlobalShortcut && e.target && e.target.tagName) {
		var tag = e.target.tagName.toLowerCase();
		if (tag !== 'body' && tag !== 'canvas' && !e.target.readOnly) return;
	}


	if ((e.shiftKey || (e.ctrlKey || e.metaKey)) && pageNumber === 2) {
		e.preventDefault();
		e.stopPropagation();
	}
	
	// Zistí sa, či bol práve stlačený Ctrl (kvôli tooltipu).
	var ctrlJustPressed = (e.ctrlKey || e.metaKey) && !ctrlKey;

	shiftKey = e.shiftKey;
	altKey = e.altKey;
	ctrlKey = (e.ctrlKey || e.metaKey);

	// Pri stlačení Ctrl sa znovu skontroluje, čo je pod kurzorom, kvôli tooltipu.
	if (ctrlJustPressed && select.offsetX && select.offsetY) {
		Canvas.checkPartialHover(select.offsetX, select.offsetY);
	}

	// Del / Backspace.
	if (e.keyCode === 46 || e.keyCode === 8) {
		Canvas.deletePartials();
	}
	else if (e.keyCode === 36) {
		e.preventDefault();
		playback.time = 0;
		playback.midiTime = 0;
		playback.timeOld = 0;
		if (typeof Canvas !== 'undefined') Canvas.keepPlayheadInView();
	}
	// Pri Ctrl+Up sa vyberie najbližší vyšší parciál pri vybraných notách.
	else if (e.keyCode === 38 && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
		e.preventDefault();
		Canvas.shiftPartialSelection(1);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Pri Ctrl+Down sa vyberie najbližší nižší parciál pri vybraných notách.
	else if (e.keyCode === 40 && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
		e.preventDefault();
		Canvas.shiftPartialSelection(-1);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Pri Ctrl+Alt+Up sa vybrané noty posunú o 10 centov vyššie.
	else if (e.keyCode === 38 && (e.ctrlKey || e.metaKey) && e.altKey) {
		e.preventDefault();
		Canvas.nudgeSelectedNotes(0.1);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Pri Ctrl+Alt+Down sa vybrané noty posunú o 10 centov nižšie.
	else if (e.keyCode === 40 && (e.ctrlKey || e.metaKey) && e.altKey) {
		e.preventDefault();
		Canvas.nudgeSelectedNotes(-0.1);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Pri Alt+Up sa vybrané noty posunú o 1 cent vyššie.
	else if (e.keyCode === 38 && e.altKey) {
		e.preventDefault();
		Canvas.nudgeSelectedNotes(0.01);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Pri Alt+Down sa vybrané noty posunú o 1 cent nižšie.
	else if (e.keyCode === 40 && e.altKey) {
		e.preventDefault();
		Canvas.nudgeSelectedNotes(-0.01);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Hore
	else if (e.keyCode === 38 && !bypass.up) {
		Canvas.movePartialUp(e);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Dole
	else if (e.keyCode === 40 && !bypass.down) {
		Canvas.movePartialDown(e);
		if (window['switch-checkbox-headphones'].checked) Canvas.previewChordPartials();
	}
	// Vľavo
	else if (e.keyCode === 37 && !bypass.left) {
		if (e.shiftKey && hasSelectedNotes()) {
			// Pri Shift+Left s vybranými notami sa noty skrátia.
			Canvas.movePartialLeft();
		} else if (e.shiftKey) {
			// Pri Shift+Left bez vybraných nôt sa skočí na predchádzajúcu udalosť na časovej osi.
			moveCursorToPreviousEvent();
		} else if (hasSelectedNotes()) {
			Canvas.movePartialLeft();
		} else {
			// Ak nie sú vybrané žiadne noty, kurzor sa presunie na predchádzajúcu čiaru mriežky.
			moveCursorToPreviousGridStep();
		}
	}
	// Vpravo
	else if (e.keyCode === 39 && !bypass.right) {
		if (e.shiftKey && hasSelectedNotes()) {
			// Pri Shift+Right s vybranými notami sa noty predĺžia.
			Canvas.movePartialRight();
		} else if (e.shiftKey) {
			// Pri Shift+Right bez vybraných nôt sa skočí na nasledujúcu udalosť na časovej osi.
			moveCursorToNextEvent();
		} else if (hasSelectedNotes()) {
			Canvas.movePartialRight();
		} else {
			// Ak nie sú vybrané žiadne noty, kurzor sa presunie na nasledujúcu čiaru mriežky.
			moveCursorToNextGridStep();
		}
	}
	// Shift+Q kvantizuje vybrané noty na aktuálne ladenie.
	else if (e.shiftKey && !(e.ctrlKey || e.metaKey) && e.keyCode === 81) {
		e.preventDefault();
		Canvas.quantizeToTuning();
	}
	// Q kvantizuje vybrané noty na aktuálnu mriežku (bez Shift).
	else if (!e.shiftKey && !(e.ctrlKey || e.metaKey) && e.keyCode === 81) {
		e.preventDefault();
		Canvas.quantizeToGrid();
	}
	// Shift+T vytvorí zmenu ladenia na pozícii hlavy prehrávania.
	else if (e.shiftKey && !ctrlKey && e.keyCode === 84) {
		e.preventDefault();
		if (typeof Timeline !== 'undefined') {
			Timeline.createEventAtPlayhead('tuning');
		}
	}
	// T prepne viditeľnosť parciálov (bez Shift).
	else if (!e.shiftKey && e.keyCode === 84) {
		Canvas.partialBrightness = !Canvas.partialBrightness;
		document.getElementById("switch-checkbox-T").checked = !document.getElementById("switch-checkbox-T").checked;
	}
	// Shift+M vytvorí marker na pozícii hlavy prehrávania.
	else if (e.shiftKey && !ctrlKey && e.keyCode === 77) {
		e.preventDefault();
		if (typeof Timeline !== 'undefined') {
			Timeline.createEventAtPlayhead('markers');
		}
	}
	// Shift+G vytvorí udalosť mriežky na pozícii hlavy prehrávania.
	else if (e.shiftKey && !ctrlKey && e.keyCode === 71) {
		e.preventDefault();
		if (typeof Timeline !== 'undefined') {
			Timeline.createEventAtPlayhead('grid');
		}
	}
	// U prepína režim magnetu.
	else if (e.keyCode === 85 && !e.shiftKey) {
		Canvas.magnetMode = !Canvas.magnetMode;
		document.getElementById("switch-checkbox-magnet").checked = Canvas.magnetMode;
	}
	// M prepína režim Computer Keyboard.
	else if (e.keyCode === 77 && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
		const checkbox = document.getElementById('switch-checkbox-computer-keyboard');
		if (checkbox) {
			checkbox.checked = !checkbox.checked;
			checkbox.dispatchEvent(new Event('change'));
		}
	}
	// L prepne zámok na vybraných parciáloch.
	else if (e.keyCode === 76 && !ctrlKey) {
		Canvas.togglePartialLock();
	}
	else if (e.keyCode === 82 && !(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
		if (window.midiRecording && window.midiRecording.toggle) window.midiRecording.toggle();
	}
	// P prehrá základné tóny vybraných nôt.
	else if (e.keyCode === 80) {
		Canvas.previewChord();
	}
	// O prehrá parciály vybraných nôt.
	else if (e.keyCode === 79) {
		Canvas.previewChordPartials();
	}
	// H prepne posluch.
	else if (e.keyCode === 72) {
		const checkbox = sel('#switch-checkbox-headphones');
		if (checkbox) {
			checkbox.checked = !checkbox.checked;
		}
	}
	// Medzerník prepína prehrávanie a pauzu.
	else if (e.keyCode === 32) {
		e.preventDefault();
		togglePlayback();
	}
	else if (e.keyCode === 83 && !(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
		e.preventDefault();
		if (typeof Canvas !== 'undefined' && Canvas.splitAtPlayhead) Canvas.splitAtPlayhead();
	}
	// Ctrl + A vyberie všetky noty vo vybraných stopách.
	else if (ctrlKey && e.keyCode === 65) {
		e.preventDefault();

		// Najprv sa zruší výber všetkých nôt vo všetkých stopách.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				const note = MIDI.data[i][j];
				if (note.length < 5 || !note[N_DATA] || !note[N_DATA].partials) continue;
				for (let k = 0; k < note[N_DATA].partials.length; k++) {
					note[N_DATA].partials[k][P_SEL] = 0;
				}
			}
		}

		// Vyberie sa aktívny parciál každej noty vo všetkých vybraných stopách.
		for (let i = 0; i < instruments.length; i++) {
			if (!instruments[i].selected) continue;
			if (!MIDI.data[i]) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				const note = MIDI.data[i][j];
				if (note.length < 5 || !note[N_DATA] || !note[N_DATA].partials) continue;

				var activePartialIdx = note[N_PARTIAL] - 1; // N_PARTIAL je indexovaný od 1.
				if (activePartialIdx >= 0 && activePartialIdx < note[N_DATA].partials.length) {
					note[N_DATA].partials[activePartialIdx][P_SEL] = 1;
				}
			}
		}
	}
	// Ctrl + C.
	else if (ctrlKey && e.keyCode === 67) {
		// Nájdu sa všetky vybrané noty a skopírujú sa do schránky.
		let clipboard = [];
		let earliestTime = Infinity;

		// V prvom kole sa nájde najskorší začiatok medzi vybranými notami.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;

				const partials = MIDI.data[i][j][4].partials;
				let isSelected = false;
				for (let k = 0; k < partials.length; k++)
					if (partials[k][4]) {
						isSelected = true;
						break;
					}

				if (isSelected) {
					earliestTime = Math.min(earliestTime, MIDI.data[i][j][0]);
				}
			}
		}
		
		// V druhom kole sa zozbierajú všetky vybrané noty s relatívnym načasovaním.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;

				const partials = MIDI.data[i][j][4].partials;
				let isSelected = false;
				for (let k = 0; k < partials.length; k++) {
					if (partials[k][4]) {
						isSelected = true;
						break;
					}
				}

				if (isSelected) {
					// Uloží sa kópia s relatívnym časovým posunom.
					const noteCopy = structuredClone(MIDI.data[i][j]);
					clipboard.push({
						instrumentIndex: i,
						relativeTime: MIDI.data[i][j][0] - earliestTime,
						note: noteCopy
					});
				}
			}
		}

		if (clipboard.length > 0) {
			select.clipboard = clipboard;
			Logger.log(`Copied ${clipboard.length} note(s) to clipboard`);
		}
	}
	// Ctrl + X.
	else if (ctrlKey && e.keyCode === 88) {
		// Vystrihnutie je kopírovanie a zmazanie.
		let clipboard = [];
		let earliestTime = Infinity;

		// Najprv sa nájde úplný začiatok medzi vybranými notami.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;
				
				const partials = MIDI.data[i][j][4].partials;
				let isSelected = false;
				for (let k = 0; k < partials.length; k++) {
					if (partials[k][4]) {
						isSelected = true;
						break;
					}
				}
				
				if (isSelected) {
					earliestTime = Math.min(earliestTime, MIDI.data[i][j][0]);
				}
			}
		}
		
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;

				const partials = MIDI.data[i][j][4].partials;
				let isSelected = false;
				for (let k = 0; k < partials.length; k++) {
					if (partials[k][4]) {
						isSelected = true;
						break;
					}
				}

				if (isSelected) {
					const noteCopy = structuredClone(MIDI.data[i][j]);
					clipboard.push({
						instrumentIndex: i,
						relativeTime: MIDI.data[i][j][0] - earliestTime,
						note: noteCopy
					});
				}
			}
		}

		if (clipboard.length > 0) {
			select.clipboard = clipboard;
			// Zmažú sa vybrané noty; deletePartials si zaznamenáva vlastný záznam kroku vzad.
			Canvas.deletePartials();
			Logger.log(`Cut ${clipboard.length} note(s) to clipboard`);
		}
	}
	// Ctrl + V.
	else if (ctrlKey && e.keyCode === 86) {
		if (!select.clipboard || select.clipboard.length === 0) {
			Logger.log('Clipboard is empty');
			return;
		}

		// Najprv sa zruší výber všetkých aktuálne vybraných nôt.
		for (let i = 0; i < MIDI.data.length; i++) {
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;
				
				const partials = MIDI.data[i][j][4].partials;
				for (let k = 0; k < partials.length; k++) {
					partials[k][4] = 0;
					partials[k][5] = 0;
				}
			}
		}
		
		var beforePaste = structuredClone(MIDI.data);
		var pasteTime = playback.time;

		var selectedInstrumentIndex = 0;
		for (let i = 0; i < instruments.length; i++) {
			if (instruments[i].selected) {
				selectedInstrumentIndex = i;
				break;
			}
		}

		for (let clipItem of select.clipboard) {
			var newNote = structuredClone(clipItem.note);
			var newTime = pasteTime + clipItem.relativeTime;

			newNote[0] = newTime;

			// Aktualizujú sa pozície všetkých parciálov, kde x-súradnica je čas * barSize.
			if (newNote[4] && newNote[4].partials) {
				for (let k = 0; k < newNote[4].partials.length; k++) {
					newNote[4].partials[k][0] = newTime;  // Ukladá sa v časových jednotkách.
				}
				var fundamentalIndex = newNote[3] - 1;
				if (fundamentalIndex >= 0 && fundamentalIndex < newNote[4].partials.length) {
					newNote[4].partials[fundamentalIndex][4] = 1;
					newNote[4].partials[fundamentalIndex][5] = 0;
				}
			}

			MIDI.data[selectedInstrumentIndex].push(newNote);
		}
		
		DB.set('MIDIdata', MIDI.data);
		if (typeof UndoManager !== 'undefined') {
			UndoManager.recordSnapshot('Paste notes', 'MIDIdata', { MIDIdata: beforePaste }, { MIDIdata: structuredClone(MIDI.data) });
		}
		Logger.log(`Pasted ${select.clipboard.length} note(s) at time ${pasteTime.toFixed(2)}`);
	}
	// Ctrl + S uloží projekt.
	else if (ctrlKey && e.keyCode === 83) {
		e.preventDefault();

		if (typeof DB !== 'undefined' && DB.useProjectManager && typeof ProjectManager !== 'undefined') {
			// Okamžité uloženie
			if (DB.autoSaveTimer) {
				clearTimeout(DB.autoSaveTimer);
				DB.autoSaveTimer = null;
			}

			var savePromise = ProjectManager.saveCurrentProject();

			savePromise.then(() => {
				showSaveNotification();
			}).catch(err => {
				Logger.error('Save failed:', err);
				showSaveNotification('Save failed!', true);
			});
		} else {
			// Inak sa len zobrazí oznámenie, keďže auto-save rieši localStorage.
			showSaveNotification();
		}
	}
	// Čísla 1 - 9.
	else if (!ctrlKey && e.code.includes("Digit") && parseInt(e.code[e.code.length - 1]) > 0
			&& parseInt(e.code[e.code.length - 1]) < 10) {
		var newSelection = parseInt(e.code[e.code.length - 1]) - 1;
		var radioButtons = sel('.radio-selectionMode', true);

		if (radioButtons && radioButtons.length > 0 && newSelection < radioButtons.length) {
			var currentSelection = settings.orderedPartialsSelection || 0;
			if (radioButtons[currentSelection]) {
				radioButtons[currentSelection].classList.remove('selected');
			}
			settings.orderedPartialsSelection = newSelection;
			radioButtons[settings.orderedPartialsSelection].classList.add('selected');
		}
	}
	else if (e.code === 'KeyD' && !(e.ctrlKey || e.metaKey) && !e.metaKey && !e.altKey) { 
		Canvas.duplicateNotes();
	}
});
document.addEventListener('keyup', e => {
	if (Spectra.callHooks('keyUp', e, { shiftKey: shiftKey, ctrlKey: ctrlKey, altKey: altKey })) {
		e.preventDefault();
		shiftKey = e.shiftKey;
		altKey = e.altKey;
		ctrlKey = (e.ctrlKey || e.metaKey);
		return;
	}

	// Po pustení Ctrl sa tooltip skryje.
	if (!(e.ctrlKey || e.metaKey) && ctrlKey) {
		hoverTooltip.visible = false;
	}

	shiftKey = e.shiftKey;
	altKey = e.altKey;
	ctrlKey = (e.ctrlKey || e.metaKey);
});
window.onload = async () => {
	await DB.init();
	UI.init(); // Inicializácia DOM prvkov podľa databázy.
	var MIDIdata = DB.get('MIDIdata');
	MIDI.data = MIDIdata;
	// Uložené nastavenie režimu Performance sa uplatní na plátne a premietne do prepínača.
	var perfMode = !!(window.settings && window.settings.performanceMode);
	if (Canvas.applyPerformanceMode) Canvas.applyPerformanceMode(perfMode);
	var perfToggle = document.querySelector('.performanceModeToggle');
	if (perfToggle) perfToggle.checked = perfMode;
	initVolumeControl();
	initMidiPartialModeButton();
	initComputerKeyboardMode();
	initBrightnessOffsetControl();
	// Inicializácia syntetizátorov
}
function loadSynths() {
	if (!window.synths) window.synths = [];

	// Existujúce syntetizátory a pannery sa odstránia.
	if (window.synths && window.synths.length > 0) {
		for (let i = 0; i < window.synths.length; i++) {
			if (window.synths[i]) {
				try {
					window.synths[i].releaseAll();
					window.synths[i].dispose();
				} catch (e) {
					// Chyby pri rušení sa ignorujú.
				}
			}
		}
		window.synths.length = 0; // Pole sa vyprázdni, referencia však zostane zachovaná.
	}
	if (window.trackPanners && window.trackPanners.length > 0) {
		for (let i = 0; i < window.trackPanners.length; i++) {
			if (window.trackPanners[i]) {
				try {
					window.trackPanners[i].dispose();
				} catch (e) {
					// Chyby pri rušení sa ignorujú.
				}
			}
		}
		window.trackPanners.length = 0;
	}

	if (!masterLimiter) {
		var ctx;
		if (Tone.context._context && Tone.context._context._nativeAudioContext) {
			ctx = Tone.context._context._nativeAudioContext;
		} else if (Tone.context._nativeAudioContext) {
			ctx = Tone.context._nativeAudioContext;
		} else if (Tone.context._nativeContext) {
			ctx = Tone.context._nativeContext;
		} else if (Tone.context._context) {
			ctx = Tone.context._context;
		} else if (Tone.context.rawContext) {
			ctx = Tone.context.rawContext;
		} else {
			ctx = Tone.context;
		}

		// Uloží sa globálne, aby všetky moduly používali rovnaký context.
		window.nativeAudioContext = ctx;

		// Zistí sa, či context má createGain, teda či ide o skutočný AudioContext.
		var canUseNativeNodes = ctx && typeof ctx.createGain === 'function';

		if (canUseNativeNodes) {
			try {
				var nativeMasterBus = ctx.createGain();
				nativeMasterBus.channelCount = 2;
				nativeMasterBus.channelCountMode = 'explicit';
				window.nativeMasterBus = nativeMasterBus;

				// Vytvorenie AnalyserNode na meranie namiesto Tone.Meter.
				var nativeAnalyser = ctx.createAnalyser();
				nativeAnalyser.fftSize = 2048;
				nativeAnalyser.smoothingTimeConstant = 0.8;
				window.nativeAnalyser = nativeAnalyser;

				// nativeMasterBus -> nativeAnalyser -> výstup.
				nativeMasterBus.connect(nativeAnalyser);
				nativeAnalyser.connect(ctx.destination);

				masterVolume = new Tone.Volume(masterVolumeValue);
				masterLimiter = new Tone.Limiter(-1).connect(masterVolume);

				// Výstup Tone.js sa prepojí na master bus.
				var toneOutput = masterVolume.output?._gainNode || masterVolume.output || masterVolume._gainNode;
				if (toneOutput && typeof toneOutput.connect === 'function') {
					toneOutput.connect(nativeMasterBus);
					Logger.log('Tone.js connected to native master bus');
				} else {
					masterVolume.toDestination();
					Logger.warn('Using Tone.js destination fallback');
				}

				masterMeter = nativeAnalyser;
			} catch (e) {
				Logger.warn('Native audio setup failed, using Tone.js fallback:', e.message, e.stack, e);
				masterVolume = new Tone.Volume(masterVolumeValue).toDestination();
				masterLimiter = new Tone.Limiter(-1).connect(masterVolume);
				masterMeter = new Tone.Meter({ smoothing: 0.8 });
				masterVolume.connect(masterMeter);
			}
		} else {
			Logger.log('Using Tone.js-only audio chain');
			masterVolume = new Tone.Volume(masterVolumeValue).toDestination();
			masterLimiter = new Tone.Limiter(-1).connect(masterVolume);
			masterMeter = new Tone.Meter({ smoothing: 0.8 });
			masterVolume.connect(masterMeter);
		}

		// Sprístupní sa na window kvôli prístupu z iných modulov, aj z workletu.
		window.masterLimiter = masterLimiter;
		window.masterVolume = masterVolume;
		window.masterMeter = masterMeter;

		requestAnimationFrame(updateMasterMeter);
	}
	var spectra = DB.get('spectra');
	var instruments = DB.get('instruments');
	if (!window.trackPanners) window.trackPanners = [];
	if (!MIDI.data) return;
	for (let i=0; i < MIDI.data.length; i++) {
		var pan = (instruments[i] && instruments[i].pan) || 0;
		var panner = new Tone.Panner(pan).connect(masterLimiter);
		window.trackPanners[i] = panner;

		var timbre = (i < instruments.length) ? spectra[instruments[i].spectrum] : null;
		var env = timbre?.envelope || {};
		var envAttack = env.a !== undefined ? env.a : 0.01;
		var envDecay = env.d !== undefined ? env.d : 0.1;
		var envSustain = env.s !== undefined ? env.s : 0.8;
		var envRelease = env.r !== undefined ? env.r : 0.3;
		
		var synth = new Tone.PolySynth({
			volume: (instruments[i] && instruments[i].volume) || -12
		}).connect(panner);
		
		synth.set({
			envelope: {
				attack: envAttack,
				decay: envDecay,
				sustain: envSustain,
				release: envRelease
			}
		});

		if (i < instruments.length) {
			// Stredné C (60) sa použije ako referenčná výška pre parciály.
			var partialsData = typeof DynamicTimbre !== 'undefined'
				? DynamicTimbre.getPartialsAtPitch(timbre, 60)
				: getTimbrePartials(timbre, 60);
			var spectraPartials = partialsData.map(m => {return m[1]});
			synth.set({
				oscillator: {
					type: "custom",
					partials: spectraPartials
				}
			});
		}
		window.synths.push(synth);
	}

	Logger.log(`loadSynths: Created ${window.synths.length} synths for ${MIDI.data.length} tracks`);
	if (window.synths.length !== MIDI.data.length) {
		Logger.warn(`loadSynths: Mismatch! synths.length (${window.synths.length}) !== MIDI.data.length (${MIDI.data.length})`);
	}

}
function initVolumeControl() {
	var slider = document.querySelector('.volume-slider');
	var valueDisplay = document.querySelector('.volume-value');
	var muteBtn = document.querySelector('.volume-mute-btn');
	
	if (!slider || !valueDisplay || !muteBtn) return;

	slider.value = dbToSlider(masterVolumeValue);
	valueDisplay.textContent = formatDbValue(masterVolumeValue);
	
	slider.addEventListener('input', (e) => {
		var sliderVal = parseFloat(e.target.value);
		var dbVal = sliderToDb(sliderVal);
		masterVolumeValue = dbVal;
		valueDisplay.textContent = formatDbValue(dbVal);

		if (!masterMuted && masterVolume) {
			masterVolume.volume.value = dbVal <= -70 ? -Infinity : dbVal;
		}
		// Ovláda sa aj stereoGain v AudioWorklete, s prevodom dB na lineárnu hodnotu.
		if (!masterMuted && typeof PlaybackManager !== 'undefined' && PlaybackManager.stereoGain) {
			var linearGain = dbVal <= -70 ? 0 : Math.pow(10, dbVal / 20);
			PlaybackManager.stereoGain.gain.value = linearGain;
		}
	});

	// Ctrl+klik alebo dvojklik resetuje na 0 dB.
	var resetMaster = () => {
		masterVolumeValue = 0;
		slider.value = dbToSlider(0);
		valueDisplay.textContent = formatDbValue(0);

		if (!masterMuted && masterVolume) {
			masterVolume.volume.value = 0;
		}
		// Resetuje sa aj stereoGain v AudioWorklete.
		if (!masterMuted && typeof PlaybackManager !== 'undefined' && PlaybackManager.stereoGain) {
			PlaybackManager.stereoGain.gain.value = 1;
		}
	};
	slider.addEventListener('click', (e) => {
		if (e.ctrlKey || e.metaKey) resetMaster();
	});
	slider.addEventListener('dblclick', resetMaster);
	
	muteBtn.addEventListener('click', () => {
		masterMuted = !masterMuted;
		muteBtn.classList.toggle('muted', masterMuted);
		muteBtn.querySelector('.volume-icon').style.display = masterMuted ? 'none' : '';
		muteBtn.querySelector('.volume-icon-muted').style.display = masterMuted ? '' : 'none';

		if (masterVolume) {
			if (masterMuted) {
				masterVolume.volume.value = -Infinity;
			} else {
				masterVolume.volume.value = masterVolumeValue <= -70 ? -Infinity : masterVolumeValue;
			}
		}
		// Ovláda sa aj stereoGain v AudioWorklete.
		if (typeof PlaybackManager !== 'undefined' && PlaybackManager.stereoGain) {
			if (masterMuted) {
				PlaybackManager.stereoGain.gain.value = 0;
			} else {
				var linearGain = masterVolumeValue <= -70 ? 0 : Math.pow(10, masterVolumeValue / 20);
				PlaybackManager.stereoGain.gain.value = linearGain;
			}
		}
	});
	
	// Klávesová skratka na stlmenie (Ctrl+M).
	document.addEventListener('keydown', (e) => {
		if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) && !e.target.readOnly) return;
		if ((e.key === 'm' || e.key === 'M') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			e.preventDefault();
			muteBtn.click();
		}
	});
}

function initMidiPartialModeButton() {
	var checkbox = document.getElementById('switch-checkbox-midi-partial');
	if (!checkbox) return;

	checkbox.addEventListener('change', () => {
		window.midiPartialMode = checkbox.checked;

		if (typeof showStatus === 'function') {
			showStatus(window.midiPartialMode
				? 'MIDI Partial Mode ON - Playing fundamentals of ordered partials'
				: 'MIDI Partial Mode OFF - Playing tuning steps',
				{ type: 'info', duration: 2000 });
		}
	});
}

// Režim počítačovej klávesnice, ktorá funguje ako vstup MIDI.
function initComputerKeyboardMode() {
	var checkbox = document.getElementById('switch-checkbox-computer-keyboard');
	if (!checkbox) return;

	// Mapovanie kláves na MIDI noty (relatívne k oktáve)
	// v spodnom riadku a=C, s=D, d=E, f=F, g=G, h=A, j=B, k=C+1, l=D+1
	// v hornom riadku sú čierne klávesy w=C#, e=D#, t=F#, y=G#, u=A#, o=C#+1, p=D#+1.
	var keyToNote = {
		'a': 0,   // C
		'w': 1,   // C#
		's': 2,   // D
		'e': 3,   // D#
		'd': 4,   // E
		'f': 5,   // F
		't': 6,   // F#
		'g': 7,   // G
		'y': 8,   // G#
		'h': 9,   // A
		'u': 10,  // A#
		'j': 11,  // B
		'k': 12,  // C (nasledujúca oktáva).
		'o': 13,  // C# (nasledujúca oktáva).
		'l': 14,  // D (nasledujúca oktáva).
		'p': 15   // D# (nasledujúca oktáva).
	};

	var heldKeys = new Set();

	checkbox.addEventListener('change', () => {
		window.computerKeyboardMode = checkbox.checked;

		// Stavové oznámenie ukazuje oktávu - 1, keďže výpočet MIDI používa oktávu + 1.
		if (typeof showStatus === 'function') {
			showStatus(window.computerKeyboardMode
				? `Computer Keyboard ON - Octave ${window.computerKeyboardOctave - 1} (use , and . to change)`
				: 'Computer Keyboard OFF',
				{ type: 'info', duration: 2000 });
		}

		// Pri vypnutí sa pustia všetky držané klávesy.
		if (!window.computerKeyboardMode) {
			for (const key of heldKeys) {
				var noteOffset = keyToNote[key];
				if (noteOffset !== undefined) {
					var midiNote = (window.computerKeyboardOctave + 1) * 12 + noteOffset;
					if (typeof WebMIDI !== 'undefined' && WebMIDI.onNoteOff) {
						WebMIDI.onNoteOff(midiNote, 0);
					}
				}
			}
			heldKeys.clear();
		}
	});

	document.addEventListener('keydown', (e) => {
		if (!window.computerKeyboardMode) return;

		if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) && !e.target.readOnly) return;

		var key = e.key.toLowerCase();

		// Zmena oktávy pomocou , a .
		if (key === ',') {
			if (window.computerKeyboardOctave > 0) {
				window.computerKeyboardOctave--;
				if (typeof showStatus === 'function') {
					showStatus(`Octave ${window.computerKeyboardOctave - 1}`, { type: 'info', duration: 1000 });
				}
			}
			e.preventDefault();
			return;
		}
		if (key === '.') {
			if (window.computerKeyboardOctave < 8) {
				window.computerKeyboardOctave++;
				if (typeof showStatus === 'function') {
					showStatus(`Octave ${window.computerKeyboardOctave - 1}`, { type: 'info', duration: 1000 });
				}
			}
			e.preventDefault();
			return;
		}

		var noteOffset = keyToNote[key];
		if (noteOffset === undefined) return;

		// Zabráni opakovaniu klávesy.
		if (heldKeys.has(key)) return;
		heldKeys.add(key);

		var midiNote = (window.computerKeyboardOctave + 1) * 12 + noteOffset;
		var velocity = 100;

		if (typeof WebMIDI !== 'undefined' && WebMIDI.onNoteOn) {
			WebMIDI.onNoteOn(midiNote, velocity, 0);
		}

		e.preventDefault();
	});

	document.addEventListener('keyup', (e) => {
		if (!window.computerKeyboardMode) return;

		var key = e.key.toLowerCase();
		var noteOffset = keyToNote[key];
		if (noteOffset === undefined) return;

		// Uvoľní sa len vtedy, ak bola daná klávesa držaná.
		if (!heldKeys.has(key)) return;
		heldKeys.delete(key);

		var midiNote = (window.computerKeyboardOctave + 1) * 12 + noteOffset;

		if (typeof WebMIDI !== 'undefined' && WebMIDI.onNoteOff) {
			WebMIDI.onNoteOff(midiNote, 0);
		}
	});
}

// Prevod hodnoty jazdca (0-100) na dB (-70 až +6).
function sliderToDb(sliderVal) {
	if (sliderVal <= 0) return -70;
	if (sliderVal >= 100) return 6;
	
	// Logaritmická mierka: 0-84 sa mapuje na -70 až 0, 84-100 na 0 až 6
	// bod 0 dB je pri hodnote jazdca 84
	// krivka nechá väčšinu priestoru jazdca blízko 0 dB, teda v užitočnom rozsahu, a menej v spodnej časti.
	var zeroDbPoint = 84;

	if (sliderVal <= zeroDbPoint) {
		// Rozsah -70 až 0.
		const normalized = sliderVal / zeroDbPoint; // 0 až 1.
		// Krivka sqrt rozširuje horný rozsah blízko 0 dB a stláča nízke hlasitosti bližšie k sebe.
		var curved = Math.sqrt(normalized);
		return -70 + (70 * curved);
	} else {
		// Rozsah 0 až +6 (lineárny).
		const normalized = (sliderVal - zeroDbPoint) / (100 - zeroDbPoint); // 0 až 1.
		return normalized * 6;
	}
}
// Prevod dB na hodnotu jazdca (0-100).
function dbToSlider(dbVal) {
	if (dbVal <= -70) return 0;
	if (dbVal >= 6) return 100;
	
	var zeroDbPoint = 84;
	
	if (dbVal <= 0) {
		// Rozsah -70 až 0.
		const normalized = (dbVal + 70) / 70; // 0 až 1.
		var curved = Math.pow(normalized, 2); // Inverzia sqrt
		return curved * zeroDbPoint;
	} else {
		// Rozsah 0 až +6.
		const normalized = dbVal / 6; // 0 až 1.
		return zeroDbPoint + (normalized * (100 - zeroDbPoint));
	}
}
// Formátovanie hodnoty dB na zobrazenie.
function formatDbValue(dbVal) {
	if (dbVal <= -70) return '-Inf dB';
	if (dbVal >= 0) return '+' + dbVal.toFixed(1) + ' dB';
	return dbVal.toFixed(1) + ' dB';
}

function initBrightnessOffsetControl() {
	var volumeControl = document.querySelector('.volume-control');
	if (!volumeControl) return;

	var brightnessControl = document.createElement('div');
	brightnessControl.className = 'brightness-offset-control';
	brightnessControl.innerHTML = `
		<div class="brightness-offset-slider-container" title="Partial brightness offset (Alt+scroll, Ctrl+click to reset)">
			<input type="range" id="brightness-offset-slider" class="brightness-offset-slider" 
				   min="-1" max="1" step="0.05" value="0">
			<span id="brightness-offset-value" class="brightness-offset-value">+0.00</span>
		</div>
	`;

	volumeControl.parentNode.insertBefore(brightnessControl, volumeControl);
	
	var slider = document.getElementById('brightness-offset-slider');
	var valueDisplay = document.getElementById('brightness-offset-value');
	
	slider.addEventListener('input', (e) => {
		var val = parseFloat(e.target.value);
		Canvas.partialBrightnessOffset = val;
		valueDisplay.textContent = val >= 0 ? '+' + val.toFixed(2) : val.toFixed(2);
	});
	
	// Ctrl+klik alebo dvojklik pre reset.
	slider.addEventListener('click', (e) => {
		if (e.ctrlKey || e.metaKey) {
			resetBrightnessOffset();
		}
	});
	
	slider.addEventListener('dblclick', () => {
		resetBrightnessOffset();
	});
	
	function resetBrightnessOffset() {
		Canvas.partialBrightnessOffset = 0;
		slider.value = 0;
		valueDisplay.textContent = '+0.00';
	}
}

var analyserBuffer = null;

function updateMasterMeter() {
	var analyser = window.nativeAnalyser;
	var meterFill = document.querySelector('.volume-meter-fill');
	
	if (meterFill) {
		var dbValue = -Infinity;

		if (analyser && typeof analyser.getFloatTimeDomainData === 'function') {
			if (!analyserBuffer || analyserBuffer.length !== analyser.fftSize) {
				analyserBuffer = new Float32Array(analyser.fftSize);
			}

			// Získanie dát v časovej doméne a výpočet RMS.
			analyser.getFloatTimeDomainData(analyserBuffer);
			
			var sum = 0;
			var peak = 0;
			for (let i = 0; i < analyserBuffer.length; i++) {
				var sample = analyserBuffer[i];
				sum += sample * sample;
				var abs = Math.abs(sample);
				if (abs > peak) peak = abs;
			}
			var rms = Math.sqrt(sum / analyserBuffer.length);
			
			// Prevod RMS na dB; na citlivejší merač hlasitosti sa použije peak.
			var linearLevel = Math.max(rms * 1.5, peak * 0.7);
			dbValue = linearLevel > 0 ? 20 * Math.log10(linearLevel) : -Infinity;
		} 
		// Ak natívny analyzátor nie je dostupný, použije sa Tone.Meter.
		else if (masterMeter && typeof masterMeter.getValue === 'function') {
			dbValue = masterMeter.getValue();
		}
		
		if (typeof dbValue !== 'number' || !isFinite(dbValue)) {
			dbValue = -Infinity;
		}

		dbValue = Math.max(-70, Math.min(6, dbValue));
		
		// Prevod na percentá (0 % = -70 dB, 100 % = +6 dB).
		var percent;
		if (dbValue <= -70) {
			percent = 0;
		} else {
			percent = ((dbValue + 70) / 76) * 100;
		}
		
		meterFill.style.width = percent + '%';
	}
	
	requestAnimationFrame(updateMasterMeter);
}
function updateCanvasSize() {
	var center = sel('.center');
	if (!center) return;

	var canvasElement = document.getElementById('canvasElement');
	if (canvasElement && typeof Canvas !== 'undefined') {
		var timelineHeight = (typeof Timeline !== 'undefined' && Timeline.height) ? Timeline.height : 0;
		ctx = Canvas.setupHighDPICanvas(canvasElement, center.offsetWidth, center.offsetHeight - timelineHeight);
	}

	if (typeof Timeline !== 'undefined' && Timeline.resize) {
		Timeline.resize();
	}

	if (typeof Canvas !== 'undefined' && Canvas.renderFrame) {
		Canvas.renderFrame();
	}

}


window.addEventListener('resize', updateCanvasSize);
var zoomFactor = 1.1;
var minSpacing = 20;
var maxSpacing = 4000;
var minBarSize = 5;
var maxBarSize = 5000;

// Krivky rovnakej hlasitosti podľa ISO-226, ktoré používa modul Fletcher-Munson.
function iso226({ freq, spl = null, phon = null, reverse = false }) {
	// Referenčné frekvencie ISO-226 (Hz).
	var fRef = [
		20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
		200, 250, 315, 400, 500, 630, 800, 1000,
		1250, 1600, 2000, 2500, 3150, 4000,
		5000, 6300, 8000, 10000, 12500
	];

	// Percepčný exponent ISO-226 (af).
	var af = [
		0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330,
		0.315, 0.301, 0.288, 0.276, 0.267, 0.259, 0.253, 0.250,
		0.246, 0.244, 0.243, 0.243, 0.243, 0.242,
		0.242, 0.245, 0.254, 0.271, 0.301
	];

	// Magnitúda lineárnej normalizovanej prenosovej funkcie (Lu).
	var Lu = [
		-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1,
		-6.2, -4.5, -3.1, -2.0, -1.1, -0.4, 0.0, 0.3,
		0.5, 0.0, -2.7, -4.1, -1.0, 1.7, 2.5, 1.2,
		-2.1, -7.1, -11.2, -10.7, -3.1
	];

	// Prah počuteľnosti (Tf) v dB.
	var Tf = [
		78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5,
		22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3.0,
		2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4,
		-1.5, 6.0, 12.6, 13.9, 12.3
	];

	freq = Math.max(20, Math.min(freq, 12500));

	// Nájdenie intervalu v fRef pre interpoláciu.
	var i = fRef.findIndex((f) => f >= freq);
	if (i === -1) i = fRef.length - 1;
	var i0 = Math.max(0, i - 1);
	var i1 = Math.min(fRef.length - 1, i);

	function lerp(x0, x1, t) {
		return x0 + (x1 - x0) * t;
	}

	// Výpočet zlomkovej pozície medzi najbližšími bodmi.
	var tFrac = (freq - fRef[i0]) / (fRef[i1] - fRef[i0] || 1);

	var af_ = lerp(af[i0], af[i1], tFrac);
	var Lu_ = lerp(Lu[i0], Lu[i1], tFrac);
	var Tf_ = lerp(Tf[i0], Tf[i1], tFrac);

	if (!reverse) {
		// Výpočet hlasitosti (phon) z SPL.
		if (spl === null) return 0;

		// Psychoakustický vzorec podľa ISO-226.
		const Af = Math.pow(10, (spl + Lu_) / 10) - Math.pow(10, Tf_ / 10);
		if (Af <= 0) return 0;

		return (10 / af_) * Math.log10(Af) + 94;
	} else {
		// Výpočet SPL z phon.
		if (phon === null) return 0;

		const Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15);
		if (Af <= 0) return 0;

		var splOut = (10 / af_) * Math.log10(Af) - Lu_ + 94;
		return splOut;
	}
}

// Modul je vypnutý, apply() vracia amplitúdu nezmenenú.


// Globálne sa zabráni tomu, aby prehliadač pri Ctrl+koliesko priblížil obraz.
document.addEventListener('wheel', e => {
	if ((e.ctrlKey || e.metaKey)) {
		e.preventDefault();
	}
}, {passive: false});

// Zabránenie návratu na predchádzajúcu stránku.
document.getElementById('canvasElement')?.addEventListener('touchstart', (e) => {
}, { passive: false });
document.getElementById('canvasElement')?.addEventListener('touchmove', (e) => {
  e.preventDefault();
}, { passive: false });

window.addEventListener('wheel', e => {
	var t = e.target;
	if (t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'timelineCanvas') {
		e.preventDefault();
		const old = barSize;
		if (e.deltaY < 0) barSize *= zoomFactor;
		else barSize /= zoomFactor;
		barSize = Math.min(maxBarSize, Math.max(minBarSize, barSize));
		const scale = barSize / old;
		const mouseX = e.offsetX - 60;
		Canvas.offx = mouseX - (mouseX - Canvas.offx) * scale;
		Canvas.barlinesOffx = Canvas.offx % barSize;
		debouncedSaveViewState();
		return;
	}
	if (t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'canvasElement') {
		if (!Canvas.canvas) return;

		e.preventDefault();

		// Posúvanie nad klávesmi približuje vertikálne.
		if (e.offsetX < 60) {
			const old = octaveSpacing;
			if (e.deltaY < 0) octaveSpacing *= zoomFactor;
			else octaveSpacing /= zoomFactor;
			octaveSpacing = Math.min(maxSpacing, Math.max(minSpacing, octaveSpacing));
			const scale = octaveSpacing / old;
			Canvas.offy = e.offsetY - (e.offsetY - Canvas.offy) * scale;

			// octaveSpacingStep sa aktualizuje; parciály sú uložené v jednotkách nôt, takže netreba prepočítavať.
			octaveSpacingStep = octaveSpacing / 12;

			// Zvuková spätná väzba je obmedzená, aby rýchle posúvanie nespôsobilo zvukové artefakty.
			return;
		}

		if (e.offsetY > Canvas.cssHeight - timeRegionHeight) {
			const old = barSize;
			if (e.deltaY < 0) barSize *= zoomFactor;
			else barSize /= zoomFactor;
			barSize = Math.min(maxBarSize, Math.max(minBarSize, barSize));
			const scale = barSize / old;

			// Úprava offx, aby kliknutý bod zostal na mieste.
			const mouseX = e.offsetX - 60;  // Zohľadnenie šírky kláves.
			Canvas.offx = mouseX - (mouseX - Canvas.offx) * scale;

			// Parciály sú uložené v časových jednotkách, takže netreba prepočítavať.
			Canvas.barlinesOffx = Canvas.offx % barSize;

			debouncedSaveViewState();
			return;
		}

		// Pri Ctrl+Alt+scroll v hlavnej zóne plátna sa približujú obe osi.
		if ((e.ctrlKey || e.metaKey) && e.altKey) {
			// Vertikálne priblíženie
			var oldOctaveSpacing = octaveSpacing;
			if (e.deltaY < 0) octaveSpacing *= zoomFactor;
			else octaveSpacing /= zoomFactor;
			octaveSpacing = Math.min(maxSpacing, Math.max(minSpacing, octaveSpacing));
			var scaleY = octaveSpacing / oldOctaveSpacing;
			Canvas.offy = e.offsetY - (e.offsetY - Canvas.offy) * scaleY;
			octaveSpacingStep = octaveSpacing / 12;

			// Horizontálne priblíženie
			var oldBarSize = barSize;
			if (e.deltaY < 0) barSize *= zoomFactor;
			else barSize /= zoomFactor;
			barSize = Math.min(maxBarSize, Math.max(minBarSize, barSize));
			var scaleX = barSize / oldBarSize;
			const mouseX = e.offsetX - 60;
			Canvas.offx = mouseX - (mouseX - Canvas.offx) * scaleX;
			Canvas.barlinesOffx = Canvas.offx % barSize;

			debouncedSaveViewState();
			return;
		}

		// Alt+scroll v hlavnej zóne plátna.
		if (e.altKey && !e.shiftKey) {
			// Alt+scroll upravuje jas parciálov.
			var step = 0.05;
			if (e.deltaY < 0) {
				Canvas.partialBrightnessOffset = Math.min(1, Canvas.partialBrightnessOffset + step);
			} else {
				Canvas.partialBrightnessOffset = Math.max(-1, Canvas.partialBrightnessOffset - step);
			}
			var slider = document.getElementById('brightness-offset-slider');
			var valueDisplay = document.getElementById('brightness-offset-value');
			if (slider) slider.value = Canvas.partialBrightnessOffset;
			if (valueDisplay) {
				var val = Canvas.partialBrightnessOffset;
				valueDisplay.textContent = val >= 0 ? '+' + val.toFixed(2) : val.toFixed(2);
			}
			return;
		}

		// Pri Ctrl+Shift+scroll v hlavnej zóne plátna sa približuje vertikálne.
		if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
			const old = octaveSpacing;
			if (e.deltaY < 0) octaveSpacing *= zoomFactor;
			else octaveSpacing /= zoomFactor;
			octaveSpacing = Math.min(maxSpacing, Math.max(minSpacing, octaveSpacing));
			const scale = octaveSpacing / old;
			Canvas.offy = e.offsetY - (e.offsetY - Canvas.offy) * scale;
			octaveSpacingStep = octaveSpacing / 12;

			debouncedSaveViewState();
			return;
		}

		// Pri Ctrl+scroll v hlavnej zóne plátna sa približuje horizontálne.
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
			const old = barSize;
			if (e.deltaY < 0) barSize *= zoomFactor;
			else barSize /= zoomFactor;
			barSize = Math.min(maxBarSize, Math.max(minBarSize, barSize));
			const scale = barSize / old;

			const mouseX = e.offsetX - 60;  // Zohľadnenie šírky kláves.
			Canvas.offx = mouseX - (mouseX - Canvas.offx) * scale;
			Canvas.barlinesOffx = Canvas.offx % barSize;

			debouncedSaveViewState();
			return;
		}

		// Bežné posúvanie bez modifikátorov posúva náhľad.
		if (!(e.ctrlKey || e.metaKey) && !e.altKey) {
			var deltaXClamped = Math.max(-scrollSize, Math.min(scrollSize, e.deltaX));
			var deltaYClamped = Math.max(-scrollSize, Math.min(scrollSize, e.deltaY));

			if (e.deltaX && e.deltaY) {
				// Pri diagonálnom posúvaní sa aktualizujú obe osi s obmedzenými deltami.
				Canvas.offx -= deltaXClamped;
				Canvas.offy -= deltaYClamped;
			} else if (e.deltaX) {
				// Iba horizontálne posúvanie.
				Canvas.offx -= deltaXClamped;
			} else {
				// Iba vertikálne posúvanie (so Shiftom horizontálne).
				if (e.shiftKey) {
					Canvas.offx -= deltaYClamped;
				} else {
					Canvas.offy -= deltaYClamped;
				}
			}
			Canvas.barlinesOffx = Canvas.offx % barSize;
			debouncedSaveViewState();
		}
	}
}, {passive: false});

// Prvky uložené v cache kvôli viditeľnosti tlačidiel priblíženia.
var _zoomElCache = null;
function getZoomElements() {
	if (!_zoomElCache) {
		_zoomElCache = {
			center: document.querySelector('.center'),
			kbd: document.querySelector('.canvas-nav-kbd-zoom-group'),
			time: document.querySelector('.canvas-nav-time-zoom-group')
		};
	}
	return _zoomElCache;
}

function canvasMouseMove(e) {
	// Viditeľnosť tlačidiel priblíženia podľa pozície myši nad zónou plátna.
	var z = getZoomElements();
	if (z.center && (z.kbd || z.time)) {
		var rect = z.center.getBoundingClientRect();
		var relX = e.clientX - rect.left;
		var relY = e.clientY - rect.top;
		var inCenter = e.clientX >= rect.left && e.clientX <= rect.right &&
						 e.clientY >= rect.top && e.clientY <= rect.bottom;

		if (z.kbd) {
			z.kbd.classList.toggle('visible', inCenter && relX < 60);
		}
		if (z.time) {
			z.time.classList.toggle('visible', inCenter && relY > rect.height - 16);
		}
	}

	if (e.target.tagName && e.target.tagName.toLowerCase() === 'canvas' && e.target.id === 'canvasElement') {
		if (!Canvas.canvas) return;

		if (select.velocityDragging) {
			if (Canvas.updateVelocityDrag) Canvas.updateVelocityDrag(e.offsetY);
			return;
		}

		// Ťahanie stredným tlačidlom myši na voľné posúvanie.
		if (select.middleDrag) {
			Canvas.offx = select.offx - (select.x - e.offsetX);
			Canvas.offy = select.offy - (select.y - e.offsetY);
			Canvas.barlinesOffx = Canvas.offx % barSize;
			debouncedSaveViewState();
			return;
		}


		// Pri dočasnej slučke sa veľkosť slučky aktualizuje počas samotného ťahania myšou.
		if (select.momentaryLoop.active) {
			const startX = select.momentaryLoop.startX;
			var currentX = e.offsetX;

			var startTime = (startX - 60.5 - Canvas.offx) / barSize;
			var endTime = (currentX - 60.5 - Canvas.offx) / barSize;

			// Nastavenie začiatku a konca slučky, ktoré umožňuje ťahanie oboma smermi.
			if (endTime > startTime) {
				playback.loopStart = Math.max(0, startTime);
				playback.loopEnd = endTime;
			} else {
				playback.loopStart = Math.max(0, endTime);
				playback.loopEnd = startTime;
			}
			return;
		}

		if (select.keyboard) {
			Canvas.offy = select.offy - (select.y - e.offsetY);
			// Zastaví ďalšie vykonávanie kódu, pretože pohyb po klávesoch má mať prednosť pred všetkým.
			return;
		}
		// Ťahanie cez klávesy klavíra funguje ako glissando.
		if (select.keyboardPlaying) {
			if (e.offsetX >= 40 && e.offsetX < 60) {
				const noteInfo = getKeyboardNoteAtY(e.offsetY);
				if (noteInfo) {
					playKeyboardPreview(noteInfo);
				}
			} else {
				// Po pustení klávesy sa prehrávanie zastaví.
				stopKeyboardPreview();
				select.keyboardPlaying = false;
			}
			return;
		}
		if (select.timeline) {
			Canvas.offx = select.offx - (select.x - e.offsetX);
			Canvas.barlinesOffx = Canvas.offx % barSize;
			debouncedSaveViewState();
			// Zastaví ďalšie vykonávanie kódu, pretože pohyb časovej osi má mať prednosť pred všetkým.
			return;
		}
		// Spracovanie ťahania po dvojkliku na zmenu veľkosti novovytvorenej noty.
		if (select.dblClickCreating && select.dblClickNote) {
			const noteInfo = select.dblClickNote;
			const note = MIDI.data[noteInfo.instIdx][noteInfo.noteIdx];
			if (note) {
				if (!noteInfo.resizing && Math.abs(e.offsetX - noteInfo.startMouseX) < 5) return;
				noteInfo.resizing = true;

				var currentTimeX = (e.offsetX - 60.5 - Canvas.offx) / barSize;
				var newLength = currentTimeX - noteInfo.startTime;

				if (!e.shiftKey && typeof snapTimeToGrid === 'function') {
					var snappedEnd = snapTimeToGrid(noteInfo.startTime + newLength,
						typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0,
						Canvas.snapThreshold);
					newLength = snappedEnd - noteInfo.startTime;
				}

				newLength = Math.max(1 / gridSize, newLength);

				note[N_DUR] = newLength;

				if (note[N_DATA] && note[N_DATA].partials) {
					for (let k = 0; k < note[N_DATA].partials.length; k++) {
						note[N_DATA].partials[k][2] = newLength;  // Aktualizácia dĺžky parciálu.
					}
				}
			}
			return;
		}
		// Spracovanie ťahania v režime scrollovania na prechádzanie zoradenými parciálmi.
		if (select.scrollCreating && select.scrollNote) {
			var scrollInfo = select.scrollNote;
			if (!MIDI.data[scrollInfo.instIdx]) return;
			const note = MIDI.data[scrollInfo.instIdx][scrollInfo.noteIdx];
			if (!note) return;

			const deltaY = scrollInfo.startY - e.offsetY;
			var threshold = select.scrollPitchThreshold || 12;

			// Výpočet počtu prejdených krokov, každý má svoj prah v pixeloch.
			var pitchStep = Math.floor(deltaY / threshold);

			if (pitchStep !== scrollInfo.lastPitchStep) {
				var direction = pitchStep > scrollInfo.lastPitchStep ? 1 : -1;
				var stepsToMove = Math.abs(pitchStep - scrollInfo.lastPitchStep);
				scrollInfo.lastPitchStep = pitchStep;

				var inst = instruments[scrollInfo.instIdx];
				if (!inst) return;

				var tuningKey = typeof Timeline !== 'undefined'
					? Timeline.getTuningAtTime(note[N_TIME], scrollInfo.instIdx)
					: (settings.scale || 'edo12');
				var orderedPartials = DB.getOrderedPartials(tuningKey, inst.spectrum, settings.orderedPartialsSelection);
				if (!orderedPartials || orderedPartials.length === 0) return;

				var spectrum = window.spectra?.[inst.spectrum];
				var spectrumData = typeof getTimbrePartials === 'function' ? getTimbrePartials(spectrum) : (spectrum?.data || [[1, 1]]);

				var currentIdx = scrollInfo.currentIdx;

				// Nájdenie aktuálnej pozície.
				if (currentIdx === undefined || currentIdx < 0 || currentIdx >= orderedPartials.length) {
					currentIdx = -1;
					var currentPitch = note[N_PITCH];
					var currentPartial = note[N_PARTIAL] || 1;

					// Nájdenie zodpovedajúceho záznamu v orderedPartials v rámci tolerancie.
					var closestDist = Infinity;
					for (let i = 0; i < orderedPartials.length; i++) {
						var pitchDiff = Math.abs(orderedPartials[i][1] - currentPitch);
						var partialMatch = orderedPartials[i][4] === currentPartial;
						if (pitchDiff < 0.01 && partialMatch) {
							currentIdx = i;
							break;
						}
						if (pitchDiff < closestDist) {
							closestDist = pitchDiff;
							currentIdx = i;
						}
					}
				}

				if (currentIdx === -1) currentIdx = 0;

				for (let step = 0; step < stepsToMove; step++) {
					var targetIdx = currentIdx + direction;
					if (targetIdx < 0) targetIdx = 0;
					if (targetIdx >= orderedPartials.length) targetIdx = orderedPartials.length - 1;

					if (targetIdx !== currentIdx) {
						var targetEntry = orderedPartials[targetIdx];
						if (targetEntry && typeof targetEntry[1] === 'number' && typeof targetEntry[4] === 'number') {
							note[N_PITCH] = targetEntry[1];
							note[N_PARTIAL] = targetEntry[4];
							currentIdx = targetIdx;

							if (note[N_DATA] && note[N_DATA].partials) {
								var baseRatio = spectrumData[note[N_PARTIAL] - 1] ? spectrumData[note[N_PARTIAL] - 1][0] : note[N_PARTIAL];
								for (let pIdx = 0; pIdx < note[N_DATA].partials.length; pIdx++) {
									var specRatio = spectrumData[pIdx] ? spectrumData[pIdx][0] : (pIdx + 1);
									note[N_DATA].partials[pIdx][1] = freq2note(note2freq(note[N_PITCH]) / baseRatio * specRatio);
									note[N_DATA].partials[pIdx][4] = (pIdx + 1 === note[N_PARTIAL]) ? 1 : 0;
								}
							}

							if (typeof AdaptiveTuning !== 'undefined') {
								AdaptiveTuning.refresh();
							}
						}
					}
				}

				// Uloženie aktuálneho indexu pre ďalšiu iteráciu.
				scrollInfo.currentIdx = currentIdx;

				if (window['switch-checkbox-headphones']?.checked) {
					var previewFreq = note2freq(note[N_PITCH]);
					var previewAmp = spectrumData[note[N_PARTIAL] - 1]?.[1] ?? 1;
					Canvas.previewDragSine(previewFreq, scrollInfo.instIdx, previewAmp);
				}
			}
			return;
		}
		var clampedOffsetX = Math.max(60, e.offsetX);

		if (!playback.playing && select.selecting)
			playback.time = (clampedOffsetX - 60.5 - Canvas.offx)/barSize;

		// Uloženie dočasného začiatku a konca slučky počas výberu, iba vizuálne; uplatní sa pri zapnutí slučky.
		if (select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight) {
			const startX = Math.min(select.x, clampedOffsetX);
			var endX = Math.max(select.x, clampedOffsetX);
			// Dočasný rozsah sa nastaví len pri výbere širšom než 5 pixelov.
			if (endX - startX > 5) {
				var tempStart = (startX - 60.5 - Canvas.offx) / barSize;
				var tempEnd = (endX - 60.5 - Canvas.offx) / barSize;
				// Prichytenie na mriežku, ak je držaný Shift.
				if (e.shiftKey && typeof GridSystem !== 'undefined') {
					var trackIdx = Timeline ? Timeline.getCurrentTrackIdx() : 0;
					var snappedStart = GridSystem.snapToGrid(tempStart, trackIdx, 0.5);
					var snappedEnd = GridSystem.snapToGrid(tempEnd, trackIdx, 0.5);
					if (snappedStart !== null) tempStart = snappedStart;
					if (snappedEnd !== null) tempEnd = snappedEnd;
				}
				select.tempLoopStart = tempStart;
				select.tempLoopEnd = tempEnd;
			}
		}

		var hoveredNote = (Canvas.offy - e.offsetY) / octaveSpacingStep;
		infoWindowNote.textContent = hoveredNote.toFixed(2);
		infoWindowFrequency.textContent = (Math.round(note2freq(hoveredNote)*1000)/1000).toFixed(3) + 'Hz';
		infoWindowClosest.textContent = note2name(hoveredNote);
		infoWindowTime.textContent = ((clampedOffsetX - 60.5 - Canvas.offx) / barSize).toFixed(4);
		select.offsetX = clampedOffsetX;
		select.offsetY = e.offsetY;
		Canvas.checkPartialHover(clampedOffsetX, e.offsetY);
	}
}
document.addEventListener('mousemove', canvasMouseMove);
document.addEventListener('dblclick', e => {
	var t = e.target;
	if ((e.ctrlKey || e.metaKey)) return;
	if (t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'canvasElement') {
		if (!Canvas.canvas) return;

		if (e.altKey) {
			if (typeof Canvas !== 'undefined' && Canvas.resetVelocity) Canvas.resetVelocity(partialNumber ? partialNote : null);
			return;
		}

		// Dvojklik na zónu kláves resetuje vertikálne priblíženie.
		if (e.offsetX < 60) {
			var defaultOctaveSpacing = 120;  // 12 * 10.
			const old = octaveSpacing;
			octaveSpacing = defaultOctaveSpacing;
			octaveSpacingStep = octaveSpacing / 12;
			// Úprava offy, aby kliknutý bod zostal na mieste.
			const scale = octaveSpacing / old;
			Canvas.offy = e.offsetY - (e.offsetY - Canvas.offy) * scale;
			return;
		}

		// Dvojklik v zóne časovej osi resetuje horizontálne priblíženie.
		if (e.offsetY > Canvas.cssHeight - timeRegionHeight) {
			var defaultBarSize = 60;
			const old = barSize;
			barSize = defaultBarSize;
			const scale = barSize / old;

			// Úprava offx, aby kliknutý bod zostal na mieste.
			var mouseX = e.offsetX - 60;
			Canvas.offx = mouseX - (mouseX - Canvas.offx) * scale;

			// Parciály sú uložené v časových jednotkách, takže prepočet nie je nutný.

			Canvas.barlinesOffx = Canvas.offx % barSize;
			return;
		}

		// Vytváranie noty sa rieši v mousedown kvôli podpore ťahania na zmenu veľkosti.
	}
	if (t?.classList?.contains('pane-instrument-name')) {
		t.removeAttribute('readonly');
	}
});
document.addEventListener('blur', e => {
	var t = e.target;
	if (t?.classList?.contains('pane-instrument-name')) {
		t.setAttribute('readonly', 'true');
	}
}, true);

function getKeyboardNoteAtY(y) {
	if (!Canvas.canvas) return null;

	// Získanie aktuálneho ladenia, pričom sa vychádza z primárnej stopy.
	var trackIdx = typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() :
					 (typeof primaryTrackIndex !== 'undefined' ? primaryTrackIndex : 0);
	var keyboardScale = settings.scale || scale;

	// Kontrola ladenia na časovej osi v aktuálnom čase.
	if (typeof Timeline !== 'undefined' && Timeline.getTrackEvents) {
		var trackEvents = Timeline.getTrackEvents(trackIdx);
		if (trackEvents && trackEvents.tuningChanges && trackEvents.tuningChanges.length > 0) {
			var sorted = [...trackEvents.tuningChanges].sort((a, b) => a.time - b.time);
			for (let i = sorted.length - 1; i >= 0; i--) {
				if (sorted[i].time <= playback.time) {
					keyboardScale = sorted[i].tuningKey;
					break;
				}
			}
		}
	}

	// Prevod frekvencie na Y pozíciu (rovnako ako pri kreslení na plátno).
	var freqToY = (freq) => {
		var semitones = 12 * Math.log2(freq / 440) + 69;
		return Canvas.offy - semitones * octaveSpacing / 12;
	};

	var isAdaptive = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(keyboardScale);

	if (isAdaptive) {
		var adaptivePitches = AdaptiveTuning.getPitchesAtTime(playback.time, trackIdx, keyboardScale);
		if (!adaptivePitches || adaptivePitches.length < 2) return null;

		// Nájdenie klávesy, do ktorej Y pozícia patrí.
		for (let i = 0; i < adaptivePitches.length - 1; i++) {
			const noteY = Canvas.pitchToY(adaptivePitches[i].midiNote);
			const nextNoteY = Canvas.pitchToY(adaptivePitches[i + 1].midiNote);
			const keyTop = nextNoteY;  // Vyššia výška má nižšie Y.
			const keyBottom = noteY;   // Nižšia výška má vyššie Y.

			if (y >= keyTop && y < keyBottom) {
				var pitch = adaptivePitches[i];
				return {
					freq: pitch.freq,
					note: freq2note(pitch.freq),
					keyIndex: i,
					isBlackKey: pitch.isBlackKey,
					tuningKey: keyboardScale
				};
			}
		}

		return null;
	} else {
		// Bežné ladenie sa berie zo scaleData.notes.
		var scaleData = scales[keyboardScale];
		if (!scaleData || !scaleData.notes || scaleData.notes.length < 2) return null;

		// Nájdenie klávesy
		for (let i = 0; i < scaleData.notes.length; i++) {
			const hasNext = i + 1 < scaleData.notes.length;
			const noteY = freqToY(scaleData.notes[i][1]);
			
			const nextNoteY = hasNext ? freqToY(scaleData.notes[i + 1][1]) : 2 * noteY - freqToY(scaleData.notes[i - 1][1]);
			const keyTop = nextNoteY;  // Vyššia výška má nižšie Y.
			const keyBottom = noteY;   // Nižšia výška má vyššie Y.

			if (y >= keyTop && y < keyBottom) {
				var noteData = scaleData.notes[i];
				return {
					freq: noteData[1],
					note: freq2note(noteData[1]),
					keyIndex: i,
					isBlackKey: noteData[2],
					tuningKey: keyboardScale
				};
			}
		}

		return null;
	}
}

function playKeyboardPreview(noteInfo) {
	if (!noteInfo) return;

	var instIdx = 0;
	for (let i = 0; i < instruments.length; i++) {
		if (instruments[i].selected) {
			instIdx = i;
			break;
		}
	}

	var now = Tone.now();
	var ctx = Tone.context?.rawContext;
	if (!ctx || ctx.state !== 'running') return;

	// Zohľadňuje sa iba hlavná hlasitosť (prevod dB na lineárnu hodnotu).
	var masterDb = typeof masterVolumeValue !== 'undefined' ? masterVolumeValue : 0;
	var masterLinear = masterDb <= -70 ? 0 : Math.pow(10, masterDb / 20);
	var targetGain = Math.max(0.0001, masterLinear * 0.3);

	// Ak hrá, plynulo prejde na novú frekvenciu bez počuteľného kliku.
	if (window.keyboardPreview.active && window.keyboardPreview.osc && window.keyboardPreview.freq !== noteInfo.freq) {
		var rampTime = now + 0.02;
		window.keyboardPreview.osc.frequency.setValueAtTime(window.keyboardPreview.osc.frequency.value, rampTime);
		window.keyboardPreview.osc.frequency.linearRampToValueAtTime(noteInfo.freq, rampTime + 0.015);

		window.keyboardPreview.note = noteInfo.note;
		window.keyboardPreview.freq = noteInfo.freq;
		window.keyboardPreview.keyIndex = noteInfo.keyIndex;
		return;
	}

	// Prehratie novej noty ako jednoduchej sínusovky pri hlavnej hlasitosti.
	if (!window.keyboardPreview.active) {
		var osc = ctx.createOscillator();
		var gain = ctx.createGain();
		osc.type = 'sine';
		gain.gain.value = 0;
		osc.frequency.value = noteInfo.freq;
		osc.connect(gain);

		try {
			var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
				? window.nativeMasterBus
				: ctx.destination;
			gain.connect(destination);
		} catch (e) {
			try {
				gain.connect(ctx.destination);
			} catch (e2) {
				Logger.warn('Keyboard preview: Could not connect audio');
				return;
			}
		}

		osc.start(now);

		// Plynulý nábeh po 20 ms.
		var rampStart = now + 0.02;
		gain.gain.setValueAtTime(0, rampStart);
		gain.gain.linearRampToValueAtTime(targetGain, rampStart + 0.06);

		window.keyboardPreview = {
			active: true,
			note: noteInfo.note,
			freq: noteInfo.freq,
			instIdx: instIdx,
			keyIndex: noteInfo.keyIndex,
			osc: osc,
			gain: gain
		};
	}
}

function stopKeyboardPreview() {
	if (window.keyboardPreview.active) {
		var now = Tone.now();

		if (window.keyboardPreview.osc && window.keyboardPreview.gain) {
			var oscToStop = window.keyboardPreview.osc;
			var gainToStop = window.keyboardPreview.gain;

			// Plynulé stíšenie, aby sa predišlo klikom.
			var currentGain = gainToStop.gain.value;
			var fadeStart = now + 0.02;
			var fadeEnd = fadeStart + 0.08;
			gainToStop.gain.setValueAtTime(currentGain, fadeStart);
			gainToStop.gain.linearRampToValueAtTime(0, fadeEnd);
			try { oscToStop.stop(fadeEnd + 0.05); } catch(e){}

			// Odstránenie po stíšení.
			setTimeout(() => {
				try {
					oscToStop.disconnect();
					gainToStop.disconnect();
				} catch (e) {}
			}, 200);
		}

		window.keyboardPreview = {
			active: false,
			note: null,
			freq: null,
			instIdx: 0,
			keyIndex: -1,
			osc: null,
			gain: null
		};
	}
}

document.addEventListener('mousedown', async e => {
	var overlay = document.getElementById('startOverlay');
	if (!initDone && (!overlay || overlay.style.display === 'none')) {
		if (Tone.context.state !== 'running') {
			await Tone.context.resume();
		}
		// Latencia Tone.js sa týmto zníži, keďže predvolený lookAhead je 0,1 s a pridáva 100 ms oneskorenie.
		Tone.context.lookAhead = 0.01; // 10 ms lookAhead pre nižšiu latenciu.
		loadSynths();
		// Predinicializácia AudioWorklet, aby bol pripravený na prvé prehrávanie.
		PlaybackManager.initWorklet();
		Canvas.step();
		initDone = true;
	}
	var t = e.target;
	if (t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'canvasElement') {
		if (!Canvas.canvas) return;

		// Dočasná slučka sa vytvorí medzerníkom a ťahaním, ktoré vymedzí jej zónu.
		if (select.momentaryLoop.keyHeld && e.button === 0 && e.offsetX >= 60 && e.offsetY <= Canvas.cssHeight - timeRegionHeight) {
			e.preventDefault();
			select.momentaryLoop.active = true;
			select.momentaryLoop.startX = e.offsetX;

			var clickTime = (e.offsetX - 60.5 - Canvas.offx) / barSize;

			// Nastavenie malej počiatočnej zóny slučky, ktorá sa rozšíri ťahaním.
			playback.loopStart = Math.max(0, clickTime);
			playback.loopEnd = clickTime + 0.1;

			// Zapnutie checkboxu slučky s identifikátorom 'playback-loop'.
			var loopCheckbox = document.getElementById('playback-loop');
			if (loopCheckbox) loopCheckbox.checked = true;

			// Presun hlavy prehrávania na začiatok slučky a spustenie prehrávania, ak ešte nehrá.
			playback.time = playback.loopStart;
			if (!playback.playing) {
				playback.playing = true;
				playbackUIPlay.dataset.playing = playback.playing;
				playback.timestamp = Date.now();
				playbackUIPlay.querySelector('i').classList.remove('fa-play');
				playbackUIPlay.querySelector('i').classList.add('fa-pause');
			}
			return;
		}


		// Stredné tlačidlo spúšťa režim voľného posúvania.
		if (e.button === 1) {
			e.preventDefault();
			select.middleDrag = true;
			select.x = e.offsetX;
			select.y = e.offsetY;
			select.offx = Canvas.offx;
			select.offy = Canvas.offy;
			Canvas.canvas.style.cursor = 'grabbing';
			return;
		}
		
		// Kontrola dvojkliku (druhý mousedown do 400 ms a 10 px).
		var now_ts = Date.now();
		var timeSinceLastClick = now_ts - select.lastClickTime;
		var distFromLastClick = Math.sqrt(
			Math.pow(e.offsetX - select.lastClickX, 2) + 
			Math.pow(e.offsetY - select.lastClickY, 2)
		);
		var isDoubleClick = timeSinceLastClick < 400 && distFromLastClick < 10;

		select.lastClickTime = now_ts;
		select.lastClickX = e.offsetX;
		select.lastClickY = e.offsetY;
		
		// Kontrola, ak je pod myšou parciál (potrebné pri dvojkliku aj pri kreslení).
		Canvas.checkPartialHover(e.offsetX, e.offsetY);
		var isOverPartial = partialNumber > 0;

		var allowNoteCreation = !isOverPartial;
		// Debounce, aby sa predišlo dvojitému vytvoreniu noty (prestávka 500 ms).
		var noteCreationDebounce = now_ts - select.lastNoteCreationTime > 500;
		if (isDoubleClick && noteCreationDebounce && !(e.ctrlKey || e.metaKey) && e.offsetX >= 60 && e.offsetY <= Canvas.cssHeight - timeRegionHeight && allowNoteCreation) {
			select.lastNoteCreationTime = now_ts;
			var selectedInstIdx = 0;
			for (let i = 0; i < instruments.length; i++) {
				if (instruments[i].selected) {
					selectedInstIdx = i;
					break;
				}
			}

			// Zistenie počtu nôt pred pridaním.
			var noteCountBefore = MIDI.data[selectedInstIdx] ? MIDI.data[selectedInstIdx].length : 0;
			var beforeNoteCreate = structuredClone(MIDI.data);

			MIDI.addNote(e.offsetX, e.offsetY);

			// Zistí sa počet nôt po pridaní, nová nota je posledná.
			var noteCountAfter = MIDI.data[selectedInstIdx] ? MIDI.data[selectedInstIdx].length : 0;

			// Ak bola nota skutočne pridaná, zapne sa režim ťahania na zmenu veľkosti.
			if (noteCountAfter > noteCountBefore) {
				var newNoteIdx = noteCountAfter - 1;
				var newNote = MIDI.data[selectedInstIdx][newNoteIdx];

				// Kontrola, či je aktívne adaptívne ladenie.
				if (typeof AdaptiveTuning !== 'undefined' && typeof Timeline !== 'undefined') {
					const noteTime = newNote[0];
					const tuningKey = Timeline.getTuningAtTime(noteTime, selectedInstIdx);
					if (AdaptiveTuning.isAdaptive(tuningKey)) {
						var originalPartial = newNote[3];
						var spectrum = spectra[instruments[selectedInstIdx].spectrum];
						var spectrumData = typeof DynamicTimbre !== 'undefined'
							? DynamicTimbre.getPartialsAtPitch(spectrum, newNote[2])
							: getTimbrePartials(spectrum, newNote[2]);
						const partialRatio = spectrumData && spectrumData[originalPartial - 1] ?
							spectrumData[originalPartial - 1][0] : 1;

						// Výpočet aktuálnej frekvencie základného tónu.
						var currentFreq = note2freq(newNote[2]) / partialRatio;

						var pitches = AdaptiveTuning.getPitchesAtTimeExcluding(noteTime, selectedInstIdx, tuningKey, newNoteIdx);

						// Hľadanie najbližšej výšky podľa logaritmickej vzdialenosti.
						var snappedFreq = currentFreq;
						if (pitches && pitches.length > 0) {
							var logFreq = Math.log2(currentFreq);
							var nearest = pitches[0];
							var nearestDist = Math.abs(logFreq - Math.log2(nearest.freq));
							for (let i = 1; i < pitches.length; i++) {
								const dist = Math.abs(logFreq - Math.log2(pitches[i].freq));
								if (dist < nearestDist) {
									nearest = pitches[i];
									nearestDist = dist;
								}
							}
							snappedFreq = nearest.freq;
						}

						var newNote2 = freq2note(snappedFreq * partialRatio);

						newNote[2] = newNote2;
						// newNote[3] ostáva nezmenené (zachovanie čísla parciálu).

						// Aktualizácia pozícií všetkých parciálov podľa novej výšky.
						if (newNote[4] && newNote[4].partials) {
							var baseRatio = spectrumData[originalPartial - 1] ?
								spectrumData[originalPartial - 1][0] : 1;
							for (let pIdx = 0; pIdx < newNote[4].partials.length; pIdx++) {
								var specRatio = spectrumData[pIdx] ? spectrumData[pIdx][0] : (pIdx + 1);
								const partialY = freq2note(note2freq(newNote[2]) / baseRatio * specRatio);
								newNote[4].partials[pIdx][1] = partialY;
							}
						}

						// Obnovenie cache po pridaní noty.
						AdaptiveTuning.refresh();
					}
				}

				select.dblClickCreating = true;
				select.dblClickNote = {
					instIdx: selectedInstIdx,
					noteIdx: newNoteIdx,
					startTime: newNote[0],
					startMouseX: e.offsetX,
					resizing: false
				};

				for (let ti = 0; ti < MIDI.data.length; ti++) {
					if (!MIDI.data[ti]) continue;
					for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
						const note = MIDI.data[ti][ni];
						note[N_SEL] = 0;
						if (note[N_DATA] && note[N_DATA].partials) {
							for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
								note[N_DATA].partials[pi][4] = 0; // Zrušenie výberu
								note[N_DATA].partials[pi][5] = 0; // Zvýraznenie sa zruší.
							}
						}
					}
				}
				newNote[N_SEL] = 1;
				if (newNote[N_DATA] && newNote[N_DATA].partials) {
					const activePartialIdx = (newNote[N_PARTIAL] || 1) - 1;
					if (activePartialIdx >= 0 && activePartialIdx < newNote[N_DATA].partials.length) {
						newNote[N_DATA].partials[activePartialIdx][4] = 1; // Výber aktívneho parciálu.
					}
				}

				if (window['switch-checkbox-headphones']?.checked) {
					const inst = instruments[selectedInstIdx];
					const timbre = spectra[inst?.spectrum];
					var fundamentalPitch = newNote[N_PITCH];

					if (timbre && typeof DynamicTimbre !== 'undefined') {
						const partialsData = DynamicTimbre.getPartialsAtPitch(timbre, newNote[N_PITCH]);
						const activePartialIdx = (newNote[N_PARTIAL] || 1) - 1;
						const partialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
						fundamentalPitch = freq2note(note2freq(newNote[N_PITCH]) / partialRatio);
					}

					requestAnimationFrame(() => Canvas.previewNoteWithTimbre(selectedInstIdx, fundamentalPitch, 0.5));
				}
			}

			DB.set('MIDIdata', MIDI.data);
			if (typeof UndoManager !== 'undefined') {
				UndoManager.recordSnapshot('Create note', 'MIDIdata', { MIDIdata: beforeNoteCreate }, { MIDIdata: structuredClone(MIDI.data) });
			}
			return; // Bežná logika mousedown sa preskočí.
		}

		// Ak ide o zónu klaviatúry.
		if (e.offsetX < 60) {
			// V zóne kláves (x >= 40) sa prehrávajú noty.
			if (e.offsetX >= 40) {
				var noteInfo = getKeyboardNoteAtY(e.offsetY);
				if (noteInfo) {
					playKeyboardPreview(noteInfo);
					select.keyboardPlaying = true;
				}
				return;
			}
			// V zóne popiskov (x < 40) sa posúva.
			select.keyboard = true;
			Canvas.canvas.style.cursor = 'grab';
			select.y = e.offsetY;
			select.offy = Canvas.offy;
			return;
		}
		if (select.keyboard) select.keyboard = false;
		if (select.keyboardPlaying) {
			stopKeyboardPreview();
			select.keyboardPlaying = false;
		}

		// V zóne časovej osi sa spustí jej posúvanie.
		if (e.offsetY > Canvas.cssHeight - timeRegionHeight) {
			select.timeline = true;
			Canvas.canvas.style.cursor = 'grab';
			select.x = e.offsetX;
			select.offx = Canvas.offx;
			return;
		}
		if (select.timeline) select.timeline = false;
		select.selecting = true;
		select.x = e.offsetX;
		select.y = e.offsetY;
		select.type = e.button;
		select.moving = false;
		select.resizeLeft = false;
		select.resizeRight = false;
		select.tempLoopStart = null;
		select.tempLoopEnd = null;
		if (e.altKey && typeof Canvas !== 'undefined' && Canvas.beginVelocityDrag && Canvas.beginVelocityDrag(e.offsetY, partialNumber ? partialNote : null)) {
			select.velocityDragging = true;
			select.selecting = false;
			if (Canvas.canvas) Canvas.canvas.style.cursor = 'ns-resize';
			return;
		}
		var now = Tone.now();
		if (!playback.playing) {
			playback.time = Math.max(0, (e.offsetX - 60.5 - Canvas.offx)/barSize);

			// Pri Shift+kliku sa hlava prehrávania prichytí k mriežke.
			if (e.shiftKey && typeof GridSystem !== 'undefined') {
				const trackIdx = typeof Timeline !== 'undefined' ? Timeline.getCurrentTrackIdx() : 0;
				var snapped = GridSystem.snapToGrid(playback.time, trackIdx, 10);
				if (snapped !== null) {
					playback.time = snapped;
				}
			}

			// Uloží sa stabilný čas na prichytávanie výšky MIDI, ktorý sa počas ťahania výberu nemení.
			playback.midiTime = playback.time;
			debouncedSaveViewState();
		}
		var potentialMovePartial = null;
		if (!e.shiftKey) {
			for (let iCheck = 0; iCheck < MIDI.data.length; iCheck++) {
				if (!instruments[iCheck] || !instruments[iCheck].selected || !MIDI.data[iCheck]) continue;

				for (let jCheck = 0; jCheck < MIDI.data[iCheck].length; jCheck++) {
					var notePartialsCheck = MIDI.data[iCheck][jCheck][4]?.partials;
					if (!notePartialsCheck) continue;

					for (let kCheck = notePartialsCheck.length - 1; kCheck >= 0; kCheck--) {
						if (!Canvas.partialBrightness && kCheck !== MIDI.data[iCheck][jCheck][3]-1) continue;

						var partial = notePartialsCheck[kCheck];
						if (!partial) continue;
						
						var partialXCheck = Canvas.offx + partial[0] * barSize;
						var partialWCheck = partial[2] * barSize;
						var partialHCheck = partial[3] * Math.min(octaveSpacingStep, 10);
						// Pri pozícii Y sa odčíta výška, aby partialYCheck bol horný okraj parciálu.
						var partialYCheck = Canvas.offy - partial[1] * octaveSpacingStep - partialHCheck;
						
						
						var mouseXCheck = e.offsetX - 60.5;
						var mouseYCheck = e.offsetY;
						
						if (partialXCheck < mouseXCheck && mouseXCheck < partialXCheck + partialWCheck) {
							let topEdgeY = partialYCheck;
							let bottomEdgeY = partialYCheck + partialHCheck;
							
							
							if (topEdgeY < mouseYCheck && mouseYCheck < bottomEdgeY) {
								if (partial[4]) {
									// Kontrola, či je v oblasti presunu.
									if (mouseXCheck >= partialXCheck + resizingRegionSize
											&& mouseXCheck <= partialXCheck + partialWCheck - resizingRegionSize) {
										potentialMovePartial = [iCheck, jCheck, kCheck];
									}
								}
								break;
							}
						}
					}
					if (potentialMovePartial) break;
				}
				if (potentialMovePartial) break;
			}
		}
		// Prehrá sa na aktuálnej pozícii, ale nie vtedy, ak práve ide o Ctrl+ťahanie duplikátu.
		if ((e.ctrlKey || e.metaKey) && !potentialMovePartial) {
			const mouseX = e.offsetX - 60.5;
			const mouseY = e.offsetY;
			var mouseTime = (mouseX - Canvas.offx) / barSize;
			var playedPartial = false;
			var iC3, jC3, kC3, MIDInotePartialsSP1;

			// Najprv kontrola, či ide o klik na konkrétny parciál.
			for (iC3 = 0; iC3 < MIDI.data.length; iC3++) {
				if (!instruments[iC3] || !MIDI.data[iC3]) continue;

				for (jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
					const note = MIDI.data[iC3][jC3];
					if (!note[N_DATA] || !note[N_DATA].partials) continue;

					var spectrumSP1 = spectra[instruments[iC3].spectrum];
					MIDInotePartialsSP1 = typeof DynamicTimbre !== 'undefined'
						? DynamicTimbre.getPartialsAtPitch(spectrumSP1, note[N_PITCH])
						: getTimbrePartials(spectrumSP1, note[N_PITCH]);
					
					for (kC3 = MIDInotePartialsSP1.length - 1; kC3 >= 0; kC3--) {
						// Preskočenie neviditeľných parciálov, okrem aktívneho parciálu.
						if (!Canvas.partialBrightness && kC3 !== note[N_PARTIAL] - 1) continue;
						
						var partialData = note[N_DATA].partials[kC3];
						if (!partialData) continue;
						
						const partialX = Canvas.offx + partialData[0] * barSize;
						const partialW = partialData[2] * barSize;
						const defaultOctaveSpacingStep = 10;
						const partialH = partialData[3] * Math.min(octaveSpacingStep, defaultOctaveSpacingStep);
						let partialY = Canvas.offy - partialData[1] * octaveSpacingStep - partialH;
						

						if (mouseX >= partialX && mouseX <= partialX + partialW) {
							let topEdgeY = partialY;
							let bottomEdgeY = partialY + partialH;


							if (mouseY >= topEdgeY && mouseY <= bottomEdgeY) {
								// Kliklo sa na konkrétny parciál, takže sa prehrá ako čistá sínusovka.
								const fundamentalFreq = note2freq(note[N_PITCH]) / MIDInotePartialsSP1[note[N_PARTIAL] - 1][0];
								const partialFreq = fundamentalFreq * MIDInotePartialsSP1[kC3][0];
								var previewSynth = Canvas._getPreviewSynth();
								if (previewSynth) {
									previewSynth.triggerAttackRelease(partialFreq, "8n", now);
								}
								playedPartial = true;
								break;
							}
						}
					}
					if (playedPartial) break;
				}
				if (playedPartial) break;
			}
			
			// Ak nešlo o klik na konkrétny parciál, prehrajú sa základné tóny na pozícii myši.
			if (!playedPartial) {
				for (iC3 = 0; iC3 < MIDI.data.length; iC3++) {
					if (!MIDI.data[iC3]) continue;
					for (jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
						const note = MIDI.data[iC3][jC3];
						if (note[N_TIME] <= mouseTime && mouseTime <= note[N_TIME] + note[N_DUR]) {
							if (window.synths && window.synths[iC3]) {
								window.synths[iC3].triggerAttackRelease(note2freq(note[N_PITCH]) / note[N_PARTIAL], "8n", now);
							}
						}
					}
				}
			}
		} else if (!e.shiftKey) {
			let movingPartial = [],
				resizingPartialLeft = [],
				resizingPartialRight = [],
				clickedPartial = [],
				partialX,
				partialY,
				partialX2,
				partialY2;
			// Najprv sa prejdú všetky parciály a zistí sa, či niektorý má byť v režime "presúvania".
			for (iC3 = 0; iC3 < MIDI.data.length; iC3++) {
				// Vynechanie, ak nástroj neexistuje (nesúlad dát).
				if (!instruments[iC3]) continue;
				if (!instruments[iC3].selected) continue;
				if (!MIDI.data[iC3]) continue;
				for (jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
					// Berie sa skutočná dĺžka poľa 'partials' danej noty namiesto počtu parciálov v spektre stopy.
					const notePartialsLen = MIDI.data[iC3][jC3][4]?.partials?.length || 0;
					for (kC3 = notePartialsLen - 1; kC3 >= 0; kC3--) {
						if (!MIDI.data[iC3][jC3][4] || !MIDI.data[iC3][jC3][4].partials[kC3]) continue;
						
						MIDI.data[iC3][jC3][4].partials[kC3][5] = 0;
						if (!Canvas.partialBrightness && kC3 !== MIDI.data[iC3][jC3][3]-1) continue;
							partialX = Canvas.offx + MIDI.data[iC3][jC3][4].partials[kC3][0] * barSize;
							const partialW = MIDI.data[iC3][jC3][4].partials[kC3][2] * barSize;
							const defaultOctaveSpacingStep = 10;
							const partialH = MIDI.data[iC3][jC3][4].partials[kC3][3] * Math.min(octaveSpacingStep, defaultOctaveSpacingStep);
							partialY = Canvas.offy - MIDI.data[iC3][jC3][4].partials[kC3][1] * octaveSpacingStep - partialH;
							partialX2 = Canvas.offx + MIDI.data[iC3][jC3][4].partials[kC3][0] * barSize + MIDI.data[iC3][jC3][4].partials[kC3][2] * barSize;
							partialY2 = Canvas.offy - MIDI.data[iC3][jC3][4].partials[kC3][1] * octaveSpacingStep;
						const mouseX = e.offsetX - 60.5;
						const mouseY = e.offsetY;

						var isInLeftResizeRegion = mouseX > partialX - resizingRegionSize && mouseX < partialX + resizingRegionSize;
						var isInRightResizeRegion = mouseX > partialX + partialW - resizingRegionSize && mouseX < partialX + partialW + resizingRegionSize;
						var isInResizeRegion = isInLeftResizeRegion || isInRightResizeRegion;

						// Pri oblastiach na zmenu veľkosti sa kontroluje rozsah Y na okraji.
						if (isInResizeRegion) {
							let topEdgeY = partialY;
							let bottomEdgeY = partialY + partialH;
							
							
							if (topEdgeY < mouseY && mouseY < bottomEdgeY) {
								clickedPartial = [iC3, jC3, kC3];
								if (isInLeftResizeRegion) {
									resizingPartialLeft = [iC3, jC3, kC3];
								} else {
									resizingPartialRight = [iC3, jC3, kC3];
								}
								break;
							}
						}
						// Kontrola, či je mouseX v rozsahu parciálu (na klik alebo presun).
						if (partialX < mouseX && mouseX < partialX + partialW) {
							let topEdgeY = partialY;
							let bottomEdgeY = partialY + partialH;


							// Kontrola, či je mouseY v skosenom rozsahu.
							if (topEdgeY < mouseY && mouseY < bottomEdgeY) {
								clickedPartial = [iC3, jC3, kC3];

								// Okraje menia veľkosť aj pri nevybranom parciáli; presun stredom vyžaduje výber.
								if (mouseX < partialX + resizingRegionSize) {
									resizingPartialLeft = [iC3, jC3, kC3];
								} else if (mouseX > partialX + partialW - resizingRegionSize) {
									resizingPartialRight = [iC3, jC3, kC3];
								} else if (MIDI.data[iC3][jC3][4].partials[kC3][4]) {
									movingPartial = [iC3, jC3, kC3];
								}
								break;
							}
						}
					}
					if (clickedPartial.length > 0) break;
				}
				if (clickedPartial.length > 0) break;
			}
			// Klik na parciály.
			if (clickedPartial.length > 0 &&
				!MIDI.data[clickedPartial[0]][clickedPartial[1]][4].partials[clickedPartial[2]][4]) {

				for (iC3 = 0; iC3 < MIDI.data.length; iC3++) {
					if (!MIDI.data[iC3]) continue;
					for (jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
						// Ak ide o starší formát parciálu z predchádzajúcich verzií Spectry, nevyberie sa.
						if (MIDI.data[iC3][jC3].length < 5 || !MIDI.data[iC3][jC3][4] || !MIDI.data[iC3][jC3][4].partials) continue;
						// Berie sa skutočná dĺžka poľa 'partials' danej noty namiesto počtu parciálov v spektre stopy.
						const notePartialsLen = MIDI.data[iC3][jC3][4].partials.length;
						for (kC3 = notePartialsLen - 1; kC3 >= 0; kC3--) {
							if (!MIDI.data[iC3][jC3][4].partials[kC3]) continue;
							MIDI.data[iC3][jC3][4].partials[kC3][4] = 0;
							MIDI.data[iC3][jC3][4].partials[kC3][5] = 0;
						}
					}
				}

				MIDI.data[clickedPartial[0]][clickedPartial[1]][4].partials[clickedPartial[2]][4] = 1;
				if (resizingPartialLeft.length === 0 && resizingPartialRight.length === 0) {
					movingPartial = clickedPartial;
				}

				// Spustenie sínusového predprehrávania, ktoré znie počas držania; plná farba sa prehrá až pri mouseup.
				if (movingPartial.length > 0 && window['switch-checkbox-headphones']?.checked) {
					const trackIdx = clickedPartial[0];
					const clickedNote = MIDI.data[trackIdx][clickedPartial[1]];
					const clickedPartialIdx = clickedPartial[2];
					const inst = instruments[trackIdx];
					const timbre = spectra[inst?.spectrum];

					// Výpočet frekvencie kliknutého parciálu.
					const partialsData = (timbre && typeof DynamicTimbre !== 'undefined')
						? DynamicTimbre.getPartialsAtPitch(timbre, clickedNote[N_PITCH])
						: getTimbrePartials(timbre, clickedNote[N_PITCH]);
					const activePartialIdx = (clickedNote[N_PARTIAL] || 1) - 1;
					const activePartialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
					const fundamentalFreq = note2freq(clickedNote[N_PITCH]) / activePartialRatio;
					const clickedPartialRatio = partialsData?.[clickedPartialIdx]?.[0] || (clickedPartialIdx + 1);
					const clickedPartialAmp = partialsData?.[clickedPartialIdx]?.[1] ?? 1;
					const partialFreq = fundamentalFreq * clickedPartialRatio;

					Canvas.previewPartialSine(partialFreq, clickedPartialAmp, trackIdx);
					select.heldPartialPreview = { trackIdx, noteIdx: clickedPartial[1] };
				}
			}
			// Ak sa nič nemá presúvať, zruší sa výber všetkých parciálov.
			if (clickedPartial.length === 0 && movingPartial.length === 0
					&& resizingPartialLeft.length === 0
					&& resizingPartialRight.length === 0) {

				// Pri držanom Ctrl sa predprehrá celý akord.
				for (iC3 = 0; iC3 < MIDI.data.length; iC3++) {
					if (!MIDI.data[iC3]) continue;
					for (jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
						if (!MIDI.data[iC3][jC3][4] || !MIDI.data[iC3][jC3][4].partials) continue;

						const notePartialsLen = MIDI.data[iC3][jC3][4].partials.length;
						for (kC3 = notePartialsLen - 1; kC3 >= 0; kC3--) {
							if (!MIDI.data[iC3][jC3][4].partials[kC3]) continue;
							MIDI.data[iC3][jC3][4].partials[kC3][4] = 0;
							MIDI.data[iC3][jC3][4].partials[kC3][5] = 0;
						}

					}
				}
			}
			if (movingPartial.length > 0) {
				// Spustenie sínusového predprehrávania, ak ešte nebežalo, čo rieši kliknutie na už vybrané parciály.
				if (!select.heldPartialPreview && window['switch-checkbox-headphones']?.checked) {
					const trackIdx = movingPartial[0];
					const clickedNote = MIDI.data[trackIdx][movingPartial[1]];
					const clickedPartialIdx = movingPartial[2];
					const inst = instruments[trackIdx];
					const timbre = spectra[inst?.spectrum];

					const partialsData = (timbre && typeof DynamicTimbre !== 'undefined')
						? DynamicTimbre.getPartialsAtPitch(timbre, clickedNote[N_PITCH])
						: getTimbrePartials(timbre, clickedNote[N_PITCH]);
					const activePartialIdx = (clickedNote[N_PARTIAL] || 1) - 1;
					const activePartialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
					const fundamentalFreq = note2freq(clickedNote[N_PITCH]) / activePartialRatio;
					const clickedPartialRatio = partialsData?.[clickedPartialIdx]?.[0] || (clickedPartialIdx + 1);
					const clickedPartialAmp = partialsData?.[clickedPartialIdx]?.[1] ?? 1;
					const partialFreq = fundamentalFreq * clickedPartialRatio;

					Canvas.previewPartialSine(partialFreq, clickedPartialAmp, trackIdx);
					select.heldPartialPreview = { trackIdx, noteIdx: movingPartial[1] };
				}

				// Ctrl+ťahanie znamená duplikovanie vybraných nôt.
				var duplicatedKeys = new Set(); // Atribúty v tvare 'stopa:finálnyIndex' pre noty vytvorené daným gestom.
				if ((e.ctrlKey || e.metaKey)) {
					var duplicatedNotes = []; // Zoznam vytvorených nôt.

					for (let i = 0; i < MIDI.data.length; i++) {
						if (!instruments[i] || !MIDI.data[i]) continue;

						var notesToAdd = [];

						for (let j = 0; j < MIDI.data[i].length; j++) {
							if (MIDI.data[i][j].length < 5 || !MIDI.data[i][j][4] || !MIDI.data[i][j][4].partials) continue;

							var partials = MIDI.data[i][j][4].partials;
							var isSelected = false;
							for (let k = 0; k < partials.length; k++) {
								if (partials[k][4]) {
									isSelected = true;
									break;
								}
							}

							if (isSelected) {
								var duplicateNote = structuredClone(MIDI.data[i][j]);

								// Na duplikátoch sa zvýraznenie zruší, zachová sa len výber [4].
								for (let k = 0; k < duplicateNote[4].partials.length; k++) {
									duplicateNote[4].partials[k][5] = 0;
								}

								// Zrušenie výberu parciálov pôvodnej noty.
								for (let k = 0; k < partials.length; k++) {
									partials[k][4] = 0;
									partials[k][5] = 0;
								}

								// Duplikát si ponechá výber (klonovaný už s [4]=true).
								notesToAdd.push(duplicateNote);
								duplicatedNotes.push({inst: i, noteIndex: MIDI.data[i].length + notesToAdd.length - 1});
								duplicatedKeys.add(i + ':' + (MIDI.data[i].length + notesToAdd.length - 1));
							}
						}

						for (let note of notesToAdd) {
							MIDI.data[i].push(note);
						}
					}

					Logger.log(`Ctrl+drag: duplicated ${duplicatedNotes.length} note(s)`);
				}

				select.deltaX = e.offsetX;
				select.deltaY = e.offsetY;
				select.initialDragX = e.offsetX;
				select.initialDragY = e.offsetY;
				select.moving = true;
				select.scrollMoveStep = 0;  // Vynulovanie počítadla krokov v režime scrollovania.
				select.scrollMoveIndices = {};  // V režime scrollovania sa vynuluje sledovanie indexov.

				// Sledujú sa len vybrané noty namiesto klonovania celého MIDI.data.
				select.dragTrackedNotes = new Map();
				select.dragTrackedBefore = {};  // trackIdx -> [{noteIndex, before}].
				select.dragChanged = false;
				select.dragHadDuplicates = duplicatedKeys.size > 0;
				for (let ti = 0; ti < MIDI.data.length; ti++) {
					if (!MIDI.data[ti]) continue;
					for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
						const note = MIDI.data[ti][ni];
						if (!note[N_DATA] || !note[N_DATA].partials) continue;
						for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
							if (note[N_DATA].partials[pi][4] || note[N_DATA].partials[pi][5]) {
								// Zaznamenanie počiatočného stavu danej noty.
								if (!select.dragTrackedNotes.has(ti)) {
									select.dragTrackedNotes.set(ti, new Map());
								}
								// Ukladá sa: [x, šírka, výška, parciál, vybraný, zvýraznený].
								select.dragTrackedNotes.get(ti).set(ni, [
									note[N_TIME], note[N_DUR], note[N_PITCH], note[N_PARTIAL],
									note[N_DATA].partials[pi][4], note[N_DATA].partials[pi][5]
								]);
								// Klonovanie pre krok vzad.
								if (!select.dragTrackedBefore[ti]) select.dragTrackedBefore[ti] = [];
								select.dragTrackedBefore[ti].push({
									noteIndex: ni,
									before: duplicatedKeys.has(ti + ':' + ni) ? null : structuredClone(note)
								});
								break;
							}
						}
					}
				}

				Canvas.canvas.style.cursor = 'grabbing';
			}
			if (resizingPartialLeft.length > 0) {
				select.deltaX = e.offsetX;
				select.deltaY = e.offsetY;
				select.initialDragX = e.offsetX;  // Uloží sa pôvodné x.
				select.moving = false;
				select.resizeLeft = true;

				// Len vybrané noty namiesto klonovania celého MIDI.data.
				select.dragTrackedNotes = new Map();
				select.dragTrackedBefore = {};
				select.dragChanged = false;
				for (let ti = 0; ti < MIDI.data.length; ti++) {
					if (!MIDI.data[ti]) continue;
					for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
						const note = MIDI.data[ti][ni];
						if (!note[N_DATA] || !note[N_DATA].partials) continue;
						for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
							if (note[N_DATA].partials[pi][4] || note[N_DATA].partials[pi][5]) {
								if (!select.dragTrackedNotes.has(ti)) {
									select.dragTrackedNotes.set(ti, new Map());
								}
								select.dragTrackedNotes.get(ti).set(ni, [
									note[N_TIME], note[N_DUR], note[N_PITCH], note[N_PARTIAL],
									note[N_DATA].partials[pi][4], note[N_DATA].partials[pi][5]
								]);
								if (!select.dragTrackedBefore[ti]) select.dragTrackedBefore[ti] = [];
								select.dragTrackedBefore[ti].push({
									noteIndex: ni,
									before: structuredClone(note)
								});
								break;
							}
						}
					}
				}
			}
			if (resizingPartialRight.length > 0) {
				select.deltaX = e.offsetX;
				select.deltaY = e.offsetY;
				select.initialDragX = e.offsetX;  // Uloží sa pôvodné x.
				select.moving = false;
				select.resizeRight = true;

				// Len vybrané noty namiesto klonovania celého MIDI.data.
				select.dragTrackedNotes = new Map();
				select.dragTrackedBefore = {};
				select.dragChanged = false;
				for (let ti = 0; ti < MIDI.data.length; ti++) {
					if (!MIDI.data[ti]) continue;
					for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
						const note = MIDI.data[ti][ni];
						if (!note[N_DATA] || !note[N_DATA].partials) continue;
						for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
							if (note[N_DATA].partials[pi][4] || note[N_DATA].partials[pi][5]) {
								if (!select.dragTrackedNotes.has(ti)) {
									select.dragTrackedNotes.set(ti, new Map());
								}
								select.dragTrackedNotes.get(ti).set(ni, [
									note[N_TIME], note[N_DUR], note[N_PITCH], note[N_PARTIAL],
									note[N_DATA].partials[pi][4], note[N_DATA].partials[pi][5]
								]);
								if (!select.dragTrackedBefore[ti]) select.dragTrackedBefore[ti] = [];
								select.dragTrackedBefore[ti].push({
									noteIndex: ni,
									before: structuredClone(note)
								});
								break;
							}
						}
					}
				}
			}
		}
	}
	else if (t.classList.contains('pane-instrument-name')
			|| t.classList.contains('pane-instrument-spectrum')
			|| t.classList.contains('pane-instrument-strip')) {
		clickPaneInstrument(t.parentNode, e);
	}
});
document.addEventListener('mouseup', e => {
	if (Canvas.canvas) Canvas.canvas.style.cursor = 'default';
	var t = e.target;

	if (select.velocityDragging) {
		if (typeof Canvas !== 'undefined' && Canvas.commitVelocityDrag) Canvas.commitVelocityDrag();
		select.velocityDragging = false;
		return;
	}

	// Prepojenie pre tutoriály a rozšírenia.
	if (t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'canvasElement') {
		Spectra.callHooks('canvasMouseUp', e);
	}
	/*if (t.tagName && t.tagName.toLowerCase() === 'canvas') {
	}*/

	// Uloženie začiatku a konca slučky z výberu do dočasných premenných, ktoré sa uplatnia pri jej zapnutí.
	if (select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight
		&& t.tagName && t.tagName.toLowerCase() === 'canvas' && t.id === 'canvasElement') {
		var startX = Math.min(select.x, e.offsetX);
		var endX = Math.max(select.x, e.offsetX);

		// Uloženie začiatku a konca slučky len pri výbere širšom než 5 pixelov.
		if (endX - startX > 5) {
			var loopStart = (startX - 60.5 - Canvas.offx) / barSize;
			var loopEnd = (endX - 60.5 - Canvas.offx) / barSize;
			// Prichytenie k mriežke, ak je držaný Shift.
			if (e.shiftKey && typeof GridSystem !== 'undefined') {
				const trackIdx = Timeline ? Timeline.getCurrentTrackIdx() : 0;
				var snappedStart = GridSystem.snapToGrid(loopStart, trackIdx, 0.5);
				var snappedEnd = GridSystem.snapToGrid(loopEnd, trackIdx, 0.5);
				if (snappedStart !== null) loopStart = snappedStart;
				if (snappedEnd !== null) loopEnd = snappedEnd;
			}
			select.tempLoopStart = loopStart;
			select.tempLoopEnd = loopEnd;
		}
	}

	// Ukončenie režimu ťahania na zmenu veľkosti pri dvojkliku a uložení.
	if (select.dblClickCreating) {
		select.dblClickCreating = false;
		select.dblClickNote = null;
		DB.set('MIDIdata', MIDI.data);
	}

	if (select.scrollCreating) {
		select.scrollCreating = false;
		select.scrollNote = null;
		DB.set('MIDIdata', MIDI.data);
	}

	Canvas.stopDragSine();
	Canvas.stopPartialSine();
	if (select.heldPartialPreview && window['switch-checkbox-headphones']?.checked) {
		const { trackIdx, noteIdx } = select.heldPartialPreview;
		const note = MIDI.data[trackIdx]?.[noteIdx];
		if (note) {
			// Oneskorenie prehrávania farby, aby sínusovka najprv odznela, čím sa predíde kliku.
			setTimeout(() => {
				var inst = instruments[trackIdx];
				var timbre = spectra[inst?.spectrum];
				var fundamentalPitch = note[N_PITCH];
				if (timbre && typeof DynamicTimbre !== 'undefined') {
					var partialsData = DynamicTimbre.getPartialsAtPitch(timbre, note[N_PITCH]);
					var activePartialIdx = (note[N_PARTIAL] || 1) - 1;
					var partialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
					fundamentalPitch = freq2note(note2freq(note[N_PITCH]) / partialRatio);
				}
				Canvas.previewNoteWithTimbre(trackIdx, fundamentalPitch, 0.5);
			}, 60);
		}
		select.heldPartialPreview = null;
	}

	// Krok vzad pri presune a zmene veľkosti sa zapisuje deltami namiesto celého záznamu stavu.
	if ((select.moving || select.resizeLeft || select.resizeRight) && select.dragTrackedNotes) {
		// Prehratie noty po skončení ťahania výšky, teda len pri presune.
		var wasMoved = select.moving && select.dragChanged;

		if ((select.dragChanged || select.dragHadDuplicates) && typeof UndoManager !== 'undefined' && select.dragTrackedBefore) {
			var trackChanges = {};
			for (const trackIdx in select.dragTrackedBefore) {
				var changes = select.dragTrackedBefore[trackIdx];
				trackChanges[trackIdx] = changes.map(c => ({
					noteIndex: c.noteIndex,
					before: c.before,
					after: structuredClone(MIDI.data[trackIdx][c.noteIndex])
				}));
			}
			if (Object.keys(trackChanges).length > 0) {
				UndoManager.recordMultiTrackDelta(
					select.moving ? 'Move notes' : (select.resizeLeft ? 'Resize notes (left)' : 'Resize notes (right)'),
					trackChanges
				);
			}
		}
		select.dragHadDuplicates = false;
		DB.set('MIDIdata', MIDI.data, { skipUndo: true });

		if (wasMoved && window['switch-checkbox-headphones']?.checked) {
			// Najprv spočítanie vybraných nôt na kompenzáciu hlasitosti.
			const selectedNotes = [];
			for (let ti = 0; ti < MIDI.data.length; ti++) {
				if (!MIDI.data[ti]) continue;
				for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
					const note = MIDI.data[ti][ni];
					if (!note[N_DATA] || !note[N_DATA].partials) continue;
					let hasSelected = false;
					for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
						if (note[N_DATA].partials[pi][4]) { hasSelected = true; break; }
					}
					if (hasSelected) selectedNotes.push({ ti, note });
				}
			}
			const noteCount = selectedNotes.length;
			for (const { ti, note } of selectedNotes) {
				const inst = instruments[ti];
				const timbre = spectra[inst?.spectrum];
				let fundamentalPitch = note[N_PITCH];
				if (timbre && typeof DynamicTimbre !== 'undefined') {
					const partialsData = DynamicTimbre.getPartialsAtPitch(timbre, note[N_PITCH]);
					const activePartialIdx = (note[N_PARTIAL] || 1) - 1;
					const partialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
					fundamentalPitch = freq2note(note2freq(note[N_PITCH]) / partialRatio);
				}
				Canvas.previewNoteWithTimbre(ti, fundamentalPitch, 0.5, noteCount);
			}
		}
	}

	// Zachytí sa, či išlo o výber rámčekom, a to ešte pred resetom stavu.
	var wasBoxSelecting = select.selecting && !select.moving && !select.resizeLeft && !select.resizeRight;

	select.keyboard = false;
	select.timeline = false;
	select.middleDrag = false;
	if (select.keyboardPlaying) {
		stopKeyboardPreview();
		select.keyboardPlaying = false;
	}
	select.selecting = false;
	select.moving = false;
	select.resizeLeft = false;
	select.resizeRight = false;
	select.dragTrackedNotes = null;
	select.dragTrackedBefore = null;
	select.dragChanged = false;
	select.initialDragX = null;
	select.initialDragY = null;
	if (!MIDI.data) return;
	for (let iC3 = 0; iC3 < MIDI.data.length; iC3++) {
		for (let jC3 = 0; jC3 < MIDI.data[iC3].length; jC3++) {
			if (!MIDI.data[iC3][jC3][4] || !MIDI.data[iC3][jC3][4].partials) continue;
			var actualPartials = MIDI.data[iC3][jC3][4].partials;
			var partialsLength = actualPartials.length;

			var hasSelection = false;
			for (let kC3 = 0; kC3 < partialsLength; kC3++) {
				try {
					if (actualPartials[kC3] && actualPartials[kC3][4]) {
						hasSelection = true;
						break;
					}
				} catch {}
			}
			// Prevedie sa zvýraznenie na výber, len ak ešte nie je vybraný žiadny parciál.
			if (!hasSelection) {
				for (let kC3 = partialsLength - 1; kC3 >= 0; kC3--) {
					try {
						if (actualPartials[kC3] && actualPartials[kC3][5]) {
							actualPartials[kC3][4] = 1;
						}
					} catch {
					}
				}
			} else {
				// Zmazanie stavu zvýraznenia na notách, ktoré už majú výber.
				for (let kC3 = 0; kC3 < partialsLength; kC3++) {
					try {
						if (actualPartials[kC3]) {
							actualPartials[kC3][5] = 0;
						}
					} catch {}
				}
			}
		}
	}

	Canvas.stopSelectionPreview();

	// Prehratie vybraných nôt po výbere rámčekom, ale len pri zapnutom prehrávaní (slúchadlá) a len vtedy, keď výber rámčekom naozaj prebehol.
	if (wasBoxSelecting && window['switch-checkbox-headphones']?.checked) {
		// Spočítanie vybraných nôt na kompenzáciu hlasitosti.
		const selectedNotes = [];
		for (let ti = 0; ti < MIDI.data.length; ti++) {
			if (!MIDI.data[ti]) continue;
			for (let ni = 0; ni < MIDI.data[ti].length; ni++) {
				const note = MIDI.data[ti][ni];
				if (!note[N_DATA] || !note[N_DATA].partials) continue;
				let hasSelected = false;
				for (let pi = 0; pi < note[N_DATA].partials.length; pi++) {
					if (note[N_DATA].partials[pi][4]) { hasSelected = true; break; }
				}
				if (hasSelected) selectedNotes.push({ ti, note });
			}
		}
		const noteCount = selectedNotes.length;
		for (const { ti, note } of selectedNotes) {
			const inst = instruments[ti];
			const timbre = spectra[inst?.spectrum];
			let fundamentalPitch = note[N_PITCH];
			if (timbre && typeof DynamicTimbre !== 'undefined') {
				const partialsData = DynamicTimbre.getPartialsAtPitch(timbre, note[N_PITCH]);
				const activePartialIdx = (note[N_PARTIAL] || 1) - 1;
				const partialRatio = partialsData?.[activePartialIdx]?.[0] || 1;
				fundamentalPitch = freq2note(note2freq(note[N_PITCH]) / partialRatio);
			}
			Canvas.previewNoteWithTimbre(ti, fundamentalPitch, 0.5, noteCount);
		}
	}

	DB.set('MIDIdata', MIDI.data);
	// Obnovenie cache adaptívneho ladenia pri zmene nôt.
	if (typeof AdaptiveTuning !== 'undefined') {
		AdaptiveTuning.refresh();
	}
});

document.addEventListener('mouseleave', e => {
	if (e.target.id === 'canvasElement' && select.keyboardPlaying) {
		stopKeyboardPreview();
		select.keyboardPlaying = false;
	}
}, true);

function resetAllGestureStates() {
	if (select.keyboardPlaying) {
		stopKeyboardPreview();
	}
	select.keyboard = false;
	select.timeline = false;
	select.middleDrag = false;
	select.keyboardPlaying = false;
	select.selecting = false;
	select.moving = false;
	select.resizeLeft = false;
	select.resizeRight = false;
	select.velocityDragging = false;
	if (typeof Canvas !== 'undefined') Canvas._velDrag = null;
	select.dblClickCreating = false;
	select.dblClickNote = null;
	select.dragTrackedNotes = null;
	select.dragTrackedBefore = null;
	select.dragChanged = false;
	select.initialDragX = null;
	select.initialDragY = null;
	if (Canvas.canvas) Canvas.canvas.style.cursor = 'default';
}

function handleWindowBlur() {
	resetAllGestureStates();


	// Reset stavov modifikačných kláves, ktoré zostanú zaseknuté, ak sa pustia mimo aktívneho okna.
	altKey = false;
	ctrlKey = false;
	shiftKey = false;
}

function handleWindowFocus() {
	if (playback.playing) {
		playback.timestamp = Date.now();
	}
}

window.addEventListener('blur', handleWindowBlur);
window.addEventListener('focus', handleWindowFocus);
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		handleWindowBlur();
	} else {
		handleWindowFocus();
	}
});

document.addEventListener('DOMContentLoaded', async () => {
	if (typeof DB !== 'undefined' && DB.init && !DB.initialized) {
		await DB.init();
	}
});
// Prepínanie slučky
function toggleLoopMode() {
	var loopCheckbox = document.getElementById('playback-loop');
	if (!loopCheckbox) return;

	var wasEnabled = loopCheckbox.checked;
	loopCheckbox.checked = !wasEnabled;

	if (!wasEnabled) {
		// Prvá možnosť, použije sa dočasný začiatok a koniec slučky z výberu na plátne.
		if (select.tempLoopStart !== null && select.tempLoopEnd !== null) {
			playback.loopStart = select.tempLoopStart;
			playback.loopEnd = select.tempLoopEnd;
			select.tempLoopStart = null;
			select.tempLoopEnd = null;
		} else {
			// Druhá možnosť, skontrolujú sa vybrané noty.
			var minTime = Infinity, maxTime = -Infinity;

			if (MIDI.data) {
				for (let i = 0; i < MIDI.data.length; i++) {
					for (let j = 0; j < MIDI.data[i].length; j++) {
						var note = MIDI.data[i][j];
						if (note[N_DATA] && note[N_DATA].partials) {
							for (let k = 0; k < note[N_DATA].partials.length; k++) {
								if (note[N_DATA].partials[k][4]) {
									minTime = Math.min(minTime, note[N_TIME]);
									maxTime = Math.max(maxTime, note[N_TIME] + note[N_DUR]);
								}
							}
						}
					}
				}
			}

			if (minTime !== Infinity && maxTime !== -Infinity) {
				playback.loopStart = minTime;
				playback.loopEnd = maxTime;
			} else if (playback.loopStart === null || playback.loopEnd === null) {
				// Tretia možnosť, predvolene sa nastaví viditeľný rozsah.
				playback.loopStart = -Canvas.offx / barSize;
				playback.loopEnd = playback.loopStart + 4;
			}
			// Inak sa ponechá existujúci začiatok a koniec slučky.
		}
		playback.loopLocked = true;
	} else {
		// Pri vypínaní sa začiatok a koniec slučky odstránia.
		playback.loopStart = null;
		playback.loopEnd = null;
		playback.loopLocked = false;
	}
}

// I/O diagram v nastaveniach zobrazuje, čo je s čím prepojené.
function updateIOFlowDiagram() {
	var diagram = document.querySelector('.io-flow-diagram');
	if (!diagram) return;

	// ~~~ MIDI vstup ~~~.
	var midiIn = diagram.querySelector('[data-type="midi-in"]');
	if (midiIn) {
		const hasInput = typeof WebMIDI !== 'undefined' && 
						WebMIDI.selectedInputs && 
						WebMIDI.selectedInputs.length > 0;
		midiIn.classList.toggle('active', hasInput);
		
		const deviceEl = midiIn.querySelector('.io-flow-device');
		if (deviceEl) {
			if (hasInput) {
				const names = WebMIDI.selectedInputs.map(i => i.name || 'Unknown').join(', ');
				deviceEl.textContent = names;
			} else {
				deviceEl.textContent = ' ';
			}
		}
	}
	
	// ~~~ MIDI výstup ~~~.
	var midiOut = diagram.querySelector('[data-type="midi-out"]');
	if (midiOut) {
		const hasOutput = typeof WebMIDI !== 'undefined' && WebMIDI.selectedOutput !== null;
		midiOut.classList.toggle('active', hasOutput);
		
		const deviceEl = midiOut.querySelector('.io-flow-device');
		if (deviceEl) {
			if (hasOutput) {
				var name = WebMIDI.selectedOutput.name || 'Unknown';
				deviceEl.textContent = name;
			} else {
				deviceEl.textContent = ' ';
			}
		}
	}
	
	// ~~~ OSC vstup a výstup ~~~.
	var oscIn = diagram.querySelector('[data-type="osc-in"]');
	var oscOut = diagram.querySelector('[data-type="osc-out"]');

	var oscActive = false;
	var oscSelectedDevices = [];
	if (typeof SpectraOSC !== 'undefined' && SpectraOSC.getDevices) {
		var allDevices = SpectraOSC.getDevices() || [];
		var selectedIds = SpectraOSC.getSelectedDevices ? SpectraOSC.getSelectedDevices() : [];
		oscSelectedDevices = allDevices.filter(d => selectedIds.includes(d.id));
		oscActive = oscSelectedDevices.length > 0;

		if (allDevices.length > 0 || selectedIds.length > 0) {
			Logger.log('IO Flow OSC:', { allDevices, selectedIds, oscSelectedDevices, oscActive });
		}
	}
	
	if (oscIn) {
		oscIn.classList.toggle('active', oscActive);
		const deviceEl = oscIn.querySelector('.io-flow-device');
		if (deviceEl) {
			if (oscActive) {
				const names = oscSelectedDevices.map(d => d.name || d.host).join(', ');
				deviceEl.textContent = names;
			} else {
				deviceEl.textContent = ' ';
			}
		}
	}
	
	if (oscOut) {
		oscOut.classList.toggle('active', oscActive);
		const deviceEl = oscOut.querySelector('.io-flow-device');
		if (deviceEl) {
			if (oscActive) {
				const names = oscSelectedDevices.map(d => d.name || d.host).join(', ');
				deviceEl.textContent = names;
			} else {
				deviceEl.textContent = ' ';
			}
		}
	}
	
	// ~~~ Šípky ~~~.
	var arrows = diagram.querySelectorAll('.io-flow-arrow');
	const hasInput = (typeof WebMIDI !== 'undefined' && WebMIDI.selectedInputs?.length > 0) || oscActive;
	const hasOutput = (typeof WebMIDI !== 'undefined' && WebMIDI.selectedOutput) || oscActive;
	
	if (arrows[0]) arrows[0].classList.toggle('active', hasInput);
	if (arrows[1]) arrows[1].classList.toggle('active', hasOutput);
	if (arrows[2]) arrows[2].classList.toggle('active', hasOutput);
	
	// ~~~ Výstupný filter ~~~.
	var filterBox = diagram.querySelector('.io-flow-filter');
	var filterTracks = diagram.querySelector('.filter-tracks');
	var filterPartials = diagram.querySelector('.filter-partials');

	var trackMode = 'all';
	var partialMode = 'fundamentals';

	var trackBtn = document.querySelector('.midi-tracks-filter .ui-choice-option.selected');
	if (trackBtn) trackMode = trackBtn.dataset.value;

	var partialBtn = document.querySelector('.midi-partials-filter .ui-choice-option.selected');
	if (partialBtn) partialMode = partialBtn.dataset.value;

	// Ak je k dispozícii WebMIDI, prenos ide cez neho.
	if (typeof WebMIDI !== 'undefined') {
		if (WebMIDI.outputTrackMode) trackMode = WebMIDI.outputTrackMode;
		if (WebMIDI.outputPartialMode) partialMode = WebMIDI.outputPartialMode;
	}
	
	if (filterTracks) {
		switch (trackMode) {
			case 'all': filterTracks.textContent = 'Tracks: All'; break;
			case 'current': filterTracks.textContent = 'Tracks: Current'; break;
			case 'custom': filterTracks.textContent = 'Tracks: Custom'; break;
			default: filterTracks.textContent = 'Tracks: All';
		}
	}
	
	if (filterPartials) {
		switch (partialMode) {
			case 'all-partials': filterPartials.textContent = 'Partials: All'; break;
			case 'fundamentals': filterPartials.textContent = 'Fundamentals only'; break;
			case 'active-partial': filterPartials.textContent = 'Active partial'; break;
			case 'custom': filterPartials.textContent = 'Partials: Custom'; break;
			default: filterPartials.textContent = 'Fundamentals only';
		}
	}
	
	// Filter sa označí, ak nemá predvolené nastavenia.
	if (filterBox) {
		var hasCustomFilter = (trackMode !== 'all') || (partialMode !== 'all-partials');
		filterBox.classList.toggle('has-filter', hasCustomFilter);
	}
}


document.addEventListener('DOMContentLoaded', () => {
	setTimeout(updateIOFlowDiagram, 500);

	// Pravidelná aktualizácia pre prípad asynchrónnych zmien.
	setInterval(updateIOFlowDiagram, 10000);

	document.addEventListener('click', (e) => {
		if (e.target.closest('.midi-tracks-filter') || 
			e.target.closest('.midi-partials-filter')) {
			setTimeout(updateIOFlowDiagram, 50);
		}
	});
});

if (typeof window !== 'undefined') {
	window.updateIOFlowDiagram = updateIOFlowDiagram;
}

document.addEventListener('change', (e) => {
	if (e.target && e.target.tagName === 'SELECT') e.target.blur();
});
