var NOTE_MIN_LENGTH = 0.1;

// Výpisy okrem chýb sa objavia len pri zapnutom Config.debug.
var Logger = {
	log: function(...args) {
		if (typeof Config !== 'undefined' && Config.debug) {
			console.log('[Spectra]', ...args);
		}
	},
	warn: function(...args) {
		if (typeof Config !== 'undefined' && Config.debug) {
			console.warn('[Spectra]', ...args);
		}
	},
	error: function(...args) {
		console.error('[Spectra]', ...args);
	},
	info: function(...args) {
		if (typeof Config !== 'undefined' && Config.debug) {
			console.info('[Spectra]', ...args);
		}
	}
};
// Formát noty: [čas, dĺžka, výška, partial, data, selected, depth, hidden]
// pomenované indexy sprehľadňujú orientáciu vo viacrozmerných poliach.
var N_TIME = 0,
	N_DUR = 1,
	N_PITCH = 2,
	N_PARTIAL = 3,
	N_DATA = 4,
	N_SEL = 5,
	N_DEPTH = 6,
	N_HIDDEN = 7;

// Predvolená farba novej stopy musí odkazovať na farbu, ktorá existuje v základných spektrách (pozri presets-instruments.js). Určuje sa len tu, aby predvoľby "spectrum: 'sawtooth'" neprestali platiť pri zmene sady presetov.
var DEFAULT_SPECTRUM = 'pluck';

// Formát parciálu: [x, y, width, heightFactor, selected, hover, locked].
var P_X = 0,
	P_Y = 1,
	P_W = 2,
	P_H = 3,
	P_SEL = 4,
	P_HOVER = 5,
	P_LOCKED = 6;

var OCTAVE_SPACING = 120;
	DEFAULT_VELOCITY = 100;

var DEFAULT_ENVELOPE = {
	a: 0.005,
	d: 0.0,
	s: 1.0,
	r: 0.005
};

var AUDIO_LATENCY_OVERRIDE = null;

var Config = {
	version: '1.1',
	debug: false,
	io: {
		midiClockPPQN: 24,
		oscDefaultHost: '127.0.0.1',
		oscDefaultPort: 9000,
		wavSampleRate: 48000,
		wavSampleRates: [22050, 44100, 48000, 96000],
	},
	defaultSettings: {
		grid: '16th',
		scale: 'edo12',
		playbackPitch: 0,
		midiPitchCenter: 69,
		partialLimit: 0,
		orderedPartialsSelection: 0,
		performanceMode: false,
		playbackType: 'return',
		playbackSpeed: 1,
		midiInputId: '',
		midiOutputId: '',
		midiChannel: 0,
		midiOutputTrackMode: 'all',
		midiOutputTracks: [],
		midiOutputPartialMode: 'all',
		midiOutputPartials: [],
		wavSampleRate: 48000
	},
	defaultViewState: {
		scrollPosition: 0,
		// 6,5 oktávy pod výškou 0 pri predvolenom octaveSpacing 240, rovnako ako predvolené offy plátna, čím sa pohľad vycentruje okolo C4.
		verticalScroll: 6.5 * 240,
		playheadPosition: 0,
		selectedTrack: 0
	}
};

var Spectra = window.Spectra || {};

Spectra.edition = 'mini';
Spectra.features = {};
Spectra.hooks = {
	keyDown: [],
	keyUp: [],
	canvasMouseUp: [],
	onNoteCreate: []
};

Spectra.registerFeature = function(name, featureObj) {
	if (Spectra.features[name]) {
		Logger.warn('Feature already registered:', name);
		return;
	}

	Spectra.features[name] = featureObj;
	Logger.log('Feature registered:', name);

	if (!featureObj._boundHooks) featureObj._boundHooks = {};
	var hookNames = Object.keys(Spectra.hooks);
	for (const hookName of hookNames) {
		if (typeof featureObj[hookName] === 'function') {
			var bound = featureObj[hookName].bind(featureObj);
			featureObj._boundHooks[hookName] = bound;
			Spectra.hooks[hookName].push(bound);
		}
	}

	if (typeof featureObj.init === 'function') {
		try {
			featureObj.init();
		} catch (err) {
			Logger.error('Feature init failed:', name, err);
		}
	}
};

Spectra.callHooks = function(hookName, ...args) {
	var hooks = Spectra.hooks[hookName];
	if (!hooks || hooks.length === 0) {
		return false;
	}

	for (const hook of hooks) {
		try {
			var result = hook(...args);
			if (result === true) {
				return true;
			}
		} catch (err) {
			Logger.error('Hook error in', hookName, err);
		}
	}

	return false;
};

Spectra.setEdition = function(edition) {
	var isElectron = window.electronAPI?.isElectron;
	if (!isElectron && edition === 'full') {
		Logger.log('Browser version is always Mini, ignoring setEdition(full)');
		return;
	}
	Spectra.edition = edition;
	document.body.setAttribute('data-edition', edition);
	Logger.log('Edition set to:', edition);
};

window.Spectra = Spectra;
