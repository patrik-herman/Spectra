// obálky ADSR, samostatne pre parciál aj pre farbu
// štruktúra údajov farby:
// {
//     name: "Sawtooth",
//     data: [[1, 1], [2, 0.5], ...],
//     envelope: {a: 0.005, d: 0, s: 1, r: 0.005},  // predvolená pre všetky parciály
//     partialEnvelopes: {
//         2: {a: 0.1, d: 0.2, s: 0.5, r: 0.4},  // override pre parciál s indexom 2
//     }
// }


// DEFAULT_ENVELOPE pochádza z config.js (načítava sa skôr).

var Envelope = {
	// Obálka pre konkrétny index parciálu vo farbe; obálky majú prednosť v poradí partialEnvelopes[idx] > timbre.envelope > DEFAULT_ENVELOPE.
	getForPartial: (timbre, partialIdx) => {
		if (timbre?.partialEnvelopes?.[partialIdx]) {
			return timbre.partialEnvelopes[partialIdx];
		}
		if (timbre?.envelope) {
			return timbre.envelope;
		}
		return typeof DEFAULT_ENVELOPE !== 'undefined' ? DEFAULT_ENVELOPE : {a: 0.005, d: 0, s: 1, r: 0.005};
	},

	// Výpočet amplitúdy v konkrétnom okamihu noty; časy ADSR sú absolútne, takže ak je nota príliš krátka, fázy sa orežú.
	getAmplitudeAt: (env, t, duration, baseAmp = 1) => {
		// Hodnota NaN alebo Infinity v ktoromkoľvek parametri by sa preniesla aj do výsledku.
		var a = Number.isFinite(env.a) && env.a > 0 ? env.a : 0.005;
		var d = Number.isFinite(env.d) && env.d > 0 ? env.d : 0;
		var s = Number.isFinite(env.s) ? Math.max(0, Math.min(1, env.s)) : 1;
		// Chýbajúce alebo nulové doznenie sa nahradí hodnotou 0.05, aby zodpovedalo zvuku (pozri r || 0.05 v playback-manager.js a
		// additive-processor.js), lebo vykreslený priebeh musí zodpovedať tomu, čo skutočne zaznie.
		var r = Number.isFinite(env.r) && env.r > 0 ? env.r : 0.05;

		if (!Number.isFinite(duration) || duration <= 0) return 0; // Nota s nulovou dĺžkou nezaznie.
		if (!Number.isFinite(t)) return 0;

		// Doznenie začína v (duration - r), nikdy však pred 0.
		var releaseStart = Math.max(0, duration - r);

		if (t < 0) return 0;
		if (t >= duration) return 0; // Po skončení noty.

		// Fáza nábehu
		if (t < a) {
			var attackProgress = t / a;
			// Ak ide zároveň o fázu doznenia (veľmi krátka nota), uplatní sa aj doznenie.
			if (t >= releaseStart) {
				const releaseProgress = (t - releaseStart) / r;
				return baseAmp * attackProgress * (1 - releaseProgress);
			}
			return baseAmp * attackProgress;
		}

		// Fáza poklesu
		if (t < a + d) {
			var decayProgress = (t - a) / d;
			var decayAmp = 1 - decayProgress * (1 - s);
			// Ak ide zároveň o fázu doznenia.
			if (t >= releaseStart) {
				const releaseProgress = (t - releaseStart) / r;
				return baseAmp * decayAmp * (1 - releaseProgress);
			}
			return baseAmp * decayAmp;
		}

		// Fáza držania (sustain) alebo doznenia.
		if (t < releaseStart) {
			return baseAmp * s;
		}

		// Fáza doznenia
		const releaseProgress = (t - releaseStart) / r;
		return baseAmp * s * (1 - Math.min(1, releaseProgress));
	},

	// Vygenerovanie jednotlivých farieb gradientu plátna na zobrazenie obálky ADSR
	// funkcia vráti pole {position: 0-1, alpha: 0-1}
	// časy ADSR sú absolútne, takže ak je nota príliš krátka, fázy sa orežú, než aby by sa natiahli
	// poradie je nábeh > pokles > držanie > doznenie.

	getGradientStops: (env, duration) => {
		var a = Number.isFinite(env.a) && env.a > 0 ? env.a : 0.005;
		var d = Number.isFinite(env.d) && env.d > 0 ? env.d : 0;
		var s = Number.isFinite(env.s) ? Math.max(0, Math.min(1, env.s)) : 1;
		var r = Number.isFinite(env.r) && env.r > 0 ? env.r : 0.05;

		if (!Number.isFinite(duration) || duration <= 0) {
			return [{ position: 0, alpha: 0 }, { position: 1, alpha: 0 }];
		}

		var stops = [];

		// Prevod časov na jednotlivé pozície (0-1 v rámci dĺžky noty).
		var attackEndPos = a / duration;
		var decayEndPos = (a + d) / duration;
		var releaseStartPos = Math.max(0, (duration - r) / duration);

		stops.push({ position: 0, alpha: 0 });

		// Prvý prípad, nota je kratšia než dĺžka nábehu, takže nábeh je len čiastočný a až potom nastupuje doznenie.
		if (duration <= a) {
			// Nábeh dosiahne (duration/a) plnej amplitúdy v pozícii 1.
			var peakAlpha = a > 0 ? duration / a : 1;
			var releaseProgress = r > 0 ? Math.min(1, duration / r) : 1;
			var endAlpha = peakAlpha * (1 - releaseProgress);
			stops.push({ position: 1, alpha: Math.max(0, endAlpha) });
			return stops;
		}

		stops.push({ position: Math.min(attackEndPos, 1), alpha: 1 });

		// Druhý prípad, nota je kratšia než nábeh a pokles spolu, takže pokles je len čiastočný a potom nastupuje doznenie.
		if (duration <= a + d) {
			var decayProgress = (duration - a) / d;
			var decayAlpha = 1 - decayProgress * (1 - s);
			if (releaseStartPos < 1) {
				stops.push({ position: releaseStartPos, alpha: decayAlpha });
			}
			stops.push({ position: 1, alpha: 0 });
			return stops;
		}

		// Pokles sa v rámci noty ukončí.
		if (decayEndPos < 1) {
			stops.push({ position: decayEndPos, alpha: s });
		}

		// Tretí prípad, nota je kratšia než nábeh, pokles a doznenie spolu, takže sa držanie skráti alebo vypadne.
		if (releaseStartPos <= decayEndPos) {
			// Bez fázy držania nastupuje doznenie hneď po poklese
			// doznenie sa v rámci noty nemusí dokončiť.
			stops.push({ position: 1, alpha: 0 });
			return stops;
		}

		// Štvrtý prípad, úplné ADSR s fázou držania.
		if (releaseStartPos > decayEndPos && releaseStartPos < 1) {
			stops.push({ position: releaseStartPos, alpha: s });
		}

		stops.push({ position: 1, alpha: 0 });

		return stops;
	},

	createGradient: (ctx, x, width, color, env, duration, baseAlpha = 1) => {
		var gradient = ctx.createLinearGradient(x, 0, x + width, 0);
		var stops = Envelope.getGradientStops(env, duration);

		// Konvertovanie farby na jej zložky RGB (v šesťmiestnom hex kóde).
		var r = parseInt(color.slice(1, 3), 16) || 0;
		var g = parseInt(color.slice(3, 5), 16) || 0;
		var b = parseInt(color.slice(5, 7), 16) || 0;

		for (const stop of stops) {
			var alpha = stop.alpha * baseAlpha;
			gradient.addColorStop(stop.position, `rgba(${r},${g},${b},${alpha})`);
		}

		return gradient;
	}
};

if (typeof window !== 'undefined') {
	window.Envelope = Envelope;
}

// EnvelopeUI je rozhranie na úpravu obálky ADSR v časti Setup v editore farby (Timbre Editor).

var EnvelopeUI = {
	canvas: null,
	ctx: null,

	init: () => {
		var enableCheckbox = document.querySelector('.timbre-envelope-enable');
		var controls = document.querySelector('.timbre-envelope-controls');
		var canvas = document.querySelector('.timbre-envelope-canvas');

		if (!enableCheckbox || !controls) return;

		EnvelopeUI.canvas = canvas;
		if (canvas) {
			EnvelopeUI.ctx = canvas.getContext('2d');

			var setupResize = window.SpectraUtil?.setupCanvasResize;
			EnvelopeUI._resizeCanvas = setupResize
				? setupResize(canvas, 80, () => EnvelopeUI.drawEnvelope())
				: () => EnvelopeUI.drawEnvelope();

			window.addEventListener('resize', EnvelopeUI._resizeCanvas);

			// MutationObserver určí, kedy sa ovládacie prvky zviditeľnia.
			var observer = new MutationObserver(() => {
				if (controls.style.display !== 'none') {
					setTimeout(EnvelopeUI._resizeCanvas, 10);
				}
			});
			observer.observe(controls, { attributes: true, attributeFilter: ['style'] });
		}

		enableCheckbox.addEventListener('change', () => {
			controls.style.display = enableCheckbox.checked ? 'block' : 'none';
			if (enableCheckbox.checked && EnvelopeUI._resizeCanvas) {
				setTimeout(EnvelopeUI._resizeCanvas, 10);
			}
		});

		var inputs = document.querySelectorAll('.timbre-env-attack, .timbre-env-decay, .timbre-env-sustain, .timbre-env-release');
		inputs.forEach(input => {
			input.addEventListener('input', () => EnvelopeUI.drawEnvelope());
		});

		var addOverrideBtn = document.querySelector('.timbre-env-add-override');
		if (addOverrideBtn) {
			addOverrideBtn.addEventListener('click', () => EnvelopeUI.addOverride());
		}
	},

	drawEnvelope: () => {
		var canvas = EnvelopeUI.canvas;
		var ctx = EnvelopeUI.ctx;
		if (!canvas || !ctx) return;

		var dpr = window.devicePixelRatio || 1;
		var width = canvas.width / dpr;
		var height = canvas.height / dpr;
		var padding = 10;

		var readEnv = (q, dflt) => {
			var v = parseFloat(document.querySelector(q)?.value);
			return Number.isFinite(v) ? v : dflt;
		};
		var a = readEnv('.timbre-env-attack', 0.005);
		var d = readEnv('.timbre-env-decay', 0);
		var s = readEnv('.timbre-env-sustain', 1);
		var r = readEnv('.timbre-env-release', 0.005);

		ctx.fillStyle = '#1a1a1a';
		ctx.fillRect(0, 0, width, height);

		// Výpočet bodov, normalizovaných na dvojsekundovú dĺžku.
		var totalTime = Math.max(a + d + 0.5 + r, 1); // Zobrazí sa najmenej 1 sekunda.
		var scale = (width - padding * 2) / totalTime;

		var attackEnd = padding + a * scale;
		var decayEnd = attackEnd + d * scale;
		var sustainEnd = decayEnd + 0.5 * scale;
		var releaseEnd = sustainEnd + r * scale;

		var top = padding;
		var bottom = height - padding;
		var sustainY = top + (1 - s) * (bottom - top);

		ctx.beginPath();
		ctx.strokeStyle = '#aaa';
		ctx.lineWidth = 2;

		// Nakreslí sa krivka ADSR.
		ctx.moveTo(padding, bottom);
		ctx.lineTo(attackEnd, top);
		ctx.lineTo(decayEnd, sustainY);
		ctx.lineTo(sustainEnd, sustainY);
		ctx.lineTo(releaseEnd, bottom);

		ctx.stroke();

		ctx.lineTo(padding, bottom);
		ctx.closePath();
		ctx.fillStyle = 'transparent';
		ctx.fill();
	},

	loadFromTimbre: (timbre) => {
		var enableCheckbox = document.querySelector('.timbre-envelope-enable');
		var controls = document.querySelector('.timbre-envelope-controls');

		if (!enableCheckbox || !controls) return;

		var hasEnvelope = timbre?.envelope || timbre?.partialEnvelopes;
		enableCheckbox.checked = hasEnvelope;
		controls.style.display = hasEnvelope ? 'block' : 'none';

		var env = timbre?.envelope || {a: 0.005, d: 0, s: 1, r: 0.005};
		var attackInput = document.querySelector('.timbre-env-attack');
		var decayInput = document.querySelector('.timbre-env-decay');
		var sustainInput = document.querySelector('.timbre-env-sustain');
		var releaseInput = document.querySelector('.timbre-env-release');

		if (attackInput) attackInput.value = env.a || 0.005;
		if (decayInput) decayInput.value = env.d || 0;
		if (sustainInput) sustainInput.value = env.s !== undefined ? env.s : 1;
		if (releaseInput) releaseInput.value = env.r || 0.005;

		EnvelopeUI.loadOverrides(timbre?.partialEnvelopes || {});

		if (hasEnvelope) {
			// Pred vykreslením sa prepočíta veľkosť plátna
			// použitie requestAnimationFrame + timeout kvôli tomu, aby bol DOM už vopred aktualizovaný.
			var tryResize = (attempts = 0) => {
				if (!EnvelopeUI.canvas) return;
				var rect = EnvelopeUI.canvas.parentElement?.getBoundingClientRect();
				if (rect && rect.width > 0) {
					if (EnvelopeUI._resizeCanvas) {
						EnvelopeUI._resizeCanvas();
					}
					EnvelopeUI.drawEnvelope();
				} else if (attempts < 5) {
					// Ak prvok ešte nie je pripravený, opakovaný pokus po krátkom oneskorení.
					requestAnimationFrame(() => setTimeout(() => tryResize(attempts + 1), 20));
				}
			};
			requestAnimationFrame(() => tryResize());
		}
	},

	saveToTimbre: (timbre) => {
		var enableCheckbox = document.querySelector('.timbre-envelope-enable');
		if (!enableCheckbox?.checked) {
			delete timbre.envelope;
			delete timbre.partialEnvelopes;
			return;
		}

		// Uloženie predvolenej obálky.
		var readEnv = (q, dflt) => {
			var v = parseFloat(document.querySelector(q)?.value);
			return Number.isFinite(v) ? v : dflt;
		};
		timbre.envelope = {
			a: readEnv('.timbre-env-attack', 0.005),
			d: readEnv('.timbre-env-decay', 0),
			s: readEnv('.timbre-env-sustain', 1),
			r: readEnv('.timbre-env-release', 0.005)
		};

		var overrides = EnvelopeUI.getOverrides();
		if (Object.keys(overrides).length > 0) {
			timbre.partialEnvelopes = overrides;
		} else {
			delete timbre.partialEnvelopes;
		}
	},

	loadOverrides: (partialEnvelopes) => {
		var list = document.querySelector('.timbre-env-overrides-list');
		if (!list) return;

		var keys = Object.keys(partialEnvelopes);
		if (keys.length === 0) {
			list.innerHTML = '<span class="timbre-env-no-overrides">None</span>';
			return;
		}

		list.innerHTML = '';
		keys.forEach(partialIdx => {
			var env = partialEnvelopes[partialIdx];
			EnvelopeUI.createOverrideRow(list, parseInt(partialIdx), env);
		});
	},

	getOverrides: () => {
		var list = document.querySelector('.timbre-env-overrides-list');
		if (!list) return {};

		var overrides = {};
		var rows = list.querySelectorAll('.env-override-row');
		rows.forEach(row => {
			var partialIdx = parseInt(row.dataset.partial);
			if (isNaN(partialIdx)) return;

			var readRow = (q, dflt) => {
				var v = parseFloat(row.querySelector(q)?.value);
				return Number.isFinite(v) ? v : dflt;
			};
			overrides[partialIdx] = {
				a: readRow('.override-a', 0.005),
				d: readRow('.override-d', 0),
				s: readRow('.override-s', 1),
				r: readRow('.override-r', 0.005)
			};
		});

		return overrides;
	},

	addOverride: () => {
		var list = document.querySelector('.timbre-env-overrides-list');
		if (!list) return;

		var noOverrides = list.querySelector('.timbre-env-no-overrides');
		if (noOverrides) noOverrides.remove();

		// Nájdenie najbližšieho voľného čísla parciálu.
		var existing = list.querySelectorAll('.env-override-row');
		var usedPartials = new Set();
		existing.forEach(row => usedPartials.add(parseInt(row.dataset.partial)));

		var nextPartial = 1;
		while (usedPartials.has(nextPartial)) nextPartial++;

		EnvelopeUI.createOverrideRow(list, nextPartial, {a: 0.005, d: 0, s: 1, r: 0.005});
	},

	createOverrideRow: (container, partialIdx, env) => {
		var row = document.createElement('div');
		row.className = 'env-override-row';
		row.dataset.partial = partialIdx;

		row.innerHTML = `
			<div class="timbre-env-input">
				<label>P</label>
				<input type="number" class="override-partial" value="${partialIdx}" min="1" max="128">
			</div>
			<div class="timbre-env-input">
				<label>A</label>
				<input type="number" class="override-a" value="${env.a || 0.005}" min="0" max="5" step="0.001">
			</div>
			<div class="timbre-env-input">
				<label>D</label>
				<input type="number" class="override-d" value="${env.d || 0}" min="0" max="5" step="0.001">
			</div>
			<div class="timbre-env-input">
				<label>S</label>
				<input type="number" class="override-s" value="${env.s !== undefined ? env.s : 1}" min="0" max="1" step="0.01">
			</div>
			<div class="timbre-env-input">
				<label>R</label>
				<input type="number" class="override-r" value="${env.r || 0.005}" min="0" max="10" step="0.001">
			</div>
			<button class="override-remove">&times;</button>
		`;

		var partialInput = row.querySelector('.override-partial');
		partialInput.addEventListener('change', () => {
			row.dataset.partial = partialInput.value;
		});

		row.querySelector('.override-remove').addEventListener('click', () => {
			row.remove();
			var list = document.querySelector('.timbre-env-overrides-list');
			if (list && list.querySelectorAll('.env-override-row').length === 0) {
				list.innerHTML = '<span class="timbre-env-no-overrides">None</span>';
			}
		});

		container.appendChild(row);
	}
};

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', EnvelopeUI.init);
	} else {
		EnvelopeUI.init();
	}
}

if (typeof window !== 'undefined') {
	window.EnvelopeUI = EnvelopeUI;
}