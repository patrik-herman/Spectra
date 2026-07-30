// ProjectManager rieši ukladanie a načítavanie projektov cez IndexedDB
// tiež riadi UI výberu projektu a migráciu starých dát z localStorage.

// config pochádza z config.js (načítava sa skôr)
// showStatus pochádza z util.js (načítava sa skôr).

// Uvedené globálne premenné sa v neskorších fázach zmenia na importy
// prístup cez window kvôli spätnej kompatibilite.

var ProjectManager = {
	db: null,
	dbName: 'SpectraDB',
	dbVersion: 1,

	currentProject: null,
	currentProjectId: null,

	// Indikátor, ktorý počas načítavania blokuje auto-save.
	isLoading: false,

	useElectronStorage: false,

	init: () => {
		var leftoverModal = document.querySelector('.project-loading-modal');
		if (leftoverModal) {
			leftoverModal.remove();
		}

		if (window.electronAPI?.isElectron) {
			Logger.log('Running in Electron - using file-based storage');
			ProjectManager.useElectronStorage = true;

			if (window.electronAPI.onOpenProjectFile) {
				window.electronAPI.onOpenProjectFile(async (filePath) => {
					Logger.log('Opening project file from file association:', filePath);
					try {
						var result = await window.electronAPI.readFile(filePath);
						if (result.success && result.content) {
							if (typeof importProject === 'function') {
								importProject(result.content);
								showStatus('Project loaded from file', { type: 'success' });
							}
						} else {
							showStatus('Failed to read project file: ' + (result.error || 'Unknown error'), { type: 'error' });
						}
					} catch (e) {
						Logger.error('Error opening project file:', e);
						showStatus('Error opening project file', { type: 'error' });
					}
				});
			}

			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			var timeoutId = setTimeout(() => {
				Logger.warn('IndexedDB init timed out after 10 seconds');
				reject(new Error('IndexedDB init timeout'));
			}, 10000);

			var request = indexedDB.open(ProjectManager.dbName, ProjectManager.dbVersion);

			request.onerror = (event) => {
				clearTimeout(timeoutId);
				Logger.error('IndexedDB error:', event.target.error);
				reject(event.target.error);
			};

			request.onsuccess = (event) => {
				clearTimeout(timeoutId);
				ProjectManager.db = event.target.result;
				Logger.log('IndexedDB initialized successfully');
				resolve(ProjectManager.db);
			};

			request.onupgradeneeded = (event) => {
				var db = event.target.result;

				if (!db.objectStoreNames.contains('projects')) {
					var projectStore = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
					projectStore.createIndex('name', 'name', { unique: false });
					projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
					projectStore.createIndex('createdAt', 'createdAt', { unique: false });
				}

				if (!db.objectStoreNames.contains('settings')) {
					db.createObjectStore('settings', { keyPath: 'key' });
				}

				Logger.log('IndexedDB schema created/upgraded');
			};
		});
	},
	
	migrationInProgress: false,

	// Jednorazová migrácia zo starého systému localStorage do IndexedDB
	// spúšťa sa len raz.
	migrateFromLocalStorage: async () => {
		Logger.log('=== migrateFromLocalStorage check ===');

		if (ProjectManager.migrationInProgress) {
			Logger.log('Migration already in progress, skipping');
			return false;
		}
		ProjectManager.migrationInProgress = true;

		try {
			var migrated = await ProjectManager.getSetting('migratedFromLocalStorage');
			Logger.log('migratedFromLocalStorage setting:', migrated);

			if (migrated) {
				Logger.log('Already migrated from localStorage');
				return false;
			}

			var hasLocalData = localStorage.getItem('MIDIdata') !== null;
			Logger.log('Has MIDIdata in localStorage:', hasLocalData);

			if (!hasLocalData) {
				await ProjectManager.setSetting('migratedFromLocalStorage', true);
				Logger.log('No localStorage data, marking as migrated');
				return false;
			}

			Logger.log('Migrating data from localStorage...');

			var midiData = JSON.parse(localStorage.getItem('MIDIdata') || '[[]]');
			var instruments = JSON.parse(localStorage.getItem('instruments') || '[]');
			var scales = JSON.parse(localStorage.getItem('scales') || '{}');
			var spectra = JSON.parse(localStorage.getItem('spectra') || '{}');
			var grids = JSON.parse(localStorage.getItem('grids') || '{}');
			var settings = JSON.parse(localStorage.getItem('settings') || '{}');
			var trackEvents = JSON.parse(localStorage.getItem('trackEvents') || '{}');
			var viewState = JSON.parse(localStorage.getItem('viewState') || '{}');
			
			var project = {
				name: 'Migrated Project',
				midiData: midiData,
				instruments: instruments,
				scales: scales,
				spectra: spectra,
				grids: grids,
				trackEvents: trackEvents,
				viewState: viewState,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			};
			
			var projectId = await ProjectManager.createProject(project);
			Logger.log('Created migrated project with ID:', projectId);

			await ProjectManager.setSetting('appSettings', settings);
			await ProjectManager.setSetting('migratedFromLocalStorage', true);

			// localStorage sa vyprázdni, aby nedošlo k opätovnej migrácii.
			Logger.log('Clearing localStorage to prevent re-migration');
			localStorage.removeItem('MIDIdata');
			
			return projectId;
		} finally {
			ProjectManager.migrationInProgress = false;
		}
	},
	
	
	// Vytvorí nový projekt v IndexedDB a vráti automaticky vygenerované ID.
	createProject: (project) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					var result = await window.electronAPI.projectSave(null, project);
					if (result.success) {
						Logger.log('Project created with ID:', result.projectId);
						resolve(result.projectId);
					} else {
						reject(new Error(result.error || 'Failed to create project'));
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['projects'], 'readwrite');
			var store = transaction.objectStore('projects');

			project.createdAt = project.createdAt || new Date().toISOString();
			project.updatedAt = new Date().toISOString();

			delete project.id;

			Logger.log('=== CREATING NEW PROJECT ===', project.name);

			var request = store.add(project);

			request.onsuccess = () => {
				var newId = request.result;
				Logger.log('Project created with ID:', newId);
				resolve(newId);
			};
			request.onerror = () => reject(request.error);
		});
	},
	
	getProject: (id) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					var result = await window.electronAPI.projectRead(id);
					if (result.success) {
						resolve(result.project);
					} else {
						resolve(null);
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['projects'], 'readonly');
			var store = transaction.objectStore('projects');
			var request = store.get(id);

			request.onsuccess = () => {
				var project = request.result;
				if (project && !project.id) {
					project.id = id;
				}
				resolve(project);
			};
			request.onerror = () => reject(request.error);
		});
	},
	
	// Uloženie zmien v existujúcom projekte.
	updateProject: (project) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				if (!project.id) {
					Logger.error('Cannot update project without ID!', project);
					reject(new Error('Project must have an ID to update'));
					return;
				}
				try {
					project.updatedAt = new Date().toISOString();
					var result = await window.electronAPI.projectSave(project.id, project);
					if (result.success) {
						Logger.log('Project updated successfully:', project.id);
						resolve();
					} else {
						reject(new Error(result.error || 'Failed to update project'));
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			if (!project.id && project.id !== 0) {
				Logger.error('Cannot update project without ID!', project);
				reject(new Error('Project must have an ID to update'));
				return;
			}

			var transaction = ProjectManager.db.transaction(['projects'], 'readwrite');
			var store = transaction.objectStore('projects');

			project.updatedAt = new Date().toISOString();

			Logger.log('Updating project:', project.id, project.name);

			var request = store.put(project);

			request.onsuccess = () => {
				Logger.log('Project updated successfully, key:', request.result);
				resolve();
			};
			request.onerror = () => {
				Logger.error('Failed to update project:', request.error);
				reject(request.error);
			};
		});
	},
	
	deleteProject: (id) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					var result = await window.electronAPI.projectDelete(id);
					if (result.success) {
						resolve();
					} else {
						reject(new Error(result.error || 'Failed to delete project'));
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['projects'], 'readwrite');
			var store = transaction.objectStore('projects');
			var request = store.delete(id);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	},

	renameProject: async (id, newName) => {
		var project = await ProjectManager.getProject(id);
		if (!project) {
			throw new Error('Project not found');
		}
		
		project.name = newName;
		await ProjectManager.updateProject(project);
		
		if (ProjectManager.currentProjectId === id) {
			document.title = `${newName} - Spectra`;
			if (ProjectManager.currentProject) ProjectManager.currentProject.name = newName;
			if (window.electronAPI?.setTitle) {
				window.electronAPI.setTitle(newName);
				var titleEl = document.querySelector('.titlebar-title');
				if (titleEl) titleEl.textContent = newName;
			}
		}
	},

	// Všetky projekty, zoradené od najnovších.
	getAllProjects: () => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					var result = await window.electronAPI.projectList();
					if (result.success) {
						resolve(result.projects);
					} else {
						reject(new Error(result.error || 'Failed to list projects'));
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['projects'], 'readonly');
			var store = transaction.objectStore('projects');
			var index = store.index('updatedAt');
			var request = index.openCursor(null, 'prev');

			var projects = [];

			request.onsuccess = (event) => {
				var cursor = event.target.result;
				if (cursor) {
					var project = cursor.value;
					if (!project.id && project.id !== 0) {
						project.id = cursor.primaryKey;
					}
					projects.push(project);
					cursor.continue();
				} else {
					resolve(projects);
				}
			};

			request.onerror = () => reject(request.error);
		});
	},
	
	getSetting: (key) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					var result = await window.electronAPI.appSettingsRead();
					if (result.success) {
						resolve(result.settings[key] || null);
					} else {
						resolve(null);
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['settings'], 'readonly');
			var store = transaction.objectStore('settings');
			var request = store.get(key);

			request.onsuccess = () => {
				resolve(request.result ? request.result.value : null);
			};
			request.onerror = () => reject(request.error);
		});
	},

	setSetting: (key, value) => {
		if (ProjectManager.useElectronStorage) {
			return new Promise(async (resolve, reject) => {
				try {
					// Aktuálne nastavenia sa načítajú, upravia a zapíšu späť.
					var readResult = await window.electronAPI.appSettingsRead();
					var settings = readResult.success ? readResult.settings : {};
					settings[key] = value;
					var writeResult = await window.electronAPI.appSettingsSave(settings);
					if (writeResult.success) {
						resolve();
					} else {
						reject(new Error(writeResult.error || 'Failed to save settings'));
					}
				} catch (err) {
					reject(err);
				}
			});
		}

		return new Promise((resolve, reject) => {
			var transaction = ProjectManager.db.transaction(['settings'], 'readwrite');
			var store = transaction.objectStore('settings');
			var request = store.put({ key, value });

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	},
	

	// Načítanie projektu
	// progressCallback sa spúšťa s (percent, status), aby sa dal zobraziť priebeh načítania.
	loadProject: async (id, progressCallback) => {
		// Pomocná funkcia na hlásenie priebehu, ktorá uvoľní vlákno na aktualizáciu UI.
		var reportProgress = async (percent, status) => {
			if (progressCallback) {
				progressCallback(percent, status);
				await new Promise(r => setTimeout(r, 0));
			}
		};
		
		await reportProgress(0, 'Fetching project...');
		var project = await ProjectManager.getProject(id);
		if (!project) {
			throw new Error('Project not found');
		}
		
		await reportProgress(12, 'Setting up project data...');

		window.MIDI = window.MIDI || {};
		window.MIDI.data = project.midiData || [[]];
		window.instruments = project.instruments || [];
		window.scales = project.scales || {};
		window.spectra = project.spectra || {};
		window.grids = project.grids || {};
		window.trackEvents = project.trackEvents || {};
		// Vymazanie záznamov udalostí pre stopy, ktoré neexistujú.
		for (const teKey in window.trackEvents) {
			if (parseInt(teKey) >= (window.instruments ? window.instruments.length : 0)) {
				delete window.trackEvents[teKey];
			}
		}
		window.viewState = project.viewState || {};

		if (typeof UndoManager !== 'undefined' && UndoManager.clear) UndoManager.clear();

		window.projectMidiSettings = project.midiSettings || null;

		await reportProgress(13, 'Checking built-in tunings...');

		if (!window.scales.edo12 || !window.scales.edo12.notes || window.scales.edo12.notes.length === 0) {
			await reportProgress(14, 'Creating default tunings...');
			const defaultScales = ProjectManager.createDefaultScales();
			window.scales.edo12 = defaultScales.edo12;
			window.scales.edo24 = defaultScales.edo24;
			window.scales.adaptive = defaultScales.adaptive;
		}
		// Ladenie 'free' musí existovať.
		if (!window.scales.free || !window.scales.free.notes || window.scales.free.notes.length === 0) {
			const defaultScales = ProjectManager.createDefaultScales();
			// Vkladá sa ako prvé v poradí.
			var reordered = { free: defaultScales.free };
			for (const key in window.scales) reordered[key] = window.scales[key];
			for (const key in window.scales) delete window.scales[key];
			for (const key in reordered) window.scales[key] = reordered[key];
		}
		
		await reportProgress(15, 'Validating tuning reference...');

		// Kontrola, že predvolené ladenia boli vytvorené s A=440
		// ak nie, vygenerujú sa znova kvôli starším projektom.
		var tuningsRegenerated = false;
		var DB = window.DB;
		if (DB?.ensureValidDefaultTunings) {
			tuningsRegenerated = DB.ensureValidDefaultTunings((regenPercent, regenStatus) => {
				// Priebeh regenerácie (0-100) sa mapuje na rozsah (15-92).
				var mappedPercent = 15 + Math.round(regenPercent * 0.77);
				if (progressCallback) progressCallback(mappedPercent, regenStatus);
			});
		}

		if (!tuningsRegenerated) {
			await reportProgress(26, 'Loading settings...');
		}

		var appSettings = await ProjectManager.getSetting('appSettings') || Config.defaultSettings;
		window.settings = { ...appSettings }; // Klonuje sa, aby sa nemenili uložené nastavenia.
		// Migrácia zo starého referenceA na playbackPitch.
		if (window.settings.referenceA && window.settings.playbackPitch === undefined) {
			window.settings.playbackPitch = 12 * Math.log2(window.settings.referenceA / 440);
			delete window.settings.referenceA;
		}
		window.playbackPitch = window.settings.playbackPitch ?? 0;
		window.midiPitchCenter = window.settings.midiPitchCenter ?? 69;
		if (typeof setPlaybackPitch === 'function') {
			setPlaybackPitch(window.playbackPitch);
		}
		
		if (!tuningsRegenerated) {
			await reportProgress(27, 'Validating scale selection...');
		}
		
		// Ladenie sa overí, pretože musí existovať v ladeniach daného projektu, inak sa predvolene použije edo12
		// daná zmena sa neukladá globálne, platí len pre práve načítaný projekt.
		var validScale = window.settings.scale || 'edo12';
		if (!window.scales[validScale]) {
			Logger.warn('Scale "' + validScale + '" not found in current project - using edo12');
			validScale = 'edo12';
		}
		window.scale = validScale;
		window.settings.scale = validScale;
		
		// scalesExt sa pred prepočítaním vyprázdni, aby tam nezostali staré dáta z predchádzajúceho projektu.
		window.scalesExt = {};
		if (!tuningsRegenerated) {
			await reportProgress(28, 'Initializing tuning data...');

			// Inicializuje sa štruktúra cache, reálne parciály sa počítajú až vtedy, keď je potrebné.
			if (DB?.calculateOrderedPartials) {
				DB.calculateOrderedPartials();
			}
		}
		
		await reportProgress(93, 'Finalizing...');

		project.id = id;
		ProjectManager.currentProject = project;
		ProjectManager.currentProjectId = id;

		Logger.log('Project loaded:', project.name, 'ID:', id, 'project.id:', project.id);

		document.title = `${project.name} - Spectra`;
		if (window.electronAPI?.setTitle) {
			window.electronAPI.setTitle(project.name);
			var titleEl = document.querySelector('.titlebar-title');
			if (titleEl) titleEl.textContent = project.name;
		}

		await reportProgress(100, 'Project loaded');
		
		return project;
	},
	
	saveCurrentProject: async () => {
		if (!ProjectManager.currentProjectId) {
			//Logger.warn('No project loaded, cannot save');
			return false;
		}

		// getProject čaká (await) a ak počas toho užívateľ prepne projekt, globálny stav window.* by patril inému projektu.
		var targetProjectId = ProjectManager.currentProjectId;
		var project = await ProjectManager.getProject(targetProjectId);
		if (!project) {
			//Logger.warn('Project not found for ID:', targetProjectId);
			return false;
		}
		if (ProjectManager.currentProjectId !== targetProjectId) {
			Logger.warn('saveCurrentProject: project changed during fetch (', targetProjectId, '->', ProjectManager.currentProjectId, ') - aborting to avoid cross-project contamination');
			return false;
		}
		
		//Logger.log('Fetched project:', project.name, 'project.id:', project.id, 'typeof:', typeof project.id);
		
		// Projekt musí mať správne ID, lebo od neho závisí, či sa záznam aktualizuje, alebo vytvorí nanovo.
		if (project.id !== targetProjectId) {
			project.id = targetProjectId;
		}

		var Canvas = window.Canvas;
		var playback = window.playback;
		var Timeline = window.Timeline;
		var WebMIDI = window.WebMIDI;

		project.midiData = window.MIDI?.data || [[]];
		project.instruments = window.instruments || [];
		project.scales = window.scales || {};
		project.spectra = window.spectra || {};
		project.grids = window.grids || {};
		project.trackEvents = window.trackEvents || {};
		project.viewState = {
			// Scroll sa ukladá ako časová pozícia, nezávislá od priblíženia.
			scrollTime: Canvas && barSize ? -(Canvas.offx / barSize) : 0,
			verticalScroll: Canvas?.offy || 0,
			barSize: barSize || 200,
			playheadPosition: playback?.time || 0,
			selectedTrack: Timeline?.getCurrentTrackIdx?.() || 0,
			loopStart: playback?.loopStart ?? null,
			loopEnd: playback?.loopEnd ?? null
		};

		project.midiSettings = {
			inputIds: WebMIDI?.selectedInputs?.map(i => i.id) || [],
			outputId: WebMIDI?.selectedOutput?.id || '',
			channel: WebMIDI?.channel || 0,
			transportSyncEnabled: WebMIDI?.transportSync?.enabled ?? true,
			outputFilter: WebMIDI?.outputFilter ? {
				trackMode: WebMIDI.outputFilter.trackMode,
				tracks: WebMIDI.outputFilter.tracks,
				partialMode: WebMIDI.outputFilter.partialMode,
				partials: WebMIDI.outputFilter.partials
			} : { trackMode: 'all', tracks: [], partialMode: 'fundamentals', partials: [] },
			bpm: playback?.bpm || 120
		};
		
		//Logger.log('About to update project with id:', project.id);
		await ProjectManager.updateProject(project);
		//Logger.log('Project saved successfully:', project.name, 'id:', project.id);
		
		return true;
	},
	
	createNewProject: async (name) => {
		Logger.log('=== createNewProject called ===', name);

		var appSettings = await ProjectManager.getSetting('appSettings') || Config.defaultSettings;

		var defaultScales = ProjectManager.createDefaultScales();
		var defaultSpectra = ProjectManager.createDefaultSpectra();
		var defaultGrids = ProjectManager.createDefaultGrids();
		
		var project = {
			name: name,
			midiData: [[]],
			instruments: [{
				name: 'Track 1',
				spectrum: DEFAULT_SPECTRUM,
				color: '#eba52c',
				fundamentalColor: '#eba52c',
				selected: true
			}],
			scales: defaultScales,
			spectra: defaultSpectra,
			grids: defaultGrids,
			trackEvents: {
				0: {
					markers: [],
					tuningChanges: [{ time: 0, tuningKey: 'edo12' }],
					gridChanges: [{ time: 0, gridKey: 'seconds' }]
				}
			},
			viewState: Config.defaultViewState,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		
		var projectId = await ProjectManager.createProject(project);
		return projectId;
	},
	
	// Základom je vždy A=440, aby boli ladenia nezávislé od referencie.
	// Nastavenie playbackPitch užívateľa sa aplikuje až pri prehrávaní.
	createDefaultScales: () => {
		// Pre predvolené ladenia sa vždy používa 440, čím zostávajú ladenia konzistentné bez ohľadu na nastavenie playbackPitch užívateľa.
		var tuningRefA = 440;

		// Rozšírený frekvenčný rozsah nad rámec MIDI (zodpovedá generovaniu EDO v setup.js).
		var MIN_FREQ = 0.001;
		var MAX_FREQ = 1e9;
		var bwPattern = [0,1,0,1,0,0,1,0,1,0,1,0];

		var freq2note = (freq) => 69 + 12 * Math.log2(freq / tuningRefA);

		// Pomocná funkcia na vygenerovanie ladenia EDO s príslušným čierno-bielym vzorom.
		var generateEDO = (divisions, octaveRatio = 2) => {
			var notes = [];
			var logRatio = Math.log2(octaveRatio);
			var minStep = Math.ceil(divisions * (Math.log2(MIN_FREQ / tuningRefA) + 69/12) / logRatio);
			var maxStep = Math.floor(divisions * (Math.log2(MAX_FREQ / tuningRefA) + 69/12) / logRatio);

			var edoPattern;
			if (divisions % 12 === 0) {
				// Pri násobkoch 12 sa opakuje štandardný vzor s poddeleniami.
				var mult = divisions / 12;
				edoPattern = [];
				for (let j = 0; j < 12; j++) {
					edoPattern.push(bwPattern[j]); // Hlavná nota
					for (let k = 1; k < mult; k++) {
						edoPattern.push(1 - bwPattern[j]); // Poddelenia majú opačnú farbu.
					}
				}
			} else {
				// Pri ostatných EDO sa vzor vytvorí podľa blízkosti k 12-EDO.
				edoPattern = [];
				for (let j = 0; j < divisions; j++) {
					// Nájsť najbližší stupeň 12-EDO.
					var cents = (j / divisions) * 1200;
					var nearest12 = Math.round(cents / 100);
					var nearestCents = nearest12 * 100;
					var distance = Math.abs(cents - nearestCents);
					// Ak je blízko note 12-EDO, použije sa jej farba, inak opačná.
					if (distance < (1200 / divisions / 2)) {
						edoPattern.push(bwPattern[nearest12 % 12]);
					} else {
						edoPattern.push(1 - bwPattern[nearest12 % 12]);
					}
				}
			}

			for (let i = minStep; i <= maxStep; i++) {
				var freq = tuningRefA * Math.pow(octaveRatio, (i - divisions * 69/12) / divisions);
				var noteIndex = freq2note(freq);
				var stepInOctave = ((i % divisions) + divisions) % divisions;
				notes.push([noteIndex, freq, edoPattern[stepInOctave]]);
			}
			return notes;
		};

		// Pomocná funkcia na vygenerovanie ladenia založeného na pomeroch.
		var generateRatioScale = (baseFreq, ratios, octaves = 10, pattern = null, ratioStrings = null) => {
			var notes = [];
			for (let oct = -octaves; oct <= octaves; oct++) {
				var octMult = Math.pow(2, oct);
				for (let r = 0; r < ratios.length; r++) {
					var ratio = ratios[r];
					var freq = baseFreq * ratio * octMult;
					if (freq >= 20 && freq <= 20000) {
						var noteIndex = freq2note(freq);
						var isBlack = pattern ? pattern[r % pattern.length] : 0;
						var ratioStr = ratioStrings ? ratioStrings[r % ratioStrings.length] : null;
						notes.push([noteIndex, freq, isBlack, ratioStr]);
					}
				}
			}
			notes.sort((a, b) => a[1] - b[1]);
			return notes;
		};

		// Pomocná funkcia na vygenerovanie harmonického a subharmonického radu.
		var generateHarmonicSeries = (fundamental, count, stretch = 1) => {
			var notes = [];
			for (let n = 1; n <= count; n++) {
				var freq = fundamental * Math.pow(n, stretch);
				if (freq >= 20 && freq <= 20000) {
					var noteIndex = freq2note(freq);
					// Oktávy (1,2,4,8,16,32,64) sú biele, ostatné čierne.
					var isOctave = (n & (n - 1)) === 0;
					notes.push([noteIndex, freq, isOctave ? 0 : 1]);
				}
			}
			return notes;
		};

		var generateSubharmonicSeries = (baseFreq, count) => {
			var notes = [];
			for (let n = 1; n <= count; n++) {
				var freq = baseFreq / n;
				if (freq >= 20) {
					var noteIndex = freq2note(freq);
					// Oktávy (1,2,4,8,16,32,64) sú biele, ostatné čierne.
					var isOctave = (n & (n - 1)) === 0;
					notes.push([noteIndex, freq, isOctave ? 0 : 1]);
				}
			}
			notes.sort((a, b) => a[1] - b[1]);
			return notes;
		};

		// Spektrálne ladenie z explicitného zoznamu pomerov parciálov (namerané spektrá nástrojov).
		// Jeden parciál predstavuje jednu výšku, neopakuje sa po oktávach, pretože ladenie je totožné so spektrom. Referencia 1/1
		// sa vynúti aj vtedy, keď bol analyzovaný fundamentál slabý.
		var generateSpectralScale = (fundamental, ratios) => {
			var set = ratios.slice();
			if (!set.length || Math.abs(set[0] - 1) > 1e-6) set = [1].concat(set);
			var notes = [];
			for (const r of set) {
				var freq = fundamental * r;
				if (freq >= 20 && freq <= 20000) {
					var nearInt = Math.abs(r - Math.round(r)) < 0.03; // Parciál vzdialený menej než 0,03 od celého čísla je biely.
					notes.push([freq2note(freq), freq, nearInt ? 0 : 1]);
				}
			}
			notes.sort((a, b) => a[1] - b[1]);
			return notes;
		};

		// [ZDROJ] FLETCHER, Harvey. Normal Vibration Frequencies of a Stiff Piano String. Journal of the
		//   Acoustical Society of America. 1964, roč. 36, č. 1, s. 203-209. DOI 10.1121/1.1918933.
		// nelinearita tuhej struny podľa f_k = k*sqrt(1 + B*k^2), teda krivka sláčikového monochordu s kalafunou.
		var generateStiffString = (fundamental, count, B) => {
			var notes = [];
			for (let k = 1; k <= count; k++) {
				var freq = fundamental * k * Math.sqrt(1 + B * k * k);
				if (freq >= 20 && freq <= 20000) {
					notes.push([freq2note(freq), freq, (k & (k - 1)) === 0 ? 0 : 1]);
				}
			}
			return notes;
		};

		// Namerané sady parciálov nástrojov (presets-instruments.js) na spektrálne ladenia.
		var IT =(typeof window !== 'undefined' && window.INSTRUMENT_PRESETS && window.INSTRUMENT_PRESETS.tunings) || {};

		var scales = {
			free: {
				name: 'Free', category: 'Standard', full: 'Free pitch (1-cent steps)',
				description: 'continuous pitch, 1-cent resolution',
				notes: [], type: 'free', _generatedWithRefA: tuningRefA
			},
			edo12: {
				name: '12-EDO', category: 'Equal', full: '12-tone equal temperament',
				description: 'the octave in 12 equal steps',
				notes: [], type: 'edo', edoDivisions: 12, _generatedWithRefA: tuningRefA
			},
			edo24: {
				name: '24-EDO', category: 'Equal', full: '24-tone equal temperament',
				description: 'quarter-tones, 12 x 2',
				notes: [], type: 'edo', edoDivisions: 24, _generatedWithRefA: tuningRefA
			},
			edo36: {
				name: '36-EDO', category: 'Equal', full: '36-tone equal temperament',
				description: 'sixth-tones, 12 x 3',
				notes: generateEDO(36), type: 'edo', edoDivisions: 36, _generatedWithRefA: tuningRefA
			},
			edo48: {
				name: '48-EDO', category: 'Equal', full: '48-tone equal temperament',
				description: 'eighth-tones, 12 x 4',
				notes: generateEDO(48), type: 'edo', edoDivisions: 48, _generatedWithRefA: tuningRefA
			},
			edo31: {
				name: '31-EDO', category: 'Equal', full: '31-tone equal temperament',
				description: '7-limit JI within 4 cents',
				notes: generateEDO(31), type: 'edo', edoDivisions: 31, _generatedWithRefA: tuningRefA
			},
			pythagorean: {
				name: 'Pythagorean', category: 'Just Intonation', full: 'Pythagorean tuning (3-limit)',
				description: 'twelve pure 3:2 fifths',
				notes: generateRatioScale(261.63, [1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81, 27/16, 16/9, 243/128], 10, bwPattern,
					['1/1', '256/243', '9/8', '32/27', '81/64', '4/3', '729/512', '3/2', '128/81', '27/16', '16/9', '243/128']),
				type: 'ratio',
				ratios: ['1/1', '256/243', '9/8', '32/27', '81/64', '4/3', '729/512', '3/2', '128/81', '27/16', '16/9', '243/128'],
				_generatedWithRefA: tuningRefA
			},
			ji5limit: {
				name: 'JI 5-Limit', category: 'Just Intonation', full: '5-limit just intonation',
				description: 'ratios of 2, 3 and 5',
				notes: generateRatioScale(261.63, [1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8], 10, bwPattern,
					['1/1', '16/15', '9/8', '6/5', '5/4', '4/3', '45/32', '3/2', '8/5', '5/3', '9/5', '15/8']),
				type: 'ratio',
				ratios: ['1/1', '16/15', '9/8', '6/5', '5/4', '4/3', '45/32', '3/2', '8/5', '5/3', '9/5', '15/8'],
				_generatedWithRefA: tuningRefA
			},
			ji7limit: {
				name: 'JI 7-Limit', category: 'Just Intonation', full: '7-limit just intonation',
				description: 'adds ratios of 7',
				notes: generateRatioScale(261.63, [1, 16/15, 8/7, 7/6, 6/5, 5/4, 4/3, 7/5, 3/2, 8/5, 5/3, 7/4, 15/8], 10, [0,1,0,1,0,1,0,0,1,0,1,0,1],
					['1/1', '16/15', '8/7', '7/6', '6/5', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8']),
				type: 'ratio',
				ratios: ['1/1', '16/15', '8/7', '7/6', '6/5', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8'],
				_generatedWithRefA: tuningRefA
			},
			harmonicSeries: {
				name: 'Harmonic Series', category: 'Spectral', full: 'Harmonic series (partials 1-64)',
				description: 'partials 1-64 of one fundamental',
				notes: generateHarmonicSeries(55, 64), type: 'spectral',
				spectralFundamental: 55, spectralCount: 64, _generatedWithRefA: tuningRefA
			},
			subharmonicSeries: {
				name: 'Subharmonic Series', category: 'Spectral', full: 'Undertone series (1-64)',
				description: 'the harmonic series inverted',
				notes: generateSubharmonicSeries(3520, 64), type: 'subharmonic',
				subharmonicBase: 3520, subharmonicCount: 64, _generatedWithRefA: tuningRefA
			},
			bohlenPierce: {
				name: 'Bohlen-Pierce', category: 'Non-octave', full: 'Bohlen-Pierce (13ed3)',
				description: '3:1 tritave in 13 equal steps',
				notes: (() => {
					var notes = [];
					var tritave = 3;
					var bpPattern = [0,1,0,0,1,0,1,0,0,1,0,1,0];
					for (let t = -4; t <= 4; t++) {
						for (let i = 0; i < 13; i++) {
							var freq = 261.63 * Math.pow(tritave, t) * Math.pow(tritave, i/13);
							if (freq >= 20 && freq <= 20000) notes.push([freq2note(freq), freq, bpPattern[i]]);
						}
					}
					return notes.sort((a, b) => a[1] - b[1]);
				})(),
				type: 'custom', _generatedWithRefA: tuningRefA
			},
			trombone: {
				name: 'Trombone', category: 'Spectral', full: 'Trombone partials as pitches',
				description: 'measured trombone partials',
				notes: generateSpectralScale(58.27, IT.trombone || [1,2,3,4,5,6,7,8]),
				type: 'custom', _generatedWithRefA: tuningRefA
			},
			clarinetSpectral: {
				name: 'Clarinet', category: 'Spectral', full: 'Clarinet partials as pitches',
				description: 'measured clarinet partials (odd-dominant)',
				notes: generateSpectralScale(146.83, IT.clarinet || [1,3,5,7,9,11]),
				type: 'custom', _generatedWithRefA: tuningRefA
			},
			gong: {
				name: 'Gong', category: 'Spectral', full: 'Gong partials as pitches',
				description: 'measured gong partials (inharmonic)',
				notes: generateSpectralScale(110, IT.gong || [1, 2.01, 2.76, 3.02, 3.73, 5.52]),
				type: 'custom', _generatedWithRefA: tuningRefA
			},
			monochord: {
				name: 'Monochord with rosin', category: 'Spectral', full: 'Stiff-string inharmonic series',
				description: 'f_k = k*sqrt(1 + B*k^2), B = 4e-4',
				notes: generateStiffString(65.41, 48, 4e-4),
				type: 'custom', _generatedWithRefA: tuningRefA
			},
			adaptive: {
				name: 'Adaptive', category: 'Dynamic', full: 'Adaptive spectral tuning',
				description: 'pitch field follows the sounding spectrum',
				type: 'adaptive', isAdaptive: true, applyToPreview: true,
				tolerance: 25, minFreq: 20, maxFreq: 20000, notes: [], _generatedWithRefA: tuningRefA
			}
		};

		// Vygenerovať noty ladenia Free (stupne po 1c, MIDI 0-127).
		for (let cent = 0; cent <= 12700; cent++) {
			const note = cent / 100;
			const freq = tuningRefA * Math.pow(2, (note - 69) / 12);
			scales.free.notes.push([note, freq, 0]);
		}

		var minMidi12 =Math.ceil(69 + 12 * Math.log2(MIN_FREQ / tuningRefA));
		var maxMidi12 = Math.floor(69 + 12 * Math.log2(MAX_FREQ / tuningRefA));
		for (let i = minMidi12; i <= maxMidi12; i++) {
			const freq = tuningRefA * Math.pow(2, (i - 69) / 12);
			const bwKey = bwPattern[((i % 12) + 12) % 12];
			scales.edo12.notes.push([i, freq, bwKey]);
		}

		var minStep24 =Math.ceil(2 * (69 + 12 * Math.log2(MIN_FREQ / tuningRefA)));
		var maxStep24 = Math.floor(2 * (69 + 12 * Math.log2(MAX_FREQ / tuningRefA)));
		for (let i = minStep24; i <= maxStep24; i++) {
			const note = i / 2;
			const freq = tuningRefA * Math.pow(2, (note - 69) / 12);
			const bwKey = bwPattern[((Math.round(note) % 12) + 12) % 12];
			scales.edo24.notes.push([note, freq, bwKey]);
		}

		return scales;
	},
	
	// Používa keypoints na dynamické farby, ktoré sa menia naprieč klaviatúrou.
	createDefaultSpectra: () => {
		// Presety farieb sa nachádzajú v presets-instruments.js.
		var P =(typeof window !== 'undefined' && window.INSTRUMENT_PRESETS) || { core: {}, full: {} };
		var clone = (o) => JSON.parse(JSON.stringify(o));
		if (typeof Spectra !== 'undefined' && Spectra.edition === 'full') {
			return clone({ ...P.core, ...P.full });
		}
		return clone(P.core);
	},
	
	createDefaultGrids: () => {
		var patternFromGaps = (gaps) => {
			var total = gaps.reduce((a, b) => a + b, 0);
			var pat = [0], acc = 0;
			for (let i = 0; i < gaps.length - 1; i++) { acc += gaps[i]; pat.push(acc / total); }
			return pat;
		};
		var N = 8;
		var harmonicGaps    = Array.from({length: N}, (_, i) => 1 / (i + 1));       // Medzery sa zmenšujú -> accelerando.
		var subharmonicGaps = Array.from({length: N}, (_, i) => i + 1);             // Medzery sa zväčšujú -> ritardando.
		// Zlatý rez, teda 1,618.
		var phi = (1 + Math.sqrt(5)) / 2;
		var sineGaps        = Array.from({length: N}, (_, i) => 1 + 0.7 * Math.sin(2 * Math.PI * i / N));
		var IT = (typeof window !== 'undefined' && window.INSTRUMENT_PRESETS && window.INSTRUMENT_PRESETS.tunings) || {};

		// Spektrum sa berie ako frekvencia, každý parciál je frekvencia.
		var patternFromRatios = (ratios) => {
			var set = new Set();
			for (const r of ratios) {
				for (let k = 0; k / r < 1 - 1e-9; k++) set.add(Math.round((k / r) * 1e6) / 1e6);
			}
			return Array.from(set).sort((a, b) => a - b);
		};
		// Parciály sa obmedzia, aby najrýchlejší pulz zostal hudobne únosný 90 ms.
		var clarinetRatios = (IT.clarinet || [1, 3, 5, 7, 9, 11]).filter(r => r <= 11.5);
		var goldenRatios = [];
		for (let n = 0; Math.pow(phi, n) <= 11.5; n++) goldenRatios.push(Math.pow(phi, n));

		return {
			'off': { type: 'off', name: 'Off', category: 'Standard', deletable: false },
			'seconds':  { type: 'linear', name: 'Seconds',   category: 'Absolute', deletable: false, spacingMs: 1000, subdivisions: 1 },
			'seconds2': { type: 'linear', name: '2 Seconds', category: 'Absolute', spacingMs: 2000, subdivisions: 1 },
			'seconds4': { type: 'linear', name: '4 Seconds', category: 'Absolute', spacingMs: 4000, subdivisions: 1 },
			'seconds8': { type: 'linear', name: '8 Seconds', category: 'Absolute', spacingMs: 8000, subdivisions: 1 },
			'harmonic':    { type: 'sequence', name: 'Harmonic',    category: 'Spectral', description: 'onset gaps 1/n (accelerando)', cellMs: 4000, pattern: patternFromGaps(harmonicGaps) },
			'subharmonic': { type: 'sequence', name: 'Subharmonic', category: 'Spectral', description: 'onset gaps n (ritardando)',    cellMs: 4000, pattern: patternFromGaps(subharmonicGaps) },
			'sinewave':    { type: 'sequence', name: 'Sinewave',    category: 'Spectral', description: 'spacing breathes on a sine',    cellMs: 4000, pattern: patternFromGaps(sineGaps) },
			'golden':      { type: 'sequence', name: 'Golden',      category: 'Spectral', description: 'phi-partial pulse frequencies',      cellMs: 1000, pattern: patternFromRatios(goldenRatios) },
			'clarinet':    { type: 'sequence', name: 'Clarinet',    category: 'Spectral', description: 'clarinet-partial pulse frequencies', cellMs: 1000, pattern: patternFromRatios(clarinetRatios) }
		};
	},
	
	
	// Indikátor na zabránenie dvojitému zobrazeniu úvodného UI.
	startupUIShown: false,


	showStartupUI: async () => {
		if (ProjectManager.startupUIShown) {
			Logger.log('showStartupUI: Already shown, skipping');
			return;
		}
		ProjectManager.startupUIShown = true;
		
		var overlay = document.getElementById('startOverlay');
		var projectContainer = document.getElementById('projectSelectContainer');
		var loadingIndicator = document.getElementById('startOverlayLoading');
		
		if (!overlay) return;
		
		if (loadingIndicator) loadingIndicator.style.display = 'none';

		if (!window.electronAPI?.isElectron) {
			var landingSections = document.getElementById('landingSections');
			var landingFooter = document.getElementById('landingFooter');
			if (landingSections) landingSections.style.display = '';
			if (landingFooter) landingFooter.style.display = '';
		}

		ProjectManager.hideLoadingBar();
		var selectContainer = document.querySelector('.project-select-container');
		if (selectContainer) selectContainer.style.display = '';

		var projectHeader = document.querySelector('.project-select-header');
		if (projectHeader) projectHeader.style.display = '';

		var DB = window.DB;
		if (DB?.autoSaveTimer) {
			clearTimeout(DB.autoSaveTimer);
			DB.autoSaveTimer = null;
		}
		ProjectManager.currentProjectId = null;
		ProjectManager.currentProject = null;
		Logger.log('Startup UI: Reset currentProjectId to null');
		
		if (projectContainer) {
			projectContainer.style.display = 'block';
		}

		await ProjectManager.loadRecentProjectsList();

		var isCreating = false;

		var getTodayName = () => {
			var d = new Date();
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		};

		var createProjectWithGuard = async () => {
			if (isCreating) {
				Logger.log('Already creating project, ignoring duplicate call');
				return;
			}
			isCreating = true;

			var nameInput = overlay.querySelector('#new-project-name');
			var name = nameInput?.value?.trim() || getTodayName();
			Logger.log('Creating project with name:', name);

			try {
				await ProjectManager.handleCreateProject(name);
			} finally {
				isCreating = false;
			}
		};

		// Tlačidlo nového projektu odkryje vstupné pole.
		var newProjectBtn = overlay.querySelector('.new-project-btn');
		var newProjectInline = overlay.querySelector('.new-project-inline');
		var nameInput = overlay.querySelector('#new-project-name');

		var hideInlineInput = () => {
			newProjectInline.style.display = 'none';
			newProjectBtn.style.display = '';
		};

		if (newProjectBtn && newProjectInline && nameInput && !newProjectBtn.dataset.listenerBound) {
			newProjectBtn.dataset.listenerBound = 'true';
			newProjectBtn.addEventListener('click', () => {
				newProjectBtn.style.display = 'none';
				newProjectInline.style.display = 'flex';
				nameInput.value = getTodayName();
				nameInput.focus();
				nameInput.select();
			});
		}

		var createBtn = overlay.querySelector('.create-project-btn');
		if (createBtn && !createBtn.dataset.listenerBound) {
			createBtn.dataset.listenerBound = 'true';
			createBtn.addEventListener('click', createProjectWithGuard);
		}

		if (nameInput && !nameInput.dataset.listenerBound) {
			nameInput.dataset.listenerBound = 'true';
			nameInput.addEventListener('keydown', async (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					await createProjectWithGuard();
				} else if (e.key === 'Escape') {
					hideInlineInput();
				}
			});

			nameInput.addEventListener('blur', (e) => {
				// Drobné oneskorenie, aby sa stihlo zaregistrovať kliknutie na tlačidlo vytvoriť.
				setTimeout(() => {
					if (newProjectInline.style.display !== 'none' && !newProjectInline.contains(document.activeElement)) {
						hideInlineInput();
					}
				}, 150);
			});
		}
	},
	loadRecentProjectsList: async () => {
		var listContainer = document.querySelector('.project-list');
		if (!listContainer) return;

		listContainer.innerHTML = '<p class="loading-text">Loading projects...</p>';

		var projects = (await ProjectManager.getAllProjects()).slice(0, 20);

		listContainer.innerHTML = '';

		var section = document.createElement('div');
		section.className = 'project-section local-projects';

		// Prázdny stav je štylizovaný v CSS pomocou [data-empty] na overlay.
		var overlay = document.getElementById('startOverlay');
		if (projects.length === 0) {
			listContainer.style.display = 'none';
			if (overlay) overlay.dataset.empty = '';
		} else {
			listContainer.style.display = '';
			if (overlay) delete overlay.dataset.empty;

			for (const project of projects) {
				section.appendChild(ProjectManager.createProjectListItem(project));
			}
			listContainer.appendChild(section);
		}

		var selectContent = document.querySelector('.project-select-content');
		var existing = selectContent?.querySelector('.project-buttons-container');
		if (existing) existing.remove();

		if (selectContent && projects.length > 0) {
			var buttonsContainer = document.createElement('div');
			buttonsContainer.className = 'project-buttons-container';

			buttonsContainer.innerHTML = `
				<button class="open-project-file-btn">
					Open File...
				</button>
			`;

			selectContent.appendChild(buttonsContainer);

			buttonsContainer.querySelector('.open-project-file-btn').addEventListener('click', (e) => {
				Logger.log('Open Project File button clicked');
				e.stopPropagation();
				var fileInput = document.querySelector('.load-midi');
				Logger.log('File input found:', fileInput);
				if (fileInput) {
					fileInput.click();
				} else {
					Logger.error('Could not find .load-midi file input element');
				}
			});
		}
	},

	createProjectListItem: (project) => {
		var item = document.createElement('div');
		item.className = 'project-list-item local-project';
		item.dataset.projectId = project.id;
		item.dataset.projectType = 'local';

		var date = new Date(project.updatedAt || project.updated_at);
		var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

		item.innerHTML = `
			<div class="project-item-info">
				<div class="project-item-name">${escapeHtml(project.name)}</div>
				<div class="project-item-date">Last modified: ${dateStr}</div>
			</div>
			<div class="project-item-actions">
				<button class="project-rename-btn" title="Rename project">
					<i class="fa fa-pencil"></i>
				</button>
				<button class="project-delete-btn" title="Delete project">
					<i class="fa fa-trash"></i>
				</button>
			</div>
		`;

		item.addEventListener('click', async (e) => {
			if (e.target.closest('.project-item-actions')) return;
			await ProjectManager.handleOpenProject(project.id);
		});

		item.querySelector('.project-rename-btn').addEventListener('click', async (e) => {
			e.stopPropagation();
			var newName = await showPrompt('Enter new project name:', project.name, { title: 'Rename Project' });
			if (newName && newName.trim() && newName !== project.name) {
				await ProjectManager.renameProject(project.id, newName.trim());
				await ProjectManager.loadRecentProjectsList();
			}
		});

		item.querySelector('.project-delete-btn').addEventListener('click', async (e) => {
			e.stopPropagation();
			if (await showConfirm(`Delete project "${project.name}"? This cannot be undone.`, { title: 'Delete Project', type: 'danger' })) {
				await ProjectManager.deleteProject(project.id);
				await ProjectManager.loadRecentProjectsList();
			}
		});

		return item;
	},

	currentProjectType: 'local',

	handleCreateProject: async (name) => {
		Logger.log('=== handleCreateProject called ===', name);

		var projectId = await ProjectManager.createNewProject(name);
		Logger.log('=== handleCreateProject: local project created, now opening ===', projectId);
		await ProjectManager.handleOpenProject(projectId);
	},

	showLoadingBar: (projectName) => {
		var selectContainer = document.querySelector('.project-select-container');
		if (selectContainer) {
			selectContainer.style.display = 'none';
		}
		var projectHeader = document.querySelector('.project-select-header');
		if (projectHeader) {
			projectHeader.style.display = 'none';
		}
		var _ls = document.getElementById('landingSections');
		var _lf = document.getElementById('landingFooter');
		if (_ls) _ls.style.display = 'none';
		if (_lf) _lf.style.display = 'none';

		var loadingContainer = document.querySelector('.project-loading-container');
		if (!loadingContainer) {
			loadingContainer = document.createElement('div');
			loadingContainer.className = 'project-loading-container';
			loadingContainer.innerHTML = `
				<div class="project-loading-title">Loading <span class="project-loading-name"></span></div>
				<div class="project-loading-bar-bg">
					<div class="project-loading-bar-fill"></div>
				</div>
				<div class="project-loading-status">Initializing...</div>
			`;
			var overlay = document.getElementById('startOverlay');
			if (overlay) {
				overlay.appendChild(loadingContainer);
			}
		}

		loadingContainer.querySelector('.project-loading-name').textContent = projectName || 'project';
		loadingContainer.querySelector('.project-loading-bar-fill').style.width = '0%';
		loadingContainer.querySelector('.project-loading-status').textContent = 'Initializing...';
		loadingContainer.classList.add('visible');
	},
	
	updateLoadingBar: (percent, status) => {
		var fill = document.querySelector('.project-loading-bar-fill');
		var statusEl = document.querySelector('.project-loading-status');
		if (fill) fill.style.width = percent + '%';
		if (statusEl) statusEl.textContent = status;
	},
	
	hideLoadingBar: () => {
		var loadingContainer = document.querySelector('.project-loading-container');
		if (loadingContainer) {
			loadingContainer.classList.remove('visible');
		}
	},

	// Kontrola dát projektu a odhalenie problémov s kompatibilitou. Prázdne pole upozornení, ak je všetko v poriadku.
	validateProjectData: () => {
		var warnings = [];
		var MIDI = window.MIDI;
		var instruments = window.instruments || [];

		if (!MIDI || !MIDI.data) {
			warnings.push('MIDI data is missing or corrupted');
			return warnings;
		}

		if (MIDI.data.length !== instruments.length) {
			warnings.push(`Instrument count (${instruments.length}) doesn't match MIDI track count (${MIDI.data.length})`);
		}

		var missingTrackData = 0;
		var notesWithoutPartials = 0;
		var malformedNotes = 0;

		for (let i = 0; i < Math.max(MIDI.data.length, instruments.length); i++) {
			if (instruments[i] && !MIDI.data[i]) {
				missingTrackData++;
				continue;
			}

			if (MIDI.data[i] && Array.isArray(MIDI.data[i])) {
				for (let j = 0; j < MIDI.data[i].length; j++) {
					var note = MIDI.data[i][j];
					if (!note || !Array.isArray(note)) {
						malformedNotes++;
						continue;
					}
					// Kontrola, či note chýbajú dáta parciálov (starší formát).
					if (note.length < 5 || !note[4] || !note[4].partials) {
						notesWithoutPartials++;
					}
				}
			}
		}

		if (missingTrackData > 0) {
			warnings.push(`${missingTrackData} instrument(s) have no MIDI data`);
		}
		if (notesWithoutPartials > 0) {
			warnings.push(`${notesWithoutPartials} note(s) are missing partials data (older file format)`);
		}
		if (malformedNotes > 0) {
			warnings.push(`${malformedNotes} note(s) have corrupted data`);
		}

		return warnings;
	},

	handleOpenProject: async (projectId) => {
		try {
			var DB = window.DB;
			if (DB?.forceSave) await DB.forceSave();
			// Prípadný čakajúci auto-save sa zruší, aby náhodou nedošlo k súbehu.
			if (DB?.cancelPendingAutoSave) {
				DB.cancelPendingAutoSave();
			}

			// Indikátor načítavania sa nastaví, aby sa počas inicializácie nespustil auto-save.
			ProjectManager.isLoading = true;

			ProjectManager.currentProjectType = 'local';

			ProjectManager.showLoadingBar('');
			ProjectManager.updateLoadingBar(0, 'Starting...');

			await ProjectManager.loadProject(projectId, (percent, status) => {
				// Priebeh loadProject je 0-100, namapovať na 0-75 z celku.
				var mappedPercent = Math.round(percent * 0.75);
				ProjectManager.updateLoadingBar(mappedPercent, status);
			});

			var projectName = ProjectManager.currentProject?.name || 'project';
			var loadingName = document.querySelector('.project-loading-name');
			if (loadingName) loadingName.textContent = projectName;

			ProjectManager.updateLoadingBar(77, 'Initializing audio...'); // Arbitrárne percentuálne hodnoty.

			// Inicializácia audio contextu.
			if (typeof Tone !== 'undefined' && Tone.context.state !== 'running') {
				await Tone.context.resume();
			}
			if (typeof Tone !== 'undefined') Tone.context.lookAhead = 0.01;

			ProjectManager.updateLoadingBar(82, 'Loading synthesizers...');

			var loadSynths = window.loadSynths;
			if (loadSynths) loadSynths();

			ProjectManager.updateLoadingBar(87, 'Rendering canvas...');

			var Canvas = window.Canvas;
			if (Canvas) Canvas.step();
			window.initDone = true;
			
			ProjectManager.updateLoadingBar(90, 'Restoring view state...');

			var playback = window.playback;
			if (ProjectManager.currentProject?.viewState) {
				var vs = ProjectManager.currentProject.viewState;
				if (Canvas) {
					if (vs.barSize) window.barSize = vs.barSize;
					Canvas.offx = vs.scrollTime !== undefined ? -(vs.scrollTime * (window.barSize || 200)) : (vs.scrollPosition || 0);
					Canvas.offy = vs.verticalScroll || 0;
				}
				if (playback && vs.playheadPosition !== undefined) {
					playback.time = vs.playheadPosition;
					playback.midiTime = vs.playheadPosition;
				}
				if (playback) {
					if (vs.loopStart !== undefined && vs.loopStart !== null) playback.loopStart = vs.loopStart;
					if (vs.loopEnd !== undefined && vs.loopEnd !== null) playback.loopEnd = vs.loopEnd;
				}
				if (vs.selectedTrack !== undefined && vs.selectedTrack >= 0) {
					var instruments = window.instruments;
					if (instruments && vs.selectedTrack < instruments.length) {
						window.primaryTrackIndex = vs.selectedTrack;
						instruments.forEach((inst, idx) => {
							inst.selected = (idx === vs.selectedTrack);
						});
					}
				}
			}

			ProjectManager.updateLoadingBar(94, 'Refreshing UI...');

			var UI = window.UI;
			if (UI?.instruments) UI.instruments.refresh();

			var EditorLists = window.EditorLists;
			if (EditorLists) {
				EditorLists.populateTuningList();
				EditorLists.populateTimbreList();
				EditorLists.populateGridList();
			}

			if (UI?.select?.refreshAllSpectraDropdowns) {
				UI.select.refreshAllSpectraDropdowns();
			}

			var WebMIDI = window.WebMIDI;
			if (WebMIDI?.applyProjectSettings) {
				WebMIDI.applyProjectSettings();
			}

			ProjectManager.updateLoadingBar(100, 'Done');

			await new Promise(resolve => setTimeout(resolve, 200));

			ProjectManager.resetNewProjectForm();
			var overlay = document.getElementById('startOverlay');
			if (overlay) {
				overlay.style.display = 'none';
			var _ls = document.getElementById('landingSections'); if (_ls) _ls.style.display = 'none';
			var _lf = document.getElementById('landingFooter'); if (_lf) _lf.style.display = 'none';
			}
			var projectHeader = document.querySelector('.project-select-header');
			if (projectHeader) {
				projectHeader.style.display = 'none';
			}

			ProjectManager.isLoading = false;
		
			var writeBtn = document.querySelector('#header-write');
			if (writeBtn) writeBtn.click();

		} catch (error) {
			ProjectManager.isLoading = false;
			ProjectManager.hideLoadingBar();
			Logger.error('Failed to open project:', error);
			showStatus('Failed to open project: ' + error.message, { type: 'error' });
		}
	},
		
	resetNewProjectForm: () => {
		var newProjectBtn = document.querySelector('.new-project-btn');
		var newProjectInline = document.querySelector('.new-project-inline');
		if (newProjectBtn) newProjectBtn.style.display = '';
		if (newProjectInline) newProjectInline.style.display = 'none';
	},

};

