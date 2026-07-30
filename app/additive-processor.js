class AdditiveProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.tableSize = 2048;
		this.sineTable = new Float32Array(this.tableSize);
		for (let i = 0; i < this.tableSize; i++) {
			this.sineTable[i] = Math.sin((i / this.tableSize) * 2 * Math.PI);
		}
		this.sineScale = this.tableSize / (2 * Math.PI);
		this.halfPi = Math.PI / 2;

		this.voices = new Map();

		this.STATE_ATTACK = 0;
		this.STATE_DECAY = 1;
		this.STATE_SUSTAIN = 2;
		this.STATE_RELEASE = 3;
		this.STATE_OFF = 4;

		this.maxVoices = 64;
		this.maxPartialsPerVoice = 64;
		this.maxTotalPartials = 1500;

		this.ampSmooth = 0.005;

		this.controlRate = 32;
		this.controlCounter = 0;

		this.port.onmessage = (e) => this.handleMessage(e.data);
	}

	handleMessage(msg) {
		switch (msg.type) {
			case 'noteOn':
				this.noteOn(msg.voiceId, msg.partials,
					Number.isFinite(msg.velocity) ? msg.velocity : 1,
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
		if (this.voices.size >= this.maxVoices && !this.voices.has(voiceId)) {
			for (const [id, voice] of this.voices) {
				if (voice.allOff || voice.stolen) {
					this.voices.delete(id);
					if (this.voices.size < this.maxVoices) break;
				}
			}
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
					for (const partial of stolen.partials) {
						if (partial.state !== this.STATE_OFF) {
							partial.releaseAmp = this.getPartialEnvelopeLevel(partial);
							partial.state = this.STATE_RELEASE;
							partial.stateTime = 0;
							partial.env = { ...partial.env, r: 0.005 };
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

		const fadeInTime = 0.002;
		const startMidNote = envOffset > 0;

		const processedPartials = audiblePartials.map(p => {
			const env = p.env || { a: 0.005, d: 0, s: 1, r: 0.05 };
			const a = Number.isFinite(env.a) && env.a > 0 ? env.a : 0;
			const d = Number.isFinite(env.d) && env.d > 0 ? env.d : 0;
			const s = Number.isFinite(env.s) ? Math.max(0, Math.min(1, env.s)) : 1;
			const r = Number.isFinite(env.r) && env.r > 0 ? env.r : 0.05;

			const minRelease = 0.005;
			let releaseStartTime = Math.max(a + d, noteDuration - r);
			let effectiveR;

			if (releaseStartTime >= noteDuration) {
				releaseStartTime = Math.max(0, noteDuration - minRelease);
				effectiveR = noteDuration - releaseStartTime;
			} else {
				effectiveR = noteDuration - releaseStartTime;
			}

			let state = this.STATE_ATTACK;
			let stateTime = 0;
			let releaseAmp = s;

			if (startMidNote) {
				const inRelease = envOffset >= releaseStartTime;

				if (inRelease) {
					const timeIntoRelease = envOffset - releaseStartTime;
					const releaseProgress = r > 0 ? Math.min(1, timeIntoRelease / r) : 1;
					const currentLevel = s * (1 - releaseProgress);

					state = this.STATE_RELEASE;
					stateTime = timeIntoRelease;
					releaseAmp = s;
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
				phase: Math.random() * this.tableSize,
				freq: p.freq,
				amp: p.amp * velocity * 0.15,
				targetAmp: p.amp * velocity * 0.15,
				pan: p.pan || 0,
				basePan: p.pan || 0,
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
			elapsedTime: envOffset,
			noteDuration: noteDuration,
			trackIdx: trackIdx || 0,
			trackVolume: trackVolume !== undefined ? trackVolume : 1,
			trackPan: trackPan || 0,
			fadeIn: startMidNote ? fadeInTime : 0,
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
				const freq = sanFreq(newPartials[i].freq);
				if (freq === null) {
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
				voice.partials[i].targetAmp = 0;
			}
		}
	}


	sineLookup(rad) {
		const t = this.tableSize;
		let idx = rad * this.sineScale;
		idx -= Math.floor(idx / t) * t;
		const i = idx | 0;
		const frac = idx - i;
		const st = this.sineTable;
		return st[i] + frac * (st[(i + 1) % t] - st[i]);
	}

	cosLookup(rad) {
		return this.sineLookup(rad + this.halfPi);
	}


	getPartialEnvelopeLevel(partial) {
		const env = partial.env;
		const t = partial.stateTime;

		switch (partial.state) {
			case this.STATE_ATTACK:
				if (env.a <= 0) return 1;
				const attackProgress = Math.min(1, t / env.a);
				return 0.5 * (1 - this.cosLookup(Math.PI * attackProgress));
			case this.STATE_DECAY: {
				if (env.d <= 0) return env.s;
				const decayProgress = Math.min(1, t / env.d);
				return 1 - (1 - env.s) * 0.5 * (1 - this.cosLookup(Math.PI * decayProgress));
			}
			case this.STATE_SUSTAIN:
				return env.s;
			case this.STATE_RELEASE: {
				if (env.r <= 0) return 0;
				const releaseProgress = Math.min(1, t / env.r);
				return partial.releaseAmp * 0.5 * (1 + this.cosLookup(Math.PI * releaseProgress));
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
				return 0.5 * (1 - this.cosLookup(Math.PI * Math.min(1, t / env.a)));
			case this.STATE_DECAY:
				if (env.d <= 0) return env.s;
				return 1 - (1 - env.s) * 0.5 * (1 - this.cosLookup(Math.PI * Math.min(1, t / env.d)));
			case this.STATE_SUSTAIN:
				return env.s;
			case this.STATE_RELEASE:
				if (env.r <= 0) return 0;
				return partial.releaseAmp * 0.5 * (1 + this.cosLookup(Math.PI * Math.min(1, t / env.r)));
			default:
				return 0;
		}
	}

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

		let totalPartials = 0;

		for (const [voiceId, voice] of this.voices) {
			if (voice.allOff) {
				toRemove.push(voiceId);
				continue;
			}

			const partials = voice.partials;

			if (voice.currentVolume === undefined) voice.currentVolume = voice.trackVolume;
			const targetVol = voice.trackVolume !== undefined ? voice.trackVolume : 1;
			voice.currentVolume += (targetVol - voice.currentVolume) * 0.1;
			const voiceVol = voice.currentVolume;

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

			const elapsedAfterBlock = voice.elapsedTime + dt;
			for (let p = 0; p < partials.length; p++) {
				const partial = partials[p];
				if (partial.state === this.STATE_OFF || partial.state === this.STATE_RELEASE) continue;
				if (elapsedAfterBlock >= partial.releaseStartTime) {
					partial.releaseAmp = this.getPartialEnvelopeLevel(partial);
					partial.state = this.STATE_RELEASE;
					const timeIntoRelease = voice.elapsedTime - partial.releaseStartTime;
					partial.stateTime = Math.max(0, timeIntoRelease);
				}
			}

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

				partial.amp += (partial.targetAmp - partial.amp) * Math.min(1, ampSmooth * numSamples);

				const envStart = this.getPartialEnvelopeLevel(partial);

				const envEnd = this._peekEnvelopeEnd(partial, dt);

				const ampStart = partial.amp * envStart * blockGainStart;
				const ampEnd = partial.amp * envEnd * blockGainEnd;

				if (ampStart < 0.00001 && ampEnd < 0.00001) {
					partial._skip = true;
					continue;
				}
				partial._skip = false;

				if (partial.currentPan === undefined) partial.currentPan = partial.pan;
				partial.currentPan += (partial.pan - partial.currentPan) * 0.1;

				const pan01 = (partial.currentPan + 1) * 0.5;
				const leftPan = this.cosLookup(pan01 * halfPi);
				const rightPan = this.sineLookup(pan01 * halfPi);

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

					const idx = partial.phase | 0;
					const frac = partial.phase - idx;
					const value = sineTable[idx] + frac * (sineTable[(idx + 1) % tableSize] - sineTable[idx]);

					leftChannel[i] += value * (partial._leftStart + partial._leftInc * i);
					rightChannel[i] += value * (partial._rightStart + partial._rightInc * i);

					partial.phase += partial._phaseInc;
					if (partial.phase >= tableSize || partial.phase < 0) {
						partial.phase -= Math.floor(partial.phase / tableSize) * tableSize;
					}
				}
			}

			voice.elapsedTime += dt;

			if (voice.elapsedTime >= voice.noteDuration + 0.01) {
				for (const partial of partials) {
					partial.state = this.STATE_OFF;
				}
				voice.allOff = true;
				continue;
			}

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
