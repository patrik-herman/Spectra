var crashRecoveryKey = 'spectra_crash_recovery';
var crashRecoveryInterval = 30000;
var crashRecoveryFlag = 'spectra_was_running';


var DB = {
	autoSaveTimer: null,
	autoSaveDelay: 2000,
	isSaving: false,
	useProjectManager: false,
	initialized: false,

	get: q => {
		if (DB.useProjectManager) {
			switch(q) {
				case 'instruments': return window.instruments;
				case 'settings': return window.settings;
				case 'scales': return window.scales;
				case 'spectra': return window.spectra;
				case 'grids': return window.grids;
				case 'trackEvents': return window.trackEvents;
				case 'viewState': return window.viewState;
				case 'MIDIdata': return window.MIDI?.data;
				default: return null;
			}
		}

		var ret = localStorage.getItem(q);
		return ret === null ? null : JSON.parse(ret);
	},

	set: (key, value, options) => {
		options = options || {};
		var ProjectManager = window.ProjectManager;
		var MIDI = window.MIDI;

		if (key === 'instruments') {
			window.instruments = value;
			// Krok vzad po pridaní stopy zoznam skráti, no primaryTrackIndex stále poukazuje za koniec, takže každý handler šípok potom padne na MIDI.data[primary]. Ohraničuje sa tu, lebo všetky zmeny počtu stôp idú cez tento set.
			if (window.primaryTrackIndex >= value.length) {
				window.primaryTrackIndex = Math.max(0, value.length - 1);
			}
		}
		if (key === 'settings') {
			window.settings = value;
			if (DB.useProjectManager && (ProjectManager?.db || ProjectManager?.useElectronStorage)) {
				ProjectManager.setSetting('appSettings', value);
			}
		}
		if (key === 'scales')
			window.scales = value;
		if (key === 'spectra')
			window.spectra = value;
		if (key === 'grids')
			window.grids = value;
		if (key === 'trackEvents')
			window.trackEvents = value;
		if (key === 'viewState')
			window.viewState = value;
		if (key === 'MIDIdata' && MIDI) {
			MIDI.data = value;
			if (typeof Canvas !== 'undefined' && Canvas.refreshCache) {
				Canvas.refreshCache();
			}
		}

		if (DB.useProjectManager) {
			if (ProjectManager?.currentProjectId) {
				DB.scheduleAutoSave();
				return;
			}
		}

		DB._safeLocalStorageSet(key, value);
	},

	_safeLocalStorageSet: (key, value) => {
		try {
			const strValue = typeof value === 'string' ? value : JSON.stringify(value);
			localStorage.setItem(key, strValue);
			return true;
		} catch (err) {
			// Špecifická chyba pri prekročení kvóty úložiska.
			if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
				Logger.error('localStorage quota exceeded:', err);

				if (typeof showStatus === 'function') {
					showStatus('Storage full - some data may not be saved. Try exporting your project.', {
						type: 'error',
						duration: 6000
					});
				} else if (typeof window.showSaveNotification === 'function') {
					window.showSaveNotification('Storage full - data may not save', true);
				}

				DB._attemptStorageCleanup();

				try {
					const strValue = typeof value === 'string' ? value : JSON.stringify(value);
					localStorage.setItem(key, strValue);
					Logger.log('localStorage save succeeded after cleanup');
					return true;
				} catch (retryErr) {
					Logger.error('localStorage save failed even after cleanup:', retryErr);
					return false;
				}
			}
			throw err;
		}
	},

	_attemptStorageCleanup: () => {
		Logger.log('Attempting localStorage cleanup...');

		var cleanupCandidates = [
			'spectra_tutorial_state',
			'spectra_last_export_settings',
			'spectra_ui_state',
			'spectra_recent_colors',
			'spectra_undo_history'
		];

		var freedBytes = 0;
		for (const key of cleanupCandidates) {
			var item = localStorage.getItem(key);
			if (item) {
				freedBytes += item.length;
				localStorage.removeItem(key);
				Logger.log(`  Removed ${key} (${item.length} bytes)`);
			}
		}

		Logger.log(`Cleanup freed ~${freedBytes} bytes`);
	},

	_recoveryInterval: null,

	initCrashRecovery: () => {
		var wasRunning = localStorage.getItem(crashRecoveryFlag);
		var recoveryData = localStorage.getItem(crashRecoveryKey);

		if (wasRunning && recoveryData) {
			try {
				var data = JSON.parse(recoveryData);
				if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
					DB._showRecoveryPrompt(data);
				}
			} catch (e) {
				Logger.warn('Failed to parse recovery data:', e);
			}
		}

		localStorage.removeItem(crashRecoveryFlag);
		localStorage.removeItem(crashRecoveryKey);

		DB._startRecoverySaves();
		window.addEventListener('beforeunload', DB._onCleanExit);
	},

	_startRecoverySaves: () => {
		if (DB._recoveryInterval) {
			clearInterval(DB._recoveryInterval);
		}

		DB._recoveryInterval = setInterval(() => {
			DB._saveRecoveryData();
		}, crashRecoveryInterval);

		Logger.log('Crash recovery system initialized');
	},

	_saveRecoveryData: () => {
		var ProjectManager = window.ProjectManager;
		var MIDI = window.MIDI;

		if (!MIDI?.data || !window.instruments) {
			return;
		}

		try {
			localStorage.setItem(crashRecoveryFlag, 'true');

			var recoveryData = {
				timestamp: Date.now(),
				projectId: ProjectManager?.currentProjectId || null,
				projectName: ProjectManager?.currentProject?.name || 'Untitled',
				instruments: window.instruments,
				MIDIdata: MIDI.data,
				settings: window.settings,
				viewState: window.viewState,
				playbackTime: window.playback?.time || 0,
				scales: window.scales,
				spectra: window.spectra,
				grids: window.grids,
				trackEvents: window.trackEvents
			};

			localStorage.setItem(crashRecoveryKey, JSON.stringify(recoveryData));
		} catch (e) {
			Logger.warn('Failed to save recovery data:', e);
		}
	},

	_onCleanExit: () => {
		localStorage.removeItem(crashRecoveryFlag);
	},

	_showRecoveryPrompt: (data) => {
		var timestamp = new Date(data.timestamp).toLocaleString();
		var projectName = data.projectName || 'Untitled';

		var dialog = document.createElement('div');
		dialog.className = 'recovery-dialog';
		dialog.innerHTML = `
			<div class="recovery-dialog-content">
				<h3>Recover Unsaved Work?</h3>
				<p>Spectra detected unsaved work from a previous session:</p>
				<p class="recovery-info"><strong>${projectName}</strong><br><small>${timestamp}</small></p>
				<div class="recovery-buttons">
					<button class="recovery-restore">Restore</button>
					<button class="recovery-discard">Discard</button>
				</div>
			</div>
		`;

		document.body.appendChild(dialog);

		dialog.querySelector('.recovery-restore').onclick = () => {
			DB._restoreRecoveryData(data);
			dialog.remove();
		};

		dialog.querySelector('.recovery-discard').onclick = () => {
			localStorage.removeItem(crashRecoveryKey);
			dialog.remove();
		};
	},

	_restoreRecoveryData: (data) => {
		var MIDI = window.MIDI;

		try {
			if (data.instruments) window.instruments = data.instruments;
			if (data.MIDIdata && MIDI) MIDI.data = data.MIDIdata;
			if (data.settings) {
				window.settings = data.settings;
				// Obnovené nastavenia musia znovu zosynchronizovať výšku tónu v rámci note2freq a freq2note.
				if (window.settings.referenceA && window.settings.playbackPitch === undefined) {
					window.settings.playbackPitch = 12 * Math.log2(window.settings.referenceA / 440);
					delete window.settings.referenceA;
				}
				window.playbackPitch = window.settings.playbackPitch ?? 0; // Nullish operátor (ak je playbackPitch null alebo undefined).
				window.midiPitchCenter = window.settings.midiPitchCenter ?? 69;
				if (typeof setPlaybackPitch === 'function') setPlaybackPitch(window.playbackPitch);
			}
			if (data.viewState) window.viewState = data.viewState;

			if (data.playbackTime && window.playback) window.playback.time = data.playbackTime;
			if (data.scales) window.scales = data.scales;
			if (data.spectra) window.spectra = data.spectra;
			if (data.grids) window.grids = data.grids;
			if (data.trackEvents) window.trackEvents = data.trackEvents;

			window.scalesExt = {};

			if (typeof Canvas !== 'undefined' && Canvas.refreshCache) {
				Canvas.refreshCache();
			}

			localStorage.removeItem(crashRecoveryKey);

			if (typeof showStatus === 'function') {
				showStatus('Work restored from previous session', { type: 'success' });
			}

			Logger.log('Recovery data restored successfully');
		} catch (e) {
			Logger.error('Failed to restore recovery data:', e);
			if (typeof showStatus === 'function') {
				showStatus('Failed to restore work', { type: 'error' });
			}
		}
	},

	cancelPendingAutoSave: () => {
		if (DB.autoSaveTimer) {
			Logger.log('cancelPendingAutoSave: cancelling pending save');
			clearTimeout(DB.autoSaveTimer);
			DB.autoSaveTimer = null;
		}
	},

	scheduleAutoSave: () => {
		var ProjectManager = window.ProjectManager;

		if (ProjectManager?.isLoading) {
			Logger.log('scheduleAutoSave: Skipping - isLoading is true');
			return;
		}

		if (ProjectManager && !ProjectManager.currentProjectId) {
			Logger.log('scheduleAutoSave: Skipping - no currentProjectId');
			return;
		}

		if (DB.isSaving) {
			// Ak ukladanie prebieha, naplánuje sa nasledujúce, aby sa úpravy urobené počas ukladania nestratili.
			Logger.log('scheduleAutoSave: Save in progress - queueing follow-up save');
			DB.saveQueuedDuringSave = true;
			return;
		}

		var scheduledProjectId = ProjectManager.currentProjectId;
		var scheduledProjectType = ProjectManager.currentProjectType;

		if (DB.autoSaveTimer) {
			clearTimeout(DB.autoSaveTimer);
		}


		DB.autoSaveTimer = setTimeout(async () => {
			var PM = window.ProjectManager;

			if (PM?.currentProjectId !== scheduledProjectId) {
				Logger.log('scheduleAutoSave: Aborting - project changed from', scheduledProjectId, 'to', PM?.currentProjectId);
				return;
			}

			if (PM?.isLoading) {
				Logger.log('scheduleAutoSave: Aborting - project is now loading');
				return;
			}

			if (DB.isSaving) {
				Logger.log('scheduleAutoSave: Aborting - another save in progress');
				return;
			}

			DB.isSaving = true;

			try {
				Logger.log('scheduleAutoSave: Executing save for project', scheduledProjectId);

				await PM.saveCurrentProject();
			} catch (error) {
				Logger.error('scheduleAutoSave: Save failed for project', scheduledProjectId, error);
			} finally {
				DB.isSaving = false;
				if (DB.saveQueuedDuringSave) {
					DB.saveQueuedDuringSave = false;
					DB.scheduleAutoSave();
				}
			}
		}, DB.autoSaveDelay);
	},

	forceSave: async () => {
		var ProjectManager = window.ProjectManager;
		Logger.log('forceSave called, currentProjectId:', ProjectManager?.currentProjectId);

		DB.cancelPendingAutoSave();

		if (ProjectManager?.isLoading) {
			Logger.log('forceSave: Skipping - project is loading');
			return;
		}

		if (DB.isSaving) {
			Logger.log('forceSave: Waiting for in-progress save to complete...');
			var maxWait = 5000;
			var startTime = Date.now();
			while (DB.isSaving && (Date.now() - startTime) < maxWait) {
				await new Promise(r => setTimeout(r, 100));
			}
			if (DB.isSaving) {
				Logger.warn('forceSave: Timeout waiting for in-progress save');
			}
		}

		if (ProjectManager?.currentProjectId) {
			DB.isSaving = true;
			try {
				Logger.log('forceSave: Saving project', ProjectManager.currentProjectId);

				await ProjectManager.saveCurrentProject();
			} catch (error) {
				Logger.error('forceSave: Save failed', error);
			} finally {
				DB.isSaving = false;
				if (DB.saveQueuedDuringSave) {
					DB.saveQueuedDuringSave = false;
					DB.scheduleAutoSave();
				}
			}
		} else {
			Logger.log('forceSave: No project to save');
		}
	},

	initDefaultGlobals: () => {
		window.settings = window.settings || Config.defaultSettings;
		if (window.settings.referenceA && window.settings.playbackPitch === undefined) {
			window.settings.playbackPitch = 12 * Math.log2(window.settings.referenceA / 440);
			delete window.settings.referenceA;
		}
		window.playbackPitch = window.settings.playbackPitch ?? 0;
		if (typeof setPlaybackPitch === 'function') {
			setPlaybackPitch(window.playbackPitch);
		}
		window.midiPitchCenter = window.settings.midiPitchCenter ?? 69;

		if (!window.scales || !window.scales.edo12 || !window.scales.edo12.notes || window.scales.edo12.notes.length === 0) {
			if (typeof ProjectManager !== 'undefined' && ProjectManager.createDefaultScales) {
				window.scales = ProjectManager.createDefaultScales();
			} else {
				window.scales = DB.createDefaultScalesBasic();
			}
		}

		var validScale = window.settings.scale || 'edo12';
		if (!window.scales[validScale]) {
			Logger.warn('Invalid scale in settings:', validScale, '- resetting to edo12');
			validScale = 'edo12';
			window.settings.scale = 'edo12';
		}
		window.scale = validScale;

		window.instruments = window.instruments || [{
			name: 'Track 1',
			spectrum: DEFAULT_SPECTRUM,
			color: '#eba52c',
			fundamentalColor: '#eba52c',
			selected: true
		}];

		window.spectra = window.spectra || DB.createDefaultSpectra();

		if (!window.grids) {
			if (typeof ProjectManager !== 'undefined' && ProjectManager.createDefaultGrids) {
				window.grids = ProjectManager.createDefaultGrids();
			} else {
				window.grids = {
					'off': { type: 'off', name: 'Off', deletable: false },
					'seconds': { type: 'linear', name: 'Seconds', deletable: false, spacingMs: 1000, subdivisions: 4 }
				};
			}
		}
		window.trackEvents = window.trackEvents || {};
		window.viewState = window.viewState || Config.defaultViewState;
		window.MIDI = window.MIDI || { data: [[]] };

		if (!window.scalesExt || Object.keys(window.scalesExt).length === 0) {
			window.scalesExt = {};
			if (typeof DB.calculateOrderedPartials === 'function') {
				DB.calculateOrderedPartials();
			}
		}
	},

	// Vždy sa tu používa A=440, playbackPitch užívateľa sa uplatní až pri prehrávaní.
	createDefaultScalesBasic: () => {
		var tuningRefA = 440;
		var MIN_FREQ = 0.001;
		var MAX_FREQ = 1e9;

		var scales = {
			free: {
				name: 'Free',
				full: 'Free pitch (1-cent steps)',
				description: 'Continuous pitch - each step is 1c',
				notes: [],
				type: 'free',
				orderedPartials: [{},{},{}],
				_generatedWithRefA: tuningRefA
			},
			edo12: {
				name: '12-EDO',
				full: '12-tone equal temperament',
				description: 'Standard Western tuning',
				notes: [],
				type: 'edo',
				edoDivisions: 12,
				orderedPartials: [{},{},{}],
				_generatedWithRefA: tuningRefA
			},
			edo24: {
				name: '24-EDO',
				full: '24-tone equal temperament (quarter-tones)',
				description: 'Quarter-tone scale with 50c steps',
				notes: [],
				type: 'edo',
				edoDivisions: 24,
				orderedPartials: [{},{},{}],
				_generatedWithRefA: tuningRefA
			},
			adaptive: {
				name: 'Adaptive',
				full: 'Adaptive spectral tuning',
				description: 'Dynamic pitch field based on spectrum of sounding notes',
				type: 'adaptive',
				isAdaptive: true,
				applyToPreview: true,
				tolerance: 25,
				minFreq: 20,
				maxFreq: 20000,
				notes: [],
				_generatedWithRefA: tuningRefA
			}
		};

		var minMidi12 = Math.ceil(69 + 12 * Math.log2(MIN_FREQ / tuningRefA));
		var maxMidi12 = Math.floor(69 + 12 * Math.log2(MAX_FREQ / tuningRefA));
		var bwPattern = [0,1,0,1,0,0,1,0,1,0,1,0];

		for (let i = minMidi12; i <= maxMidi12; i++) {
			const freq = tuningRefA * Math.pow(2, (i - 69) / 12);
			const bwKey = bwPattern[((i % 12) + 12) % 12];
			scales.edo12.notes.push([i, freq, bwKey]);
		}

		var minStep24 = Math.ceil(2 * (69 + 12 * Math.log2(MIN_FREQ / tuningRefA)));
		var maxStep24 = Math.floor(2 * (69 + 12 * Math.log2(MAX_FREQ / tuningRefA)));

		for (let i = minStep24; i <= maxStep24; i++) {
			const note = i / 2;
			const freq = tuningRefA * Math.pow(2, (note - 69) / 12);
			const bwKey = bwPattern[((Math.round(note) % 12) + 12) % 12];
			scales.edo24.notes.push([note, freq, bwKey]);
		}

		// Voľné ladenie má rozlíšenie 1c, plný rozsah a žiadne biele ani čierne klávesy.
		for (let cent = 0; cent <= 12700; cent++) {
			const note = cent / 100;
			const freq = tuningRefA * Math.pow(2, (note - 69) / 12);
			scales.free.notes.push([note, freq, 0]);
		}

		return scales;
	},

	validateDefaultTunings: () => {
		var tuningRefA = 440;
		var TOLERANCE = 0.01;
		var expectedA4Freq = tuningRefA;

		if (window.scales?.edo12?.notes) {
			const a4Note = window.scales.edo12.notes.find(n => n[0] === 69);
			if (a4Note) {
				const diff = Math.abs(a4Note[1] - expectedA4Freq);
				if (diff > TOLERANCE) {
					Logger.log(`12EDO A4 frequency ${a4Note[1]} Hz differs from expected ${expectedA4Freq} Hz by ${diff.toFixed(2)} Hz - regeneration needed`);
					return false;
				}
			}
		}

		if (window.scales?.edo24?.notes) {
			const a4Note = window.scales.edo24.notes.find(n => n[0] === 69);
			if (a4Note) {
				const diff = Math.abs(a4Note[1] - expectedA4Freq);
				if (diff > TOLERANCE) {
					Logger.log(`24EDO A4 frequency ${a4Note[1]} Hz differs from expected ${expectedA4Freq} Hz by ${diff.toFixed(2)} Hz - regeneration needed`);
					return false;
				}
			}
		}

		if (window.scales?.edo12?._generatedWithRefA && window.scales.edo12._generatedWithRefA !== tuningRefA) {
			Logger.log(`12EDO was generated with refA=${window.scales.edo12._generatedWithRefA}, expected ${tuningRefA} - regeneration needed`);
			return false;
		}

		if (window.scales?.edo24?._generatedWithRefA && window.scales.edo24._generatedWithRefA !== tuningRefA) {
			Logger.log(`24EDO was generated with refA=${window.scales.edo24._generatedWithRefA}, expected ${tuningRefA} - regeneration needed`);
			return false;
		}

		return true;
	},

	ensureValidDefaultTunings: (progressCallback) => {
		if (!DB.validateDefaultTunings()) {
			Logger.log('Regenerating default tunings with A=440...');

			if (progressCallback) progressCallback(0, 'Regenerating 12EDO tuning...');
			var defaultScales = DB.createDefaultScalesBasic();

			if (window.scales?.edo12) {
				const preserved = { ...window.scales.edo12 };
				window.scales.edo12 = { ...defaultScales.edo12 };
				for (const key of Object.keys(preserved)) {
					if (!['name', 'full', 'description', 'notes', 'orderedPartials', '_generatedWithRefA'].includes(key)) {
						window.scales.edo12[key] = preserved[key];
					}
				}
			} else {
				window.scales.edo12 = defaultScales.edo12;
			}

			if (progressCallback) progressCallback(10, 'Regenerating 24EDO tuning...');

			if (window.scales?.edo24) {
				const preserved = { ...window.scales.edo24 };
				window.scales.edo24 = { ...defaultScales.edo24 };
				for (const key of Object.keys(preserved)) {
					if (!['name', 'full', 'description', 'notes', 'orderedPartials', '_generatedWithRefA'].includes(key)) {
						window.scales.edo24[key] = preserved[key];
					}
				}
			} else {
				window.scales.edo24 = defaultScales.edo24;
			}

			if (progressCallback) progressCallback(20, 'Regenerating Adaptive tuning...');

			if (window.scales?.adaptive) {
				const preserved = { ...window.scales.adaptive };
				window.scales.adaptive = { ...defaultScales.adaptive };
				for (const key of Object.keys(preserved)) {
					if (!['name', 'full', 'description', 'notes', '_generatedWithRefA'].includes(key)) {
						window.scales.adaptive[key] = preserved[key];
					}
				}
			} else {
				window.scales.adaptive = defaultScales.adaptive;
			}

			if (progressCallback) progressCallback(25, 'Initializing tuning data...');

			window.scalesExt = {};

			if (typeof DB.calculateOrderedPartials === 'function') {
				DB.calculateOrderedPartials();
			}

			if (progressCallback) progressCallback(90, 'Saving tunings...');

			if (DB.useProjectManager) {
				DB.scheduleAutoSave();
			}

			if (progressCallback) progressCallback(100, 'Tunings regenerated');
			Logger.log('Default tunings regenerated successfully');
			return true;
		}
		return false;
	},

	// [ZDROJ] W3C. Indexed Database API 2.0 [online]. W3C Recommendation, 30. 1. 2018 [cit. 2026-07-30].
	//   Dostupné z: https://www.w3.org/TR/2018/REC-IndexedDB-2-20180130/

	init: async () => {
		if (DB.initialized) {
			Logger.log('DB.init: Already initialized, skipping');
			return;
		}
		DB.initialized = true;

		Logger.log('=== DB.init starting ===');

		DB.initDefaultGlobals();

		var ProjectManager = window.ProjectManager;
		if (ProjectManager) {
			try {
				Logger.log('Initializing ProjectManager...');
				await ProjectManager.init();
				DB.useProjectManager = true;

				Logger.log('Checking for localStorage migration...');
				var migratedId = await ProjectManager.migrateFromLocalStorage();
				Logger.log('Migration result:', migratedId);

				Logger.log('Showing startup UI...');
				await ProjectManager.showStartupUI();

				// Spúšťanie je dokončené (zobrazené úvodné UI, načítaný projekt), spúšťa sa obnova po páde
				// výzva na obnovenie je modálne okno v najvrchnejšej vrstve (z-index 100000), takže nemôže kolidovať s prebiehajúcim načítaním; 30s časovač snímky a príznak čistého ukončenia začínajú tu.
				DB.initCrashRecovery();

				Logger.log('DB initialized with ProjectManager (IndexedDB)');
				return;
			} catch (error) {
				Logger.error('Failed to initialize ProjectManager, falling back to localStorage:', error);

				if (typeof window.showSaveNotification === 'function') {
					window.showSaveNotification('Using local storage - projects may not persist in private browsing', true);
				}

				DB._showStorageFallbackWarning(error);
			}
		}

		DB.useProjectManager = false;
		DB.initLocalStorage();
		// Spustenie cez localStorage.
		DB.initCrashRecovery();
	},

	initLocalStorage: () => {
		if (localStorage.getItem('version') === null) {
			DB.set('version', Config.version);
		}
		if (localStorage.getItem('settings') === null) {
			DB.set('settings', Config.defaultSettings);
		}
		else {
			let settingsList = DB.get('settings');
			// Staršie referenceA sa prevedie na playbackPitch AKO PRVÉ, teda skôr, než zlúčenie predvolieb doplní playbackPitch:0 a migráciu zakryje
			// a skôr, než sa referenceA pri orezaní odstráni, keďže medzi predvolenými nastaveniami nie je.
			if (settingsList.referenceA && settingsList.playbackPitch === undefined) {
				settingsList.playbackPitch = 12 * Math.log2(settingsList.referenceA / 440);
			}
			for (const setting in Config.defaultSettings)
				if (!settingsList.hasOwnProperty(setting)) settingsList[setting] = Config.defaultSettings[setting];
			for (const setting in settingsList)
				if (!Config.defaultSettings.hasOwnProperty(setting)) delete settingsList[setting];
			DB.set('settings', settingsList);
		}
		if (localStorage.getItem('MIDIdata') === null || localStorage.getItem('MIDIdata') === '[]') {
			DB.set('MIDIdata', [
				[
					[0, 1, 69.68825906469125, 7, null, 0, 0, 0],
				]
			]);
		}
		if (localStorage.getItem('spectra') === null) {
			DB.set('spectra', DB.createDefaultSpectra());
		}
		if (localStorage.getItem('grids') === null) {
			DB.set('grids', {
				'off': {
					type: 'off',
					name: 'Off',
					deletable: false
				},
				'seconds': {
					type: 'linear',
					name: 'Seconds',
					deletable: false,
					spacingMs: 1000,
					subdivisions: 8
				}
			});
		}
		window.grids = DB.get('grids');
		if (localStorage.getItem('trackEvents') === null) {
			DB.set('trackEvents', {});
		}
		window.trackEvents = DB.get('trackEvents');
		if (localStorage.getItem('instruments') === null) {
			DB.set('instruments', [{
				name: 'Track 1',
				spectrum: DEFAULT_SPECTRUM,
				color: '#eba52c',
				fundamentalColor: '#eba52c',
				selected: false
			}]);
		}
		if (localStorage.getItem('scales') === null) {
			var MIN_FREQ = 0.001;
			var MAX_FREQ = 1e9;
			var REF_A = 440;
			var bwPattern = [0,1,0,1,0,0,1,0,1,0,1,0];

			var scalesTemp = {
				free: {
					name: 'Free',
					full: 'Free pitch (1-cent steps)',
					description: 'Continuous pitch - no grid, 1-cent resolution',
					notes: [],
					type: 'free',
					orderedPartials: [{},{},{}],
					_generatedWithRefA: REF_A
				},
				edo12: {
					name: '12EDO',
					full: '12-tone equal temperament',
					description: '',
					notes: [],
					type: 'edo',
					edoDivisions: 12,
					orderedPartials: [{},{},{}],
					_generatedWithRefA: REF_A
				},
				edo24: {
					name: '24EDO',
					full: '24-tone equal temperament',
					description: '',
					notes: [],
					type: 'edo',
					edoDivisions: 24,
					orderedPartials: [{},{},{}],
					_generatedWithRefA: REF_A
				},
				adaptive: {
					name: 'Adaptive',
					full: 'Adaptive spectral tuning',
					description: 'Dynamic pitch field based on spectrum of sounding notes',
					type: 'adaptive',
					isAdaptive: true,
					applyToPreview: true,
					tolerance: 25,
					minFreq: 20,
					maxFreq: 20000,
					notes: [],
					_generatedWithRefA: REF_A
				}
			};

			var minMidi12 = Math.ceil(69 + 12 * Math.log2(MIN_FREQ / REF_A));
			var maxMidi12 = Math.floor(69 + 12 * Math.log2(MAX_FREQ / REF_A));
			for (let iData = minMidi12; iData <= maxMidi12; iData++) {
				const freq = REF_A * Math.pow(2, (iData - 69) / 12);
				const bwKey = bwPattern[((iData % 12) + 12) % 12];
				scalesTemp.edo12.notes.push([iData, freq, bwKey]);
			}

			var minStep24 = Math.ceil(2 * (69 + 12 * Math.log2(MIN_FREQ / REF_A)));
			var maxStep24 = Math.floor(2 * (69 + 12 * Math.log2(MAX_FREQ / REF_A)));
			for (let iData = minStep24; iData <= maxStep24; iData++) {
				const note = iData / 2;
				const freq = REF_A * Math.pow(2, (note - 69) / 12);
				const bwKey = bwPattern[((Math.round(note) % 12) + 12) % 12];
				scalesTemp.edo24.notes.push([note, freq, bwKey]);
			}

			for (let cent = 0; cent <= 12700; cent++) {
				const note = cent / 100;
				const freq = REF_A * Math.pow(2, (note - 69) / 12);
				scalesTemp.free.notes.push([note, freq, 0]);
			}

			DB.set('scales', scalesTemp);
		}
		let settingsList = DB.get('settings');
		var scalesList = DB.get('scales');
		if (!scalesList['adaptive']) {
			scalesList['adaptive'] = {
				name: 'Adaptive',
				full: 'Adaptive spectral tuning',
				description: 'Dynamic pitch field based on spectrum of sounding notes',
				type: 'adaptive',
				isAdaptive: true,
				applyToPreview: true,
				tolerance: 25,
				minFreq: 20,
				maxFreq: 20000,
				notes: []
			};
			DB.set('scales', scalesList);
		}
		
		// Free ladenie paradoxne nie je stopercentne 'free', avšak je delenie z percepčného hľadiska natoľko jemné, že bolo možné túto variantu podstúpiť.
		if (!scalesList['free']) {
			var refAFree = 440;
			var freeNotes = [];
			for (let cent = 0; cent <= 12700; cent++) {
				const note = cent / 100;
				const freq = refAFree * Math.pow(2, (note - 69) / 12);
				freeNotes.push([note, freq, 0]);
			}
			// 'free' sa vloží ako prvé ladenie prestavaním objektu.
			var reordered = { free: {
				name: 'Free',
				full: 'Free pitch (1c steps)',
				description: 'Continuous pitch - 1c resolution',
				notes: freeNotes,
				type: 'free',
				orderedPartials: [{},{},{}],
				_generatedWithRefA: refAFree
			}};
			for (const key in scalesList) reordered[key] = scalesList[key];
			for (const key in scalesList) delete scalesList[key];
			for (const key in reordered) scalesList[key] = reordered[key];
			DB.set('scales', scalesList);
		}
		if (settingsList.referenceA && settingsList.playbackPitch === undefined) {
			settingsList.playbackPitch = 12 * Math.log2(settingsList.referenceA / 440);
			delete settingsList.referenceA;
		}
		window.playbackPitch = settingsList.playbackPitch ?? 0;
		window.midiPitchCenter = settingsList.midiPitchCenter ?? 69;
		if (typeof setPlaybackPitch === 'function') {
			setPlaybackPitch(window.playbackPitch);
		}
		window.scales = scalesList;
		window.settings = settingsList;
		window.instruments = DB.get('instruments');
		window.spectra = DB.get('spectra');
		DB.calculateOrderedPartials();
		DB.set('scales', scalesList);
		var instrumentsUpdated = false;
		for (let i = 0; i < window.instruments.length; i++) {
			if (!window.instruments[i].hasOwnProperty('fundamentalColor')) {
				window.instruments[i].fundamentalColor = window.instruments[i].color;
				instrumentsUpdated = true;
			}
		}
		DB.set('instruments', window.instruments);
		if (localStorage.getItem('viewState') === null) {
			DB.set('viewState', Config.defaultViewState);
		} else {
			var viewState = DB.get('viewState');
			for (const key in Config.defaultViewState) {
				if (!viewState.hasOwnProperty(key)) {
					viewState[key] = Config.defaultViewState[key];
				}
			}
			DB.set('viewState', viewState);
		}
		window.viewState = DB.get('viewState');
		Logger.log('DB initialized with localStorage (legacy mode)');
	},


	getOrderedPartials: (scaleKey, spectrumKey, mode = 0) => {
		var scalesExt = window.scalesExt || (window.scalesExt = {});

		if (scalesExt[scaleKey]?.orderedPartials?.[mode]?.[spectrumKey]) {
			return scalesExt[scaleKey].orderedPartials[mode][spectrumKey];
		}

		var scaleData = window.scales?.[scaleKey];
		var spectrumData = window.spectra?.[spectrumKey];

		if (!scaleData || !scaleData.notes || scaleData.notes.length === 0) {
			return null;
		}

		var hasValidData = (spectrumData?.keypoints && spectrumData.keypoints.length > 0) ||
			(spectrumData?.data && spectrumData.data.length > 0);
		if (!spectrumData || !hasValidData) {
			return null;
		}

		var scaleNotes = scaleData.notes;
		var scaleSpectrumPartials = [];
		var scaleSpectrumPartials2 = [];
		var scaleSpectrumPartials3 = [];

		// Ladenie free je séria tónov s jemným delením na úrovni centu, v tomto prípade ide o výnimku v rámci výpočtov, nakoľko by bolo dosiahnutých
		var freeScale = scaleData.type == 'free';

		for (let k = 0; k < scaleNotes.length; k++) {
			var notePitch = scaleNotes[k][0];
			var spectraPartials = freeScale ? [[1, 1]]
				: (typeof DynamicTimbre !== 'undefined' && DynamicTimbre)
				? DynamicTimbre.getPartialsAtPitch(spectrumData, notePitch)
				: (typeof getTimbrePartials === 'function' ? getTimbrePartials(spectrumData, notePitch) : (spectrumData.data || [[1, 1]]));

			for (let l = 0; l < spectraPartials.length; l++) {
				scaleSpectrumPartials.push([
					scaleNotes[k][1] * spectraPartials[l][0],
					freq2note_440(scaleNotes[k][1] * spectraPartials[l][0]),
					scaleNotes[k],
					spectraPartials[l][0],
					l + 1
				]);
				scaleSpectrumPartials3.push(scaleSpectrumPartials[scaleSpectrumPartials.length - 1]);
			}
			for (let l = spectraPartials.length - 1; l >= 0; l--) {
				scaleSpectrumPartials2.push([
					scaleNotes[k][1],
					freq2note_440(scaleNotes[k][1]),
					freq2note_440(scaleNotes[k][1] / spectraPartials[l][0]),
					spectraPartials[l][0],
					l + 1
				]);
				scaleSpectrumPartials3.push(scaleSpectrumPartials2[scaleSpectrumPartials2.length - 1]);
			}
		}

		scaleSpectrumPartials.sort(sortingFunction);
		scaleSpectrumPartials2.sort(sortingFunction);
		scaleSpectrumPartials3.sort(sortingFunction);

		if (!scalesExt[scaleKey]) scalesExt[scaleKey] = {};
		if (!scalesExt[scaleKey].orderedPartials) scalesExt[scaleKey].orderedPartials = [{}, {}, {}];
		scalesExt[scaleKey].orderedPartials[0][spectrumKey] = scaleSpectrumPartials;
		scalesExt[scaleKey].orderedPartials[1][spectrumKey] = scaleSpectrumPartials2;
		scalesExt[scaleKey].orderedPartials[2][spectrumKey] = scaleSpectrumPartials3;

		return scalesExt[scaleKey].orderedPartials[mode][spectrumKey];
	},

	calculateOrderedPartials: () => {
		var scalesExt = window.scalesExt || (window.scalesExt = {});

		var scalesKeys = Object.keys(window.scales || {});
		for (const scaleKey of scalesKeys) {
			if (!scalesExt[scaleKey]) scalesExt[scaleKey] = {};
			if (!scalesExt[scaleKey].orderedPartials) scalesExt[scaleKey].orderedPartials = [{}, {}, {}];
		}

		Logger.log('Ordered partials initialized (lazy mode) for', scalesKeys.length, 'scales');
	},

	createDefaultSpectra: () => {
		if (typeof ProjectManager !== 'undefined' && ProjectManager.createDefaultSpectra) {
			return ProjectManager.createDefaultSpectra();
		}
		// V prípade, ak ProjectManager nie je stále načítaný, použijú sa základné presety,
		// a ak ani tie nie sú k dispozícii, použije sa úplne základná farba.
		if (typeof window !== 'undefined' && window.INSTRUMENT_PRESETS?.core) {
			return JSON.parse(JSON.stringify(window.INSTRUMENT_PRESETS.core));
		}
		return {
			'harmonic16': {
				name: "Harmonic 16",
				description: "partials 1-16, 1/n^2",
				keypoints: [{ pitch: 60, data: Array.from({length: 16}, (_, i) => [i + 1, 1 / Math.pow(i + 1, 2)]) }]
			}
		};
	},

	saveViewState: () => {
		var Canvas = window.Canvas;
		var playback = window.playback;
		var Timeline = window.Timeline;

		if (Canvas && playback) {
			var viewState = {
				scrollPosition: Canvas.offx || 0,
				playheadPosition: playback.time || 0,
				selectedTrack: Timeline?.getCurrentTrackIdx ? Timeline.getCurrentTrackIdx() : 0
			};
			DB.set('viewState', viewState);
			window.viewState = viewState;
		}
	},

	_showStorageFallbackWarning: (error) => {
		var showWarning = () => {
			if (document.querySelector('.storage-fallback-warning')) return;

			var warningDiv = document.createElement('div');
			warningDiv.className = 'storage-fallback-warning';
			warningDiv.style.cssText = `
				position: fixed;
				bottom: 60px;
				left: 50%;
				transform: translateX(-50%);
				background: #442;
				border: none;
				border-left: 3px solid #aa8;
				
				padding: 12px 20px;
				color: #ffa;
				font-size: 13px;
				z-index: 10000;
				max-width: 400px;
				text-align: center;
				box-shadow: 0 4px 12px rgba(0,0,0,0.3);
			`;

			var message = '<strong>Limited Storage Mode</strong><br>';

			if (error.message && error.message.includes('timeout')) {
				message += 'Database took too long to load.<br>';
			} else if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
				message += 'Private Browsing mode detected.<br>';
			}

			message += 'Changes are saved locally but may be lost when you close this tab.';
			message += '<br><small style="color:#aa8">For persistent storage, use Chrome/Edge in normal browsing mode.</small>';

			warningDiv.innerHTML = message;

			var closeBtn = document.createElement('span');
			closeBtn.textContent = '×';
			closeBtn.style.cssText = `
				position: absolute;
				top: 4px;
				right: 8px;
				cursor: pointer;
				font-size: 18px;
				color: #aa8;
			`;
			closeBtn.onclick = () => warningDiv.remove();
			warningDiv.appendChild(closeBtn);

			document.body.appendChild(warningDiv);

			setTimeout(() => {
				if (warningDiv.parentNode) {
					warningDiv.style.transition = 'opacity 0.5s';
					warningDiv.style.opacity = '0';
					setTimeout(() => warningDiv.remove(), 500);
				}
			}, 15000);
		};

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', showWarning);
		} else {
			setTimeout(showWarning, 1000);
		}
	}
};

if (typeof window !== 'undefined') {
	window.DB = DB;
}
