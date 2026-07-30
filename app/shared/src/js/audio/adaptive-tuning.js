// AdaptiveTuning je výškové pole na základe práve znejúcich nôt, fungujúce na podobnom systéme ako prirodzené ladenie, avšak pre farbu než jednoduchú harmonickú radu.
// Logika:
// - základné ladenie pred pridaním prvej noty je 12-EDO
// - počas znenia nôt sú následné dostupné výšky zjednotením spektra a invertovaného spektra všetkých znejúcich nôt
// - každá nová nota sa prichytí k dostupnej výške (pochádzajúcej z vyššie uvedeného korpusu tónových výšok)
// - po umiestnení pridá nová nota svoje pôvodné aj invertované spektrum medzi dostupné výšky
// pre notu so základnou f a parciálmi [p1, p2, p3...]:
// - spektrálne výšky sú f*p1, f*p2, f*p3...
// - invertované výšky sú f/p1, f/p2, f/p3...
// pričom parciály nemusia nutne predstavovať celé čísla
// jednotlivé tóny sa zobrazujú ako biele a čierne klávesy klavíra.

// [ZDROJ] Spektrálna kompozícia - technika odvodenia výškového materiálu zo spektrálnych vlastností zvuku.
//   Pozri: MURAIL, Tristan. Target Practice. Preklad: Joshua CODY. Contemporary Music Review. 2005, roč.
//   24, č. 2-3, s. 149-171. ISSN 0749-4467.

// N_TIME, N_DUR, N_PITCH, N_PARTIAL z config.js (načítava sa skôr)
// note2freq, freq2note, sel z util.js (načítava sa skôr).

// Uvedené globálne premenné sa neskôr prevedú na importy
// prístup skrz window kvôli spätnej kompatibilite.
var getInstruments = () => typeof DB !== 'undefined' ? DB.get('instruments') : window.instruments;
var getSpectra = () => typeof DB !== 'undefined' ? DB.get('spectra') : window.spectra;

var AdaptiveTuning = {
	
	defaultConfig: {
		applyToPreview: true, // Pri zapnutom sa predprehrávanie riadi adaptívnou logikou, pri vypnutom sa prichytáva ku kurzoru.
		minFreq: 20,          // Minimálna frekvencia (Hz).
		maxFreq: 20000,       // Maximálna frekvencia (Hz).
	},
	
	
	// Cache segmentov v rámci stopy vo formáte map<trackIdx, {tuningKey, segments: [{startTime, endTime, pitches, is12EDO}], needsRefresh}>
	_segmentCaches: new Map(),

	_getCache: (trackIdx) => {
		if (!AdaptiveTuning._segmentCaches.has(trackIdx)) {
			AdaptiveTuning._segmentCaches.set(trackIdx, {
				tuningKey: null,
				segments: [],
				needsRefresh: true
			});
		}
		return AdaptiveTuning._segmentCaches.get(trackIdx);
	},

	// Spätná kompatibilita skrz segmentCache.
	get segmentCache() {
		return AdaptiveTuning._lastAccessedCache || { trackIdx: -1, tuningKey: null, segments: [], needsRefresh: true };
	},
	
	
	// Zistenie, či je zadané ladenie adaptívne.
	isAdaptive: (tuningKey) => {
		if (tuningKey === 'adaptive') return true;

		var scale = window.scales[tuningKey];
		if (!scale) return false;

		return scale.type === 'adaptive' ||
		       scale.isAdaptive === true ||
		       scale.name === 'Adaptive';
	},
	
	
	// Zostavenie jednotlivých časových segmentov pre stopu.
	buildSegments: (trackIdx, tuningKey) => {
		var MIDI = window.MIDI;
		var track = MIDI?.data[trackIdx];
		var cache = AdaptiveTuning._getCache(trackIdx);
		if (!track || track.length === 0) {
			cache.tuningKey = tuningKey;
			cache.segments = [];
			cache.needsRefresh = false;
			AdaptiveTuning._lastAccessedCache = cache;
			return;
		}

		var scales = window.scales;
		var scale = scales[tuningKey];
		var config = {
			minFreq: scale?.minFreq || AdaptiveTuning.defaultConfig.minFreq,
			maxFreq: scale?.maxFreq || AdaptiveTuning.defaultConfig.maxFreq,
		};

		// Farba nástroja na dynamické vyhľadávanie parciálov.
		var instruments = window.instruments;
		var spectra = window.spectra;
		var instrument = instruments[trackIdx];
		var spectrumKey = instrument?.spectrum || DEFAULT_SPECTRUM;
		var timbre = spectra?.[spectrumKey];

		// Začiatky a konce všetkých nôt.
		var boundaries = [];
		for (let noteIdx = 0; noteIdx < track.length; noteIdx++) {
			var note = track[noteIdx];
			if (!note || note.length < 4) continue;
			
			boundaries.push({ time: note[N_TIME], type: 'start', noteIdx });
			boundaries.push({ time: note[N_TIME] + note[N_DUR], type: 'end', noteIdx });
		}
		
		// Zoradenie podľa času; pri totožnom čase potom konce pred začiatkami.
		boundaries.sort((a, b) => {
			if (a.time !== b.time) return a.time - b.time;
			return a.type === 'end' ? -1 : 1;
		});
		
		// Zostavenie segmentov
		var segments = [];
		var currentlyPlaying = new Set(); // noteIdx práve znejúcich nôt.
		var lastTime = 0;
		
		for (let i = 0; i < boundaries.length; i++) {
			var boundary = boundaries[i];
			
			// Segment pred daným bodom v prípade medzery.
			if (boundary.time > lastTime) {
				if (currentlyPlaying.size === 0) {
					// Keď žiadne noty neznejú, ide o segment 12-EDO.
					segments.push({
						startTime: lastTime,
						endTime: boundary.time,
						is12EDO: true,
						pitches: AdaptiveTuning._get12EDOPitches(config)
					});
				} else {
					// Keď noty znejú, použijú sa adaptívne výšky z dynamickej farby.
					var pitches = AdaptiveTuning._calculatePitchesFromNotes(
						track, currentlyPlaying, timbre, config
					);
					segments.push({
						startTime: lastTime,
						endTime: boundary.time,
						is12EDO: false,
						pitches: pitches
					});
				}
			}
			
			// Aktualizácia množiny znejúcich nôt.
			if (boundary.type === 'start') {
				currentlyPlaying.add(boundary.noteIdx);
			} else {
				currentlyPlaying.delete(boundary.noteIdx);
			}
			
			lastTime = boundary.time;
		}
		
		// Záverečný segment 12-EDO za poslednou notou, siaha do nekonečna a oreže sa až pri vykresľovaní.
		if (currentlyPlaying.size === 0 && boundaries.length > 0) {
			segments.push({
				startTime: lastTime,
				endTime: Infinity,
				is12EDO: true,
				pitches: AdaptiveTuning._get12EDOPitches(config)
			});
		}
		
		cache.tuningKey = tuningKey;
		cache.segments = segments;
		cache.needsRefresh = false;
		AdaptiveTuning._lastAccessedCache = cache;
	},
	
	// Výšky 12-EDO pre segmenty s voľným umiestnením.
	_get12EDOPitches: (config) => {
		var pitches = [];
		// Generovanie výšok 12-EDO v počuteľnom rozsahu.
		for (let midi = 0; midi < 128; midi++) {
			var freq = note2freq(midi);
			if (freq < config.minFreq || freq > config.maxFreq) continue;
			
			pitches.push({
				freq: freq,
				midiNote: midi,
				isBlackKey: AdaptiveTuning._isBlackKey(midi)
			});
		}
		return pitches;
	},
	
	// Výpočet dostupných výšok zo znejúcich nôt.
	_calculatePitchesFromNotes: (track, playingNoteIndices, timbre, config) => {
		var freqSet = new Map(); // freq -> {midiNote, isBlackKey}

		// Statické parciály, ak chýba farba.
		var staticPartials = typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre) : (timbre?.data || [[1, 1]]);

		for (const noteIdx of playingNoteIndices) {
			var note = track[noteIdx];
			if (!note || note.length < 4) continue;

			var pitch = note[N_PITCH];

			// Dynamické parciály na výške danej noty, keďže DynamicTimbre.getPartialsAtPitch vracia parciály závislé od výšky.
			var partialsData = typeof DynamicTimbre !== 'undefined' && timbre
				? DynamicTimbre.getPartialsAtPitch(timbre, pitch)
				: staticPartials;

			// Pomer parciálu z dát (note[N_PARTIAL] je indexovaný od 1)
			// obmedzenie na dostupný rozsah namiesto návratu k harmonickému predpokladu.
			var partialIdx = Math.min(note[N_PARTIAL] - 1, partialsData.length - 1);
			var partialRatio = (partialsData[partialIdx] && partialsData[partialIdx][0])
				? partialsData[partialIdx][0]
				: 1; // Ak chýba, tak 1.

			// Základná frekvencia z uloženej výšky a pomeru parciálu.
			var fundamental = note2freq(pitch) / partialRatio;

			// Spektrálne výšky z dynamických parciálov.
			for (let i = 0; i < partialsData.length; i++) {
				const ratio = partialsData[i][0];
				const freq = fundamental * ratio;

				if (freq >= config.minFreq && freq <= config.maxFreq) {
					const midiNote = freq2note(freq);
					const centKey = Math.round(midiNote * 1000) / 1000;
					freqSet.set(centKey, {
						freq: freq,
						midiNote: midiNote,
						isBlackKey: false
					});
				}
			}

			// Invertované spektrálne výšky.
			for (let i = 0; i < partialsData.length; i++) {
				const ratio = partialsData[i][0];
				if (ratio === 1) continue; // Vynechanie základnej výšky pri inverzii.

				const freq = fundamental / ratio;

				if (freq >= config.minFreq && freq <= config.maxFreq) {
					const midiNote = freq2note(freq);
					const centKey = Math.round(midiNote * 1000) / 1000;
					freqSet.set(centKey, {
						freq: freq,
						midiNote: midiNote,
						isBlackKey: false
					});
				}
			}
		}

		var pitches = Array.from(freqSet.values());
		pitches.sort((a, b) => a.freq - b.freq);

		// Striedavé prideľovanie čiernych a bielych kláves podľa pozície.
		for (let i = 0; i < pitches.length; i++) {
			pitches[i].isBlackKey = (i % 2 === 0);
		}

		return pitches;
	},
	
	// Určenie, či MIDI nota leží na čiernom klávese.
	_isBlackKey: (midiNote) => {
		var noteInOctave = ((Math.round(midiNote) % 12) + 12) % 12;
		return [1, 3, 6, 8, 10].includes(noteInOctave);
	},
	

	getSegmentAtTime: (time, trackIdx, tuningKey) => {
		// Prestavba cache, ak je potrebná.
		var cache = AdaptiveTuning._getCache(trackIdx);
		if (cache.needsRefresh || cache.tuningKey !== tuningKey) {
			AdaptiveTuning.buildSegments(trackIdx, tuningKey);
		}
		
		var segments = cache.segments;
		
		// Binárne vyhľadávanie segmentu s daným časom.
		var lo = 0, hi = segments.length - 1;
		while (lo <= hi) {
			var mid = (lo + hi) >> 1;
			if (time < segments[mid].startTime) {
				hi = mid - 1;
			} else if (time >= segments[mid].endTime) {
				lo = mid + 1;
			} else {
				return segments[mid];
			}
		}
		
		// Ak sa nenašiel segment a čas je pred prvou notou, použije sa 12-EDO.
		if (segments.length === 0 || time < segments[0].startTime) {
			var scale = window.scales[tuningKey];
			return {
				startTime: 0,
				endTime: segments.length > 0 ? segments[0].startTime : Infinity,
				is12EDO: true,
				pitches: AdaptiveTuning._get12EDOPitches({
					minFreq: scale?.minFreq || AdaptiveTuning.defaultConfig.minFreq,
					maxFreq: scale?.maxFreq || AdaptiveTuning.defaultConfig.maxFreq,
				})
			};
		}
		
		return null;
	},
	

	getPitchesAtTime: (time, trackIdx, tuningKey) => {
		var segment = AdaptiveTuning.getSegmentAtTime(time, trackIdx, tuningKey);
		return segment ? segment.pitches : [];
	},

	// Dostupné výšky v danom čase s vylúčením konkrétnej noty.
	getPitchesAtTimeExcluding: (time, trackIdx, tuningKey, excludeNoteIdx) => {
		var MIDI = window.MIDI;
		var track = MIDI?.data[trackIdx];
		if (!track || track.length === 0) return [];

		var scales = window.scales;
		var scale = scales[tuningKey];
		var config = {
			minFreq: scale?.minFreq || AdaptiveTuning.defaultConfig.minFreq,
			maxFreq: scale?.maxFreq || AdaptiveTuning.defaultConfig.maxFreq,
		};

		// Farba nástroja na dynamické vyhľadávanie parciálov.
		var instruments = window.instruments;
		var spectra = window.spectra;
		var instrument = instruments[trackIdx];
		var spectrumKey = instrument?.spectrum || DEFAULT_SPECTRUM;
		var timbre = spectra?.[spectrumKey];

		// Noty znejúce v danom čase, okrem danej noty.
		var playingNoteIndices = new Set();
		for (let noteIdx = 0; noteIdx < track.length; noteIdx++) {
			if (noteIdx === excludeNoteIdx) continue;
			var note = track[noteIdx];
			if (!note || note.length < 4) continue;
			var noteStart = note[N_TIME];
			var noteEnd = note[N_TIME] + note[N_DUR];
			if (time >= noteStart && time < noteEnd) {
				playingNoteIndices.add(noteIdx);
			}
		}

		// Ak neznejú iné noty, použije sa 12-EDO.
		if (playingNoteIndices.size === 0) {
			return AdaptiveTuning._get12EDOPitches(config);
		}

		return AdaptiveTuning._calculatePitchesFromNotes(track, playingNoteIndices, timbre, config);
	},

	// Overenie, či sa v danom čase nachádza zóna 12-EDO s voľným umiestnením.

	is12EDOAtTime: (time, trackIdx, tuningKey) => {
		var segment = AdaptiveTuning.getSegmentAtTime(time, trackIdx, tuningKey);
		return segment ? segment.is12EDO : true;
	},
	
	
	// Prichytenie frekvencie k najbližšej dostupnej výške v danom čase.
	snapFrequency: (freq, time, trackIdx, tuningKey) => {
		var pitches = AdaptiveTuning.getPitchesAtTime(time, trackIdx, tuningKey);
		if (pitches.length === 0) return freq;
		
		var logFreq = Math.log2(freq);
		var nearest = pitches[0];
		var nearestDist = Math.abs(logFreq - Math.log2(nearest.freq));
		
		for (let i = 1; i < pitches.length; i++) {
			var dist = Math.abs(logFreq - Math.log2(pitches[i].freq));
			if (dist < nearestDist) {
				nearest = pitches[i];
				nearestDist = dist;
			}
		}
		
		return nearest.freq;
	},
	
	// Prichytenie MIDI noty k najbližšej dostupnej výške v danom čase.
	snapMidiNote: (midiNote, time, trackIdx, tuningKey) => {
		var freq = note2freq(midiNote);
		var snappedFreq = AdaptiveTuning.snapFrequency(freq, time, trackIdx, tuningKey);
		return freq2note(snappedFreq);
	},
	
	
	// Obnovenie cache, spúšťa sa pri zmene nôt.
	refresh: (trackIdx) => {
		if (trackIdx !== undefined) {
			// Obnovenie konkrétnej stopy.
			const cache = AdaptiveTuning._segmentCaches.get(trackIdx);
			if (cache) cache.needsRefresh = true;
		} else {
			// Obnovenie všetkých stôp.
			for (const cache of AdaptiveTuning._segmentCaches.values()) {
				cache.needsRefresh = true;
			}
		}
	},
	
	// Aktualizácia cache na aktuálny stav, spúšťa sa z vykresľovacieho cyklu podľa potreby.
	ensureCacheValid: (trackIdx, tuningKey) => {
		var cache = AdaptiveTuning._getCache(trackIdx);
		if (cache.needsRefresh || cache.tuningKey !== tuningKey) {
			AdaptiveTuning.buildSegments(trackIdx, tuningKey);
		}
	},
	
	
	// Segmenty prekrývajúce sa s časovým rozsahom.
	getSegmentsInRange: (startTime, endTime, trackIdx, tuningKey) => {
		AdaptiveTuning.ensureCacheValid(trackIdx, tuningKey);
		
		var cache = AdaptiveTuning._getCache(trackIdx);
		var segments = cache.segments;
		var result = [];
		
		// Pred prvým segmentom (12-EDO).
		if (segments.length === 0 || startTime < segments[0].startTime) {
			var scale = window.scales[tuningKey];
			var preSegmentEnd = segments.length > 0 ? segments[0].startTime : endTime;
			if (startTime < preSegmentEnd) {
				result.push({
					startTime: startTime,
					endTime: Math.min(preSegmentEnd, endTime),
					is12EDO: true,
					pitches: AdaptiveTuning._get12EDOPitches({
						minFreq: scale?.minFreq || AdaptiveTuning.defaultConfig.minFreq,
						maxFreq: scale?.maxFreq || AdaptiveTuning.defaultConfig.maxFreq,
					})
				});
			}
		}
		
		// Prekrývajúce sa segmenty.
		for (const segment of segments) {
			if (segment.endTime <= startTime) continue;
			if (segment.startTime >= endTime) break;
			
			result.push({
				startTime: Math.max(segment.startTime, startTime),
				endTime: Math.min(segment.endTime, endTime),
				is12EDO: segment.is12EDO,
				pitches: segment.pitches
			});
		}
		
		return result;
	},
	

	// Spracovanie vstupu v režime predprehrávania (vstup MIDI)
	// zohľadnenie nôt v stope spolu s práve držanými MIDI vstupnými notami.
	processPreviewInput: (midiNote, trackIdx, tuningKey) => {
		var scale = window.scales[tuningKey];
		if (!scale || !AdaptiveTuning.isAdaptive(tuningKey)) {
			return midiNote;
		}

		if (scale.applyToPreview !== false) {
			var playback = window.playback;
			var time = playback?.time || 0;

			// Výšky so zohľadnením nôt stopy aj držaných MIDI vstupných nôt.
			var pitches = AdaptiveTuning.getPitchesForMidiPreview(time, trackIdx, tuningKey);
			if (pitches.length === 0) return midiNote;

			// Prichytenie k najbližšej dostupnej výške.
			var freq = note2freq(midiNote);
			var nearest = pitches[0];
			var nearestDist = Math.abs(freq - nearest.freq);

			for (let i = 1; i < pitches.length; i++) {
				var dist = Math.abs(freq - pitches[i].freq);
				if (dist < nearestDist) {
					nearest = pitches[i];
					nearestDist = dist;
				}
			}

			return freq2note(nearest.freq);
		}

		// Pri vypnutom applyToPreview sa vracia originál, prichytenie ku kurzoru rieši volajúci.
		return midiNote;
	},

	// Dostupné výšky na predprehrávanie MIDI so zohľadnením nôt stopy
	// aj práve držaných MIDI vstupných nôt.

	getPitchesForMidiPreview: (time, trackIdx, tuningKey) => {
		var MIDI = window.MIDI;
		var track = MIDI?.data[trackIdx];
		var scales = window.scales;
		var scale = scales[tuningKey];
		var config = {
			minFreq: scale?.minFreq || AdaptiveTuning.defaultConfig.minFreq,
			maxFreq: scale?.maxFreq || AdaptiveTuning.defaultConfig.maxFreq,
		};

		// Spektrum a farba nástroja.
		var instruments = window.instruments;
		var spectra = window.spectra;
		var instrument = instruments?.[trackIdx];
		var spectrumKey = instrument?.spectrum || DEFAULT_SPECTRUM;
		var timbre = spectra?.[spectrumKey];

		// Zozbieranie všetkých znejúcich nôt spolu s výškami (noty stopy + držané MIDI noty).
		var soundingNotes = []; // {pitch, fundamental}

		// 1. výšky z nôt stopy v aktuálnom čase (vrátane N_PARTIAL pre správny základ).
		if (track) {
			for (let noteIdx = 0; noteIdx < track.length; noteIdx++) {
				var note = track[noteIdx];
				if (!note || note.length < 4) continue;
				var noteStart = note[N_TIME];
				var noteEnd = note[N_TIME] + note[N_DUR];
				if (time >= noteStart && time < noteEnd) {
					soundingNotes.push({ pitch: note[N_PITCH], partial: note[N_PARTIAL] || 1 });
				}
			}
		}

		// 2. výšky z držaných MIDI vstupných nôt.
		if (window.midiInputPreview && window.midiInputPreview.notes.size > 0) {
			for (const [midiNote, noteData] of window.midiInputPreview.notes) {
				const pitch = noteData.snappedPitch !== undefined ? noteData.snappedPitch : midiNote;
				soundingNotes.push({ pitch: pitch });
			}
		}

		// Ak nič neznie, použije sa 12-EDO.
		if (soundingNotes.length === 0) {
			return AdaptiveTuning._get12EDOPitches(config);
		}

		// Výpočet dostupných výšok z dynamickej farby pre každú znejúcu notu.
		var freqSet = new Map();

		for (const noteInfo of soundingNotes) {
			const pitch = noteInfo.pitch;
			var partialNum = noteInfo.partial || 1;

			// Dynamické parciály na danej výške.
			var partialsData = typeof DynamicTimbre !== 'undefined' && timbre
				? DynamicTimbre.getPartialsAtPitch(timbre, pitch)
				: getTimbrePartials(timbre, pitch);

			var noteFreq = note2freq(pitch);

			// Pomer aktívneho parciálu danej noty.
			var partialIdx = Math.min(partialNum - 1, partialsData.length - 1);
			var partialRatio = (partialsData[partialIdx] && partialsData[partialIdx][0])
				? partialsData[partialIdx][0]
				: partialNum;
			var fundamental = noteFreq / partialRatio;
			for (let i = 0; i < partialsData.length; i++) {
				var ratio = partialsData[i][0];
				var freq = fundamental * ratio;

				if (freq >= config.minFreq && freq <= config.maxFreq) {
					const midiNote = freq2note(freq);
					const centKey = Math.round(midiNote * 1000) / 1000;
					freqSet.set(centKey, {
						freq: freq,
						midiNote: midiNote,
						isBlackKey: false
					});
				}

				// Invertované (subharmonické) výšky.
				if (ratio !== 1 && ratio > 0) {
					var invFreq = fundamental / ratio;
					if (invFreq >= config.minFreq && invFreq <= config.maxFreq) {
						const midiNote = freq2note(invFreq);
						const centKey = Math.round(midiNote * 1000) / 1000;
						freqSet.set(centKey, {
							freq: invFreq,
							midiNote: midiNote,
							isBlackKey: false
						});
					}
				}
			}
		}

		// Konverzia na zoradené pole.
		var pitches = Array.from(freqSet.values());
		pitches.sort((a, b) => a.freq - b.freq);

		// Čierne a biele klávesy.
		for (let i = 0; i < pitches.length; i++) {
			pitches[i].isBlackKey = (i % 2 === 0);
		}

		return pitches;
	},
	
	
	loadEditorConfig: (scale) => {
		var minFreq = sel('.adaptive-min-freq');
		var maxFreq = sel('.adaptive-max-freq');
		var applyPreview = sel('.adaptive-apply-preview');

		if (minFreq) minFreq.value = scale.minFreq || 20;
		if (maxFreq) maxFreq.value = scale.maxFreq || 20000;
		if (applyPreview) applyPreview.checked = scale.applyToPreview !== false;
	}
};