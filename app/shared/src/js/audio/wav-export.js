// Export WAV zvuku pre Spectra
// zvukový export je možné vykonať štyrmi spôsobmi:
// 1. 'all' je celé spektrum (všetky parciály pre každú notu)
// 2. 'selected' je iba parciál, ktorý daná nota reprezentuje (note[N_PARTIAL])
// 3. 'fundamental' sú iba základné tóny (parciál 1)
// 4. number/array je vlastné číslo alebo čísla parciálov.

// config, N_TIME, N_DUR, N_PITCH, N_PARTIAL pochádzajú z config.js. Podobne ako v ostatných súboroch predstavujú konštanty pre kompaktnejšiu prácu s dátami
// nie je vylúčené, že v budúcnosti by sa mohlo prejsť na binárny spôsob ukladania dát, ak by doterajší spôsob ukladania nebol postačujúci
// showStatus pochádza z util.js
// DynamicTimbre je voliteľný modul (načíta sa skôr, ak je prítomný).

// Uvedené globálne premenné budú v neskorších fázach nahradené importmi.

// Počítadlo nôt preskočených bez upozornenia, na úrovni modulu (resetuje sa pred každým exportom).
var _wavExportSkippedNotes = 0;

var WavExport = {
	// Predvolená vzorkovacia frekvencia, ktorá sa dá prepísať cez Config.io.wavSampleRate alebo settings.wavSampleRate.
	get sampleRate() {
		// Prednosť majú užívateľské nastavenia, potom Config a nakoniec vstavaná hodnota.
		var settings = window.settings;
		if (settings?.wavSampleRate) {
			return settings.wavSampleRate;
		}
		if (Config?.io?.wavSampleRate) {
			return Config.io.wavSampleRate;
		}
		return 48000;
	},

	// Dostupné vzorkovacie frekvencie do dropdownu v UI.
	get availableSampleRates() {
		if (Config?.io?.wavSampleRates) {
			return Config.io.wavSampleRates;
		}
		return [22050, 44100, 48000, 96000];
	},

	// Nastavenia obálky ADSR v sekundách.
	envelope: {
		attack: 0.01,
		decay: 0.1,
		sustain: 0.8,
		release: 0.3
	},

	// Konvertuje číslo noty na frekvenciu podľa temperovaného ladenia.
	note2freq: function(note) {
		var pitchOffset = window.playbackPitch || 0;
		return 440 * Math.pow(2, (note - 69 + pitchOffset) / 12);
	},

	getEnvelope: function(t, duration) {
		var { attack, decay, sustain, release } = this.envelope;
		var sustainEnd = duration;
		
		if (t < 0) return 0;
		if (t < attack) return t / attack;
		if (t < attack + decay) {
			var decayProgress = (t - attack) / decay;
			return 1 - (1 - sustain) * decayProgress;
		}
		if (t < sustainEnd) return sustain;
		if (t < sustainEnd + release) {
			var releaseProgress = (t - sustainEnd) / release;
			return sustain * (1 - releaseProgress);
		}
		return 0;
	},

	getPartialsForNote: function(note, instrumentIndex, mode) {
		var partials = [];

		if (note.length < 4) { _wavExportSkippedNotes++; return partials; }

		var instruments = window.instruments;
		var spectra = window.spectra;
		var instrument = instruments?.[instrumentIndex];
		if (!instrument) {
			Logger.warn('getPartialsForNote: No instrument at index', instrumentIndex);
			_wavExportSkippedNotes++;
			return partials;
		}

		var timbre = spectra?.[instrument.spectrum];
		if (!timbre) {
			Logger.warn('getPartialsForNote: No timbre for spectrum', instrument.spectrum, 'available:', Object.keys(spectra || {}));
			_wavExportSkippedNotes++;
			return partials;
		}

		var notePitch = note[N_PITCH];
		var spectrumData = typeof DynamicTimbre !== 'undefined'
			? DynamicTimbre.getPartialsAtPitch(timbre, notePitch)
			: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, notePitch) : (timbre.data || [[1, 1]]));

		if (!spectrumData || spectrumData.length === 0) { _wavExportSkippedNotes++; return partials; }

		var notePartialNum = note[N_PARTIAL];

		if (!notePartialNum || notePartialNum < 1 || notePartialNum > spectrumData.length || !Number.isInteger(notePartialNum)) {
			if (Number.isFinite(notePartialNum) && !Number.isInteger(notePartialNum)) {
				Logger.warn('Fractional partial number', notePartialNum, 'rounded to', Math.round(notePartialNum));
				notePartialNum = Math.round(notePartialNum);
			}
			if (!notePartialNum || notePartialNum < 1 || notePartialNum > spectrumData.length) {
				Logger.warn('Invalid partial number in note:', note[N_PARTIAL], '- defaulting to 1');
				notePartialNum = 1;
			}
		}
		
		var noteFreq = this.note2freq(notePitch);
		
		if (!spectrumData[notePartialNum - 1] || !spectrumData[notePartialNum - 1][0]) {
			Logger.warn('Invalid spectrum data access for partial:', notePartialNum);
			_wavExportSkippedNotes++;
			return partials;
		}
		
		var fundamentalFreq = noteFreq / spectrumData[notePartialNum - 1][0];
		
		if (!isFinite(fundamentalFreq) || fundamentalFreq <= 0) {
			Logger.warn('Invalid fundamental frequency calculated:', fundamentalFreq);
			_wavExportSkippedNotes++;
			return partials;
		}
		
		var trackPan = instrument.pan || 0;
		
		for (let k = 0; k < spectrumData.length; k++) {
			var include = false;
			
			if (mode === 'all') {
				include = true;
			} else if (mode === 'selected') {
				include = (k === notePartialNum - 1);
			} else if (mode === 'fundamental') {
				include = (k === 0);
			} else if (Array.isArray(mode)) {
				include = mode.includes(k + 1);
			} else if (typeof mode === 'number') {
				include = (k === mode - 1);
			}
			
			if (include) {
				var partialFreqRatio = spectrumData[k][0];
				var partialAmplitude = spectrumData[k][1];
				var freq = fundamentalFreq * partialFreqRatio;
				
				if (isFinite(freq) && freq > 0) {
					var partialPan = 0;
					if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan) {
						partialPan = DynamicTimbre.partialPan.getPanForPartial(k, spectrumData.length, timbre);
					}
					
					var finalPan;
					if (partialPan >= 0) {
						finalPan = trackPan + partialPan * (1 - trackPan);
					} else {
						finalPan = trackPan + partialPan * (1 + trackPan);
					}
					finalPan = Math.max(-1, Math.min(1, finalPan));
					
					var env = { a: 0.01, d: 0.1, s: 0.8, r: 0.3 };
					if (typeof Envelope !== 'undefined') {
						env = Envelope.getForPartial(timbre, k + 1);
					}
					
					partials.push({
						frequency: freq,
						amplitude: partialAmplitude,
						partialNumber: k + 1,
						fundamentalFreq: fundamentalFreq,
						pan: finalPan,
						envelope: env
					});
				}
			}
		}
		
		return partials;
	},

	getTimeRange: function(mode, tracks = null, speed = 1) {
		// Uloženie a obnovenie počítadla preskočení, keďže ho getPartialsForNote zvyšuje.
		var savedSkipCount = _wavExportSkippedNotes;
		var maxEnd = -Infinity;
		var hasNotes = false;
		var MIDI = window.MIDI;
		if (!MIDI?.data) {
			Logger.warn('getTimeRange: No MIDI data available');
			return { startTime: 0, endTime: 0 };
		}

		for (let i = 0; i < MIDI.data.length; i++) {
			if (tracks !== null && !tracks.includes(i)) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				var partials = this.getPartialsForNote(note, i, mode);
				if (partials.length === 0) continue;
				
				hasNotes = true;
				// Konečný čas sa upraví podľa rýchlosti prehrávania, zatiaľ čo začiatok je vždy 0.
				var noteEnd = (note[N_TIME] + note[N_DUR]) / speed;
				if (noteEnd > maxEnd) maxEnd = noteEnd;
			}
		}
		
		// Obnovenie počítadla jednotlivých preskočení, keďže getTimeRange noty len prechádza a nič neexportuje.
		_wavExportSkippedNotes = savedSkipCount;

		if (!hasNotes) return { startTime: 0, endTime: 0 };

		return {
			// startTime je 0 namiesto minStart, lebo vykreslenie zachováva absolútne časovanie nôt; prvá nota v čase 2s teda vytvorí 2s ticha na začiatku.
			startTime: 0,
			endTime: maxEnd + this.envelope.release
		};
	},

	// Export zvuku do Float32Array.
	render: async function(mode, options = {}) {
		var sampleRate = options.sampleRate || this.sampleRate;
		var masterVolume = options.masterVolume || 0.5;
		var tracks = options.tracks || null;
		var speed = options.playbackSpeed || 1;
		var onProgress = options.onProgress || (() => {});
		var isCancelled = options.isCancelled || (() => false);

		var timeRange = this.getTimeRange(mode, tracks, speed);
		if (timeRange.endTime <= timeRange.startTime) {
			Logger.warn('No notes to export for the selected mode');
			return { left: new Float32Array(0), right: new Float32Array(0) };
		}

		var duration = timeRange.endTime - timeRange.startTime;
		var numSamples = Math.ceil(duration * sampleRate);
		var leftSamples = new Float32Array(numSamples);
		var rightSamples = new Float32Array(numSamples);
		var maxAmplitude = 0;
		var MIDI = window.MIDI;
		if (!MIDI?.data) return { left: leftSamples, right: rightSamples };

		var totalNotes = 0;
		var processedNotes = 0;
		for (let i = 0; i < MIDI.data.length; i++) {
			if (tracks !== null && !tracks.includes(i)) continue;
			totalNotes += MIDI.data[i].length;
		}

		onProgress({ phase: 'render', percent: 0, status: `Rendering ${totalNotes} notes...` });

		for (let i = 0; i < MIDI.data.length; i++) {
			if (tracks !== null && !tracks.includes(i)) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				var partials = this.getPartialsForNote(note, i, mode);
				processedNotes++;

				if (partials.length === 0) continue;

				var noteStart = (note[N_TIME] / speed) - timeRange.startTime;
				var noteDuration = note[N_DUR] / speed;

				// [ZDROJ] SHANNON, Claude E. Communication in the Presence of Noise. Proceedings of the IRE. 1949, roč.
				//   37, č. 1, s. 10-21. ISSN 0096-8390. DOI 10.1109/JRPROC.1949.232969.
				var nyquist = sampleRate / 2;

				for (const partial of partials) {
					var freq = partial.frequency;

					// Preskočenie parciálov presahujúcich Nyquistovu frekvenciu, aby sa predišlo aliasingu.
					if (freq >= nyquist || freq <= 0) continue;

					var amp = partial.amplitude;
					var pan = partial.pan || 0;
					var env = partial.envelope || { a: 0.01, d: 0.1, s: 0.8, r: 0.3 };

					var noteEnd = noteStart + noteDuration + env.r;
					var startSample = Math.floor(noteStart * sampleRate);
					var endSample = Math.min(Math.ceil(noteEnd * sampleRate), numSamples);

					var angularFreq = 2 * Math.PI * freq / sampleRate;

					// [ZDROJ] PULKKI, Ville. Spatial Sound Generation and Perception by Amplitude Panning Techniques.
					//   Espoo, 2001. Dizertačná práca. Helsinki University of Technology, Laboratory of Acoustics and
					//   Audio Signal Processing, Report 62. ISBN 951-22-5531-6.
					// panorámovanie s konštantným výkonom namiesto lineárneho prechodu
					var pan01 = (pan + 1) * 0.5;
					var leftGain = Math.cos(pan01 * Math.PI * 0.5);
					var rightGain = Math.sin(pan01 * Math.PI * 0.5);

					for (let s = Math.max(0, startSample); s < endSample; s++) {
						var t = s / sampleRate - noteStart;
						var envelope = this.getEnvelopeFromParams(t, noteDuration, env);
						var sample = Math.sin(angularFreq * s) * amp * envelope;
						leftSamples[s] += sample * leftGain;
						rightSamples[s] += sample * rightGain;
					}
				}

				var percent = Math.round((processedNotes / totalNotes) * 70); // 0-70 % na generovanie zvuku.
				onProgress({ phase: 'render', percent, status: `Rendering note ${processedNotes}/${totalNotes}` });
				// Trik, pomocou ktorého sa prekreslí obrazovka.
				await new Promise(r => setTimeout(r, 0));

				if (isCancelled()) {
					return { left: new Float32Array(0), right: new Float32Array(0), cancelled: true };
				}
			}
		}

		onProgress({ phase: 'normalize', percent: 75, status: 'Normalizing audio...' });
		await new Promise(r => setTimeout(r, 0));

		for (let s = 0; s < numSamples; s++) {
			var absL = Math.abs(leftSamples[s]);
			var absR = Math.abs(rightSamples[s]);
			if (absL > maxAmplitude) maxAmplitude = absL;
			if (absR > maxAmplitude) maxAmplitude = absR;
		}

		if (maxAmplitude > 0) {
			var normFactor = masterVolume / maxAmplitude;
			for (let s = 0; s < numSamples; s++) {
				leftSamples[s] = Math.max(-1, Math.min(1, leftSamples[s] * normFactor));
				rightSamples[s] = Math.max(-1, Math.min(1, rightSamples[s] * normFactor));
			}
		}

		onProgress({ phase: 'encode', percent: 85, status: 'Encoding WAV...' });

		return { left: leftSamples, right: rightSamples };
	},

	getEnvelopeFromParams: function(t, duration, env) {
		var { a, d, s, r } = env;
		var sustainEnd = duration;
		
		if (t < 0) return 0;
		if (t < a) return t / a;
		if (t < a + d) {
			var decayProgress = (t - a) / d;
			return 1 - (1 - s) * decayProgress;
		}
		if (t < sustainEnd) return s;
		if (t < sustainEnd + r) {
			var releaseProgress = (t - sustainEnd) / r;
			return s * (1 - releaseProgress);
		}
		return 0;
	},

	// [ZDROJ] IBM Corporation a Microsoft Corporation. Multimedia Programming Interface and Data
	//   Specifications 1.0 [online]. August 1991 [cit. 2026-07-30]. Dostupné z:
	//   https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/Docs/riffmci.pdf
	// 24-bit stereo, WAV
	encodeWav: function(samples, sampleRate) {
		var numChannels = 2;
		var bitsPerSample = 24;
		var bytesPerSample = bitsPerSample / 8;
		var blockAlign = numChannels * bytesPerSample;
		var numFrames = samples.left.length;
		var dataSize = numFrames * blockAlign;
		var bufferSize = 44 + dataSize;

		var buffer = new ArrayBuffer(bufferSize);
		var view = new DataView(buffer);

		this.writeWavHeader(view, dataSize, sampleRate, numChannels, bitsPerSample);

		var offset = 44;
		for (let i = 0; i < numFrames; i++) {
			var sampleL = Math.max(-1, Math.min(1, samples.left[i]));
			var intSampleL = Math.round(sampleL < 0 ? sampleL * 0x800000 : sampleL * 0x7FFFFF);
			view.setUint8(offset, intSampleL & 0xFF);
			view.setUint8(offset + 1, (intSampleL >> 8) & 0xFF);
			view.setUint8(offset + 2, (intSampleL >> 16) & 0xFF);
			offset += 3;
			
			var sampleR = Math.max(-1, Math.min(1, samples.right[i]));
			var intSampleR = Math.round(sampleR < 0 ? sampleR * 0x800000 : sampleR * 0x7FFFFF);
			view.setUint8(offset, intSampleR & 0xFF);
			view.setUint8(offset + 1, (intSampleR >> 8) & 0xFF);
			view.setUint8(offset + 2, (intSampleR >> 16) & 0xFF);
			offset += 3;
		}

		return buffer;
	},

	writeString: function(view, offset, string) {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	},

	// Zapíše 44-bajtovú hlavičku PCM WAV (spoločná pre encodeWav + audioBufferToWav).
	writeWavHeader: function(view, dataSize, sampleRate, numChannels, bitsPerSample) {
		var blockAlign = numChannels * bitsPerSample / 8;
		this.writeString(view, 0, 'RIFF');
		view.setUint32(4, 36 + dataSize, true);
		this.writeString(view, 8, 'WAVE');
		this.writeString(view, 12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true); // PCM
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * blockAlign, true);
		view.setUint16(32, blockAlign, true);
		view.setUint16(34, bitsPerSample, true);
		this.writeString(view, 36, 'data');
		view.setUint32(40, dataSize, true);
	},

	estimateExportSize: function(mode, options = {}) {
		var sampleRate = options.sampleRate || this.sampleRate;
		var tracks = options.tracks || null;
		var speed = options.playbackSpeed || 1;

		var timeRange = this.getTimeRange(mode, tracks, speed);
		var durationSec = Math.max(0, timeRange.endTime - timeRange.startTime);

		// Float32Array používa 4 bajty na vzorku, stereo sú 2 kanály.
		var floatArrayBytes = Math.ceil(durationSec * sampleRate) * 4 * 2;
		// Súbor WAV používa 3 bajty na vzorku (24-bit) * 2 kanály plus hlavička.
		var wavBytes = Math.ceil(durationSec * sampleRate) * 3 * 2 + 44;
		// Celková potrebná pamäť, teda float array + wav buffer + rezerva.
		var totalBytes = floatArrayBytes + wavBytes + 1024 * 1024; // 1MB rezerva

		var memorySizeMB = totalBytes / (1024 * 1024);

		var warning = null;
		if (memorySizeMB > 500) {
			warning = 'large'; // Môže spôsobiť problémy v prehliadači.
		} else if (memorySizeMB > 200) {
			warning = 'medium'; // Môže byť pomalé.
		}

		return {
			durationSec,
			memorySizeMB,
			warning
		};
	},

	// Vygeneruje zvuk pomocou OfflineAudioContext s AudioWorklet
	// na syntézu používa jediný AudioWorkletNode namiesto tisícov oscilátorov.
	renderWithOfflineContext: async function(mode, options = {}) {
		var sampleRate = options.sampleRate || this.sampleRate;
		// Predvolená hodnota 0.5, teda polovica plného rozsahu, aby sa predišlo orezaniu pri hustej aditívnej syntéze.
		var masterVolume = options.masterVolume || 0.5;
		var tracks = options.tracks || null;
		var speed = options.playbackSpeed || 1;
		var onProgress = options.onProgress || (() => {});
		var isCancelled = options.isCancelled || (() => false);

		if (masterVolume !== 1.0) {
			Logger.log(`Export master volume: ${masterVolume} (${Math.round(masterVolume * 100)}% full scale)`);
		}

		var timeRange = this.getTimeRange(mode, tracks, speed);
		if (timeRange.endTime <= timeRange.startTime) {
			return { wavBuffer: null, cancelled: false };
		}

		var totalDuration = timeRange.endTime - timeRange.startTime;
		var notes = this.prepareNotesForWorker(mode, tracks, speed);

		if (notes.length === 0) {
			return { wavBuffer: null, cancelled: false };
		}

		var nyquist = sampleRate / 2;

		if (isCancelled()) {
			return { wavBuffer: null, cancelled: true };
		}

		var numChannels = 2;
		var frameCount = Math.ceil(totalDuration * sampleRate);
		var offlineCtx = new OfflineAudioContext(numChannels, frameCount, sampleRate);

		// Vytvorenie AudioWorkletu na syntézu, jeho kód sa neskôr zabalí do blobu.
		var workletCode = `
class AdditiveSynthProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const { notes, timeRangeStart, nyquist } = options.processorOptions;
		this.notes = notes;
		this.timeRangeStart = timeRangeStart;
		this.nyquist = nyquist;
		this.sampleRate = sampleRate;
		this.currentSample = 0;

		this.tableSize = 4096;
		this.sineTable = new Float32Array(this.tableSize);
		for (let i = 0; i < this.tableSize; i++) {
			this.sineTable[i] = Math.sin(2 * Math.PI * i / this.tableSize);
		}

		this.partials = [];
		for (const note of notes) {
			const noteStart = (note.startTime - timeRangeStart) * sampleRate;
			const noteDur = note.noteDuration * sampleRate;

			for (const p of note.partials) {
				if (p.frequency >= nyquist || p.frequency <= 0) continue;

				const env = p.envelope || { a: 0.01, d: 0.1, s: 0.8, r: 0.3 };
				const envA = env.a * sampleRate;
				const envD = env.d * sampleRate;
				const envR = env.r * sampleRate;

				this.partials.push({
					freq: p.frequency,
					phaseInc: p.frequency / sampleRate,
					phase: 0,
					amp: p.amplitude,
					pan: p.pan || 0,
					startSample: noteStart,
					endSample: noteStart + noteDur + envR,
					noteDur: noteDur,
					envA: envA,
					envD: envD,
					envS: env.s,
					envR: envR
				});
			}
		}

		this.partials.sort((a, b) => a.startSample - b.startSample);
		this.activeStart = 0;
	}

	process(inputs, outputs, parameters) {
		const output = outputs[0];
		const left = output[0];
		const right = output[1];
		const blockSize = left.length;

		left.fill(0);
		right.fill(0);

		const startSample = this.currentSample;
		const endSample = startSample + blockSize;

		for (let i = this.activeStart; i < this.partials.length; i++) {
			const p = this.partials[i];

			if (p.startSample > endSample) break;

			if (p.endSample < startSample) {
				this.activeStart = i + 1;
				continue;
			}

			const pan01 = (p.pan + 1) * 0.5;
			const leftGain = Math.cos(pan01 * (Math.PI / 2)) * p.amp;
			const rightGain = Math.sin(pan01 * (Math.PI / 2)) * p.amp;

			for (let s = 0; s < blockSize; s++) {
				const globalSample = startSample + s;
				const t = globalSample - p.startSample;

				if (t < 0 || globalSample > p.endSample) continue;

				let env;
				if (t < p.envA) {
					env = t / p.envA;
				} else if (t < p.envA + p.envD) {
					env = 1 - (1 - p.envS) * (t - p.envA) / p.envD;
				} else if (t < p.noteDur) {
					env = p.envS;
				} else if (t < p.noteDur + p.envR) {
					env = p.envS * (1 - (t - p.noteDur) / p.envR);
				} else {
					continue;
				}

				const tableIdx = (p.phase * this.tableSize) | 0;
				const sample = this.sineTable[tableIdx & (this.tableSize - 1)] * env;

				left[s] += sample * leftGain;
				right[s] += sample * rightGain;

				p.phase += p.phaseInc;
				while (p.phase >= 1) p.phase -= 1;
			}
		}

		this.currentSample = endSample;
		return this.currentSample < ${Math.floor(frameCount)};
	}
}
registerProcessor('additive-synth', AdditiveSynthProcessor);
`;

		var blob = new Blob([workletCode], { type: 'application/javascript' });
		var workletUrl = URL.createObjectURL(blob);

		try {
			await offlineCtx.audioWorklet.addModule(workletUrl);
		} finally {
			URL.revokeObjectURL(workletUrl);
		}

		onProgress({ phase: 'render', percent: 10, status: 'Creating synthesizer...' });

		var synthNode = new AudioWorkletNode(offlineCtx, 'additive-synth', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			processorOptions: {
				notes: notes,
				timeRangeStart: timeRange.startTime,
				nyquist: nyquist
			}
		});

		var masterGain = offlineCtx.createGain();
		masterGain.gain.value = masterVolume;

		synthNode.connect(masterGain);
		masterGain.connect(offlineCtx.destination);

		Logger.log(`OfflineAudioContext + AudioWorklet: ${notes.length} notes`);

		// Body, kde sa export pozastaví kvôli aktualizácii priebehu, najviac stokrát za export.
		var progressInterval = Math.max(1, Math.floor(totalDuration / 100));
		var suspendPoints = [];
		for (let t = progressInterval; t < totalDuration; t += progressInterval) {
			suspendPoints.push(t);
			offlineCtx.suspend(t);
		}

		// Spracovanie bodov pozastavenia na hlásenie priebehu a na zrušenie.
		var suspendIdx = 0;
		var cancelled = false;

		var renderPromise = new Promise((resolve, reject) => {
			var resolved = false;
			var resolveOnce = (val) => { if (!resolved) { resolved = true; resolve(val); } };

			offlineCtx.onstatechange = () => {
				if (offlineCtx.state === 'suspended') {
					if (isCancelled()) {
						cancelled = true;
						// OfflineAudioContext.startRendering() sa nedá skutočne zrušiť
						// (ide o obmedzenie Web API). Promise sa tu vyrieši s null, ale generovanie
						// pokračuje na pozadí až do dokončenia. Indikátor 'cancelled'
						// zaistí, že sa nepoužije žiadny výsledok, ktorý príde po zrušení.
						resolveOnce(null);
						return;
					}

					var progress = Math.round(20 + (suspendPoints[suspendIdx] / totalDuration) * 60);
					onProgress({ phase: 'render', percent: progress, status: `Rendering ${Math.round(suspendPoints[suspendIdx])}s / ${Math.round(totalDuration)}s` });
					suspendIdx++;
					offlineCtx.resume();
				}
			};

			offlineCtx.startRendering().then(buf => {
				if (cancelled) return;
				resolveOnce(buf);
			}).catch(reject);
		});

		onProgress({ phase: 'render', percent: 20, status: 'Rendering audio...' });

		var audioBuffer = await renderPromise;

		if (cancelled || !audioBuffer) {
			return { wavBuffer: null, cancelled: true };
		}

		onProgress({ phase: 'encode', percent: 85, status: 'Encoding WAV...' });

		var left = audioBuffer.getChannelData(0);
		var right = audioBuffer.getChannelData(1);
		var maxAmp = 0;
		for (let i = 0; i < left.length; i++) {
			var l = Math.abs(left[i]);
			var r = Math.abs(right[i]);
			if (l > maxAmp) maxAmp = l;
			if (r > maxAmp) maxAmp = r;
		}
		if (maxAmp > 0.001) {
			var norm = 0.95 / maxAmp;
			for (let i = 0; i < left.length; i++) {
				left[i] *= norm;
				right[i] *= norm;
			}
		}

		var wavBuffer = this.audioBufferToWav(audioBuffer);

		onProgress({ phase: 'complete', percent: 100, status: 'Complete' });

		return { wavBuffer, cancelled: false };
	},

	// Konvertuje AudioBuffer na ArrayBuffer WAV (24-bit stereo).
	audioBufferToWav: function(audioBuffer) {
		var numChannels = audioBuffer.numberOfChannels;
		var sampleRate = audioBuffer.sampleRate;
		var numFrames = audioBuffer.length;
		var bitsPerSample = 24;
		var bytesPerSample = 3;
		var blockAlign = numChannels * bytesPerSample;
		var dataSize = numFrames * blockAlign;

		var buffer = new ArrayBuffer(44 + dataSize);
		var view = new DataView(buffer);
		var bytes = new Uint8Array(buffer);

		var left = audioBuffer.getChannelData(0);
		var right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;

		this.writeWavHeader(view, dataSize, sampleRate, numChannels, bitsPerSample);

		var off = 44;
		for (let i = 0; i < numFrames; i++) {
			var L = left[i], R = right[i];
			if (L > 1) L = 1; else if (L < -1) L = -1;
			if (R > 1) R = 1; else if (R < -1) R = -1;
			var iL = Math.round(L * (L < 0 ? 8388608 : 8388607)); // 2^23; hodnota 8388608 by pri kladných vzorkách preskočila do záporných.
			var iR = Math.round(R * (R < 0 ? 8388608 : 8388607));
			bytes[off] = iL; bytes[off + 1] = iL >> 8; bytes[off + 2] = iL >> 16;
			bytes[off + 3] = iR; bytes[off + 4] = iR >> 8; bytes[off + 5] = iR >> 16;
			off += 6;
		}

		return buffer;
	},

	// Vytvorí inline worker v rámci funkcie, čím zaručí funkčnosť vo všetkých prostrediach vrátane Electronu.
	createWorker: function() {
		var workerCode = `
var tableSize = 4096;
var tableMask = tableSize - 1;
var sineTable = new Float32Array(tableSize);
for (let i = 0; i < tableSize; i++) sineTable[i] = Math.sin(2 * Math.PI * i / tableSize);

function render(data) {
	const { notes, sampleRate, masterVolume, duration, timeRangeStart } = data;
	const numSamples = Math.ceil(duration * sampleRate);
	const left = new Float32Array(numSamples);
	const right = new Float32Array(numSamples);
	const totalNotes = notes.length;
	let maxAmp = 0;
	let lastPct = -1;

	const panCache = {};

	for (let i = 0; i < totalNotes; i++) {
		const { startTime, noteDuration, partials } = notes[i];
		const noteStartSec = startTime - timeRangeStart;
		const noteStartSmp = noteStartSec * sampleRate;

		for (let p = 0; p < partials.length; p++) {
			const pt = partials[p];
			const freq = pt.frequency;
			const amp = pt.amplitude;
			const pan = pt.pan || 0;
			const env = pt.envelope || { a: 0.01, d: 0.1, s: 0.8, r: 0.3 };

			let gains = panCache[pan];
			if (!gains) {
				const p01 = (pan + 1) * 0.5;
				gains = panCache[pan] = [Math.cos(p01 * 1.5707963), Math.sin(p01 * 1.5707963)];
			}
			const lGain = gains[0] * amp;
			const rGain = gains[1] * amp;

			const aEnd = env.a * sampleRate;
			const dEnd = aEnd + env.d * sampleRate;
			const sEnd = noteDuration * sampleRate;
			const rEnd = sEnd + env.r * sampleRate;
			const envS = env.s;
			const invA = aEnd > 0 ? 1 / aEnd : 0;
			const invD = env.d > 0 ? (1 - envS) / (env.d * sampleRate) : 0;
			const invR = env.r > 0 ? envS / (env.r * sampleRate) : 0;

			const s0 = Math.max(0, (noteStartSmp | 0));
			const s1 = Math.min(numSamples, Math.ceil(noteStartSmp + rEnd));

			const phaseInc = freq / sampleRate;
			let phase = ((s0 - noteStartSmp) * phaseInc) % 1;
			if (phase < 0) phase += 1;

			for (let s = s0; s < s1; s++) {
				const t = s - noteStartSmp;

				let e;
				if (t < 0) { phase += phaseInc; while (phase >= 1) phase -= 1; continue; }
				else if (t < aEnd) e = t * invA;
				else if (t < dEnd) e = 1 - (t - aEnd) * invD;
				else if (t < sEnd) e = envS;
				else if (t < rEnd) e = envS - (t - sEnd) * invR;
				else break; // po uvoľnení, parciál dokončený

				const idx = (phase * tableSize) & tableMask;
				const sample = sineTable[idx] * e;

				const l = sample * lGain;
				const r = sample * rGain;
				left[s] += l;
				right[s] += r;

				const al = l > 0 ? l : -l;
				const ar = r > 0 ? r : -r;
				if (al > maxAmp) maxAmp = al;
				if (ar > maxAmp) maxAmp = ar;

				phase += phaseInc;
				while (phase >= 1) phase -= 1;
			}
		}

		const pct = ((i + 1) / totalNotes * 70) | 0;
		if (pct !== lastPct) {
			lastPct = pct;
			self.postMessage({ type: 'progress', percent: pct, status: 'Rendering note ' + (i+1) + '/' + totalNotes });
		}
	}

	self.postMessage({ type: 'progress', percent: 75, status: 'Normalizing...' });

		if (maxAmp > 0) {
		const norm = masterVolume / maxAmp;
		for (let s = 0; s < numSamples; s++) {
			left[s] *= norm;
			right[s] *= norm;
		}
	}

	self.postMessage({ type: 'progress', percent: 85, status: 'Encoding WAV...' });

		const dataSize = numSamples * 6;
	const buf = new Uint8Array(44 + dataSize);
	const dv = new DataView(buf.buffer);

		buf.set([82,73,70,70], 0); // RIFF
	dv.setUint32(4, 36 + dataSize, true);
	buf.set([87,65,86,69,102,109,116,32], 8); // WAVEfmt
	dv.setUint32(16, 16, true);
	dv.setUint16(20, 1, true);
	dv.setUint16(22, 2, true);
	dv.setUint32(24, sampleRate, true);
	dv.setUint32(28, sampleRate * 6, true);
	dv.setUint16(32, 6, true);
	dv.setUint16(34, 24, true);
	buf.set([100,97,116,97], 36); // data
	dv.setUint32(40, dataSize, true);

		let off = 44;
	for (let i = 0; i < numSamples; i++) {
		let L = left[i], R = right[i];
		if (L > 1) L = 1; else if (L < -1) L = -1;
		if (R > 1) R = 1; else if (R < -1) R = -1;
		let iL = Math.round(L * (L < 0 ? 8388608 : 8388607));
		let iR = Math.round(R * (R < 0 ? 8388608 : 8388607));
		buf[off] = iL; buf[off+1] = iL >> 8; buf[off+2] = iL >> 16;
		buf[off+3] = iR; buf[off+4] = iR >> 8; buf[off+5] = iR >> 16;
		off += 6;
	}

	self.postMessage({ type: 'progress', percent: 100, status: 'Complete' });
	self.postMessage({ type: 'complete', wavBuffer: buf.buffer }, [buf.buffer]);
}

self.onmessage = function(e) {
	if (e.data.type === 'render') {
		try { render(e.data.data); }
		catch (err) { self.postMessage({ type: 'error', message: err.message, stack: err.stack }); }
	}
};
`;
		var blob = new Blob([workerCode], { type: 'application/javascript' });
		var url = URL.createObjectURL(blob);
		var worker = new Worker(url);
		URL.revokeObjectURL(url); // URL sa po vytvorení workera uvoľní.
		return worker;
	},

	// Pripraví dáta nôt pre worker z DOM a globálnych premenných.
	prepareNotesForWorker: function(mode, tracks, speed) {
		var MIDI = window.MIDI;
		if (!MIDI?.data) return [];

		var notes = [];

		for (let i = 0; i < MIDI.data.length; i++) {
			if (tracks !== null && !tracks.includes(i)) continue;

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				var partials = this.getPartialsForNote(note, i, mode);
				if (partials.length === 0) continue;

				notes.push({
					startTime: note[N_TIME] / speed,
					noteDuration: note[N_DUR] / speed,
					partials: partials.map(p => ({
						frequency: p.frequency,
						amplitude: p.amplitude,
						pan: p.pan || 0,
						envelope: p.envelope || { a: 0.01, d: 0.1, s: 0.8, r: 0.3 }
					}))
				});
			}
		}

		return notes;
	},

	// Vygeneruje zvuk pomocou Web Workera v samostatnom vlákne.
	renderWithWorker: function(mode, options = {}) {
		return new Promise((resolve, reject) => {
			var sampleRate = options.sampleRate || this.sampleRate;
			var masterVolume = options.masterVolume || 0.5;
			var tracks = options.tracks || null;
			var speed = options.playbackSpeed || 1;
			var onProgress = options.onProgress || (() => {});
			var isCancelled = options.isCancelled || (() => false);

			var timeRange = this.getTimeRange(mode, tracks, speed);
			if (timeRange.endTime <= timeRange.startTime) {
				Logger.warn('renderWithWorker: empty time range, resolving with null wavBuffer');
				resolve({ wavBuffer: null, cancelled: false });
				return;
			}

			var duration = timeRange.endTime - timeRange.startTime;
			var notes = this.prepareNotesForWorker(mode, tracks, speed);

			if (notes.length === 0) {
				Logger.warn('renderWithWorker: no notes to render, resolving with null wavBuffer');
				resolve({ wavBuffer: null, cancelled: false });
				return;
			}

			onProgress({ phase: 'render', percent: 0, status: `Preparing ${notes.length} notes...` });

			var worker;
			try {
				Logger.log('Creating Web Worker for audio export...');
				worker = this.createWorker();
				Logger.log('Web Worker created successfully');
			} catch (e) {
				Logger.error('Failed to create worker:', e);
				reject(e);
				return;
			}

			var checkCancel = setInterval(() => {
				if (isCancelled()) {
					clearInterval(checkCancel);
					worker.terminate();
					resolve({ wavBuffer: null, cancelled: true });
				}
			}, 100);

			worker.onmessage = (e) => {
				var { type, percent, status, wavBuffer, message, stack } = e.data;

				if (type === 'progress') {
					onProgress({ phase: 'render', percent, status });
				} else if (type === 'complete') {
					clearInterval(checkCancel);
					worker.terminate();
					resolve({ wavBuffer, cancelled: false });
				} else if (type === 'error') {
					clearInterval(checkCancel);
					worker.terminate();
					Logger.error('Worker runtime error:', message, stack);
					reject(new Error(message));
				}
			};

			worker.onerror = (e) => {
				clearInterval(checkCancel);
				worker.terminate();
				Logger.error('Worker error:', e.message, 'at', e.filename, 'line', e.lineno);
				reject(new Error(e.message || 'Worker error'));
			};

			worker.postMessage({
				type: 'render',
				data: {
					notes,
					sampleRate,
					masterVolume,
					duration,
					timeRangeStart: timeRange.startTime
				}
			});
		});
	},

	exportWavWithTracks: async function(mode, filename = 'spectra-export', tracks = null, options = {}) {
		var sampleRate = options.sampleRate || this.sampleRate;
		var settings = window.settings;

		var playbackSpeed = options.playbackSpeed || settings?.playbackSpeed || 1;

		var estimate = this.estimateExportSize(mode, { ...options, tracks, playbackSpeed });
		var showConfirm = window.showConfirm;

		if (estimate.warning === 'large' && showConfirm) {
			var proceed = await showConfirm(
				`Warning: This export is very large.\n\n` +
				`Duration: ${estimate.durationSec.toFixed(1)} seconds\n` +
				`Estimated memory: ${estimate.memorySizeMB.toFixed(0)} MB\n\n` +
				`This may cause your browser to freeze or crash.\n` +
				`Consider exporting a shorter selection or reducing sample rate.\n\n` +
				`Continue anyway?`,
				{ title: 'Large Export Warning', type: 'warning', confirmText: 'Export Anyway' }
			);
			if (!proceed) return;
		} else if (estimate.warning === 'medium') {
			Logger.warn(`Large export: ${estimate.memorySizeMB.toFixed(0)} MB estimated`);
			const showSaveNotification = window.showSaveNotification;
			if (showSaveNotification) {
				showSaveNotification(`Exporting ${estimate.durationSec.toFixed(0)}s audio (${estimate.memorySizeMB.toFixed(0)}MB)...`);
			}
		}

		Logger.log(`Exporting WAV with mode: ${mode}, tracks: ${tracks}, speed: ${playbackSpeed}x`);

		var wavBuffer;
		var usedFallback = null; // Sleduje, ktorý spôsob generovania sa použil.

		_wavExportSkippedNotes = 0;

		// Najprv OfflineAudioContext (najrýchlejší).
		try {
			Logger.log('Using OfflineAudioContext...');
			const result = await this.renderWithOfflineContext(mode, { ...options, tracks, playbackSpeed, sampleRate });

			if (result.cancelled) {
				return { cancelled: true };
			}

			if (result.wavBuffer) {
				wavBuffer = result.wavBuffer;
				usedFallback = false;
			}
		} catch (e) {
			Logger.warn('OfflineAudioContext failed:', e);
		}

		// Ak OfflineAudioContext zlyhal, prejde sa na Web Worker.
		if (!wavBuffer) {
			try {
				Logger.log('Falling back to Web Worker...');
				const result = await this.renderWithWorker(mode, { ...options, tracks, playbackSpeed, sampleRate });

				if (result.cancelled) {
					return { cancelled: true };
				}

				if (result.wavBuffer) {
					wavBuffer = result.wavBuffer;
					usedFallback = 'worker';
				}
			} catch (e) {
				Logger.warn('Web Worker failed, falling back to main thread:', e);

				try {
					var samples = await this.render(mode, { ...options, tracks, playbackSpeed });

					if (samples.cancelled) {
						return { cancelled: true };
					}

					if (samples.left.length === 0) {
						showStatus('Nothing matches the export mode.', { type: 'warning', duration: 4000 });
						return;
					}

					if (options.onProgress) {
						options.onProgress({ phase: 'encode', percent: 90, status: 'Encoding WAV file...' });
					}

					wavBuffer = this.encodeWav(samples, sampleRate);
					usedFallback = 'main-thread';

					if (options.onProgress) {
						options.onProgress({ phase: 'complete', percent: 100, status: 'Complete' });
					}
				} catch (mainErr) {
					Logger.error('Main thread render failed:', mainErr);
					if (options.onProgress) {
						options.onProgress({ phase: 'complete', percent: 100, status: 'Failed' });
					}
					showStatus('Export failed - try fewer notes.', { type: 'error', duration: 5000 });
					return;
				}
			}
		}

		// Všetky spôsoby generovania vrátili wavBuffer rovný null, takže nie je čo exportovať.
		if (!wavBuffer) {
			showStatus('Nothing matches the export mode.', { type: 'warning', duration: 4000 });
			return;
		}

		var blob = new Blob([wavBuffer], { type: 'audio/wav' });
		var url = URL.createObjectURL(blob);

		var a = document.createElement('a');
		a.href = url;
		a.download = `${filename}.wav`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		Logger.log('WAV export complete!');

		if (_wavExportSkippedNotes > 0) {
			showStatus(`Warning: ${_wavExportSkippedNotes} note${_wavExportSkippedNotes > 1 ? 's were' : ' was'} skipped due to missing/invalid data`, { type: 'warning', duration: 4000 });
		}

		if (usedFallback) {
			Logger.log('Export completed using fallback renderer:', usedFallback);
			showStatus('Export completed using fallback renderer', { type: 'info', duration: 3000 });
		}

		const showSaveNotification = window.showSaveNotification;
		if (showSaveNotification) {
			// Výpočet trvania z veľkosti bufferu (44-bajtová hlavička + 6 bajtov na snímok pri 24-bit stereo).
			var durationSec = (wavBuffer.byteLength - 44) / 6 / sampleRate;
			showSaveNotification(`Exported ${durationSec.toFixed(1)}s stereo audio`);
		}
	},

	exportWav: async function(mode, filename = 'spectra-export', options = {}) {
		try {
			await this.exportWavWithTracks(mode, filename, null, options);
		} catch (e) {
			Logger.error('exportWav failed:', e);
			showStatus('Audio export failed: ' + (e.message || 'Unknown error'), { type: 'error', duration: 5000 });
		}
	}
};

// [ZDROJ] MIDI Manufacturers Association. Standard MIDI Files 1.0: RP-001 [online]. Los Angeles: MMA, 1996
//   [cit. 2026-07-30]. Dostupné z: https://midi.org/standard-midi-files-specification
// [ZDROJ] MIDI Manufacturers Association. MIDI Polyphonic Expression: Version 1.0, RP-053 [online]. Los
//   Angeles: MMA, 12. 3. 2018 [cit. 2026-07-30]. Dostupné z:
//   https://d30pueezughrda.cloudfront.net/campaigns/mpe/mpespec.pdf
// modul na export MIDI
var MIDIExport = {
	// Konvertuje frekvenciu na číslo noty MIDI s odchýlkou v centoch.
	freq2midi: function(freq) {
		var pitchOffset = window.playbackPitch || 0;
		var midiNote = 69 + 12 * Math.log2(freq / 440) + pitchOffset;
		return {
			note: Math.round(midiNote),
			cents: Math.round((midiNote - Math.round(midiNote)) * 100)
		};
	},

	getNotesForExport: function(mode, tracks) {
		var notes = [];
		var skippedCount = 0;
		var MIDI = window.MIDI;
		if (!MIDI?.data) {
			Logger.warn('getNotesForExport: No MIDI data');
			return { notes, skippedCount };
		}

		Logger.log('getNotesForExport: Processing', MIDI.data.length, 'tracks, mode:', mode, 'tracks filter:', tracks);

		for (let i = 0; i < MIDI.data.length; i++) {
			if (tracks !== null && !tracks.includes(i)) continue;

			Logger.log('Track', i, ':', MIDI.data[i].length, 'notes');

			for (let j = 0; j < MIDI.data[i].length; j++) {
				var note = MIDI.data[i][j];
				if (note.length < 4) {
					skippedCount++;
					continue;
				}

				var partials = WavExport.getPartialsForNote(note, i, mode);
				if (j === 0) {
					Logger.log('First note partials:', partials.length, partials);
				}
				
				for (const partial of partials) {
					var midiInfo = this.freq2midi(partial.frequency);
					var velocity = Math.round(partial.amplitude * 127);

					// Preskočenie parciálov s nulovou amplitúdou.
					if (velocity <= 0) {
						skippedCount++;
						continue;
					}

					// Započítanie nôt mimo rozsahu MIDI.
					if (midiInfo.note < 0 || midiInfo.note > 127) {
						skippedCount++;
						continue;
					}

					notes.push({
						startTime: note[N_TIME],
						duration: note[N_DUR],
						midiNote: midiInfo.note,
						cents: midiInfo.cents,
						frequency: partial.frequency,
						velocity: velocity,
						track: i,
						partialNumber: partial.partialNumber,
						isActivePartial: partial.partialNumber === (note[N_PARTIAL] || 1)
					});
				}
			}
		}
		
		return { notes: notes.sort((a, b) => a.startTime - b.startTime), skippedCount };
	},

	// Vytvorí hodnotu s premenlivou dĺžkou pre MIDI.
	writeVarLen: function(value) {
		var bytes = [];
		bytes.push(value & 0x7F);
		value >>= 7;
		while (value > 0) {
			bytes.push((value & 0x7F) | 0x80);
			value >>= 7;
		}
		return bytes.reverse();
	},

	// Konvertuje odchýlku v centoch na hodnotu pitch bendu
	// rozsah pitch bendu: 0-16383, stred je 8192
	// predpokladá sa štandardný rozsah +-2 poltóny (+-200 centov).
	centsToPitchBend: function(cents) {
		// Obmedzenie na +-200 centov (štandardný rozsah pitch bendu).
		var clampedCents = Math.max(-200, Math.min(200, cents));
		// Konverzia: 8192 je stred, +-8191 pre +-200 centov.
		var pitchBend = Math.round(8192 + (clampedCents / 200) * 8191);
		return Math.max(0, Math.min(16383, pitchBend));
	},

	// Zostaví chunk stopy MIDI (pole bajtov) z poľa udalostí {delta, data}.
	buildTrackChunk: function(trackEvents) {
		var trackData = [];
		for (const event of trackEvents) {
			trackData.push(...this.writeVarLen(event.delta));
			trackData.push(...event.data);
		}
		var chunk = [0x4D, 0x54, 0x72, 0x6B]; // "MTrk"
		var len = trackData.length;
		chunk.push((len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF);
		chunk.push(...trackData);
		return chunk;
	},

	// Exportuje ako Standard MIDI File (Formát 1, viacstopový); viackanálová alokácia pitch bendu bráni poškodeniu polyfónneho bendu
	// čistá funkcia bez DOM, vracia { bytes, notes, skippedCount, pitchBendClampedCount } alebo null, ak nie sú žiadne noty.
	buildMIDIBytes: function(mode, filename, tracks, includePitchBend = true) {
		var { notes, skippedCount } = this.getNotesForExport(mode, tracks);
		if (notes.length === 0) return null;

		var ticksPerBeat = 480;
		var tempo = 120; // Pevne dané 120 BPM, v prípade potreby zmeniť tu.
		// Čas a trvanie v Spectre sú v jednotkách mriežky
		// každá čiara mriežky = 1/4 taktu = jedna štvrťová nota = jedna doba.
		var ticksPerGridline = ticksPerBeat; // 480 tikov na čiaru mriežky, respektíve dobu.

		// === Metrická stopa (Track 0): tempo, taktové označenie, názov stopy ===.
		var tempoTrackEvents = [];

		// Meta udalosť s názvom stopy.
		var nameBytes = [];
		var trackName = filename || 'Spectra Export';
		for (let i = 0; i < trackName.length; i++) nameBytes.push(trackName.charCodeAt(i) & 0x7F);
		tempoTrackEvents.push({
			delta: 0,
			data: [0xFF, 0x03, ...this.writeVarLen(nameBytes.length), ...nameBytes]
		});

		// Taktové označenie: 4/4, 24 MIDI clockov na tik metronómu, 8 tridsaťdvatinových nôt na dobu.
		tempoTrackEvents.push({
			delta: 0,
			data: [0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]
		});

		// Udalosť tempa
		var microsecondsPerBeat = Math.round(60000000 / tempo);
		tempoTrackEvents.push({
			delta: 0,
			data: [0xFF, 0x51, 0x03,
				(microsecondsPerBeat >> 16) & 0xFF,
				(microsecondsPerBeat >> 8) & 0xFF,
				microsecondsPerBeat & 0xFF]
		});

		// Ukončenie metrickej stopy.
		tempoTrackEvents.push({ delta: 0, data: [0xFF, 0x2F, 0x00] });

		// Rozdelenie pitch bendu medzi viacero kanálov (zjednodušené MPE)
		// dostupné kanály 0-8, 10-15, kanál 9 sa vynecháva (bicie).
		var availableChannels = [0,1,2,3,4,5,6,7,8,10,11,12,13,14,15];

		// Vytvorenie časovej osi udalostí note-on a note-off a ich spracovanie v poradí podľa tikov,
		// aby alokácia kanálov dokázala presne určiť, ktoré kanály sú voľné.
		var timeline = []; // {tick, type:'on'|'off', noteIndex, ...}
		var noteData = []; // Paralelné pole s vypočítanými informáciami o note.

		var pitchBendClampedCount = 0;
		for (let i = 0; i < notes.length; i++) {
			var note = notes[i];
			var startTick = Math.round(note.startTime * ticksPerGridline);
			var endTick = Math.round((note.startTime + note.duration) * ticksPerGridline);
			var velocity = Math.min(127, note.velocity || 100);
			var midiNote = note.midiNote;
			var cents = note.cents || 0;
			if (includePitchBend && Math.abs(cents) > 200) {
				pitchBendClampedCount++;
			}
			var desiredBend = (includePitchBend && cents !== 0)
				? this.centsToPitchBend(cents) : 8192;

			noteData.push({ startTick, endTick, velocity, midiNote, desiredBend, channel: -1 });
			timeline.push({ tick: startTick, type: 'on', idx: i, sortOrder: 1 });
			timeline.push({ tick: endTick, type: 'off', idx: i, sortOrder: 2 });
		}

		// Zoraďuje sa podľa tiku, potom off pred on, aby sa kanály uvoľnili pred novou alokáciou, a nakoniec podľa sortOrder.
		timeline.sort((a, b) => {
			if (a.tick !== b.tick) return a.tick - b.tick;
			// v rámci rovnakého tiku sa note-off spracuje pred note-on.
			if (a.type !== b.type) return a.type === 'off' ? -1 : 1;
			return a.sortOrder - b.sortOrder;
		});

		// Stav kanálov
		var channelBend = new Array(16).fill(8192);
		var channelNoteCount = new Array(16).fill(0);
		var midiEvents = [];

		for (const ev of timeline) {
			var nd = noteData[ev.idx];

			if (ev.type === 'off') {
				// Uvoľnenie kanálu
				const ch = nd.channel;
				if (ch >= 0) {
					channelNoteCount[ch] = Math.max(0, channelNoteCount[ch] - 1);
					midiEvents.push({
						tick: ev.tick,
						data: [0x80 | ch, nd.midiNote, 0],
						sortOrder: 2
					});
				}
			} else {
				// Alokácia kanálu pre note-on.
				var assignedCh = -1;

				// Niekoľko kritérií
				// presná zhoda bendu s najmenším počtom nôt.
				var bestMatch = -1, bestMatchCount = Infinity;
				for (const ch of availableChannels) {
					if (channelBend[ch] === nd.desiredBend && channelNoteCount[ch] < bestMatchCount) {
						bestMatch = ch;
						bestMatchCount = channelNoteCount[ch];
					}
				}
				if (bestMatch >= 0) {
					assignedCh = bestMatch;
				} else {
					// Voľný kanál (bez znejúcich nôt).
					for (const ch of availableChannels) {
						if (channelNoteCount[ch] === 0) {
							assignedCh = ch;
							break;
						}
					}
				}
				// Ak prvých pár možností nezafungovalo, použije sa kanál 0.
				if (assignedCh < 0) assignedCh = 0;

				nd.channel = assignedCh;

				// Pitch bend, ak je potrebný.
				if (channelBend[assignedCh] !== nd.desiredBend) {
					var lsb = nd.desiredBend & 0x7F;
					var msb = (nd.desiredBend >> 7) & 0x7F;
					midiEvents.push({
						tick: ev.tick,
						data: [0xE0 | assignedCh, lsb, msb],
						sortOrder: 0
					});
					channelBend[assignedCh] = nd.desiredBend;
				}

				// Note-on
				channelNoteCount[assignedCh]++;
				midiEvents.push({
					tick: ev.tick,
					data: [0x90 | assignedCh, nd.midiNote, nd.velocity],
					sortOrder: 1
				});
			}
		}

		// Zoradenie udalostí podľa tiku, potom podľa sortOrder.
		midiEvents.sort((a, b) => a.tick !== b.tick ? a.tick - b.tick : a.sortOrder - b.sortOrder);

		// Konverzia na delta časy.
		var noteTrackEvents = [];
		var lastTick = 0;
		for (const event of midiEvents) {
			var delta = event.tick - lastTick;
			lastTick = event.tick;
			noteTrackEvents.push({ delta, data: event.data });
		}

		noteTrackEvents.push({ delta: 0, data: [0xFF, 0x2F, 0x00] });

		var fileData = [];

		fileData.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
		fileData.push(0x00, 0x00, 0x00, 0x06); // Dĺžka hlavičky
		fileData.push(0x00, 0x01); // Formát 1
		fileData.push(0x00, 0x02); // 2 stopy
		fileData.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF);

		fileData.push(...this.buildTrackChunk(tempoTrackEvents));

		// Stopa s notami.
		fileData.push(...this.buildTrackChunk(noteTrackEvents));

		return { bytes: fileData, notes: notes, skippedCount: skippedCount, pitchBendClampedCount: pitchBendClampedCount };
	},

	exportMIDI: function(mode, filename, tracks, includePitchBend = true) {
		var result = this.buildMIDIBytes(mode, filename, tracks, includePitchBend);
		if (!result) {
			showStatus('No notes to export.', { type: 'warning' });
			return;
		}
		var notes = result.notes, skippedCount = result.skippedCount, pitchBendClampedCount = result.pitchBendClampedCount;

		var blob = new Blob([new Uint8Array(result.bytes)], { type: 'audio/midi' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = `${filename}.mid`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		var statusMsg = `MIDI export complete! ${notes.length} notes exported.`;
		if (skippedCount > 0) {
			statusMsg += ` ${skippedCount} notes were skipped (invalid data, zero amplitude, or out of range).`;
		}
		if (pitchBendClampedCount > 0) {
			statusMsg += ` ${pitchBendClampedCount} notes had pitch bend clamped (>200 cents deviation).`;
		}
		Logger.log(statusMsg);
		showStatus(statusMsg, { type: (skippedCount > 0 || pitchBendClampedCount > 0) ? 'warning' : 'info' });
	}
};

// [ZDROJ] W3C Music Notation Community Group. MusicXML Version 4.0 [online]. Final Community Group Report,
//   1. 6. 2021 [cit. 2026-07-30]. Dostupné z: https://www.w3.org/2021/06/musicxml40/
// [ZDROJ] W3C Music Notation Community Group. Standard Music Font Layout (SMuFL): Version 1.4 [online]. 20.
//   3. 2021 [cit. 2026-07-30]. Dostupné z: https://www.w3.org/2021/03/smufl14/
// modul na export MusicXML
// jedna z najužitočnejších častí celého softvéru, export do MusicXML.
// Pravidlá na export sa adaptovali zo súborov MusicXML exportovaných z Dorica.
// Noty prejdú kvantizáciou v čase a neskôr sa rozdelia na zligatúrované akordy.
// Veľký export do MusicXML, ktorý pokrýva party, hlasy, dynamiku, trioly a n-oly.
var MusicXMLExport = {
	// Definície predznamenaní pre rôzne systémy EDO
	// hodnoty predznamenaní MusicXML a názvy SMuFL.
	accidentals: {
		12: {
			0: { alter: 0, accidental: 'natural', smufl: 'accidentalNatural' },
			1: { alter: 1, accidental: 'sharp', smufl: 'accidentalSharp' },
			'-1': { alter: -1, accidental: 'flat', smufl: 'accidentalFlat' }
		},
		24: {
			0: { alter: 0, accidental: 'natural', smufl: 'accidentalNatural' },
			0.5: { alter: 0.5, accidental: 'quarter-sharp', smufl: 'accidentalQuarterToneSharpStein' },
			1: { alter: 1, accidental: 'sharp', smufl: 'accidentalSharp' },
			1.5: { alter: 1.5, accidental: 'three-quarters-sharp', smufl: 'accidentalThreeQuarterTonesSharpStein' },
			'-0.5': { alter: -0.5, accidental: 'quarter-flat', smufl: 'accidentalQuarterToneFlatStein' },
			'-1': { alter: -1, accidental: 'flat', smufl: 'accidentalFlat' },
			'-1.5': { alter: -1.5, accidental: 'three-quarters-flat', smufl: 'accidentalThreeQuarterTonesFlatZimmermann' }
		},
		36: {
			0: { alter: 0, accidental: 'natural', smufl: 'accidentalNatural' },
			'0.333': { alter: 0.333, accidental: 'arrow-up', smufl: 'accidentalArrowUp' },
			'0.667': { alter: 0.667, accidental: 'sharp-down', smufl: 'accidentalSharpArrowDown' },
			1: { alter: 1, accidental: 'sharp', smufl: 'accidentalSharp' },
			'1.333': { alter: 1.333, accidental: 'sharp-up', smufl: 'accidentalSharpArrowUp' },
			'-0.333': { alter: -0.333, accidental: 'arrow-down', smufl: 'accidentalArrowDown' },
			'-0.667': { alter: -0.667, accidental: 'flat-up', smufl: 'accidentalFlatArrowUp' },
			'-1': { alter: -1, accidental: 'flat', smufl: 'accidentalFlat' },
			'-1.333': { alter: -1.333, accidental: 'flat-down', smufl: 'accidentalFlatArrowDown' }
		},
		48: {
			0: { alter: 0, accidental: 'natural', smufl: 'accidentalNatural' },
			0.25: { alter: 0.25, accidental: 'arrow-up', smufl: 'accidentalArrowUp' },
			0.5: { alter: 0.5, accidental: 'quarter-sharp', smufl: 'accidentalQuarterToneSharpStein' },
			0.75: { alter: 0.75, accidental: 'quarter-sharp', smufl: 'accidentalQuarterToneSharpArrowUp' },
			1: { alter: 1, accidental: 'sharp', smufl: 'accidentalSharp' },
			1.25: { alter: 1.25, accidental: 'sharp-up', smufl: 'accidentalSharpArrowUp' },
			1.5: { alter: 1.5, accidental: 'three-quarters-sharp', smufl: 'accidentalThreeQuarterTonesSharpStein' },
			'-0.25': { alter: -0.25, accidental: 'arrow-down', smufl: 'accidentalArrowDown' },
			'-0.5': { alter: -0.5, accidental: 'quarter-flat', smufl: 'accidentalQuarterToneFlatStein' },
			'-0.75': { alter: -0.75, accidental: 'quarter-flat', smufl: 'accidentalQuarterToneFlatArrowDown' },
			'-1': { alter: -1, accidental: 'flat', smufl: 'accidentalFlat' },
			'-1.25': { alter: -1.25, accidental: 'flat-down', smufl: 'accidentalFlatArrowDown' },
			'-1.5': { alter: -1.5, accidental: 'three-quarters-flat', smufl: 'accidentalThreeQuarterTonesFlatZimmermann' }
		}
	},

	quantizeToEDO: function(freq, edo) {
		var semitones = 12 * Math.log2(freq / 440);
		var edoSteps = semitones * (edo / 12);
		var quantizedSteps = Math.round(edoSteps);
		var quantizedSemitones = quantizedSteps * (12 / edo);
		return 440 * Math.pow(2, quantizedSemitones / 12);
	},

	// Kvantizuje frekvenciu na ladenie, pričom sa porovnáva v rámci jednej oktávy.
	// Momentálne sa nepoužíva.
	quantizeToTuning: function(freq, tuningKey) {
		/*var scale = window.scales ? window.scales[tuningKey] : null;
		if (!scale || !scale.notes || scale.notes.length === 0) {
			return freq;
		}
		if (!isFinite(freq) || freq <= 0) {
			return freq;
		}

		// scale.notes majú tvar [[pitch, frequency, isBlack], ...]
		var closestFreq = null;
		var closestDist = Infinity;

		for (const noteEntry of scale.notes) {
			var noteFreq = Array.isArray(noteEntry) ? noteEntry[1] : noteEntry;
			if (!isFinite(noteFreq) || noteFreq <= 0) continue;

			// obe hodnoty sa na porovnanie prevedú do rovnakej oktávy, vyberie sa najbližšia
			var ratio = freq / noteFreq;
			// vzdialenosť v oktávach (logaritmická)
			var dist = Math.abs(Math.log2(ratio));
			if (dist < closestDist) {
				closestDist = dist;
				closestFreq = noteFreq;
			}
		}

		return closestFreq !== null ? closestFreq : freq;*/
	},

	// Konvertuje frekvenciu na informácie o výške tónu so správnymi predznamenaniami.
	freq2pitch: function(freq, edo, prevMidiNote) {
		if (typeof edo === 'undefined') edo = 12;
		var pitchOffset = window.playbackPitch || 0;

		if (!freq || freq <= 0 || !isFinite(freq)) {
			return { step: 'C', alter: 0, octave: 4, accidental: 'natural', cents: 0, midiNote: 60 };
		}

		// pre čierne klávesy sa použijú krížiky: C# D# F# G# A#.
		var noteDataSharps = [
			{ step: 'C', baseAlter: 0 },
			{ step: 'C', baseAlter: 1 },  // C#
			{ step: 'D', baseAlter: 0 },
			{ step: 'D', baseAlter: 1 },  // D#
			{ step: 'E', baseAlter: 0 },
			{ step: 'F', baseAlter: 0 },
			{ step: 'F', baseAlter: 1 },  // F#
			{ step: 'G', baseAlter: 0 },
			{ step: 'G', baseAlter: 1 },  // G#
			{ step: 'A', baseAlter: 0 },
			{ step: 'A', baseAlter: 1 },  // A#
			{ step: 'B', baseAlter: 0 }
		];
		var noteDataFlats = [
			{ step: 'C', baseAlter: 0 },
			{ step: 'D', baseAlter: -1 }, // Db
			{ step: 'D', baseAlter: 0 },
			{ step: 'E', baseAlter: -1 }, // Eb
			{ step: 'E', baseAlter: 0 },
			{ step: 'F', baseAlter: 0 },
			{ step: 'G', baseAlter: -1 }, // Gb
			{ step: 'G', baseAlter: 0 },
			{ step: 'A', baseAlter: -1 }, // Ab
			{ step: 'A', baseAlter: 0 },
			{ step: 'B', baseAlter: -1 }, // Bb
			{ step: 'B', baseAlter: 0 }
		];

		// playbackPitch je transpozícia v poltónoch, pripočítanie je pri koncertnom ladení správne.
		var semitones = 12 * Math.log2(freq / 440) + pitchOffset;

		if (!isFinite(semitones)) {
			return { step: 'C', alter: 0, octave: 4, accidental: 'natural', cents: 0, midiNote: 60 };
		}

		var stepSize = 12 / edo;
		var edoSteps = semitones / stepSize;
		var roundedSteps = Math.round(edoSteps);
		var quantizedSemitones = roundedSteps * stepSize;
		var midiNote = 69 + quantizedSemitones;
		var roundedMidi = Math.round(midiNote);
		var microtonalOffset = midiNote - roundedMidi;

		var pitchClass = ((roundedMidi % 12) + 12) % 12;
		var octave = Math.floor(roundedMidi / 12) - 1;

		// Pri stúpaní krížiky, pri klesaní béčka.
		var noteData;
		if (typeof prevMidiNote === 'number' && isFinite(prevMidiNote)) {
			noteData = (roundedMidi >= prevMidiNote) ? noteDataSharps : noteDataFlats;
		} else {
			noteData = noteDataSharps;
		}

		var base = noteData[pitchClass];
		var totalAlter = base.baseAlter + microtonalOffset;
		var accidentalInfo = this.getAccidentalForEDO(totalAlter, edo);

		return {
			step: base.step,
			alter: accidentalInfo.alter,
			octave: octave,
			accidental: accidentalInfo.accidental,
			smufl: accidentalInfo.smufl,
			cents: Math.round(microtonalOffset * 100),
			midiNote: roundedMidi
		};
	},

	getAccidentalForEDO: function(alter, edo) {
		var accidentals = this.accidentals[edo] || this.accidentals[12];
		var stepSize = 1 / (edo / 12);
		var roundedAlter = Math.round(alter / stepSize) * stepSize;

		var bestMatch = { alter: 0, accidental: 'natural' };
		var bestDist = Infinity;

		for (const key in accidentals) {
			var acc = accidentals[key];
			var dist = Math.abs(acc.alter - roundedAlter);
			if (dist < bestDist) {
				bestDist = dist;
				bestMatch = acc;
			}
		}

		return bestMatch;
	},

	escapeXml: function(str) {
		return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
	},

	_standardDurations: function(divisions) {
		return [
			{ ticks: divisions * 8,      type: 'breve',   dots: 0 },
			{ ticks: divisions * 6,      type: 'whole',   dots: 1 },
			{ ticks: divisions * 4,      type: 'whole',   dots: 0 },
			{ ticks: divisions * 3,      type: 'half',    dots: 1 },
			{ ticks: divisions * 2,      type: 'half',    dots: 0 },
			{ ticks: divisions * 1.5,    type: 'quarter', dots: 1 },
			{ ticks: divisions * 1,      type: 'quarter', dots: 0 },
			{ ticks: divisions * 0.75,   type: 'eighth',  dots: 1 },
			{ ticks: divisions * 0.5,    type: 'eighth',  dots: 0 },
			{ ticks: divisions * 0.375,  type: '16th',    dots: 1 },
			{ ticks: divisions * 0.25,   type: '16th',    dots: 0 },
			{ ticks: divisions * 0.125,  type: '32nd',    dots: 0 },
			{ ticks: divisions * 0.0625, type: '64th',    dots: 0 }
		];
	},

	_getStrongBeats: function(beatsNum, beatType) {
		// Tiky ťažkých dôb v rámci taktu
		// v 4/4 sú ťažké doby 1 a 3
		// v 3/4 je ťažká doba 1
		// v 6/8, teda v zloženom takte, sú ťažké doby 1 a 4
		// v 2/4 je ťažká doba 1.
		var divisions = 480;
		var beatTicks = divisions * (4 / beatType);

		if (beatsNum === 6 && beatType === 8) {
			// v zloženom takte sú ťažké doby 1 a 4.
			return [0, 3 * beatTicks];
		}
		if (beatsNum === 4) {
			return [0, 2 * beatTicks]; // Doby 1 a 3.
		}
		if (beatsNum === 3) {
			return [0]; // Iba doba 1.
		}
		if (beatsNum === 2) {
			return [0]; // Iba doba 1.
		}
		// Všeobecne je ťažká doba 1 a polovica.
		var half = Math.floor(beatsNum / 2) * beatTicks;
		return half > 0 ? [0, half] : [0];
	},

	// Dekompozícia s ohľadom na doby rozdelí totalTicks na ťažkých dobách,
	// potom každý fragment rozloží. Zjednodušene povedané, delí sa len na ťažkej dobe v polovici taktu, aby nevznikala nadmerná fragmentácia ligatúr.
	_decomposeDuration: function(totalTicks, posInMeasure, measureTicks, beatsNum, beatType) {
		var divisions = 480; // Tiky
		var stdDurations = this._standardDurations(divisions);
		var minTicks = Math.round(stdDurations[stdDurations.length - 1].ticks);

		// Delí sa iba pri hlavnej ťažkej dobe v polovici taktu, aby sa znížila fragmentácia
		// pre 4/4: delenie pri dobe 3 (tik 960). Pre 3/4: bez delenia v strede taktu.
		var beatTicks = divisions * (4 / beatType);
		var splitPoints = [];
		if (beatsNum === 4 && beatType === 4) {
			// Delenie iba pri dobe 3.
			var midPoint = 2 * beatTicks;
			if (midPoint > posInMeasure && midPoint < posInMeasure + totalTicks) {
				splitPoints.push(midPoint - posInMeasure);
			}
		} else if (beatsNum === 6 && beatType === 8) {
			// v zloženom takte sa delí pri dobe 4.
			var midPoint6 = 3 * beatTicks;
			if (midPoint6 > posInMeasure && midPoint6 < posInMeasure + totalTicks) {
				splitPoints.push(midPoint6 - posInMeasure);
			}
		}
		// Pre iné taktové označenia sa v strede taktu nedelí.

		// Zostavenie fragmentov
		var fragments = [];
		var pos = 0;
		for (var si = 0; si < splitPoints.length; si++) {
			var sp = splitPoints[si];
			if (sp > pos) fragments.push(sp - pos);
			pos = sp;
		}
		if (pos < totalTicks)
			fragments.push(totalTicks - pos);

		if (fragments.length === 0)
			fragments.push(totalTicks);


		// Rozloženie každého fragmentu.
		var result = [];
		for (var fi = 0; fi < fragments.length; fi++) {
			var remaining = Math.round(fragments[fi]);
			while (remaining >= minTicks) {
				var found = false;
				for (var di = 0; di < stdDurations.length; di++) {
					var t = Math.round(stdDurations[di].ticks);
					if (t <= remaining) {
						result.push({ ticks: t, type: stdDurations[di].type, dots: stdDurations[di].dots });
						remaining -= t;
						found = true;
						break;
					}
				}
				if (!found) break;
			}
			if (remaining > 0 && remaining >= minTicks / 2) {
				result.push({ ticks: minTicks, type: '64th', dots: 0 });
			}
		}

		if (result.length === 0 && totalTicks > 0) {
			result.push({ ticks: minTicks, type: '64th', dots: 0 });
		}

		return result;
	},

	_velocityToDynamic: function(velocity) {
		if (velocity <= 31) return 'ppp';
		if (velocity <= 47) return 'pp';
		if (velocity <= 63) return 'p';
		if (velocity <= 79) return 'mp';
		if (velocity <= 95) return 'mf';
		if (velocity <= 111) return 'f';
		if (velocity <= 121) return 'ff';
		return 'fff';
	},

	// Skontroluje, či skupina nôt tvorí triolu.
	// 3 rovnaké noty v 2 dobách = triola.
	_detectTriplet: function(noteDurationTicks, divisions) {
		// Triola štvrťových nôt: 3 noty v 2 štvrťových dobách
		// každá nota = 2/3 štvrťovej noty = divisions * 2/3.
		var tripletQuarter = Math.round(divisions * 2 / 3);
		var tripletEighth = Math.round(divisions / 3);
		var tripletSixteenth = Math.round(divisions / 6);

		var tolerance = 5;
		if (Math.abs(noteDurationTicks - tripletQuarter) < tolerance) {
			return { actualType: 'quarter', normalNotes: 3, normalType: 'quarter', actualNotes: 2 };
		}
		if (Math.abs(noteDurationTicks - tripletEighth) < tolerance) {
			return { actualType: 'eighth', normalNotes: 3, normalType: 'eighth', actualNotes: 2 };
		}
		if (Math.abs(noteDurationTicks - tripletSixteenth) < tolerance) {
			return { actualType: '16th', normalNotes: 3, normalType: '16th', actualNotes: 2 };
		}
		return null;
	},

	_assignVoices: function(notes) {
		// Zoskupenie nôt s totožným startTick a endTick do skupín akordov.
		var chordMap = {};
		for (var i = 0; i < notes.length; i++) {
			var key = notes[i].startTick + ':' + notes[i].endTick;
			if (!chordMap[key]) chordMap[key] = [];
			chordMap[key].push(notes[i]);
		}

		var groups = [];
		for (var k in chordMap) {
			if (!chordMap.hasOwnProperty(k)) continue;
			var g = chordMap[k];
			g.sort(function(a, b) { return b.midiPitch - a.midiPitch; });
			groups.push({
				startTick: g[0].startTick,
				endTick: g[0].endTick,
				notes: g
			});
		}
		groups.sort(function(a, b) {
			if (a.startTick !== b.startTick) return a.startTick - b.startTick;
			return b.notes[0].midiPitch - a.notes[0].midiPitch;
		});

		// Priradenie každej skupiny akordov do hlasu.
		var voiceEnds = [];
		for (var gi = 0; gi < groups.length; gi++) {
			var grp = groups[gi];
			var assignedVoice = -1;
			for (var v = 0; v < voiceEnds.length; v++) {
				if (voiceEnds[v] <= grp.startTick) {
					assignedVoice = v;
					break;
				}
			}
			if (assignedVoice === -1) {
				assignedVoice = voiceEnds.length;
				voiceEnds.push(0);
			}
			voiceEnds[assignedVoice] = grp.endTick;
			for (var ni = 0; ni < grp.notes.length; ni++) {
				grp.notes[ni].voice = assignedVoice + 1; // Číslované od 1.
				grp.notes[ni]._chordIndex = ni; // 0 = prvá (bez <chord/>), >0 = člen akordu.
			}
		}

		return notes;
	},

	_selectClef: function(notes) {
		if (notes.length === 0) return { sign: 'G', line: 2 }; // Husľový kľúč

		var pitches = notes.map(n => n.midiPitch).filter(p => isFinite(p));
		if (pitches.length === 0) return { sign: 'G', line: 2 };

		pitches.sort((a, b) => a - b);
		var median = pitches[Math.floor(pitches.length / 2)];

		if (median < 55) return { sign: 'F', line: 4 }; // Basový kľúč
		return { sign: 'G', line: 2 }; // Husľový kľúč
	},

	// Export do MusicXML
	// Viacpartová skladba, detekcia akordov, priradenie hlasov, generovanie páuz.
	export: function(mode, filename, tracks, quantization) {
	  if (typeof quantization === 'undefined') quantization = { type: 'off' };
	  try {
		Logger.log('MusicXML Export starting: mode=' + mode + ', tracks=' + tracks);

		var { notes, skippedCount } = MIDIExport.getNotesForExport(mode, tracks);

		if (notes.length === 0) {
			showStatus('No notes to export.', { type: 'warning' });
			return;
		}

		// Konfigurácia
		var divisions = 480; // Počet tikov na jednu štvrťovú notu.
		var ticksPerGridline = divisions; // Jedna vertikálna čiara z gridu je rovná jednej dobe.

		var playback = window.playback;
		var tempo = (playback && playback.bpm && playback.bpm > 0) ? playback.bpm : 120;

		// Spectra neukladá taktové označenie v nastaveniach, takže predvolene ide o 4/4,
		// a je ho možné rozšíriť cez settings.timeSignature.
		var settingsObj = window.settings || {};
		var beatsNum = 4;
		var beatType = 4;
		if (settingsObj.timeSignature) {
			beatsNum = settingsObj.timeSignature.beats || 4;
			beatType = settingsObj.timeSignature.beatType || 4;
		}
		var measureTicks = divisions * beatsNum * (4 / beatType);

		var edo = 12;
		if (quantization.type === '12') edo = 12;
		else if (quantization.type === '24') edo = 24;
		else if (quantization.type === '36') edo = 36;
		else if (quantization.type === '48') edo = 48;

		var processedNotes = [];
		for (let i = 0; i < notes.length; i++) {
			const note = notes[i];
			var freq = note.frequency;
			if (!freq || freq <= 0 || !isFinite(freq)) continue;

			if (quantization.type === 'tuning') {
				freq = this.quantizeToTuning(freq, quantization.tuningKey);
			} else if (quantization.type !== 'off') {
				freq = this.quantizeToEDO(freq, parseInt(quantization.type));
			}

			processedNotes.push({
				startTime: note.startTime,
				duration: note.duration,
				frequency: freq,
				velocity: note.velocity || 100,
				track: note.track,
				partialNumber: note.partialNumber || 1,
				isActivePartial: note.isActivePartial || false
			});
		}

		if (processedNotes.length === 0) {
			showStatus('No valid notes to export.', { type: 'warning' });
			return;
		}

		// Zoskupenie nôt podľa stôp.
		var trackMap = new Map();
		for (const note of processedNotes) {
			var t = note.track;
			if (!trackMap.has(t)) trackMap.set(t, []);
			trackMap.get(t).push(note);
		}
		var trackIndices = Array.from(trackMap.keys()).sort((a, b) => a - b);

		// Názvy partov z nástrojov.
		var instrumentsArr = window.instruments || [];

		// Predtaktie je určené podľa najskoršieho začiatku noty.
		var globalMinStart = processedNotes.reduce((min, n) => Math.min(min, n.startTime), Infinity);
		var tickOffset = globalMinStart < 0 ? Math.round(Math.abs(globalMinStart) * ticksPerGridline) : 0;
		var firstNoteTick = Math.round(globalMinStart * ticksPerGridline) + tickOffset;
		var hasPickup = firstNoteTick > 0 && firstNoteTick < measureTicks;
		// Ak existuje predtaktie, začne sa neúplným taktom.

		// Metadáta skladby
		var projectName = filename || 'Spectra Export';

		// Tvorba MusicXML
		var T = '\t'; // Skratka pre tabulátor.
		var xml = [];

		xml.push('<?xml version="1.0" encoding="UTF-8"?>');
		xml.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'); // Prevzaté z exportu z Dorica.
		xml.push('<score-partwise version="4.0">');

		// Metadáta
		xml.push(T + '<work>');
		xml.push(T + T + '<work-title>' + this.escapeXml(projectName) + '</work-title>');
		xml.push(T + '</work>');
		xml.push(T + '<identification>');
		xml.push(T + T + '<encoding>');
		xml.push(T + T + T + '<software>Spectra Export</software>');
		xml.push(T + T + T + '<encoding-date>' + new Date().toISOString().split('T')[0] + '</encoding-date>');
		xml.push(T + T + '</encoding>');
		xml.push(T + '</identification>');

		// Zoznam jednotlivých partov.
		xml.push(T + '<part-list>');
		for (let pi = 0; pi < trackIndices.length; pi++) {
			const tIdx = trackIndices[pi];
			const partId = 'P' + (pi + 1);
			var partName = (instrumentsArr[tIdx] && instrumentsArr[tIdx].name)
				? instrumentsArr[tIdx].name
				: 'Part ' + (pi + 1);
			xml.push(T + T + '<score-part id="' + partId + '">');
			xml.push(T + T + T + '<part-name>' + this.escapeXml(partName) + '</part-name>');
			xml.push(T + T + '</score-part>');
		}
		xml.push(T + '</part-list>');

		// Spracovanie každého jedného partu.
		for (let pi = 0; pi < trackIndices.length; pi++) {
			const tIdx = trackIndices[pi];
			const partId = 'P' + (pi + 1);
			var partNotes = trackMap.get(tIdx);

			xml.push(T + '<part id="' + partId + '">');

			var prevMidiNote = null;
			var noteList = [];
			for (let ni = 0; ni < partNotes.length; ni++) {
				const n = partNotes[ni];
				var startTick = Math.round(n.startTime * ticksPerGridline) + tickOffset;
				var durTicks = Math.max(Math.round(divisions / 16), Math.round(n.duration * ticksPerGridline));
				var pitch = this.freq2pitch(n.frequency, edo, prevMidiNote);
				prevMidiNote = pitch.midiNote;

				noteList.push({
					id: ni,
					startTick: startTick,
					endTick: startTick + durTicks,
					pitch: pitch,
					midiPitch: pitch.midiNote,
					frequency: n.frequency,
					velocity: n.velocity || 100,
					partialNumber: n.partialNumber || 1,
					isActivePartial: n.isActivePartial || false,
					voice: 1 // Bude nanovo priradené.
				});
			}

			// Priradenie hlasov k partu.
			this._assignVoices(noteList);

			// Výber kľúča.
			var clef = this._selectClef(noteList);

			var maxEndTick = noteList.reduce((max, n) => Math.max(max, n.endTick), 0);
			var totalMeasures = Math.max(1, Math.ceil(maxEndTick / measureTicks));

			var numVoices = noteList.reduce((max, n) => Math.max(max, n.voice), 1);

			// Tvorba jednotlivých taktov.
			for (let m = 0; m < totalMeasures; m++) {
				const measureStart = m * measureTicks;
				const measureEnd = measureStart + measureTicks;
				var measureNum = m + 1;

				xml.push(T + T + '<measure number="' + measureNum + '">');

				// Atribúty v prvom takte.
				if (m === 0) {
					xml.push(T + T + T + '<attributes>');
					xml.push(T + T + T + T + '<divisions>' + divisions + '</divisions>');
					// Predznamenanie, predvolene C dur.
					xml.push(T + T + T + T + '<key>');
					xml.push(T + T + T + T + T + '<fifths>0</fifths>');
					xml.push(T + T + T + T + '</key>');
					// Taktové označenie.
					xml.push(T + T + T + T + '<time>');
					xml.push(T + T + T + T + T + '<beats>' + beatsNum + '</beats>');
					xml.push(T + T + T + T + T + '<beat-type>' + beatType + '</beat-type>');
					xml.push(T + T + T + T + '</time>');
					xml.push(T + T + T + T + '<staves>1</staves>');
					xml.push(T + T + T + T + '<clef>');
					xml.push(T + T + T + T + T + '<sign>' + clef.sign + '</sign>');
					xml.push(T + T + T + T + T + '<line>' + clef.line + '</line>');
					xml.push(T + T + T + T + '</clef>');
					xml.push(T + T + T + '</attributes>');

					// Tempové označenie.
					xml.push(T + T + T + '<direction placement="above">');
					xml.push(T + T + T + T + '<direction-type>');
					xml.push(T + T + T + T + T + '<metronome>');
					xml.push(T + T + T + T + T + T + '<beat-unit>quarter</beat-unit>');
					xml.push(T + T + T + T + T + T + '<per-minute>' + tempo + '</per-minute>');
					xml.push(T + T + T + T + T + '</metronome>');
					xml.push(T + T + T + T + '</direction-type>');
					xml.push(T + T + T + T + '<sound tempo="' + tempo + '"/>');
					xml.push(T + T + T + '</direction>');
				}

				// Sledovanie posuviek v rámci taktu (podľa stupňa, oktávy a hodnoty alter).
				var accidentalState = {}; // "step+octave" -> zobrazená hodnota alter.
				// Tu treba poznamenať, že v rámci 48EDO používa Spectra rôzne typy posuviek pochádzajúcich z rôznych ladení,
				// a preto by sa spravidla malo najprv vyexportovať ladenie a až potom ho importovať do projektu.

				// Spracovanie každého hlasu samostatne.
				var voicesEmitted = 0;
				for (let v = 1; v <= numVoices; v++) {
					var voiceNotes = noteList.filter(n =>
						n.voice === v && n.startTick < measureEnd && n.endTick > measureStart
					);

					// Preskočenie hlasov, ktoré nemajú noty v danom ani v žiadnom ďalšom takte.
					if (voiceNotes.length === 0) {
						var hasLaterNotes = noteList.some(n => n.voice === v && n.startTick >= measureEnd);
						// Hlas je dokončený, preto sa preskočí úplne.
						if (!hasLaterNotes) continue;
					}

					if (voicesEmitted > 0) {
						// Kurzor ďalšieho hlasu (nie prvého) sa presunie naspäť.
						xml.push(T + T + T + '<backup>');
						xml.push(T + T + T + T + '<duration>' + measureTicks + '</duration>');
						xml.push(T + T + T + '</backup>');
					}
					voicesEmitted++;

					// Zostavenie časových segmentov pre daný hlas v rámci daného taktu
					// zhromaždenie všetkých relevantných časových bodov.
					var timePoints = new Set();
					timePoints.add(measureStart);
					timePoints.add(measureEnd);
					for (const n of voiceNotes) {
						if (n.startTick >= measureStart && n.startTick < measureEnd) {
							timePoints.add(n.startTick);
						}
						if (n.endTick > measureStart && n.endTick < measureEnd) {
							timePoints.add(n.endTick);
						}
					}
					var sortedTPs = Array.from(timePoints).sort((a, b) => a - b);

					// Zapamätať si poslednú dynamiku pre daný hlas.
					var lastDynamic = null;

					for (let ti = 0; ti < sortedTPs.length - 1; ti++) {
						const segStart = sortedTPs[ti];
						var segEnd = sortedTPs[ti + 1];
						var segDur = segEnd - segStart;
						if (segDur <= 0) continue;

						var activeNotes = voiceNotes.filter(n =>
							n.startTick <= segStart && n.endTick > segStart
						);

						// Týmto sa oddelia akordy od pridržiavaných nôt
						// akord tvoria iba noty, ktoré majú navzájom rovnaký startTick.
						var chordGroups = new Map();
						for (const n of activeNotes) {
							var key = n.startTick;
							if (!chordGroups.has(key)) chordGroups.set(key, []);
							chordGroups.get(key).push(n);
						}

						// Primárna akordová skupina je tá, ktorá začala najnovšie, prípadne tá na segStart, ak tam nejaká nota začína.
						var primaryGroup = null;
						var latestStart = -1;
						for (const [st, group] of chordGroups) {
							if (st > latestStart) {
								latestStart = st;
								primaryGroup = group;
							}
						}

						if (!primaryGroup || primaryGroup.length === 0) {
							const posInMeasure = segStart - measureStart;
							const components = this._decomposeDuration(segDur, posInMeasure, measureTicks, beatsNum, beatType);
							for (const comp of components) {
								xml.push(T + T + T + '<note>');
								xml.push(T + T + T + T + '<rest/>');
								xml.push(T + T + T + T + '<duration>' + comp.ticks + '</duration>');
								xml.push(T + T + T + T + '<voice>' + v + '</voice>');
								xml.push(T + T + T + T + '<type>' + comp.type + '</type>');
								for (let d = 0; d < comp.dots; d++) {
									xml.push(T + T + T + T + '<dot/>');
								}
								xml.push(T + T + T + T + '<staff>1</staff>');
								xml.push(T + T + T + '</note>');
							}
							continue;
						}

						const posInMeasure = segStart - measureStart;
						const components = this._decomposeDuration(segDur, posInMeasure, measureTicks, beatsNum, beatType);

						var tickPos = segStart;
						for (const comp of components) {
							var isFirstInChord = true;

							for (const note of primaryGroup) {
								var isVeryFirstChunk = (tickPos === note.startTick);
								var isVeryLastChunk = (tickPos + comp.ticks >= note.endTick);
								var tieStop = !isVeryFirstChunk;
								var tieStart = !isVeryLastChunk;

								// Je nutné ešte detekovať trioly.
								var triplet = isVeryFirstChunk ? this._detectTriplet(note.endTick - note.startTick, divisions) : null;

								// Sledovanie posuviek
								var accKey = note.pitch.step + note.pitch.octave;
								var prevAlter = accidentalState[accKey];
								var needsAccidental = isVeryFirstChunk && (prevAlter === undefined || prevAlter !== note.pitch.alter);
								if (needsAccidental && isVeryFirstChunk) {
									accidentalState[accKey] = note.pitch.alter;
								}

								xml.push(T + T + T + '<note>');

								if (!isFirstInChord) {
									xml.push(T + T + T + T + '<chord/>');
								}

								xml.push(T + T + T + T + '<pitch>');
								xml.push(T + T + T + T + T + '<step>' + note.pitch.step + '</step>');
								if (note.pitch.alter !== 0) {
									// Desatinná hodnota alter kvôli mikrotonalite.
									var alterVal = Math.round(note.pitch.alter * 1000) / 1000;
									// Vďaka danému riadku je možná mikrotonalita v MusicXML.
									xml.push(T + T + T + T + T + '<alter>' + alterVal + '</alter>');
								}
								xml.push(T + T + T + T + T + '<octave>' + note.pitch.octave + '</octave>');
								xml.push(T + T + T + T + '</pitch>');

								xml.push(T + T + T + T + '<duration>' + comp.ticks + '</duration>');

								if (tieStart) xml.push(T + T + T + T + '<tie type="start"/>');
								if (tieStop) xml.push(T + T + T + T + '<tie type="stop"/>');

								xml.push(T + T + T + T + '<voice>' + v + '</voice>');

								if (triplet) {
									xml.push(T + T + T + T + '<type>' + triplet.actualType + '</type>');
								} else {
									xml.push(T + T + T + T + '<type>' + comp.type + '</type>');
								}
								for (let d = 0; d < comp.dots; d++) {
									xml.push(T + T + T + T + '<dot/>');
								}

								if (needsAccidental && note.pitch.accidental) {
									if (note.pitch.smufl) {
										xml.push(T + T + T + T + '<accidental smufl="' + note.pitch.smufl + '">' + note.pitch.accidental + '</accidental>');
									} else {
										xml.push(T + T + T + T + '<accidental>' + note.pitch.accidental + '</accidental>');
									}
								}

								// Úprava dĺžky pre triolky.
								if (triplet) {
									xml.push(T + T + T + T + '<time-modification>');
									xml.push(T + T + T + T + T + '<actual-notes>' + triplet.normalNotes + '</actual-notes>');
									xml.push(T + T + T + T + T + '<normal-notes>' + triplet.actualNotes + '</normal-notes>');
									xml.push(T + T + T + T + '</time-modification>');
								}

								xml.push(T + T + T + T + '<staff>1</staff>');

								// Kosoštvorcová hlavička noty pre aktívne parciály (parciál, ktorý užívateľ umiestnil do mriežky).
								if (note.isActivePartial) {
									xml.push(T + T + T + T + '<notehead>diamond</notehead>');
								}

								// Notácie (viazania, n-oly, anotácie centov).
								var hasNotations = tieStart || tieStop || (triplet && isVeryFirstChunk) || (note.pitch.cents !== 0 && isVeryFirstChunk);
								if (hasNotations) {
									xml.push(T + T + T + T + '<notations>');
									if (tieStop) xml.push(T + T + T + T + T + '<tied type="stop"/>');
									if (tieStart) xml.push(T + T + T + T + T + '<tied type="start"/>');
									if (triplet && isVeryFirstChunk) {
										xml.push(T + T + T + T + T + '<tuplet type="start"/>');
									}
									if (triplet && isVeryLastChunk) {
										xml.push(T + T + T + T + T + '<tuplet type="stop"/>');
									}
									// Anotácia odchýlky v centoch.
									if (note.pitch.cents !== 0 && isVeryFirstChunk) {
										var centStr = (note.pitch.cents > 0 ? '+' : '') + note.pitch.cents + '¢';
										xml.push(T + T + T + T + T + '<technical>');
										xml.push(T + T + T + T + T + T + '<other-technical>' + centStr + '</other-technical>');
										xml.push(T + T + T + T + T + '</technical>');
									}
									xml.push(T + T + T + T + '</notations>');
								}

								xml.push(T + T + T + '</note>');
								isFirstInChord = false;
							}

							tickPos += comp.ticks;
						}
					}
				}

				if (m === totalMeasures - 1) {
					xml.push(T + T + T + '<barline location="right">');
					xml.push(T + T + T + T + '<bar-style>light-heavy</bar-style>');
					xml.push(T + T + T + '</barline>');
				}

				xml.push(T + T + '</measure>');
			}

			xml.push(T + '</part>');
		}

		xml.push('</score-partwise>');

		var xmlStr = xml.join('\n');
		var blob = new Blob([xmlStr], { type: 'application/vnd.recordare.musicxml+xml' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = filename + '.musicxml';
		document.body.appendChild(a);
		a.click(); // HTML hack
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		Logger.log('MusicXML export complete: ' + processedNotes.length + ' notes, ' + trackIndices.length + ' parts, ' + edo + 'EDO');

	  } catch (err) {
		Logger.log('MusicXML export failed: ' + err.message);
		showStatus('MusicXML export failed: ' + err.message, { type: 'error' });
	  }
	}
};

// Klávesová skratka (Ctrl+Shift+E) na otvorenie exportného okna.
document.addEventListener('keydown', e => {
	// Nespúšťa sa pri písaní do vstupných polí.
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
	if (e.ctrlKey && e.shiftKey && e.key === 'E') {
		e.preventDefault();
		var UI = window.UI;
		if (UI?.export?.open) UI.export.open();
	}
});