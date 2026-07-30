// [ZDROJ] MATHEWS, Max V. The Digital Computer as a Musical Instrument. Science. 1963, roč. 142, č. 3592,
//   s. 553-557. DOI 10.1126/science.142.3592.553.

// AdditiveProcessor, AudioWorklet pre efektívnu aditívnu syntézu
// Predtým sa prehrávanie riešilo cez Tone.js, neskôr bolo nutné prejsť na nový systém, nakoľko bol výpočet na procesor nesmierne záťažový
// Prechod nebol triviálny, ale nutný kvôli tomu, aby bolo možné mať jednotlivým parciálom priradené samostatné obálky
// Navyše dynamické timbre, ktoré predstavujú farby interpolované naprieč celým rozsahom nástrojov, spôsobili to, že bolo nutné generovať každý parciál zvlášť a nie ako jeden syntetizátor so statickou farbou.

// AdditiveProcessor má stereo výstup s panorámou pre každý parciál zvlášť
// a komunikuje s hlavným vláknom skrz message port.


class AdditiveProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		// Vyhľadávacia tabuľka sínusových vĺn s 2048 bodmi
		// keďže Math.sin môže byť výpočtovo náročný, vyhľadávacia tabuľka je efektívnejšia.
		this.tableSize = 2048;
		this.sineTable = new Float32Array(this.tableSize);
		for (let i = 0; i < this.tableSize; i++) {
			this.sineTable[i] = Math.sin((i / this.tableSize) * 2 * Math.PI);
		}

		// Zbernica jednotlivých hlasov, označených na základe voiceId.
		this.voices = new Map();

		// Vlastnosti obálky (envelope).
		this.STATE_ATTACK = 0;
		this.STATE_DECAY = 1;
		this.STATE_SUSTAIN = 2;
		this.STATE_RELEASE = 3;
		this.STATE_OFF = 4;

		this.maxVoices = 64;
		this.maxPartialsPerVoice = 64;
		this.maxTotalPartials = 1500; // Globálny limit naprieč všetkými hlasmi, 1.5k je viac než dosť.

		this.ampSmooth = 0.005; // Rýchlejšie vyhladzovanie kvôli nižšej záťaži CPU.

		this.controlRate = 32;
		this.controlCounter = 0;

		this.port.onmessage = (e) => this.handleMessage(e.data);
	}

	// Bežne daný spôsob prístupu nie je potrebný, ale programátorsky čistejší a užitočný
	// v KSP by som použil _noteOn a podobné funkcie s podčiarkovníkom ako hlavné procesory a noteOn ako hlavnú funkciu,
	// avšak neskôr by bolo náročné sa v kóde orientovať.
	handleMessage(msg) {
		switch (msg.type) {
			case 'noteOn':
				this.noteOn(msg.voiceId, msg.partials,
					Number.isFinite(msg.velocity) ? msg.velocity : 1, // Poistka
					msg.trackIdx, msg.trackVolume, msg.trackPan, msg.envOffset || 0, msg.noteDuration || 1);
				break;
			case 'noteOff':
				this.noteOff(msg.voiceId);
				break;
			case 'updateTimbre':
				this.updateTimbre(msg.voiceId, msg.partials);
				break;
			case 'updateTrackVolume':
				this.updateTrackVolume(msg.trackIdx, msg.volume);
				break;
			case 'updateTrackPan':
				this.updateTrackPan(msg.trackIdx, msg.pan);
				break;
			case 'panic':
				this.voices.clear();
				this.port.postMessage({ type: 'panic' });
				break;
			case 'setMaxVoices':
				this.maxVoices = msg.value;
				break;
		}
	}

	noteOn(voiceId, partials, velocity, trackIdx, trackVolume, trackPan, envOffset = 0, noteDuration = 1) {
		// Po prekročení hlasov sa uvoľní priestor pre nový hlas (hlas nie v inštrumentálnom zmysle, ale ako tón).
		// Jednoduché FIFO by bolo postačujúce, avšak do budúcnosti bolo lepšie využiť spôsoby vypínania hlasov,
		// aby sa neriskoval vznik zvukových glitchov počas živého hrania a chodu softvéru všeobecne,
		// takže dead > stolen > releasing > fifo.
		if (this.voices.size >= this.maxVoices && !this.voices.has(voiceId)) {
			// Prvá fáza, vypnutie hlasov, ktoré je možné okamžite použiť. Opakovanie (loop) v cykle, nakoľko
			// séria noteOn správ môže dopadnúť pomedzi audio bloky
			// a je nutné zostať pod celkovým limitom súznejúcich hlasov.
			for (const [id, voice] of this.voices) {
				if (voice.allOff || voice.stolen) {
					this.voices.delete(id);
					if (this.voices.size < this.maxVoices) break;
				}
			}
			// Ak je súbor úplne plný, využije sa jeden z hlasov. Uprednostnené sú hlasy v štádiu doznenia,
			// neskôr najstarší aktívny, a namiesto okamžitého strihu sa okamžite stíši (fade).
			if (this.voices.size >= this.maxVoices) {
				let oldestId = null;
				let oldestTime = Infinity;
				for (const [id, voice] of this.voices) {
					if (voice.partials.every(p => p.state === this.STATE_RELEASE || p.state === this.STATE_OFF)) {
						oldestId = id;
						break;
					}
				}
				if (!oldestId) {
					for (const [id, voice] of this.voices) {
						if (voice.noteOnTime < oldestTime) {
							oldestTime = voice.noteOnTime;
							oldestId = id;
						}
					}
				}
				const stolen = oldestId !== null ? this.voices.get(oldestId) : null;
				if (stolen) {
					stolen.stolen = true;
					// Rýchly release, než by sa okamžite mazal.
					for (const partial of stolen.partials) {
						if (partial.state !== this.STATE_OFF) {
							partial.releaseAmp = this.getPartialEnvelopeLevel(partial);
							partial.state = this.STATE_RELEASE;
							partial.stateTime = 0;
							partial.env = { ...partial.env, r: 0.005 }; // 5 ms kvôli predídeniu kliku.
						}
					}
				}
			}
		}

		const limitedPartials = partials.slice(0, this.maxPartialsPerVoice);
		const audiblePartials = limitedPartials.filter(p =>
			p.freq > 20 && p.freq < 20000 && p.amp > 0.0001
		);

		if (audiblePartials.length === 0) return;

		// Fade in pre nábehy uprostred noty, aby sa predišlo kliku.
		const fadeInTime = 0.002; // 2 ms
		const startMidNote = envOffset > 0;

		const processedPartials = audiblePartials.map(p => {
			const env = p.env || { a: 0.005, d: 0, s: 1, r: 0.05 };
			const a = Number.isFinite(env.a) && env.a > 0 ? env.a : 0;
			const d = Number.isFinite(env.d) && env.d > 0 ? env.d : 0;
			const s = Number.isFinite(env.s) ? Math.max(0, Math.min(1, env.s)) : 1;
			const r = Number.isFinite(env.r) && env.r > 0 ? env.r : 0.05;

			// Začiatok doznenia, relatívne k začiatku noty
			// obmedzenie v prípade, ak je doznenie dlhšie ako nota.
			const minRelease = 0.005; // min. 5 ms fade, proti kliku.
			let releaseStartTime = Math.max(a + d, noteDuration - r);
			let effectiveR;

			// Táto časť bola doplnená neskôr, ale podľa dĺžky noty a miesta, kde sa spúšťa transport,
			// sa dĺžky nábehu a doznenia dopočítavajú.
			if (releaseStartTime >= noteDuration) {
				// Príliš krátke na plné A+D, doznenie začne skôr, aby aj tak doznel.
				releaseStartTime = Math.max(0, noteDuration - minRelease);
				effectiveR = noteDuration - releaseStartTime;
			} else {
				effectiveR = noteDuration - releaseStartTime;
			}

			// Kde má daný parciál začať v rámci svojej obálky.
			let state = this.STATE_ATTACK;
			let stateTime = 0;
			let releaseAmp = s;

			if (startMidNote) {
				// Je pozícia v rámci doznenia?
				const inRelease = envOffset >= releaseStartTime;

				if (inRelease) {
					const timeIntoRelease = envOffset - releaseStartTime;
					const releaseProgress = r > 0 ? Math.min(1, timeIntoRelease / r) : 1;
					const currentLevel = s * (1 - releaseProgress); // Amplitúda musí zodpovedať aktuálnej pozícii.

					state = this.STATE_RELEASE;
					stateTime = timeIntoRelease;
					releaseAmp = s; // Vychádza zo sustain, stateTime nesie priebeh.
				} else if (envOffset < a) {
					state = this.STATE_ATTACK;
					stateTime = envOffset;
				} else if (envOffset < a + d) {
					state = this.STATE_DECAY;
					stateTime = envOffset - a;
				} else {
					state = this.STATE_SUSTAIN;
					stateTime = 0;
				}
			}

			return {
				phase: Math.random() * this.tableSize, // Náhodná fáza predchádza konštruktívnej interferencii.
				freq: p.freq,
				// Vždy sa začína na targetAmp, tvarovanie amplitúdy rieši obálka.
				amp: p.amp * velocity * 0.15,
				targetAmp: p.amp * velocity * 0.15,
				pan: p.pan || 0,
				basePan: p.pan || 0, // Pôvodná panoráma sa uchová pre vypočítanie celkovej panorámy neskôr.
				// Obálka, dozvuk orezaný na dĺžku noty.
				env: { a, d, s, r: effectiveR },
				releaseStartTime: releaseStartTime,
				state: state,
				stateTime: stateTime,
				releaseAmp: releaseAmp
			};
		});

		const voice = {
			partials: processedPartials,
			noteOnTime: currentTime || 0,
			elapsedTime: envOffset, // Ako ďaleko sa spustenie nachádza vnútri noty.
			noteDuration: noteDuration,
			trackIdx: trackIdx || 0,
			trackVolume: trackVolume !== undefined ? trackVolume : 1,
			trackPan: trackPan || 0,
			fadeIn: startMidNote ? fadeInTime : 0, // Len pre spúšťanie uprostred noty, bežný nástup rieši ADSR.
			fadeInElapsed: 0,
			allOff: false
		};

		this.voices.set(voiceId, voice);
	}

	updateTrackVolume(trackIdx, volume) {
		for (const [id, voice] of this.voices) {
			if (voice.trackIdx === trackIdx) {
				voice.trackVolume = volume;
			}
		}
	}

	updateTrackPan(trackIdx, pan) {
		for (const [id, voice] of this.voices) {
			if (voice.trackIdx === trackIdx) {
				voice.trackPan = pan;
				// Absolútny pan = basePan + pan stopy, takže sa nemôže postupne posúvať.
				for (const partial of voice.partials) {
					partial.pan = Math.max(-1, Math.min(1, (partial.basePan || 0) + pan));
				}
			}
		}
	}

	noteOff(voiceId) {
		const voice = this.voices.get(voiceId);
		if (!voice) return;

		for (const partial of voice.partials) {
			if (partial.state === this.STATE_RELEASE || partial.state === this.STATE_OFF) continue;

			partial.releaseAmp = this.getPartialEnvelopeLevel(partial);
			partial.state = this.STATE_RELEASE;
			partial.stateTime = 0;
		}
	}

	updateTimbre(voiceId, partials) {
		const voice = this.voices.get(voiceId);
		if (!voice) return;

		const newPartials = partials.slice(0, this.maxPartialsPerVoice);

		const sanEnv = (env) => ({
			a: Number.isFinite(env.a) && env.a > 0 ? env.a : 0,
			d: Number.isFinite(env.d) && env.d > 0 ? env.d : 0,
			s: Number.isFinite(env.s) ? Math.max(0, Math.min(1, env.s)) : 1,
			r: Number.isFinite(env.r) && env.r > 0 ? env.r : 0.05
		});
		const sanFreq = (f) => (Number.isFinite(f) && f > 20 && f < 20000) ? f : null;
		const sanAmp = (a) => Number.isFinite(a) ? Math.max(0, a) : 0;

		for (let i = 0; i < Math.max(voice.partials.length, newPartials.length); i++) {
			if (i < newPartials.length && i < voice.partials.length) {
				// Aktualizácia existujúceho parciálu so zachovaním stavu obálky.
				const freq = sanFreq(newPartials[i].freq);
				if (freq === null) {
					// V prípade nepoužiteľnej frekvencie sa stlmí.
					voice.partials[i].targetAmp = 0;
					continue;
				}
				voice.partials[i].freq = freq;
				voice.partials[i].targetAmp = sanAmp(newPartials[i].amp) * 0.15;
				voice.partials[i].pan = newPartials[i].pan || 0;
				if (newPartials[i].env) {
					const updEnv = sanEnv(newPartials[i].env);
					voice.partials[i].env = updEnv;
					voice.partials[i].releaseStartTime = Math.max(updEnv.a + updEnv.d, voice.noteDuration - updEnv.r);
				}
			} else if (i < newPartials.length) {
				// Nový parciál s vlastnou obálkou.
				const freq = sanFreq(newPartials[i].freq);
				if (freq === null) continue;
				const env = sanEnv(newPartials[i].env || { a: 0.005, d: 0, s: 1, r: 0.05 });
				const releaseStartTime = Math.max(env.a + env.d, voice.noteDuration - env.r);
				voice.partials.push({
					phase: Math.random() * this.tableSize,
					freq: freq,
					amp: 0,
					targetAmp: sanAmp(newPartials[i].amp) * 0.15,
					pan: newPartials[i].pan || 0,
					basePan: newPartials[i].pan || 0,
					env: env,
					releaseStartTime: releaseStartTime,
					state: this.STATE_ATTACK,
					stateTime: 0,
					releaseAmp: env.s
				});
			} else {
				// Doznenie pre zvyšné parciály.
				voice.partials[i].targetAmp = 0;
			}
		}
	}

	// Úroveň obálky pre parciál (s podporou vlastnej obálky pre každý parciál).
	getPartialEnvelopeLevel(partial) {
		const env = partial.env;
		const t = partial.stateTime;

		switch (partial.state) {
			case this.STATE_ATTACK:
				if (env.a <= 0) return 1;
				const attackProgress = Math.min(1, t / env.a);
				// Preferujem kosínus pred lineárnym nábehom a dozvukom.
				return 0.5 * (1 - Math.cos(Math.PI * attackProgress));
			case this.STATE_DECAY: {
				if (env.d <= 0) return env.s;
				const decayProgress = Math.min(1, t / env.d);
				// Kosínusový pokles: plynulý prechod z 1 na úroveň sustainu.
				return 1 - (1 - env.s) * 0.5 * (1 - Math.cos(Math.PI * decayProgress));
			}
			case this.STATE_SUSTAIN:
				return env.s;
			case this.STATE_RELEASE: {
				if (env.r <= 0) return 0;
				const releaseProgress = Math.min(1, t / env.r);
				// Zdvihnutý kosínus, nulový sklon na konci, čistý fade.
				return partial.releaseAmp * 0.5 * (1 + Math.cos(Math.PI * releaseProgress));
			}
			default:
				return 0;
		}
	}

	updatePartialEnvelopeState(partial, dt) {
		const env = partial.env;
		partial.stateTime += dt;

		switch (partial.state) {
			case this.STATE_ATTACK:
				if (partial.stateTime >= env.a) {
					partial.state = this.STATE_DECAY;
					partial.stateTime = 0;
				}
				break;
			case this.STATE_DECAY:
				if (partial.stateTime >= env.d) {
					partial.state = this.STATE_SUSTAIN;
					partial.stateTime = 0;
				}
				break;
			case this.STATE_RELEASE:
				if (partial.stateTime >= env.r) {
					partial.state = this.STATE_OFF;
				}
				break;
		}
	}

	// Nahliadnutie na úroveň obálky na konci bloku, bez zmeny stavu
	// slúži na interpoláciu po jednotlivých vzorkách.

	_peekEnvelopeEnd(partial, dt) {
		const env = partial.env;
		const futureTime = partial.stateTime + dt;
		let state = partial.state;
		let t = futureTime;

		if (state === this.STATE_ATTACK && t >= env.a) {
			t = t - env.a;
			state = this.STATE_DECAY;
			if (t >= env.d) {
				t = 0;
				state = this.STATE_SUSTAIN;
			}
		} else if (state === this.STATE_DECAY && t >= env.d) {
			state = this.STATE_SUSTAIN;
			t = 0;
		}

		switch (state) {
			case this.STATE_ATTACK:
				if (env.a <= 0) return 1;
				return 0.5 * (1 - Math.cos(Math.PI * Math.min(1, t / env.a)));
			case this.STATE_DECAY:
				if (env.d <= 0) return env.s;
				return 1 - (1 - env.s) * 0.5 * (1 - Math.cos(Math.PI * Math.min(1, t / env.d)));
			case this.STATE_SUSTAIN:
				return env.s;
			case this.STATE_RELEASE:
				if (env.r <= 0) return 0;
				return partial.releaseAmp * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, t / env.r)));
			default:
				return 0;
		}
	}

	// Hlavná funkcia vytvárajúca zvukový výstup.
	process(inputs, outputs, parameters) {
		const output = outputs[0];
		if (!output || output.length < 2) return true;

		const leftChannel = output[0];
		const rightChannel = output[1];
		const numSamples = leftChannel.length;
		const invSampleRate = 1 / sampleRate;
		const tableSize = this.tableSize;
		const sineTable = this.sineTable;
		const dt = numSamples * invSampleRate;
		const tableSizeInv = invSampleRate * tableSize;
		const ampSmooth = this.ampSmooth;
		const halfPi = Math.PI * 0.5;

		leftChannel.fill(0);
		rightChannel.fill(0);

		if (!this._toRemove) this._toRemove = [];
		const toRemove = this._toRemove;
		toRemove.length = 0;

		// Počítanie aktívnych parciálov, aby sa systém nepreťažil.
		let totalPartials = 0;

		for (const [voiceId, voice] of this.voices) {
			if (voice.allOff) {
				toRemove.push(voiceId);
				continue;
			}

			const partials = voice.partials;

			// Hlasitosť stopy sa vyhladzuje raz za blok.
			if (voice.currentVolume === undefined) voice.currentVolume = voice.trackVolume;
			const targetVol = voice.trackVolume !== undefined ? voice.trackVolume : 1;
			voice.currentVolume += (targetVol - voice.currentVolume) * 0.1;
			const voiceVol = voice.currentVolume;

			// Zisk na začiatku a konci fade-inu, menený plynulo po vzorkách, aby nevznikali skoky medzi blokmi.
			let fadeInStart = 1;
			let fadeInEnd = 1;
			const hasFadeIn = voice.fadeIn > 0 && voice.fadeInElapsed < voice.fadeIn;
			if (hasFadeIn) {
				fadeInStart = Math.min(1, voice.fadeInElapsed / voice.fadeIn);
				voice.fadeInElapsed += dt;
				fadeInEnd = Math.min(1, voice.fadeInElapsed / voice.fadeIn);
			}
			const blockGainStart = voiceVol * fadeInStart;
			const blockGainEnd = voiceVol * fadeInEnd;

			// Pre parciály, ktoré v tomto bloku dosiahnu releaseStartTime, doznejú skôr
			// musí prebehnúť pred výpočtom obálky, aby ho plynulý prechod stihol zachytiť.
			const elapsedAfterBlock = voice.elapsedTime + dt;
			for (let p = 0; p < partials.length; p++) {
				const partial = partials[p];
				if (partial.state === this.STATE_OFF || partial.state === this.STATE_RELEASE) continue;
				if (elapsedAfterBlock >= partial.releaseStartTime) {
					// Release nastane uprostred bloku, prepne sa okamžite.
					partial.releaseAmp = this.getPartialEnvelopeLevel(partial);
					partial.state = this.STATE_RELEASE;
					// stateTime = ako ďaleko bude release na začiatku bloku
					// (0, ak začína presne teraz, záporné najviac o dĺžku bloku, ak začína uprostred bloku).
					const timeIntoRelease = voice.elapsedTime - partial.releaseStartTime;
					partial.stateTime = Math.max(0, timeIntoRelease);
				}
			}

			// Konštanty pre jednotlivé parciály, mimo cyklu (loopu) po vzorkách.
			let allPartialsOff = true;
			for (let p = 0; p < partials.length; p++) {
				const partial = partials[p];

				if (partial.state === this.STATE_OFF) continue;
				allPartialsOff = false;
				totalPartials++;

				if (totalPartials > this.maxTotalPartials) {
					partial.state = this.STATE_OFF;
					continue;
				}

				// Amplitúda sa vyhladzuje v každom bloku.
				partial.amp += (partial.targetAmp - partial.amp) * Math.min(1, ampSmooth * numSamples);

				const envStart = this.getPartialEnvelopeLevel(partial);

				// Nahliadnutie do obálky na konci bloku simuláciou posunu
				// (skutočná aktualizácia stavu prebehne neskôr).
				const envEnd = this._peekEnvelopeEnd(partial, dt);

				const ampStart = partial.amp * envStart * blockGainStart;
				const ampEnd = partial.amp * envEnd * blockGainEnd;

				if (ampStart < 0.00001 && ampEnd < 0.00001) {
					partial._skip = true;
					continue;
				}
				partial._skip = false;

				// Vyhladenie panorámy, podobne ako amplitúdy.
				if (partial.currentPan === undefined) partial.currentPan = partial.pan;
				partial.currentPan += (partial.pan - partial.currentPan) * 0.1;

				// [ZDROJ] PULKKI, Ville. Spatial Sound Generation and Perception by Amplitude Panning Techniques.
				//   Espoo, 2001. Dizertačná práca. Helsinki University of Technology, Laboratory of Acoustics and Audio
				//   Signal Processing, Report 62. ISBN 951-22-5531-6.

				// Panoráma s rovnocennou hlasitosťou (equal-power).
				const pan01 = (partial.currentPan + 1) * 0.5;
				const leftPan = Math.cos(pan01 * halfPi);
				const rightPan = Math.sin(pan01 * halfPi);

				// Lineárny prechod naprieč blokom, ktorý odstraňuje skoky v hodnotách.
				partial._leftStart = ampStart * leftPan;
				partial._rightStart = ampStart * rightPan;
				partial._leftInc = (ampEnd * leftPan - partial._leftStart) / numSamples;
				partial._rightInc = (ampEnd * rightPan - partial._rightStart) / numSamples;

				partial._phaseInc = partial.freq * tableSizeInv;
			}

			for (let i = 0; i < numSamples; i++) {
				for (let p = 0; p < partials.length; p++) {
					const partial = partials[p];
					if (partial._skip || partial.state === this.STATE_OFF) continue;

					// Vyhľadanie v tabuľke, lineárna interpolácia
					// Math.sin je nesmierne zaťažujúca úloha pre procesor, obzvlášť pre veľké množstvo parciálov pre každý jeden blok,
					// čo môže veľmi rýchlo zapríčiniť viac než milión výpočtov za jednu sekundu.
					// Z toho dôvodu sa používajú vopred vypočítané tabuľky hodnôt.
					const idx = partial.phase | 0;
					const frac = partial.phase - idx;
					const value = sineTable[idx] + frac * (sineTable[(idx + 1) % tableSize] - sineTable[idx]);

					// Toto sú dva najdôležitejšie riadky kódu, bez nich by neexistoval žiadny zvukový výstup zo Spectry.
					leftChannel[i] += value * (partial._leftStart + partial._leftInc * i);
					rightChannel[i] += value * (partial._rightStart + partial._rightInc * i);

					// Posun vo fáze. Prírastok môže pri nízkych vzorkovacích frekvenciách presiahnuť celú tabuľku, preto sa celé zalomí namiesto jedného odčítania.
					partial.phase += partial._phaseInc;
					if (partial.phase >= tableSize || partial.phase < 0) {
						partial.phase -= Math.floor(partial.phase / tableSize) * tableSize;
					}
				}
			}

			voice.elapsedTime += dt;

			// Poistka WYSIWYH, hlas sa označí za skončený, keď je už výrazne za dĺžkou noty (doznenie malo amplitúdu stiahnuť na nulu už pri noteDuration).
			if (voice.elapsedTime >= voice.noteDuration + 0.01) {
				for (const partial of partials) {
					partial.state = this.STATE_OFF;
				}
				voice.allOff = true;
				continue;
			}

			// Posun stavu obálky každého parciálu, raz za blok (automatické doznenie sa rieši ešte pred blokom, tu sa stav už len posúva).
			for (const partial of partials) {
				if (partial.state === this.STATE_OFF) continue;
				this.updatePartialEnvelopeState(partial, dt);
			}

			if (allPartialsOff) {
				voice.allOff = true;
			}
		}

		for (const id of toRemove) {
			this.voices.delete(id);
		}

		// Soft clip
		for (let i = 0; i < numSamples; i++) {
			const xL = leftChannel[i];
			const xR = rightChannel[i];
			leftChannel[i] = xL / (1 + Math.abs(xL) * 0.5);
			rightChannel[i] = xR / (1 + Math.abs(xR) * 0.5);
		}

		return true;
	}
}

registerProcessor('additive-processor', AdditiveProcessor);
