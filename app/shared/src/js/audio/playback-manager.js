// Audio playback, worklet rieši aditívnu syntézu, momentálne 128 hlasov po 64 parciálov.
// V prvých verziách bol daný prístup prakticky nemožný skrz syntetizátory so statickou farbou,
// v súčasnosti je ponechaný ako jeden z prístupov v prípade, ak worklet nefunguje.
// Spúšťa sa každý snímok z Canvas.step() na spustenie a zastavenie nôt podľa pozície playback.time
// N_TIME, N_DUR, N_PITCH, N_PARTIAL, N_DATA, DEFAULT_VELOCITY pochádzajú z config.js
// note2freq pochádza z util.js
// DynamicTimbre poskytuje voliteľný modul (ak je prítomný, načíta sa skôr).

var PlaybackManager = {
	activeNotes: new Map(), // atribút: "track-noteIndex", hodnota: { freq, startTime, voiceId, trackIdx, ... }

	wasPlaying: false,
	lastPlaybackTime: -1, // Pozícia na zistenie skoku.

	workletNode: null,
	workletReady: false,
	workletInitializing: false,
	workletInitFailed: false,
	_workletInitPromise: null,
	stereoGain: null,

	// dáta aktívnych parciálov na vizualizáciu, aktualizované zo správ workletu
	// pole { voiceId, trackIdx, partialIdx, freq, amp, pan }
	activePartials: [],
	voiceCount: 0,

	// Spätná kompatibilita, alias pre Spatial Imager, ktorý číta additiveSynths; poskytuje rovnaké rozhranie, aké vizualizácia očakáva, a napĺňa sa z activePartials.
	additiveSynths: [],

	// Kompenzácia latencie zvuku v sekundách.
	audioLatency: 0,
	latencyMeasured: false,

	setLatency: (ms) => {
		PlaybackManager.audioLatency = ms / 1000;
		Logger.log(`Audio latency set to ${ms}ms`);
	},

	getLatency: () => {
		return Math.round(PlaybackManager.audioLatency * 1000);
	},

	// Zmeranie a uloženie latencie zvuku z Web Audio API
	// hodnota je len čiastočne spoľahlivá.
	measureLatency: () => {
		if (PlaybackManager.latencyMeasured) return;

		if (typeof window !== 'undefined' && typeof window.AUDIO_LATENCY_OVERRIDE === 'number' && window.AUDIO_LATENCY_OVERRIDE !== null) {
			PlaybackManager.audioLatency = window.AUDIO_LATENCY_OVERRIDE;
			PlaybackManager.latencyMeasured = true;
			Logger.log(`Audio latency: using manual override ${Math.round(window.AUDIO_LATENCY_OVERRIDE * 1000)}ms`);
			return;
		}

		if (typeof Tone === 'undefined') return;

		try {
			var ctx = Tone.context.rawContext || Tone.context;
			var baseLatency = ctx.baseLatency || 0;
			var outputLatency = ctx.outputLatency || 0;
			// 15 ms rezerva.
			PlaybackManager.audioLatency = baseLatency + outputLatency + 0.015;
			PlaybackManager.latencyMeasured = true;
			Logger.log(`Audio latency compensation: ${Math.round(PlaybackManager.audioLatency * 1000)}ms`);
		} catch (e) {
			PlaybackManager.audioLatency = 0.05;
			PlaybackManager.latencyMeasured = true;
			Logger.log('Audio latency: using 50ms default');
		}
	},

	// [ZDROJ] W3C. Web Audio API [online]. W3C Recommendation, 17. 6. 2021 [cit. 2026-07-30]. Dostupné z:
	//   https://www.w3.org/TR/2021/REC-webaudio-20210617/
	initWorklet: async () => {
		if (PlaybackManager.workletReady || PlaybackManager.workletInitFailed) return;
		if (PlaybackManager.workletInitializing) return PlaybackManager._workletInitPromise;
		if (typeof Tone === 'undefined') return;

		// Nezačína sa, kým audio context nebeží, nakoľko vyžaduje interakciu užívateľa.
		if (Tone.context.state !== 'running') return;

		// Nezačína sa, až kým nie je pripravený masterLimiter.
		if (!window.masterLimiter) return;

		PlaybackManager.workletInitializing = true;

		PlaybackManager._workletInitPromise = (async () => {
		try {
			// Uprednostní sa globálne uložený context z loadSynths kvôli konzistentnosti.
			var ctx = window.nativeAudioContext;

			if (!ctx) {
				// V opačnom prípade sa native context získa z Tone.js
				// reťazec podmienok je nutný, nakoľko Tone.js ukladá context na nepredvídateľné miesta.
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
			}


			// Načítanie modulu workletu, skúša sa viacero spôsobov kvôli podpore vo viacerých prehliadačoch
			// umiestnenie additive-processor.js podľa aktuálne spusteného kódu.
			var baseUrl = new URL('./', window.location.href).href;
			var workletUrl;
			if (window.electronAPI?.isElectron) {
				// V desktopovej verzii je additive-processor.js skopírovaný do desktop/app/ vedľa index.html
				// trik na vynútenie najnovšej verzie súboru.
				workletUrl = new URL('additive-processor.js?v=' + Date.now(), baseUrl).href;
			} else {
				// Vo verzii pre prehliadač je worklet v shared/src/js/audio/
				// v júli 2026 som podporu pre prehliadač zrušil, ponechávam ju však pre prípad, že by som sa ju v budúcnosti rozhodol vrátiť naspäť.
				workletUrl = new URL('shared/src/js/audio/additive-processor.js?v=' + Date.now(), baseUrl).href;
			}

			var workletLoaded = false;

			// Metóda 1, štandardné načítanie modulu.
			try {
				Logger.log('Trying worklet URL:', workletUrl);
				await ctx.audioWorklet.addModule(workletUrl);
				workletLoaded = true;
			} catch (e1) {
				Logger.warn('Standard worklet load failed:', e1.name, e1.message);

				// Metóda 2, fetch a načítanie ako blob.
				try {
					Logger.log('Fetching worklet code...');
					var response = await fetch(workletUrl);
					Logger.log('Fetch response:', response.status, response.ok);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					var code = await response.text();
					Logger.log('Worklet code length:', code.length, 'chars');
					var blob = new Blob([code], { type: 'application/javascript' });
					var blobUrl = URL.createObjectURL(blob);
					Logger.log('Trying blob URL:', blobUrl);
					await ctx.audioWorklet.addModule(blobUrl);
					URL.revokeObjectURL(blobUrl);
					workletLoaded = true;
					Logger.log('Worklet loaded via blob URL fallback');
				} catch (e2) {
					Logger.warn('Blob fallback failed:', e2.name, e2.message);
				}
			}

			if (!workletLoaded) {
				throw new Error('All worklet loading methods failed');
			}

			PlaybackManager.workletNode = new AudioWorkletNode(ctx, 'additive-processor', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2] // Stereo výstup
			});

			var stereoGain = ctx.createGain();
			stereoGain.channelCount = 2;
			stereoGain.channelCountMode = 'explicit';
			stereoGain.channelInterpretation = 'speakers';
			PlaybackManager.stereoGain = stereoGain;

			PlaybackManager.workletNode.connect(stereoGain);

			// Pripojenie priamo na native master bus (zdieľaný Tone.js + workletom)
			// do hlavného merača sa tak dostane takmer celý audio signál.
			var nativeMasterBus = window.nativeMasterBus;
			var connected = false;

			if (nativeMasterBus) {
				try {
					stereoGain.connect(nativeMasterBus);
					connected = true;
					Logger.log('Worklet connected to native master bus (meter will work)');
				} catch (e) {
					Logger.warn('Native master bus connect failed:', e.message);
				}
			}

			if (!connected) {
				stereoGain.connect(ctx.destination);
				Logger.warn('Worklet connected to destination (meter may not work)');

				// Ďalší pokus o pripojenie ak bude master bus k dispozícii.
				var reconnectInterval = setInterval(() => {
					var bus = window.nativeMasterBus;
					if (bus && PlaybackManager.stereoGain) {
						try {
							PlaybackManager.stereoGain.disconnect();
							PlaybackManager.stereoGain.connect(bus);
							Logger.log('Worklet reconnected to native master bus');
							clearInterval(reconnectInterval);
						} catch (e) {
							// Stále nie je pripravený, opätovne sa pripojenie vyskúša.
						}
					}
				}, 100);

				setTimeout(() => clearInterval(reconnectInterval), 5000);
			}

			PlaybackManager.workletNode.port.onmessage = (e) => {
				var msg = e.data;
				if (msg.type === 'visualization') {
					PlaybackManager.activePartials = msg.partials || [];
					PlaybackManager.voiceCount = msg.voiceCount || 0;

					// Aktualizácia staršieho poľa additiveSynths kvôli kompatibilite so Spatial Imagerom.
					PlaybackManager._updateLegacyVisualization();
				} else if (msg.type === 'panic') {
					PlaybackManager.activePartials = [];
					PlaybackManager.additiveSynths = [];
				}
			};

			PlaybackManager.workletReady = true;
			PlaybackManager.workletInitializing = false;
			Logger.log('AudioWorklet initialized for additive synthesis (stereo, 128 voices x 64 partials)');

		} catch (e) {
			Logger.error('Failed to initialize AudioWorklet:', e);
			PlaybackManager.workletInitializing = false;
			PlaybackManager.workletInitFailed = true;
		}
		})();

		return PlaybackManager._workletInitPromise;
	},

	_updateLegacyVisualization: () => {
		PlaybackManager.additiveSynths = PlaybackManager.activePartials.map(p => ({
			inUse: true,
			noteKey: p.voiceId,
			trackIdx: p.trackIdx,
			partialIdx: p.partialIdx,
			currentPan: p.pan,
			currentAmp: p.amp,
			gain: { gain: { value: p.amp } } // Predpripravený zisk z Tone.js.
		}));
	},

	_resetPlayingStates: () => {
		var MIDI = window.MIDI;
		if (!MIDI?.data) return;

		for (let i = 0; i < MIDI.data.length; i++) {
			if (!MIDI.data[i]) continue;
			for (let j = 0; j < MIDI.data[i].length; j++) {
				if (MIDI.data[i][j] && MIDI.data[i][j][N_DATA]) {
					MIDI.data[i][j][N_DATA].playing = false;
				}
			}
		}

		PlaybackManager.activeNotes.clear();
	},


	needsAdditiveSynth: (trackIdx) => {
		var instruments = window.instruments;
		var spectra = window.spectra;
		if (!instruments || !instruments[trackIdx]) return false;
		if (!spectra) return false;

		var timbre = spectra[instruments[trackIdx].spectrum];
		if (!timbre) return false;

		var hasValidData = (timbre.keypoints && timbre.keypoints.length > 0) ||
			(timbre.data && timbre.data.length > 0);

		return hasValidData;
	},

	getPartialsForPlayback: (trackIdx, note) => {
		var instruments = window.instruments;
		var spectra = window.spectra;
		if (!instruments || !instruments[trackIdx]) return null;
		if (!spectra) return null;

		var timbre = spectra[instruments[trackIdx].spectrum];
		if (!timbre) return null;

		var notePitch = note[N_PITCH];
		// Pri načítanom module DynamicTimbre sa farba interpoluje, inak getTimbrePartials vráti najbližší keypoint.
		if (typeof DynamicTimbre !== 'undefined') {
			return DynamicTimbre.getPartialsAtPitch(timbre, notePitch);
		}
		// Zvláda formát .data aj .keypoints, v najhoršom prípade sa uloží sínus.
		return typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, notePitch) : (timbre.data || [[1, 1]]);
	},

	triggerAdditive: (trackIdx, noteIdx, note, velocity, now, noteOffset = 0, releaseStartTime = 0, noteStart = 0, remainingTime = 0, releaseTime = 0) => {
		if (!PlaybackManager.workletNode || !PlaybackManager.workletReady) return null;

		var voiceId = `${trackIdx}-${noteIdx}`;
		var partialsData = PlaybackManager.getPartialsForPlayback(trackIdx, note);
		if (!partialsData || partialsData.length === 0) return null;

		var notePitch = note[N_PITCH];
		var activePartial = note[N_PARTIAL] || 1;
		var noteFreq = note2freq(notePitch);

		var instruments = window.instruments;
		var spectra = window.spectra;
		var timbre = spectra?.[instruments?.[trackIdx]?.spectrum];

		var activePartialRatio = partialsData[activePartial - 1] ? partialsData[activePartial - 1][0] : 1;
		var fundamentalFreq = noteFreq / activePartialRatio;

		var trackPan = instruments?.[trackIdx]?.pan || 0;

		var defaultEnv = typeof Envelope !== 'undefined'
			? Envelope.getForPartial(timbre, 1)
			: { a: 0.005, d: 0, s: 1, r: 0.05 }; // Krátky nábeh a doznenie.

		var partials = [];
		for (let i = 0; i < partialsData.length; i++) {
			var partial = partialsData[i];
			if (!partial) continue;
			var partialRatio = partial[0];
			var partialAmp = partial[1];
			var partialFreq = fundamentalFreq * partialRatio;

			// Parciály mimo počuteľného rozsahu sa preskočia.
			if (partialFreq > 20000 || partialFreq < 20 || partialAmp < 0.001) continue;

			var partialPan = 0;
			if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan) {
				partialPan = DynamicTimbre.partialPan.getPanForPartial(i, partialsData.length, timbre);
			}

			var finalPan;
			if (partialPan >= 0) {
				finalPan = trackPan + partialPan * (1 - trackPan);
			} else {
				finalPan = trackPan + partialPan * (1 + trackPan);
			}
			finalPan = Math.max(-1, Math.min(1, finalPan));

			var partialEnv = typeof Envelope !== 'undefined'
				? Envelope.getForPartial(timbre, i + 1)
				: defaultEnv;

			partials.push({
				freq: partialFreq,
				amp: partialAmp,
				pan: finalPan,
				env: {
					a: partialEnv.a || 0.005,
					d: partialEnv.d || 0,
					s: partialEnv.s !== undefined ? partialEnv.s : 1,
					r: partialEnv.r || 0.05
				}
			});
		}

		if (partials.length === 0) return null;

		// Získanie hlasitosti konkrétnej stopy a prevod dB na lineárnu hodnotu.
		var trackVolumeDb = instruments?.[trackIdx]?.volume || 0;
		var trackVolumeLinear = Math.pow(10, trackVolumeDb / 20);

		// Výpočet, kedy začína doznenie vzhľadom na začiatok noty
		// Spectra sa od tradičných sekvencerov líši aj v tom, ako sa počíta doznenie
		// v Spectre celá nota zahŕňa obálku ADSR, a z toho dôvodu sa počíta releaseOffset
		// štandardný spôsob výpočtu sa vyskúšal, avšak tento sa pri práci ukázal ako intuitívnejší: dĺžka noty ostáva pevná a nábeh s doznením sa stávajú súčasťou celku
		// parciály môžu mať vlastné amplitúdy nezávisle od amplitúdy pôvodnej noty.
		var releaseOffset = releaseStartTime - noteStart;

		var noteDuration = noteOffset + remainingTime;

		// Odošle sa do workletu, každý parciál s vlastnou obálkou.
		PlaybackManager.workletNode.port.postMessage({
			type: 'noteOn',
			voiceId: voiceId,
			partials: partials,
			velocity: velocity,
			trackIdx: trackIdx,
			trackVolume: trackVolumeLinear,
			trackPan: trackPan,
			envOffset: noteOffset,
			noteDuration: noteDuration
		});

		return voiceId;
	},

	releaseAdditive: (voiceId, now) => {
		if (!PlaybackManager.workletNode || !PlaybackManager.workletReady) return;

		PlaybackManager.workletNode.port.postMessage({
			type: 'noteOff',
			voiceId: voiceId
		});
	},

	// Spúšťa sa každý snímok z vykresľovacieho cyklu plátna.
	update: () => {
		var playback = window.playback;
		var MIDI = window.MIDI;
		var synths = window.synths;

		if (PlaybackManager.wasPlaying && !playback?.playing) {
			PlaybackManager.stopAll();
		}

		if (!PlaybackManager.wasPlaying && playback?.playing) {
			PlaybackManager._resetPlayingStates();
			Logger.log('PlaybackManager: Playback started, reset playing states');
		}

		PlaybackManager.wasPlaying = playback?.playing;


		if (!playback?.playing) return;

		if (!PlaybackManager.workletReady && !PlaybackManager.workletInitializing) {
			PlaybackManager.initWorklet();
		}

		if (!PlaybackManager.latencyMeasured) {
			PlaybackManager.measureLatency();
		}

		var now = Tone.now();
		var currentTime = playback.time;
		// Rýchlosť prehrávania. Pri 2x rýchlosti sa playback.time posúva 2x rýchlejšie za jednu skutočnú sekundu,
		// takže latencia v reálnych sekundách sa premietne ako latencia*speed v čase skladby.
		var speed = (typeof settings !== 'undefined' && settings.playbackSpeed) || 1;
		var triggerTime = currentTime + PlaybackManager.audioLatency * speed;

		// Skok a posun hlavy prehrávania sa zistí tak, že ak pozícia skočila dozadu alebo dopredu o viac než
		// očakávanú deltu medzi jednotlivými snímkami, spustí sa panic workletu na zastavenie zvyšných hlasov.
		if (PlaybackManager.lastPlaybackTime >= 0) {
			var expectedDelta = speed / 30;
			var actualDelta = currentTime - PlaybackManager.lastPlaybackTime;
			if (actualDelta < -0.01 || actualDelta > expectedDelta * 3) {
				if (PlaybackManager.workletNode && PlaybackManager.workletReady) {
					PlaybackManager.workletNode.port.postMessage({ type: 'panic' });
				}
				PlaybackManager._resetPlayingStates();
			}
		}
		PlaybackManager.lastPlaybackTime = currentTime;

		// Čistenie nôt
		// rieši presun nôt, zmenu stôp aj zmenu samotných nôt počas prehrávania.
		if (MIDI?.data) {
			var notesToCleanup = [];
			for (const [noteKey, activeNote] of PlaybackManager.activeNotes) {
				const [trackIdx, noteIdx] = noteKey.split('-').map(Number);
				var track = MIDI.data[trackIdx];
				if (!track || !track[noteIdx]) {
					notesToCleanup.push({ noteKey, reason: 'left' });
					continue;
				}
				const note = track[noteIdx];
				const noteStart = note[N_TIME];
				const noteEnd = noteStart + note[N_DUR];

				if (triggerTime < noteStart || triggerTime >= noteEnd) {
					notesToCleanup.push({ noteKey, reason: 'moved' });
					if (note[N_DATA]) {
						note[N_DATA].playing = false;
					}
					continue;
				}

				const notePitch = note[N_PITCH];
				const partial = note[N_PARTIAL] || 1;
				if (activeNote.pitch !== notePitch || activeNote.partial !== partial) {
					if (activeNote.useAdditive) {
						notesToCleanup.push({ noteKey, reason: 'pitch_changed' });
						if (note[N_DATA]) {
							note[N_DATA].playing = false;
						}
					} else if (synths[activeNote.trackIdx]) {
						synths[activeNote.trackIdx].triggerRelease(activeNote.freq, now);
						if (note[N_DATA]) {
							note[N_DATA].playing = false;
						}
						PlaybackManager.activeNotes.delete(noteKey);
					}
				}
			}

			for (const { noteKey, reason } of notesToCleanup) {
				const activeNote = PlaybackManager.activeNotes.get(noteKey);
				if (activeNote) {
					if (activeNote.useAdditive) {
						if (reason !== 'moved') {
							PlaybackManager.releaseAdditive(noteKey, now);
						}
					} else if (synths[activeNote.trackIdx]) {
						synths[activeNote.trackIdx].triggerRelease(activeNote.freq, now);
					}
					PlaybackManager.activeNotes.delete(noteKey);
				}
			}
		}

		if (!MIDI?.data) return;

		var notesToTrigger = [];
		var notesToRelease = [];

		for (let trackIdx = 0; trackIdx < MIDI.data.length; trackIdx++) {
			if (!synths[trackIdx]) continue;

			var useAdditive = PlaybackManager.needsAdditiveSynth(trackIdx);

			// Dáta obálky sa cachujú pre stopu mimo cyklu cez noty.
			var trackMaxRelease = 0.005;
			if (useAdditive) {
				var instruments = window.instruments;
				var spectra = window.spectra;
				var timbre = spectra?.[instruments?.[trackIdx]?.spectrum];
				if (typeof Envelope !== 'undefined' && timbre) {
					var defaultEnv = Envelope.getForPartial(timbre, 1);
					trackMaxRelease = defaultEnv.r || 0.005;
					if (timbre.partialEnvelopes) {
						for (const idx of Object.keys(timbre.partialEnvelopes)) {
							var r = timbre.partialEnvelopes[idx].r;
							if (r > trackMaxRelease) trackMaxRelease = r;
						}
					}
				}
			}

			for (let noteIdx = 0; noteIdx < MIDI.data[trackIdx].length; noteIdx++) {
				const note = MIDI.data[trackIdx][noteIdx];
				const noteStart = note[N_TIME]; // N_TIME a podobne sú konštanty na vyhľadávanie, keďže prístup do poľa je kompaktnejší než do objektu.
				var noteDuration = note[N_DUR];
				const noteEnd = noteStart + noteDuration;

				if (noteEnd + trackMaxRelease * speed + 0.5 < triggerTime || noteStart > triggerTime + 0.5) {
					continue;
				}

				const notePitch = note[N_PITCH];
				const partial = note[N_PARTIAL];

				if (!note[N_DATA]) {
					note[N_DATA] = { playing: false, velocity: DEFAULT_VELOCITY };
				}
				const noteData = note[N_DATA];

				var safePartial = partial || 1;
				// Vyhľadanie skutočného pomeru parciálu z dát spektra kvôli presnej frekvencii
				// celé čísla parciálu platia len pre harmonické farby.
				var partialRatio = safePartial;
				if (useAdditive) {
					var partialsData = PlaybackManager.getPartialsForPlayback(trackIdx, note);
					if (partialsData && partialsData[safePartial - 1]) {
						partialRatio = partialsData[safePartial - 1][0];
					}
				}
				var freq = note2freq(notePitch) / partialRatio;
				const noteKey = `${trackIdx}-${noteIdx}`;

				// Dĺžka doznenia je vypočítaná vyššie pre celú stopu.
				var releaseTime = trackMaxRelease;

				// releaseTime je v reálnych sekundách, na jednotky prehrávania sa prevedie vynásobením rýchlosťou.
				var releaseStartTime = Math.max(noteStart + 0.01, noteEnd - releaseTime * speed);
				var shouldTrigger = triggerTime >= noteStart && triggerTime < noteEnd;
				var shouldRelease = triggerTime >= releaseStartTime && triggerTime < noteEnd + 0.1 * speed;
				var isPlaying = noteData.playing === true;

				if (shouldTrigger && !isPlaying) {
					var noteOffset = Math.max(0, (triggerTime - noteStart) / speed);
					// Zistenie, či sa začína v akejkoľvek časti doznenia.
					var startedInRelease = triggerTime >= releaseStartTime;
					// Výpočet zvyšného času do vizuálneho konca noty v reálnych sekundách.
					var remainingTime = Math.max(0, (noteEnd - triggerTime) / speed);
					// Skutočná vizuálna dĺžka doznenia v sekundách.
					var actualReleaseDuration = (noteEnd - releaseStartTime) / speed;
					notesToTrigger.push({
						trackIdx, noteIdx, note, noteData, freq, noteKey, useAdditive,
						pitch: notePitch, partial: safePartial, noteOffset, releaseStartTime, noteStart, noteEnd, startedInRelease, remainingTime, actualReleaseDuration
					});
				}
				else if (shouldRelease && isPlaying) {
					notesToRelease.push({
						trackIdx, noteIdx, note, noteData, freq, noteKey, useAdditive, noteEnd
					});
				}
			}
		}

		// Spracovanie note-on
		for (const n of notesToTrigger) {
			n.noteData.playing = true;
			n.noteData.playbackNote = n.freq;
			n.noteData.oscOnSent = false;
			n.noteData.oscOffSent = false;
			n.noteData.noteStart = n.noteStart;
			n.noteData.noteEnd = n.noteEnd;

			var velocity = n.noteData.velocity !== undefined ? n.noteData.velocity / 127 : 0.8; // Často sa používa velocity 100, hodnota 101.6 je dostatočne blízko.

			if (!synths[n.trackIdx]) {
				Logger.warn(`PlaybackManager: No synth for track ${n.trackIdx}, skipping note`);
				continue;
			}

			if (n.useAdditive && PlaybackManager.workletReady) {
				var voiceId = PlaybackManager.triggerAdditive(n.trackIdx, n.noteIdx, n.note, velocity, now, n.noteOffset || 0, n.releaseStartTime || 0, n.noteStart || 0, n.remainingTime || 0, n.actualReleaseDuration || 0);
				if (voiceId) {
					PlaybackManager.activeNotes.set(n.noteKey, {
						freq: n.freq,
						pitch: n.pitch,
						partial: n.partial,
						trackIdx: n.trackIdx,
						startTime: currentTime,
						useAdditive: true,
						voiceId: voiceId,
						startedInRelease: n.startedInRelease || false
					});
				} else {
					try {
						synths[n.trackIdx].triggerAttack(n.freq, now, velocity);
					} catch (e) {
						Logger.error(`PlaybackManager: triggerAttack failed for track ${n.trackIdx}:`, e.message);
					}
					PlaybackManager.activeNotes.set(n.noteKey, {
						freq: n.freq,
						pitch: n.pitch,
						partial: n.partial,
						trackIdx: n.trackIdx,
						startTime: currentTime,
						useAdditive: false,
						startedInRelease: n.startedInRelease || false
					});
				}
			} else {
				try {
					synths[n.trackIdx].triggerAttack(n.freq, now, velocity);
				} catch (e) {
					Logger.error(`PlaybackManager: triggerAttack failed for track ${n.trackIdx}:`, e.message);
				}
				PlaybackManager.activeNotes.set(n.noteKey, {
					freq: n.freq,
					pitch: n.pitch,
					partial: n.partial,
					trackIdx: n.trackIdx,
					startTime: currentTime,
					useAdditive: false,
					startedInRelease: n.startedInRelease || false
				});
			}

			// OSC note-on sa odošle podľa vizuálneho času.
			if (currentTime >= n.noteStart && !n.noteData.oscOnSent) {
				n.noteData.oscOnSent = true;
				const OSC = window.OSC;
				if (OSC?.send) {
					OSC.send.noteOn(n.trackIdx, n.note);
				}
			}
		}

		// OSC note-on sa odošle pre noty, ktoré hrajú, ale OSC signál ešte nedostali
		// rieši prípad, keď sa zvuk spustil skôr než samotný prehrávač.
		if (MIDI?.data) {
			for (let trackIdx = 0; trackIdx < MIDI.data.length; trackIdx++) {
				for (let noteIdx = 0; noteIdx < MIDI.data[trackIdx].length; noteIdx++) {
					const note = MIDI.data[trackIdx][noteIdx];
					const noteData = note[N_DATA];
					if (noteData?.playing && !noteData.oscOnSent && noteData.noteStart !== undefined) {
						if (currentTime >= noteData.noteStart) {
							noteData.oscOnSent = true;
							const OSC = window.OSC;
							if (OSC?.send) {
								OSC.send.noteOn(trackIdx, note);
							}
						}
					}
				}
			}
		}

		// Spracovanie jednotlivých note-off signálov.
		for (const n of notesToRelease) {
			const activeNote = PlaybackManager.activeNotes.get(n.noteKey);

			// OSC noteOff sa odošle podľa vizuálneho času (currentTime).
			if (currentTime >= n.noteEnd && !n.noteData.oscOffSent) {
				n.noteData.oscOffSent = true;
				const OSC = window.OSC;
				if (OSC?.send) {
					OSC.send.noteOff(n.trackIdx, n.note);
				}
			}

			if (activeNote?.startedInRelease || activeNote?.released) {
				continue;
			}

			if (activeNote) {
				if (activeNote.useAdditive) {
					// Worklet rieši doznenie interne cez releaseStartTime.
				} else {
					synths[n.trackIdx].triggerRelease(activeNote.freq, now);
				}
				// Zabraňuje opätovnému spusteniu a duplicitným spusteniam doznenia v Tone.js.
				activeNote.released = true;
			} else {
				// Ak activeNote neexistuje, nie je nutné spustiť triggerRelease, pretože môže ísť o notu z aditívnej syntézy.
				n.noteData.playing = false;
			}
		}

		// OSC note-off sa odošle pre noty, ktoré už skončili, ale ešte nemali odoslaný OSC off.
		if (MIDI?.data) {
			for (let trackIdx = 0; trackIdx < MIDI.data.length; trackIdx++) {
				for (let noteIdx = 0; noteIdx < MIDI.data[trackIdx].length; noteIdx++) {
					const note = MIDI.data[trackIdx][noteIdx];
					const noteData = note[N_DATA];
					if (noteData?.oscOnSent && !noteData.oscOffSent && noteData.noteEnd !== undefined) {
						if (currentTime >= noteData.noteEnd) {
							noteData.oscOffSent = true;
							const OSC = window.OSC;
							if (OSC?.send) {
								OSC.send.noteOff(trackIdx, note);
							}
						}
					}
				}
			}
		}
	},

	stopAll: () => {
		var now = Tone.now();
		var synths = window.synths;
		var MIDI = window.MIDI;

		if (PlaybackManager.workletNode && PlaybackManager.workletReady) {
			PlaybackManager.workletNode.port.postMessage({ type: 'panic' });
		}

		for (const [noteKey, noteInfo] of PlaybackManager.activeNotes) {
			if (!noteInfo.useAdditive && synths?.[noteInfo.trackIdx]) {
				synths[noteInfo.trackIdx].triggerRelease(noteInfo.freq, now);
			}
		}
		PlaybackManager.activeNotes.clear();

		if (MIDI?.data) {
			for (let i = 0; i < MIDI.data.length; i++) {
				if (synths?.[i]) {
					synths[i].releaseAll(now);
				}

				for (let j = 0; j < MIDI.data[i].length; j++) {
					if (MIDI.data[i][j][N_DATA]) {
						MIDI.data[i][j][N_DATA].playing = false;
					}
				}
			}
		}

		PlaybackManager.activePartials = [];
		PlaybackManager.additiveSynths = [];

		var WebMIDI = window.WebMIDI;
		if (WebMIDI?.sendPanic) {
			WebMIDI.sendPanic();
		}
	},

	stopNote: (trackIdx, noteIdx) => {
		var noteKey = `${trackIdx}-${noteIdx}`;
		var activeNote = PlaybackManager.activeNotes.get(noteKey);
		var synths = window.synths;
		var MIDI = window.MIDI;

		if (activeNote) {
			var now = Tone.now();
			if (activeNote.useAdditive) {
				PlaybackManager.releaseAdditive(noteKey, now);
			} else if (synths?.[trackIdx]) {
				synths[trackIdx].triggerRelease(activeNote.freq, now);
			}
			PlaybackManager.activeNotes.delete(noteKey);
		}

		if (MIDI?.data[trackIdx]?.[noteIdx]?.[N_DATA]) {
			MIDI.data[trackIdx][noteIdx][N_DATA].playing = false;
		}
	},

	stopTrack: (trackIdx) => {
		var now = Tone.now();
		var synths = window.synths;
		var MIDI = window.MIDI;

		if (synths?.[trackIdx]) {
			synths[trackIdx].releaseAll(now);
		}

		for (const [noteKey, noteInfo] of PlaybackManager.activeNotes) {
			if (noteInfo.trackIdx === trackIdx) {
				if (noteInfo.useAdditive) {
					PlaybackManager.releaseAdditive(noteKey, now);
				}
				PlaybackManager.activeNotes.delete(noteKey);
			}
		}

		if (MIDI?.data[trackIdx]) {
			for (let j = 0; j < MIDI.data[trackIdx].length; j++) {
				if (MIDI.data[trackIdx][j]?.[N_DATA]) {
					MIDI.data[trackIdx][j][N_DATA].playing = false;
				}
			}
		}
	},

	// Inak by poradie nesedelo.
	reindexAfterTrackDelete: (deletedTrackIdx) => {
		var newActiveNotes = new Map();

		for (const [noteKey, noteInfo] of PlaybackManager.activeNotes) {
			var [trackIdxStr, noteIdxStr] = noteKey.split('-');
			var trackIdx = parseInt(trackIdxStr);
			var noteIdx = parseInt(noteIdxStr);

			if (trackIdx === deletedTrackIdx) {
				continue;
			}

			if (trackIdx > deletedTrackIdx) {
				var newTrackIdx = trackIdx - 1;
				var newKey = `${newTrackIdx}-${noteIdx}`;
				newActiveNotes.set(newKey, {
					...noteInfo,
					trackIdx: newTrackIdx
				});
			} else {
				newActiveNotes.set(noteKey, noteInfo);
			}
		}

		PlaybackManager.activeNotes = newActiveNotes;
	},

	retriggerTrack: (trackIdx) => {
		var playback = window.playback;
		if (!playback?.playing) return;

		var now = Tone.now();
		var synths = window.synths;
		var MIDI = window.MIDI;

		if (synths?.[trackIdx]) {
			synths[trackIdx].releaseAll(now);
		}

		for (const [noteKey, noteInfo] of PlaybackManager.activeNotes) {
			if (noteInfo.trackIdx === trackIdx) {
				if (noteInfo.useAdditive) {
					PlaybackManager.releaseAdditive(noteKey, now);
				}
				PlaybackManager.activeNotes.delete(noteKey);
			}
		}

		if (MIDI?.data[trackIdx]) {
			for (let j = 0; j < MIDI.data[trackIdx].length; j++) {
				if (MIDI.data[trackIdx][j][N_DATA]) {
					MIDI.data[trackIdx][j][N_DATA].playing = false;
				}
			}
		}
	}
};
