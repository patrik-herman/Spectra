// Po istom čase bolo nutné vytvoriť správcu funkcií undo a redo,
// nakoľko nezvratné rozhodnutia sa nedali vziať späť.


var UndoManager = {
	undoStack: [],
	redoStack: [],

	maxHistory: 100,
	maxMemoryMB: 50,
	currentMemoryBytes: 0,
	redoMemoryBytes: 0,

	paused: false,

	trackableKeys: ['MIDIdata', 'instruments', 'scales', 'spectra', 'grids', 'trackEvents'],

	init: function() {
		this.clear();
		Logger.log('UndoManager initialized');
	},

	record: function(entry) {
		if (this.paused) return;

		this.redoStack = [];
		this.redoMemoryBytes = 0;

		if (!entry.timestamp) {
			entry.timestamp = Date.now();
		}

		if (!entry.memoryBytes) {
			entry.memoryBytes = this.estimateMemory(entry);
		}

		this.undoStack.push(entry);
		this.currentMemoryBytes += entry.memoryBytes;

		this.pruneHistory();
	},

	recordSnapshot: function(description, keys, beforeState, afterState) {
		if (this.paused) return;
		var entry = {
			type: 'snapshot',
			description: description,
			keys: Array.isArray(keys) ? keys : [keys],
			before: beforeState,
			after: afterState,
			timestamp: Date.now(),
			memoryBytes: this.estimateMemory(beforeState) + this.estimateMemory(afterState)
		};

		this.record(entry);
	},

	recordNoteDelta: function(description, trackIndex, changes) {
		if (this.paused) return;
		var before = {};
		var after = {};
		var noteIndices = [];

		for (let i = 0; i < changes.length; i++) {
			var change = changes[i];
			noteIndices.push(change.noteIndex);
			before[change.noteIndex] = change.before;
			after[change.noteIndex] = change.after;
		}
		var entry = {
			type: 'delta',
			description: description,
			key: 'MIDIdata',
			trackIndex: trackIndex,
			noteIndices: noteIndices,
			before: before,
			after: after,
			timestamp: Date.now(),
			memoryBytes: this.estimateMemory(before) + this.estimateMemory(after)
		};

		this.record(entry);
	},

	recordMultiTrackDelta: function(description, trackChanges) {
		if (this.paused) return;
		var entry = {
			type: 'multitrack-delta',
			description: description,
			key: 'MIDIdata',
			trackChanges: {},
			timestamp: Date.now(),
			memoryBytes: 0
		};

		for (let trackIdx in trackChanges) {
			var changes = trackChanges[trackIdx];
			var before = {};
			var after = {};
			var noteIndices = [];

			for (let i = 0; i < changes.length; i++) {
				var change = changes[i];
				noteIndices.push(change.noteIndex);
				before[change.noteIndex] = change.before;
				after[change.noteIndex] = change.after;
			}

			entry.trackChanges[trackIdx] = {
				noteIndices: noteIndices,
				before: before,
				after: after
			};

			entry.memoryBytes += this.estimateMemory(before) + this.estimateMemory(after);
		}

		this.record(entry);
	},

	undo: function() {
		if (this.undoStack.length === 0) {
			Logger.log('UndoManager: Nothing to undo');
			return false;
		}
		var entry = this.undoStack.pop();
		this.currentMemoryBytes = Math.max(0, this.currentMemoryBytes - (entry.memoryBytes || 0));

		this.redoStack.push(entry);
		this.redoMemoryBytes += entry.memoryBytes || 0;

		this.pruneRedoStack();

		this.applyEntry(entry, 'undo');

		Logger.log('UndoManager: Undo -', entry.description);
		return true;
	},

	redo: function() {
		if (this.redoStack.length === 0) {
			Logger.log('UndoManager: Nothing to redo');
			return false;
		}
		var entry = this.redoStack.pop();
		this.redoMemoryBytes = Math.max(0, this.redoMemoryBytes - (entry.memoryBytes || 0));

		this.undoStack.push(entry);
		this.currentMemoryBytes += entry.memoryBytes || 0;

		this.applyEntry(entry, 'redo');

		Logger.log('UndoManager: Redo -', entry.description);
		return true;
	},

	applyEntry: function(entry, direction) {
		this.paused = true;

		try {
			this.applySingleEntry(entry, direction);

			var affectsNotes = this.entryAffectsNotes(entry);
			this.refreshUI(affectsNotes);

		} finally {
			this.paused = false;
		}
	},

	entryAffectsNotes: function(entry) {
		if (entry.type === 'delta' || entry.type === 'multitrack-delta') {
			return true;
		}
		if (entry.type === 'snapshot' && entry.keys && entry.keys.includes('MIDIdata')) {
			return true;
		}
		return false;
	},

	applySingleEntry: function(entry, direction) {
		if (entry.type === 'delta') {
			this.applyDelta(entry, direction);
		} else if (entry.type === 'multitrack-delta') {
			this.applyMultiTrackDelta(entry, direction);
		} else if (entry.type === 'snapshot') {
			var state = direction === 'undo' ? entry.before : entry.after;
			this.applySnapshot(entry, state);
		}
	},

	// aplikácia zmien nôt jednej stopy smerom k 'state', pričom 'otherState' (druhá
	// strana delty) určuje typ zásahu na každom indexe:
	// state[idx] === null           -> nota tam byť nemá       -> zmazať
	// otherState[idx] === null      -> nota tam ešte nie je    -> vložiť
	// obe rôzne od null             -> prepísať na mieste
	// klasifikovať podľa oboch strán je nutné preto, že krok vzad po zmazaní noty
	// v strede stopy je vloženie na pôvodný index; prepis by prepísal
	// notu posunutú medzitým na to miesto
	_applyTrackChanges: function(trackData, noteIndices, state, otherState, trackIndex, PlaybackManager) {
		var deletions = [];
		var updates = [];
		var insertions = [];
		for (let i = 0; i < noteIndices.length; i++) {
			const idx = noteIndices[i];
			if (state[idx] === null || state[idx] === undefined) {
				deletions.push(idx);
			} else if (otherState[idx] === null || otherState[idx] === undefined) {
				insertions.push(idx);
			} else {
				updates.push(idx);
			}
		}

		// Najprv zmeny bez posunu indexov.
		for (let i = 0; i < updates.length; i++) {
			if (updates[i] < trackData.length) {
				trackData[updates[i]] = structuredClone(state[updates[i]]);
			}
		}

		deletions.sort(function(a, b) { return b - a; });
		for (let i = 0; i < deletions.length; i++) {
			const idx = deletions[i];
			if (idx < trackData.length) {
				if (PlaybackManager) {
					PlaybackManager.stopNote(trackIndex, idx);
				}
				trackData.splice(idx, 1);
			}
		}

		insertions.sort(function(a, b) { return a - b; });
		for (let i = 0; i < insertions.length; i++) {
			const idx = insertions[i];
			trackData.splice(idx, 0, structuredClone(state[idx]));
		}
	},

	applyDelta: function(entry, direction) {
		var MIDI = window.MIDI;
		if (!MIDI) return;
		var data = MIDI.data;
		var trackData = data[entry.trackIndex];

		if (!trackData) return;

		var state = direction === 'undo' ? entry.before : entry.after;
		var otherState = direction === 'undo' ? entry.after : entry.before;
		this._applyTrackChanges(trackData, entry.noteIndices, state, otherState,
			entry.trackIndex, window.PlaybackManager);

		var DB = window.DB;
		if (DB) {
			DB.set('MIDIdata', data, { skipUndo: true });
		}
	},

	applyMultiTrackDelta: function(entry, direction) {
		var MIDI = window.MIDI;
		if (!MIDI) return;
		var data = MIDI.data;
		var PlaybackManager = window.PlaybackManager;

		for (let trackIdx in entry.trackChanges) {
			var trackChange = entry.trackChanges[trackIdx];
			var trackData = data[trackIdx];

			if (!trackData) continue;

			var state = direction === 'undo' ? trackChange.before : trackChange.after;
			var otherState = direction === 'undo' ? trackChange.after : trackChange.before;
			this._applyTrackChanges(trackData, trackChange.noteIndices, state, otherState,
				parseInt(trackIdx), PlaybackManager);
		}

		var DB = window.DB;
		if (DB) {
			DB.set('MIDIdata', data, { skipUndo: true });
		}
	},

	applySnapshot: function(entry, state) {
		var DB = window.DB;
		for (let i = 0; i < entry.keys.length; i++) {
			var key = entry.keys[i];
			var value = state[key];

			if (value !== undefined && DB) {
				DB.set(key, structuredClone(value), { skipUndo: true });
			}
		}
	},

	refreshUI: function(affectsNotes) {
		var UI = window.UI;
		if (UI?.instruments?.refresh) {
			UI.instruments.refresh();
		}

		this.refreshSynths();

		var Timeline = window.Timeline;
		if (Timeline?.draw) {
			Timeline.draw();
		}

		var GridSystem = window.GridSystem;
		if (GridSystem?.refreshCache) {
			GridSystem.refreshCache();
		}

		var AdaptiveTuning = window.AdaptiveTuning;
		if (AdaptiveTuning?.refresh) {
			AdaptiveTuning.refresh();
		}

		var Canvas = window.Canvas;
		if (Canvas?.refreshCache) {
			Canvas.refreshCache();
		}

		if (affectsNotes && window['switch-checkbox-headphones']?.checked) {
			setTimeout(function() {
				if (typeof Canvas !== 'undefined' && Canvas.previewChordPartials) {
					Canvas.previewChordPartials();
				}
			}, 10);
		}
	},

	refreshSynths: function() {
		var synths = window.synths;
		var DB = window.DB;
		if (!synths || !DB) return;
		var instruments = DB.get('instruments');
		var spectraList = DB.get('spectra');

		if (!instruments || !spectraList) return;

		var DynamicTimbre = window.DynamicTimbre;

		for (let i = 0; i < instruments.length; i++) {
			if (!synths[i] || !instruments[i]) continue;
			var spectrumKey = instruments[i].spectrum;
			var timbre = spectraList[spectrumKey];

			if (!timbre) continue;
			var partialsData = typeof DynamicTimbre !== 'undefined'
				? DynamicTimbre.getPartialsAtPitch(timbre, 60)
				: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, 60) : (timbre.data || [[1, 1]]));

			if (!partialsData) continue;
			var newPartials = partialsData.map(function(m) { return m[1]; });

			try {
				synths[i].set({
					oscillator: {
						type: "custom",
						partials: newPartials
					}
				});
			} catch (e) {
				Logger.warn('UndoManager: Failed to update synth', i, e);
			}
		}
	},

	pruneHistory: function() {
		while (this.undoStack.length > this.maxHistory) {
			const removed = this.undoStack.shift();
			this.currentMemoryBytes = Math.max(0, this.currentMemoryBytes - (removed.memoryBytes || 0));
		}
		var maxBytes = this.maxMemoryMB * 1024 * 1024;
		while (this.currentMemoryBytes > maxBytes && this.undoStack.length > 1) {
			const removed = this.undoStack.shift();
			this.currentMemoryBytes = Math.max(0, this.currentMemoryBytes - (removed.memoryBytes || 0));
		}
	},

	pruneRedoStack: function() {
		var maxBytes = this.maxMemoryMB * 1024 * 1024;
		while (this.redoMemoryBytes > maxBytes && this.redoStack.length > 1) {
			var removed = this.redoStack.shift();
			this.redoMemoryBytes = Math.max(0, this.redoMemoryBytes - (removed.memoryBytes || 0));
		}
	},

	estimateMemory: function(obj) {
		if (obj === null || obj === undefined) return 0;

		try {
			return JSON.stringify(obj).length * 2;
		} catch (e) {
			return 10000;
		}
	},

	clear: function() {
		this.undoStack = [];
		this.redoStack = [];
		this.currentMemoryBytes = 0;
		this.redoMemoryBytes = 0;
		this.transaction = null;
		this.paused = false;
	},

	canUndo: function() {
		return this.undoStack.length > 0;
	},

	canRedo: function() {
		return this.redoStack.length > 0;
	},

	getUndoCount: function() {
		return this.undoStack.length;
	}
};

if (typeof window !== 'undefined') {
	window.UndoManager = UndoManager;
}

UndoManager.init();
