// setup.js patrí spolu so spectra.js a canvas.js k najstarším súborom v Spectre.

var Setup = {
	currentTuning: null,
	currentTimbre: null,

	init: () => {
		// Kontrola načítania util.js (poskytuje funkciu sel).
		if (typeof sel === 'undefined') {
			Logger.error('util.js not loaded. Setup cannot initialize.');
			return;
		}

		// Inicializácia selektora typu ladenia (selVisible pre prípad, že je takých prvkov viac).
		var tuningTypes = document.querySelectorAll('.tuning-type');
		tuningTypes.forEach(el => {
			el.addEventListener('change', Setup.tuning.switchType);
		});
		
		var edoGenerate = sel('.edo-generate');
		var edoMicrotune = sel('.edo-microtune');
		var customGenerate = sel('.custom-generate');

		var tuningFileButton = sel('.tuning-file-button');
		var tuningFileInput = sel('.tuning-file-input');
		var tuningSave = sel('.tuning-save');
		var tuningDelete = sel('.tuning-delete');
		var tuningLoadSelect = sel('.tuning-load-select');
		var microtuneApply = sel('.microtune-apply');

		if (edoGenerate) edoGenerate.addEventListener('click', Setup.tuning.generateEDO);
		if (edoMicrotune) edoMicrotune.addEventListener('click', Setup.tuning.toggleMicrotune);
		if (customGenerate) customGenerate.addEventListener('click', Setup.tuning.generateCustom);

		var audioAnalysisOpen = sel('.audio-analysis-open');
		if (audioAnalysisOpen) audioAnalysisOpen.addEventListener('click', Setup.tuning.openAudioAnalyzer);

		// MIDI offset pre ladenia zo zvukovej analýzy.
		var midiOffsetInput = sel('.midi-offset-input');
		if (midiOffsetInput) {
			var handleOffset = () => {
				var offset = parseInt(midiOffsetInput.value) || 0;
				Setup.tuning.applyMidiOffset(offset);
			};
			midiOffsetInput.addEventListener('input', handleOffset);
			midiOffsetInput.addEventListener('change', handleOffset);
		}

		Setup.tuning.setupAutoGenerate();
		if (tuningFileButton) {
			tuningFileButton.addEventListener('click', () => {
				sel('.tuning-file-input').click();
			});
		}
		if (tuningFileInput) {
			tuningFileInput.addEventListener('change', Setup.tuning.loadFile);
		}
		if (tuningSave) tuningSave.addEventListener('click', Setup.tuning.save);
		if (tuningDelete) tuningDelete.addEventListener('click', Setup.tuning.delete);
		if (tuningLoadSelect) {
			Setup.tuning.populateTuningSelect();
			tuningLoadSelect.addEventListener('change', Setup.tuning.loadExisting);
		}
		if (microtuneApply) microtuneApply.addEventListener('click', Setup.tuning.applyMicrotune);
		
		var tuningExportBtn = sel('.tuning-export-btn');
		var tuningImportBtn = sel('.tuning-import-btn');
		var tuningImportInput = sel('.tuning-import-input');
		if (tuningExportBtn) tuningExportBtn.addEventListener('click', Setup.tuning.export);
		if (tuningImportBtn) tuningImportBtn.addEventListener('click', () => tuningImportInput?.click());
		if (tuningImportInput) tuningImportInput.addEventListener('change', Setup.tuning.import);
		
		var timbreSelect = sel('.timbre-select');
		var timbreResize = sel('.timbre-resize');
		var timbrePresetHarmonic = sel('.timbre-preset-harmonic');
		var timbrePresetOdd = sel('.timbre-preset-odd');
		var timbrePresetInharmonic = sel('.timbre-preset-inharmonic');
		var timbreSave = sel('.timbre-save');
		var timbreDelete = sel('.timbre-delete');
		if (timbreSelect) {
			Setup.timbre.populateSelect();
			timbreSelect.addEventListener('change', Setup.timbre.load);
		}
		if (timbreResize) timbreResize.addEventListener('click', Setup.timbre.resize);
		if (timbrePresetHarmonic) timbrePresetHarmonic.addEventListener('click', () => Setup.timbre.applyPreset('harmonic'));
		if (timbrePresetOdd) timbrePresetOdd.addEventListener('click', () => Setup.timbre.applyPreset('odd'));
		if (timbrePresetInharmonic) timbrePresetInharmonic.addEventListener('click', () => Setup.timbre.applyPreset('inharmonic'));
		if (timbreSave) timbreSave.addEventListener('click', Setup.timbre.save);
		if (timbreDelete) timbreDelete.addEventListener('click', Setup.timbre.delete);
		
		var timbreExportBtn = sel('.timbre-export-btn');
		var timbreImportBtn = sel('.timbre-import-btn');
		var timbreImportInput = sel('.timbre-import-input');
		if (timbreExportBtn) timbreExportBtn.addEventListener('click', Setup.timbre.export);
		if (timbreImportBtn) timbreImportBtn.addEventListener('click', () => timbreImportInput?.click());
		if (timbreImportInput) timbreImportInput.addEventListener('change', Setup.timbre.import);
		


		Setup.timbre.resize();

		if (typeof Setup.tuning.populateInstrumentSelect === 'function') {
			Setup.tuning.populateInstrumentSelect();
		}
		if (typeof Setup.tuning.populateTuningSelect === 'function') {
			Setup.tuning.populateTuningSelect();
		}

		Setup.timbre.initAudioAnalyzer();

		if (typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.init) {
			AudioAnalyzer.init();
		}
	},
	
	tuning: {
		// Zobrazenie alebo skrytie príslušného panela nastavení pre daný typ ladenia (bez automatického generovania).
		_showSettingsPanel: (tuningType) => {
			document.querySelectorAll('.tuning-settings').forEach(el => {
				el.classList.add('hidden');
			});
			var settingsMap = {
				'edo': 'edo-settings',
				'ji-limit': 'ji-limit-settings',
				'ratio': 'ratio-settings',
				'linear': 'linear-settings',
				'spectral': 'spectral-settings',
				'subharmonic': 'subharmonic-settings',
				'fm-ring': 'fm-ring-settings',
				'spectral-import': 'spectral-import-settings',
				'audio-analysis': 'audio-analysis-settings',
				'file': 'file-settings',
				'custom': 'custom-settings',
				'adaptive': 'adaptive-settings'
			};
			var settingsId = settingsMap[tuningType];
			if (settingsId) {
				var panel = sel("."+settingsId);
				if (panel) {
					panel.classList.remove('hidden');
				}
			}
		},

		switchType: () => {
			var tuningType = selVisible('.tuning-type').value;

			Setup.tuning._showSettingsPanel(tuningType);

			// Pri adaptívnom ladení sa currentTuning nastaví okamžite, keďže tu chýba tlačidlo generovania.
			if (tuningType === 'adaptive') {
				Setup.tuning.setupAdaptive();
				return;
			}
			Setup.tuning.autoGenerate();
		},

		setupAdaptive: () => {
			var minFreq = parseFloat(sel('.adaptive-min-freq')?.value) || 20;
			var maxFreq = parseFloat(sel('.adaptive-max-freq')?.value) || 20000;

			// v adaptívnom ladení je základom 12-EDO a spektrálne výšky sa dopĺňajú dynamicky.
			var notes = [];
			var multiplier = 2;
			var divisions = 12;
			var baseNote = 60;
			var baseFreq = note2freq(baseNote);

			for (let i = -48; i <= 48; i++) {
				var frequency = baseFreq * Math.pow(multiplier, i / divisions);
				if (frequency >= minFreq && frequency <= maxFreq) {
					var noteIndex = baseNote + i;
					notes.push([noteIndex, frequency, Setup.tuning.isBlackKey(noteIndex)]);
				}
			}

			Setup.currentTuning = {
				type: 'adaptive',
				name: sel('.tuning-name').value || 'Adaptive Tuning',
				notes: notes,
				adaptiveMinFreq: minFreq,
				adaptiveMaxFreq: maxFreq
			};

			Setup.tuning.preview();
		},
		

		setupAutoGenerate: () => {
			var debounceTimer = null;
			var debounce = (fn, delay = 300) => {
				clearTimeout(debounceTimer);
				debounceTimer = setTimeout(fn, delay);
			};
			
			var edoInputs = ['.edo-multiplier', '.edo-divisions', '.edo-reference'];
			edoInputs.forEach(selector => {
				var el = sel(selector);
				if (el) el.addEventListener('input', () => debounce(Setup.tuning.generateEDO));
			});


			var ratioInputs = ['.ratio-reference', '.ratio-octaves'];
			ratioInputs.forEach(selector => {
				var el = sel(selector);
				if (el) el.addEventListener('input', () => debounce(Setup.tuning.generateRatio));
			});
			var ratioTextarea = sel('.ratio-input');
			if (ratioTextarea) {
				ratioTextarea.addEventListener('input', () => debounce(Setup.tuning.generateRatio, 500));
			}






			var customFreq = sel('.custom-frequencies');
			if (customFreq) {
				customFreq.addEventListener('input', () => debounce(Setup.tuning.generateCustom, 500));
			}

			var adaptiveInputs = ['.adaptive-min-freq', '.adaptive-max-freq'];
			adaptiveInputs.forEach(selector => {
				var el = sel(selector);
				if (el) el.addEventListener('input', () => debounce(Setup.tuning.setupAdaptive));
			});
		},
		
		autoGenerate: () => {
			var tuningType = selVisible('.tuning-type')?.value;
			if (!tuningType) return;

			switch (tuningType) {
				case 'edo':
					if (sel('.edo-divisions')?.value) Setup.tuning.generateEDO();
					break;
				case 'ratio':
					if (sel('.ratio-input')?.value) Setup.tuning.generateRatio();
					break;
				case 'custom':
					if (sel('.custom-frequencies')?.value) Setup.tuning.generateCustom();
					break;
			}
		},
		
		generateEDO: () => {
			var multiplier = parseFloat(sel('.edo-multiplier').value);
			var divisions = parseInt(sel('.edo-divisions').value);
			var reference = parseFloat(sel('.edo-reference').value) || 440;

			// Obmedzenie počtu delení: HTML min a max obmedzujú len šípky, ručne zadanú hodnotu nie.
			// Cyklus nôt beží 41 * divisions krát, preto je počet delení obmedzený na 1200.
			if (!Number.isFinite(divisions) || divisions < 1) divisions = 12;
			divisions = Math.min(divisions, 1200);

			var notes = [];
			var baseNote = 60; // C4
			// Referenčná frekvencia zadaná užívateľom (predvolene 440 Hz pre A4).
			var baseFreq = reference * Math.pow(2, (baseNote - 69) / 12);
			
			var edoPattern = Setup.tuning.getEDOPattern(divisions);

			for (let octave = -20; octave <= 20; octave++) {
				for (let step = 0; step < divisions; step++) {
					var frequency = baseFreq * Math.pow(multiplier, (octave * divisions + step) / divisions);
					var noteIndex = freq2note(frequency);
					notes.push([noteIndex, frequency, edoPattern[step]]);
				}
			}
			
			// Ak EDO ladenie nemá zadaný názov, predvolený názov sa odvodí od počtu delení (napr. "12-EDO").
			var edoNameField = sel('.tuning-name');
			if (edoNameField && !edoNameField.value.trim()) edoNameField.value = divisions + '-EDO';

			Setup.currentTuning = {
				type: 'edo',
				name: sel('.tuning-name').value,
				multiplier: multiplier,
				divisions: divisions,
				reference: reference,
				notes: notes
			};
			
			Setup.tuning.preview();
		},

		generateRatio: () => {
			var text = sel('.ratio-input').value;
			var reference = parseFloat(sel('.ratio-reference').value) || 261.63;
			var octaves = parseInt(sel('.ratio-octaves').value) || 8;

			// Parsovanie pomerov z textu, oddeľovačom môže byť nový riadok aj čiarka.
			var ratioStrings = text.split(/[\n,]/).map(s => s.trim()).filter(s => s);
			var ratios = [];

			for (const str of ratioStrings) {
				if (str.includes('/')) {
					var [num, den] = str.split('/').map(s => parseFloat(s.trim()));
					if (!isNaN(num) && !isNaN(den) && den !== 0) {
						ratios.push(num / den);
					}
				} else {
					var val = parseFloat(str);
					if (!isNaN(val)) {
						ratios.push(val);
					}
				}
			}

			if (ratios.length === 0) return;

			ratios.sort((a, b) => a - b);

			var notes = [];
			for (let oct = -Math.floor(octaves / 2); oct <= Math.ceil(octaves / 2); oct++) {
				for (const ratio of ratios) {
					var frequency = reference * ratio * Math.pow(2, oct);
					if (frequency >= 20 && frequency <= 20000) {
						var noteIndex = freq2note(frequency);
						notes.push([noteIndex, frequency, Setup.tuning.isBlackKey(noteIndex)]);
					}
				}
			}

			Setup.currentTuning = {
				type: 'ratio',
				name: sel('.tuning-name').value,
				notes: notes,
				ratioInput: text,
				ratioReference: reference,
				ratioOctaves: octaves
			};

			Setup.tuning.preview();
		},




		openAudioAnalyzer: () => {
			if (typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.openWithCallback) {
				AudioAnalyzer.openWithCallback((frequencies) => {
					Setup.tuning.generateFromAudioAnalysis(frequencies);
				});
			} else {
				showStatus('Audio Analyzer not available', { type: 'error' });
			}
		},

		generateFromAudioAnalysis: (frequencies) => {
			if (!frequencies || frequencies.length === 0) {
				showStatus('No frequencies detected', { type: 'warning' });
				return;
			}

			var notes = [];
			for (let i = 0; i < frequencies.length; i++) {
				var frequency = frequencies[i];
				if (frequency > 0) {
					var noteIndex = freq2note(frequency);
					notes.push([noteIndex, frequency, Setup.tuning.isBlackKey(noteIndex)]);
				}
			}

			if (notes.length === 0) {
				showStatus('No valid frequencies found', { type: 'warning' });
				return;
			}

			notes.sort((a, b) => a[1] - b[1]);

			Setup.currentTuning = {
				type: 'audio-analysis',
				name: sel('.tuning-name').value || 'Audio Analysis Tuning',
				notes: notes,
				originalNotes: notes.map(n => [...n]) // Pôvodné tóny, z ktorých sa počíta MIDI offset.
			};

			var midiOffsetInput = sel('.midi-offset-input');
			if (midiOffsetInput) midiOffsetInput.value = 0;

			var statusEl = sel('.audio-analysis-status');
			if (statusEl) {
				statusEl.textContent = `${notes.length} frequencies extracted`;
			}

			Setup.tuning.preview();
			showStatus(`Created tuning with ${notes.length} pitches from audio analysis`, { type: 'success' });
		},

		applyMidiOffset: (offset) => {
			if (!Setup.currentTuning || !Setup.currentTuning.notes) {
				return;
			}

			// Ak originalNotes chýba, doplní sa z aktuálnych tónov.
			if (!Setup.currentTuning.originalNotes) {
				Setup.currentTuning.originalNotes = Setup.currentTuning.notes.map(n => [...n]);
			}

			Setup.currentTuning.notes = Setup.currentTuning.originalNotes.map(n => {
				var newPitch = n[0] + offset;
				return [newPitch, n[1], Setup.tuning.isBlackKey(newPitch)];
			});

			Setup.tuning.preview();
		},

		generateCustom: () => {
			var text = sel('.custom-frequencies').value;
			var lines = text.split('\n').filter(line => line.trim());
			
			var notes = [];
			for (let i = 0; i < lines.length; i++) {
				var frequency = parseFloat(lines[i].trim());
				if (!isNaN(frequency) && frequency > 0) {
					var noteIndex = freq2note(frequency);
					notes.push([noteIndex, frequency, Setup.tuning.isBlackKey(noteIndex)]);
				}
			}
			
			if (notes.length === 0) {
				showStatus('No valid frequencies found', { type: 'warning' });
				return;
			}
			
			Setup.currentTuning = {
				type: 'custom',
				name: sel('.tuning-name').value,
				notes: notes
			};
			
			Setup.tuning.preview();
		},
		
		loadFile: (e) => {
			var file = e.target.files[0];
			if (!file) return;
			
			sel('.tuning-file-name').textContent = file.name;
			
			var reader = new FileReader();
			reader.onload = (event) => {
				var content = event.target.result;
				Setup.tuning.parseSCL(content);
			};
			reader.readAsText(file);
		},
		
		// [ZDROJ] Huygens-Fokker Foundation. Scala scale file (.scl) format [online]. [cit. 2026-07-30]. Dostupné
		//   z: https://www.huygens-fokker.org/scala/scl_format.html
		parseSCL: (content) => {
			var lines = content.split('\n').filter(line => {
				var trimmed = line.trim();
				return trimmed && !trimmed.startsWith('!');
			});
			
			if (lines.length < 2) {
				showStatus('Invalid .scl file format', { type: 'error' });
				return;
			}
			
			var description = lines[0];
			var noteCount = parseInt(lines[1]);
			
			var ratios = [];
			for (let i = 2; i < Math.min(lines.length, noteCount + 2); i++) {
				var line = lines[i].trim();
				if (line.includes('.')) {
					// Centy
					ratios.push(parseFloat(line));
				} else if (line.includes('/')) {
					// Pomer
					var [num, den] = line.split('/').map(x => parseFloat(x));
					ratios.push(1200 * Math.log2(num / den));
				} else {
					// Celočíselný pomer
					ratios.push(1200 * Math.log2(parseFloat(line)));
				}
			}
			
			var baseFreq = 440 * Math.pow(2, (60 - 69) / 12);
			var notes = [];
			
			var periodCents = ratios.length > 0 ? ratios[ratios.length - 1] : 1200;
			var octavesDown = 10;
			var octavesUp = 10;
			
			for (let octave = -octavesDown; octave <= octavesUp; octave++) {
				var octaveOffset = octave * periodCents;
				var baseOctFreq = baseFreq * Math.pow(2, octaveOffset / 1200);
				var baseOctNote = freq2note(baseOctFreq);
				if (baseOctNote >= 0 && baseOctNote <= 127) {
					notes.push([baseOctNote, baseOctFreq, Setup.tuning.isBlackKey(baseOctNote)]);
				}
				// Pridanie jednotlivých intervalov v rámci danej oktávy okrem posledného, ktorý je intervalom ekvivalencie.
				for (let i = 0; i < ratios.length - 1; i++) {
					var cents = ratios[i] + octaveOffset;
					var frequency = baseFreq * Math.pow(2, cents / 1200);
					var noteIndex = freq2note(frequency);
					if (noteIndex >= 0 && noteIndex <= 127) {
						notes.push([noteIndex, frequency, Setup.tuning.isBlackKey(noteIndex)]);
					}
				}
			}

			notes.sort((a, b) => a[0] - b[0]);

			Setup.currentTuning = {
				type: 'file',
				name: description || sel('.tuning-name').value,
				notes: notes
			};
			
			sel('.tuning-name').value = Setup.currentTuning.name;
			Setup.tuning.preview();
		},
		
		// Tlačidlo Custom Microtuning samo otvára a zatvára editor.
		toggleMicrotune: () => {
			var editor = sel('.microtune-editor');
			if (editor && editor.style.display === 'block') {
				Setup.tuning.hideMicrotune();
			} else {
				Setup.tuning.showMicrotune();
			}
		},

		showMicrotune: () => {
			if (!Setup.currentTuning || Setup.currentTuning.type !== 'edo') {
				showStatus('Microtuning is only available for EDO tunings', { type: 'warning' });
				return;
			}

			var container = sel('.microtune-controls');
			container.innerHTML = '';

			// Divisions z currentTuning, prípadne zo vstupu v UI (pri starších ladeniach).
			var divisions = Setup.currentTuning.divisions || parseInt(sel('.edo-divisions')?.value) || 12;
			for (let i = 0; i < divisions; i++) {
				var div = document.createElement('div');
				div.style.marginBottom = '8px';
				
				var label = document.createElement('label');
				label.textContent = `Note ${i}: `;
				label.style.display = 'inline-block';
				label.style.width = '80px';
				
				var input = document.createElement('input');
				input.type = 'number';
				input.step = '0.1';
				input.value = (Setup.currentTuning.microtuning && Setup.currentTuning.microtuning[i] !== null)
					? Setup.currentTuning.microtuning[i]
					: '0';
				input.id = `microtune-${i}`;
				input.style.width = '80px';
				
				var centsLabel = document.createElement('span');
				centsLabel.textContent = ' cents';
				centsLabel.style.marginLeft = '5px';
				
				div.appendChild(label);
				div.appendChild(input);
				div.appendChild(centsLabel);
				container.appendChild(div);
			}
			
			sel('.microtune-editor').style.display = 'block';
			sel('.edo-microtune')?.classList.add('active');
		},

		hideMicrotune: () => {
			sel('.microtune-editor').style.display = 'none';
			sel('.edo-microtune')?.classList.remove('active');
		},
		
		applyMicrotune: () => {
			if (!Setup.currentTuning || Setup.currentTuning.type !== 'edo') return;

			// Divisions z currentTuning, prípadne zo vstupu v UI (pri starších ladeniach).
			var divisions = Setup.currentTuning.divisions || parseInt(sel('.edo-divisions')?.value) || 12;
			var offsets = [];

			for (let i = 0; i < divisions; i++) {
				var input = sel(`#microtune-${i}`);
				offsets.push(parseFloat(input?.value) || 0);
			}

			Setup.currentTuning.microtuning = offsets;

			var multiplier = Setup.currentTuning.multiplier;
			var reference = note2freq(60);
			var baseNote = 60;
			
			var notes = [];
			for (let octave = -20; octave <= 20; octave++) {
				for (let step = 0; step < divisions; step++) {
					var baseCents = (octave * divisions + step) * (1200 * Math.log2(multiplier) / divisions);
					var totalCents = baseCents + offsets[step];
					var frequency = reference * Math.pow(2, totalCents / 1200);
					var isBlack = Setup.tuning.isBlackKey(freq2note(frequency));
					var noteNumber = freq2note(frequency);
					notes.push([noteNumber, frequency, isBlack]);
				}
			}
			
			Setup.currentTuning.notes = notes;
			
			Setup.tuning.preview();
			Setup.tuning.hideMicrotune();
		},
		
		isBlackKey: (note) => {
			// Štandardný vzor bielych a čiernych kláves pre 12-EDO.
			return [1, 3, 6, 8, 10].includes(((Math.round(note) % 12) + 12) % 12) + 0;
		},

		getEDOPattern: (divisions) => {
			var bwPattern12 = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
			// Poistka pri neplatnom počte delení.
			if (!Number.isFinite(divisions) || divisions < 1) return bwPattern12;
			divisions = Math.min(Math.floor(divisions), 1200);
			if (divisions === 12) return bwPattern12;
			if (divisions % 12 === 0) {
				var mult = divisions / 12;
				const pattern = [];
				for (let j = 0; j < 12; j++) {
					pattern.push(bwPattern12[j]);
					for (let k = 1; k < mult; k++) {
						pattern.push(1 - bwPattern12[j]);
					}
				}
				return pattern;
			}
			// Pri ostatných EDO sa vzor zakladá na blízkosti k 12-EDO.
			const pattern = [];
			for (let j = 0; j < divisions; j++) {
				var cents = (j / divisions) * 1200;
				var nearest12 = Math.round(cents / 100);
				var nearestCents = nearest12 * 100;
				var distance = Math.abs(cents - nearestCents);
				if (distance < (1200 / divisions / 2)) {
					pattern.push(bwPattern12[nearest12 % 12]);
				} else {
					pattern.push(1 - bwPattern12[nearest12 % 12]);
				}
			}
			return pattern;
		},
		
		preview: () => {
			if (!Setup.currentTuning) return;

			var preview = sel('.tuning-preview-content');
			var notes = Setup.currentTuning.notes;

			if (!notes || !Array.isArray(notes) || notes.length === 0) {
				if (preview) preview.textContent = 'No notes defined';
				Setup.tuning.visualPreview.render([]);
				return;
			}

			var firstNote = notes[0];
			if (!Array.isArray(firstNote)) {
				if (preview) preview.textContent = 'Tuning uses legacy format';
				Setup.tuning.visualPreview.render([]);
				return;
			}

			var text = '';
			for (const note of notes) {
				if (Array.isArray(note) && note.length >= 2 && typeof note[0] === 'number' && typeof note[1] === 'number') {
					text += `${note[0].toFixed(2)}: ${note[1].toFixed(2)} Hz\n`;
				}
			}

			if (preview) preview.textContent = text || 'No valid notes';

			Setup.tuning.visualPreview.render(notes);
		},

		// Zmenšené zobrazenie ladenia (horizontálne klávesy so značkami tónov).
		visualPreview: {
			canvas: null,
			ctx: null,
			container: null,
			notes: [],
			scrollX: 0,
			zoom: 8, // Pixely na poltón.
			isDragging: false,
			lastMouseX: 0,
			initialized: false,
			centerMidi: 48, // MIDI hodnota, ktorá zostáva vycentrovaná pri zmene ladenia.

			init: () => {
				var vp = Setup.tuning.visualPreview;
				vp.canvas = sel('.tuning-visual-canvas');
				vp.container = sel('.tuning-visual-preview');

				if (!vp.canvas || !vp.container) return;

				vp.ctx = vp.canvas.getContext('2d');

				vp.container.addEventListener('mousedown', vp.onMouseDown);
				vp.container.addEventListener('mousemove', vp.onMouseMove);
				vp.container.addEventListener('mouseup', vp.onMouseUp);
				vp.container.addEventListener('mouseleave', vp.onMouseUp);
				vp.container.addEventListener('wheel', vp.onWheel, { passive: false });

				if (window.ResizeObserver) {
					new ResizeObserver(() => vp.render(vp.notes)).observe(vp.container);
				} else {
					window.addEventListener('resize', () => vp.render(vp.notes));
				}

				vp.initialized = true;
			},

			render: (notes) => {
				var vp = Setup.tuning.visualPreview;
				if (!vp.initialized) vp.init();
				if (!vp.canvas || !vp.ctx) return;

				vp.notes = notes || [];

				var rect = vp.container.getBoundingClientRect();
				var width = rect.width;
				var height = rect.height;

				if (width <= 0 || height <= 0) return;

				var dpr = window.devicePixelRatio || 1;

				vp.canvas.width = width * dpr;
				vp.canvas.height = height * dpr;
				vp.canvas.style.width = width + 'px';
				vp.canvas.style.height = height + 'px';
				vp.ctx.scale(dpr, dpr);

				var ctx = vp.ctx;

				ctx.fillStyle = '#181818';
				ctx.fillRect(0, 0, width, height);

				if (vp.notes.length === 0) {
					ctx.fillStyle = '#444';
					ctx.font = "12px 'Lato', sans-serif";
					ctx.textAlign = 'center';
					ctx.fillText('No tuning loaded', width / 2, height / 2);
					return;
				}

				var sortedNotes = [...vp.notes].sort((a, b) => a[0] - b[0]);

				var pixelsPerSemitone = vp.zoom;
				var minPitch = sortedNotes[0][0];
				var maxPitch = sortedNotes[sortedNotes.length - 1][0];

				var stepAreaH = Math.floor(height / 2);
				var stepY = height - stepAreaH;

				var midiToX = (midiPitch) => {
					return (midiPitch - minPitch) * pixelsPerSemitone - vp.scrollX;
				};

				vp.scrollX = (vp.centerMidi - minPitch) * pixelsPerSemitone - width / 2;

				var totalWidth = (maxPitch - minPitch) * pixelsPerSemitone;
				vp.scrollX = Math.max(-(width / 2), Math.min(totalWidth - width / 2, vp.scrollX));

				// Pásmo výšky
				ctx.fillStyle = '#202020';
				ctx.fillRect(0, stepY, width, stepAreaH);

				// Každý stupeň začína pri výške tónu a končí pri výške nasledujúceho.
				for (let i = 0; i < sortedNotes.length; i++) {
					const note = sortedNotes[i];
					const isBlack = note[2];
					var pitch = note[0];

					const x = midiToX(pitch);

					var stepW;
					if (i < sortedNotes.length - 1) {
						stepW = (sortedNotes[i + 1][0] - pitch) * pixelsPerSemitone;
					} else {
						// Posledný tón má rovnakú šírku ako predchádzajúci stupeň.
						var prevInterval = i > 0 ? pitch - sortedNotes[i - 1][0] : 1;
						stepW = prevInterval * pixelsPerSemitone;
					}

					if (x + stepW < 0 || x > width) continue;

					ctx.fillStyle = isBlack ? '#1a1a1a' : '#262626';
					ctx.fillRect(x, stepY, stepW, stepAreaH);
					ctx.fillStyle = '#141414';
					ctx.fillRect(x, stepY, 1, stepAreaH);
				}

				var lineAreaH = stepY - 15;
				for (let i = 0; i < sortedNotes.length; i++) {
					const note = sortedNotes[i];
					const isBlack = note[2];
					const x = midiToX(note[0]);

					if (x < 0 || x > width) continue;

					ctx.strokeStyle = isBlack ? '#333' : '#484848';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(x, 5);
					ctx.lineTo(x, lineAreaH);
					ctx.stroke();
				}

				// Prerušované hraničné čiary pri MIDI 0 a 127.
				ctx.strokeStyle = '#555';
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);

				var x0 = midiToX(0);
				if (x0 >= 0 && x0 <= width) {
					ctx.beginPath();
					ctx.moveTo(x0, 0);
					ctx.lineTo(x0, height);
					ctx.stroke();
				}

				var x127 = midiToX(127);
				if (x127 >= 0 && x127 <= width) {
					ctx.beginPath();
					ctx.moveTo(x127, 0);
					ctx.lineTo(x127, height);
					ctx.stroke();
				}
				ctx.setLineDash([]);

				// Značky C majú svetlosivý popisok a modrú kotviacu čiaru pri 25 % priesvitnosti.
				ctx.fillStyle = '#bbb';
				ctx.font = "12px 'Lato', sans-serif";
				ctx.textAlign = 'center';

				var visibleMinMidi = minPitch + vp.scrollX / pixelsPerSemitone;
				var visibleMaxMidi = visibleMinMidi + width / pixelsPerSemitone;

				for (let cMidi = Math.floor((visibleMinMidi - 24) / 12) * 12; cMidi <= Math.ceil((visibleMaxMidi + 24) / 12) * 12; cMidi += 12) {
					const x = midiToX(cMidi);
					if (x >= -20 && x <= width + 20) {
						ctx.strokeStyle = 'rgba(74, 158, 255, 0.25)';
						ctx.lineWidth = 1;
						ctx.beginPath();
						ctx.moveTo(x, 5);
						ctx.lineTo(x, lineAreaH);
						ctx.moveTo(x, stepY);
						ctx.lineTo(x, height);
						ctx.stroke();
						var octave = Math.floor(cMidi / 12) - 2;
						ctx.fillText('C' + octave, x, lineAreaH + 12);
					}
				}

			},

			onMouseDown: (e) => {
				var vp = Setup.tuning.visualPreview;
				vp.isDragging = true;
				vp.lastMouseX = e.clientX;
				vp.container.style.cursor = 'grabbing';
			},

			onMouseMove: (e) => {
				var vp = Setup.tuning.visualPreview;
				if (!vp.isDragging) return;

				var dx = e.clientX - vp.lastMouseX;
				vp.lastMouseX = e.clientX;

				// zoom = pixely na poltón, takže poltóny = pixely / zoom.
				var sortedNotes = [...vp.notes].sort((a, b) => a[0] - b[0]);
				if (sortedNotes.length > 0) {
					var minPitch = sortedNotes[0][0];
					var maxPitch = sortedNotes[sortedNotes.length - 1][0];

					var semitonesDelta = dx / vp.zoom;

					// centerMidi sa odčítava, pretože ťahanie doprava má posunúť zobrazenie doľava.
					vp.centerMidi -= semitonesDelta;

					vp.centerMidi = Math.max(minPitch, Math.min(maxPitch, vp.centerMidi));
				}

				vp.render(vp.notes);
			},

			onMouseUp: () => {
				var vp = Setup.tuning.visualPreview;
				vp.isDragging = false;
				vp.container.style.cursor = 'grab';
			},

			onWheel: (e) => {
				e.preventDefault();
				var vp = Setup.tuning.visualPreview;
				if (vp.notes.length === 0) return;

				var sortedNotes = [...vp.notes].sort((a, b) => a[0] - b[0]);
				var minPitch = sortedNotes[0][0];
				var maxPitch = sortedNotes[sortedNotes.length - 1][0];

				if (e.ctrlKey || e.metaKey) {
					// Pri priblížení zostáva centerMidi rovnaký, mení sa len mierka.
					var zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
					vp.zoom = Math.max(4, Math.min(40, vp.zoom * zoomFactor));
				} else {
					// Pri posúvaní sa centerMidi mení plynulo, v zlomkoch poltónu.
					var semitonesDelta = e.deltaY / 20;
					vp.centerMidi += semitonesDelta;

					vp.centerMidi = Math.max(minPitch, Math.min(maxPitch, vp.centerMidi));
				}

				vp.render(vp.notes);
			},

			reset: () => {
				var vp = Setup.tuning.visualPreview;
				vp.scrollX = 0;
				vp.zoom = 8;
				vp.centerMidi = 48; // C3
			}
		},
		
		save: async () => {
			// Ak ladenie ešte nie je vygenerované, pokúsi sa o to podľa aktuálnych nastavení.
			if (!Setup.currentTuning) {
				Setup.tuning.autoGenerate();
			}

			if (!Setup.currentTuning) {
				showStatus('Generate a tuning first', { type: 'warning' });
				return;
			}

			var name = sel('.tuning-name').value;
			if (!name || name.trim() === '') {
				showStatus('Name the tuning first', { type: 'warning' });
				return;
			}

			var derivedKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
			var scales = DB.get('scales') || {};

			var existingKey = (typeof EditorLists !== 'undefined' && EditorLists.selectedTuning)
				? EditorLists.selectedTuning
				: (sel('.tuning-load-select')?.value || '_new');

			var tuningKey;
			if (existingKey !== '_new' && scales[existingKey] && scales[existingKey].name === name) {
				tuningKey = existingKey;
			} else {
				tuningKey = derivedKey;
			}

			if (existingKey !== '_new' && existingKey !== tuningKey && scales[existingKey]) {
				// Identifikátor sa zmenil pri premenovaní, takže treba migrovať referencie zo starého na nový.
				if (!await showConfirm(`Rename tuning from "${scales[existingKey].name}" to "${name}"?`, { title: 'Rename Tuning', type: 'info' })) {
					return;
				}
				// Pri migrácii sa zmaže starý identifikátor a aktualizujú sa referencie.
				var oldMeta = scales[existingKey];
				delete scales[existingKey];
				if (window.scalesExt && window.scalesExt[existingKey]) {
					delete window.scalesExt[existingKey];
				}
				if (window.settings && window.settings.scale === existingKey) {
					window.settings.scale = tuningKey;
					DB.set('settings', window.settings);
				}
				var allTrackEvents = DB.get('trackEvents') || {};
				var trackEventsChanged = false;
				for (const tIdx in allTrackEvents) {
					var te = allTrackEvents[tIdx];
					if (te && te.tuningChanges) {
						for (const tc of te.tuningChanges) {
							if (tc.tuningKey === existingKey) {
								tc.tuningKey = tuningKey;
								trackEventsChanged = true;
							}
						}
					}
				}
				if (trackEventsChanged) {
					DB.set('trackEvents', allTrackEvents);
				}
			}

			// Pri prepisovaní sa zachovajú existujúce metadáta (kategória, deletable, popis a podobne).
			var existingMeta = scales[tuningKey] || {};

			scales[tuningKey] = {
				...(existingMeta.category ? { category: existingMeta.category } : {}),
				...(existingMeta.deletable === false ? { deletable: false } : {}),
				name: name,
				full: name,
				type: Setup.currentTuning.type || 'custom',
				description: existingMeta.description || `${Setup.currentTuning.type} tuning`,
				notes: Setup.currentTuning.notes,
				microtuning: Setup.currentTuning.microtuning || null,
				edoData: Setup.currentTuning.type === 'edo' ? {
					multiplier: Setup.currentTuning.multiplier,
					divisions: Setup.currentTuning.divisions,
					reference: Setup.currentTuning.reference
				} : null,
				jiLimitData: Setup.currentTuning.type === 'ji-limit' ? {
					limit: Setup.currentTuning.jiLimitValue,
					reference: Setup.currentTuning.jiLimitReference,
					octaves: Setup.currentTuning.jiLimitOctaves
				} : null,
				ratioData: Setup.currentTuning.type === 'ratio' ? {
					input: Setup.currentTuning.ratioInput,
					reference: Setup.currentTuning.ratioReference,
					octaves: Setup.currentTuning.ratioOctaves
				} : null,
				// Dáta špecifické pre daný typ, potrebné na obnovenie.
				linearData: Setup.currentTuning.type === 'linear' ? {
					a: Setup.currentTuning.linearA,
					b: Setup.currentTuning.linearB,
					count: Setup.currentTuning.linearCount
				} : null,
				spectralData: Setup.currentTuning.type === 'spectral' ? {
					fundamental: Setup.currentTuning.spectralFundamental,
					count: Setup.currentTuning.spectralCount,
					stretch: Setup.currentTuning.spectralStretch
				} : null,
				subharmonicData: Setup.currentTuning.type === 'subharmonic' ? {
					base: Setup.currentTuning.subharmonicBase,
					count: Setup.currentTuning.subharmonicCount,
					stretch: Setup.currentTuning.subharmonicStretch
				} : null,
				fmRingData: Setup.currentTuning.type === 'fm-ring' ? {
					carrier: Setup.currentTuning.fmCarrier,
					modulator: Setup.currentTuning.fmModulator,
					sidebands: Setup.currentTuning.fmSidebands,
					includeCarrier: Setup.currentTuning.fmIncludeCarrier
				} : null,
				spectralImportData: Setup.currentTuning.type === 'spectral-import' ? {
					instrument: Setup.currentTuning.spectralImportInstrument,
					baseFreq: Setup.currentTuning.spectralImportBase
				} : null,
				adaptiveData: Setup.currentTuning.type === 'adaptive' ? {
					minFreq: Setup.currentTuning.adaptiveMinFreq,
					maxFreq: Setup.currentTuning.adaptiveMaxFreq
				} : null,
				// originalNotes pre MIDI offset (potrebné pri zvukovej analýze).
				originalNotes: Setup.currentTuning.originalNotes || null,
			};
			
			DB.set('scales', scales);
			window.scales = scales;

			Setup.tuning.updateDefaultScaleDropdown(tuningKey);

			if (typeof EditorLists !== 'undefined') {
				EditorLists.selectedTuning = tuningKey;
				EditorLists.populateTuningList();
			}

			var oldSelect = sel('.tuning-load-select');
			if (oldSelect) {
				Setup.tuning.populateTuningSelect();
				oldSelect.value = tuningKey;
			}

			Setup.currentTuning.key = tuningKey;

			// Odstránenie cache zoradených parciálov pre dané ladenie, aby sa prepočítali s novými tónmi.
			if (window.scalesExt && window.scalesExt[tuningKey]) {
				window.scalesExt[tuningKey].orderedPartials = [{}, {}, {}];
			}

			if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
				DB.calculateOrderedPartials();
			}


			showStatus(`Tuning "${name}" saved`, { type: 'success' });
		},
		
		delete: async () => {
			var key = (typeof EditorLists !== 'undefined' && EditorLists.selectedTuning)
				? EditorLists.selectedTuning
				: sel('.tuning-load-select')?.value;

			if (!key || key === '_new') {
				showStatus('No tuning selected to delete', { type: 'warning' });
				return;
			}

			var tunings = DB.get('scales');
			if (!tunings || !tunings[key]) {
				showStatus('Tuning not found', { type: 'error' });
				return;
			}

			if (!await showConfirm(`Delete tuning "${tunings[key].name}"?`, { title: 'Delete Tuning', type: 'danger' })) return;

			delete tunings[key];
			DB.set('scales', tunings);
			window.scales = tunings;
			
			// Odstránenie referencií na zmazané ladenie.
			if (window.settings && window.settings.scale === key) {
				const remaining = Object.keys(tunings);
				window.settings.scale = remaining.length > 0 ? remaining[0] : 'edo12';
				DB.set('settings', window.settings);
			}
			var allTrackEventsD = DB.get('trackEvents') || {};
			var teChanged = false;
			for (const tIdx in allTrackEventsD) {
				var te = allTrackEventsD[tIdx];
				if (te && te.tuningChanges) {
					te.tuningChanges = te.tuningChanges.filter(tc => tc.tuningKey !== key);
					teChanged = true;
				}
			}
			if (teChanged) {
				DB.set('trackEvents', allTrackEventsD);
			}

			if (typeof EditorLists !== 'undefined') {
				EditorLists.selectedTuning = null;
				EditorLists.populateTuningList();
			}

			var oldSelect = sel('.tuning-load-select');
			if (oldSelect) {
				Setup.tuning.populateTuningSelect();
				oldSelect.value = '_new';
			}
			
			var tuningNameEl = sel('.tuning-name');
			if (tuningNameEl) {
				const remaining = Object.keys(tunings);
				var activeName = remaining.length > 0 && tunings[remaining[0]] ? tunings[remaining[0]].name : 'Custom Tuning';
				tuningNameEl.value = activeName;
			}
			Setup.currentTuning = null;
			var previewContent = sel('.tuning-preview-content');
			if (previewContent) previewContent.textContent = 'No tuning loaded';

			DB.init();

			Setup.tuning.updateDefaultScaleDropdown();

			showStatus('Tuning deleted', { type: 'success' });
		},

		export: () => {
			var key = Setup.currentTuning?.key ||
				(typeof EditorLists !== 'undefined' && EditorLists.selectedTuning) ||
				sel('.tuning-load-select')?.value;

			if (!key || key === '_new') {
				showStatus('No tuning selected to export. Save the tuning first.', { type: 'warning' });
				return;
			}

			var tunings = DB.get('scales') || {};
			var tuning = tunings[key];

			if (!tuning) {
				showStatus('Tuning not found', { type: 'error' });
				return;
			}

			Setup.tuning._showExportFormatDialog(tuning);
		},

		_showExportFormatDialog: (tuning) => {
			var overlay = cloneTemplate('tpl-export-format', {
				'.setup-dialog-subtitle': tuning.name
			});

			if (!overlay) {
				Logger.warn('Export format template not found');
				return;
			}

			var dialog = overlay.querySelector('.spectra-dialog');
			document.body.appendChild(overlay);

			var close = () => {
				overlay.classList.remove('visible');
				setTimeout(() => overlay.remove(), 150);
			};

			requestAnimationFrame(() => overlay.classList.add('visible'));

			dialog.querySelectorAll('.export-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					close();
					Setup.tuning._exportAs(tuning, btn.dataset.format);
				});
			});

			dialog.querySelector('.export-cancel').addEventListener('click', close);
			overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

			var handleEscape = (e) => {
				if (e.key === 'Escape') {
					close();
					document.removeEventListener('keydown', handleEscape);
				}
			};
			document.addEventListener('keydown', handleEscape);
		},

		_exportAs: (tuning, format) => {
			var safeName = tuning.name.replace(/[^a-z0-9]/gi, '_');
			var content, mimeType, extension;

			switch (format) {
				case 'json':
					content = JSON.stringify({
						spectraType: 'tuning',
						version: 1,
						name: tuning.name,
						notes: tuning.notes || tuning.data,
						type: tuning.type,
						edoData: tuning.edoData || null,
						jiLimitData: tuning.jiLimitData || null,
						ratioData: tuning.ratioData || null,
						linearData: tuning.linearData || null,
						spectralData: tuning.spectralData || null,
						subharmonicData: tuning.subharmonicData || null,
						fmRingData: tuning.fmRingData || null,
						spectralImportData: tuning.spectralImportData || null,
						adaptiveData: tuning.adaptiveData || null,
						microtuning: tuning.microtuning || null,
						originalNotes: tuning.originalNotes || null,
						exportedAt: new Date().toISOString()
					}, null, 2);
					mimeType = 'application/json';
					extension = 'tuning.json';
					break;

				case 'scl':
					content = Setup.tuning._generateScl(tuning);
					mimeType = 'text/plain';
					extension = 'scl';
					break;

				case 'tun':
					// TUN vyžaduje, aby stredný MIDI tón zadal užívateľ, takže sa spracúva samostatne.
					Setup.tuning._promptAndExportTun(tuning, safeName);
					return;

				case 'kbm':
					// KBM vyžaduje, aby stredný MIDI tón zadal užívateľ, takže sa spracúva samostatne.
					Setup.tuning._promptAndExportKbm(tuning, safeName);
					return;

				default:
					showStatus('Unknown export format', { type: 'error' });
					return;
			}

			var blob = new Blob([content], { type: mimeType });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a');
			a.href = url;
			a.download = `${safeName}.${extension}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			showStatus(`Exported as ${extension.toUpperCase()}`, { type: 'success' });
		},

		_generateScl: (tuning) => {
			// Formát Scala .scl
			// https://www.huygens-fokker.org/scala/scl_format.html
			var notes = tuning.notes || tuning.data || [];
			if (notes.length === 0) {
				return `! ${tuning.name}.scl\n!\n${tuning.name}\n0\n`;
			}

			var period = (tuning.edoData && tuning.edoData.multiplier) ? tuning.edoData.multiplier : 2;
			var periodCents = 1200 * Math.log2(period);

			var sortedNotes = [...notes].sort((a, b) => a[1] - b[1]);

			var baseFreq = sortedNotes[0][1];
			var periodNotes = [];

			for (const note of sortedNotes) {
				var ratio = note[1] / baseFreq;
				if (ratio >= period) break;
				if (ratio > 1.0000001) { // Kvôli float
					const cents = 1200 * Math.log2(ratio);
					periodNotes.push(cents);
				}
			}

			periodNotes.push(periodCents);

			var scl = `! ${tuning.name}.scl\n`;
			scl += `!\n`;
			scl += `${tuning.name}\n`;
			scl += `${periodNotes.length}\n`;
			scl += `!\n`;

			for (const cents of periodNotes) {
				scl += `${cents.toFixed(6)}\n`;
			}

			return scl;
		},

		_promptAndExportTun: (tuning, safeName) => {
			var overlay = cloneTemplate('tpl-export-midi-prompt', {
				'.setup-dialog-title': 'Export TUN'
			});

			if (!overlay) {
				Logger.warn('Export MIDI prompt template not found');
				return;
			}

			var dialog = overlay.querySelector('.spectra-dialog');
			var input = overlay.querySelector('.center-midi-input');
			var exportBtn = overlay.querySelector('.export-confirm-btn');
			var cancelBtn = overlay.querySelector('.export-cancel-btn');

			document.body.appendChild(overlay);

			requestAnimationFrame(() => {
				overlay.classList.add('visible');
				input.focus();
			});

			var closeDialog = () => {
				overlay.classList.remove('visible');
				setTimeout(() => overlay.remove(), 150);
			};

			exportBtn.addEventListener('click', () => {
				var centerMidi = parseInt(input.value) || 60;
				closeDialog();

				var content = Setup.tuning._generateTun(tuning, centerMidi);

				var blob = new Blob([content], { type: 'text/plain' });
				var url = URL.createObjectURL(blob);
				var a = document.createElement('a');
				a.href = url;
				a.download = `${safeName}.tun`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);

				showStatus('Exported as TUN', { type: 'success' });
			});

			cancelBtn.addEventListener('click', closeDialog);

			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) closeDialog();
			});

			var handleKey = (e) => {
				if (e.key === 'Escape') {
					closeDialog();
					document.removeEventListener('keydown', handleKey);
				} else if (e.key === 'Enter') {
					exportBtn.click();
					document.removeEventListener('keydown', handleKey);
				}
			};
			document.addEventListener('keydown', handleKey);
		},

		// [ZDROJ] HENNING, Mark. AnaMark tuning file format (*.tun; *.tun.*; *.msf): specifications. Version 2.00
		//   [online]. 17. 7. 2009 [cit. 2026-07-30]. Dostupné z:
		//   https://www.mark-henning.de/files/am/Tuning_File_V2_Doc.pdf
		_generateTun: (tuning, centerMidi = 60) => {
			var notes = tuning.notes || tuning.data || [];

			if (notes.length === 0) {
				let tun = `; ${tuning.name}\n; Empty tuning\n[Tuning]\n`;
				for (let i = 0; i < 128; i++) tun += `note ${i} = ${(i * 100).toFixed(6)}\n`;
				return tun;
			}

			var sortedNotes = [...notes].sort((a, b) => a[0] - b[0]);

			var centerIndex = 0;
			var closestDist = Infinity;
			for (let i = 0; i < sortedNotes.length; i++) {
				var dist = Math.abs(sortedNotes[i][0] - centerMidi);
				if (dist < closestDist) {
					closestDist = dist;
					centerIndex = i;
				}
			}

			// Mapovanie sa vytvorí tak, že sa ku každému MIDI tónu priradí index tónu ladenia
			// od stredu smerom von.
			var midiToTuningIndex = new Array(128).fill(null);
			midiToTuningIndex[centerMidi] = centerIndex;

			var midiUp = centerMidi + 1;
			var tuningUp = centerIndex + 1;
			while (midiUp <= 127 && tuningUp < sortedNotes.length) {
				midiToTuningIndex[midiUp] = tuningUp;
				midiUp++;
				tuningUp++;
			}

			var midiDown = centerMidi - 1;
			var tuningDown = centerIndex - 1;
			while (midiDown >= 0 && tuningDown >= 0) {
				midiToTuningIndex[midiDown] = tuningDown;
				midiDown--;
				tuningDown--;
			}

			let tun = `; ${tuning.name}\n`;
			tun += `; Exported from Spectra (center: MIDI ${centerMidi})\n`;
			tun += `[Tuning]\n`;

			// Referenciou je frekvencia MIDI tónu 0 v 12-EDO.
			var midiZeroFreq = 440 * Math.pow(2, -69 / 12); // 8,176 Hz

			for (let midi = 0; midi < 128; midi++) {
				var tuningIdx = midiToTuningIndex[midi];
				var absCents;

				if (tuningIdx !== null) {
					var actualFreq = sortedNotes[tuningIdx][1];
					absCents = 1200 * Math.log2(actualFreq / midiZeroFreq);
				} else {
					// Nenamapovaným tónom sa priradí 12-EDO.
					absCents = midi * 100;
				}

				tun += `note ${midi} = ${absCents.toFixed(6)}\n`;
			}

			return tun;
		},

		_promptAndExportKbm: (tuning, safeName) => {
			var overlay = cloneTemplate('tpl-export-midi-prompt', {
				'.setup-dialog-title': 'Export KBM'
			});

			if (!overlay) {
				Logger.warn('Export MIDI prompt template not found');
				return;
			}

			var dialog = overlay.querySelector('.spectra-dialog');
			var input = overlay.querySelector('.center-midi-input');
			var exportBtn = overlay.querySelector('.export-confirm-btn');
			var cancelBtn = overlay.querySelector('.export-cancel-btn');

			document.body.appendChild(overlay);

			requestAnimationFrame(() => {
				overlay.classList.add('visible');
				input.focus();
			});

			var closeDialog = () => {
				overlay.classList.remove('visible');
				setTimeout(() => overlay.remove(), 150);
			};

			exportBtn.addEventListener('click', () => {
				var centerMidi = parseInt(input.value) || 60;
				closeDialog();

				var content = Setup.tuning._generateKbm(tuning, centerMidi);

				var blob = new Blob([content], { type: 'text/plain' });
				var url = URL.createObjectURL(blob);
				var a = document.createElement('a');
				a.href = url;
				a.download = `${safeName}.kbm`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);

				showStatus('Exported as KBM', { type: 'success' });
			});

			cancelBtn.addEventListener('click', closeDialog);

			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) closeDialog();
			});

			var handleKey = (e) => {
				if (e.key === 'Escape') {
					closeDialog();
					document.removeEventListener('keydown', handleKey);
				} else if (e.key === 'Enter') {
					exportBtn.click();
					document.removeEventListener('keydown', handleKey);
				}
			};
			document.addEventListener('keydown', handleKey);
		},

		// [ZDROJ] Huygens-Fokker Foundation. Keyboard mappings. In: Scala help [online]. [cit. 2026-07-30].
		//   Dostupné z: https://www.huygens-fokker.org/scala/help.htm
		_generateKbm: (tuning, centerMidi = 60) => {
			// Formát mapovania klávesnice Scala (.kbm)
			// https://www.huygens-fokker.org/scala/help.htm#mappings
			var notes = tuning.notes || tuning.data || [];

			if (notes.length === 0) {
				return `! ${tuning.name}.kbm\n! Empty tuning\n`;
			}

			// Zoradenie tónov podľa výšky, teda podľa čísla MIDI tónu alebo výšky odvodenej z frekvencie.
			var sortedNotes = [...notes].sort((a, b) => a[0] - b[0]);

			var centerIndex = 0;
			var closestDist = Infinity;
			for (let i = 0; i < sortedNotes.length; i++) {
				var dist = Math.abs(sortedNotes[i][0] - centerMidi);
				if (dist < closestDist) {
					closestDist = dist;
					centerIndex = i;
				}
			}

			var mapping = new Array(128).fill('x');

			mapping[centerMidi] = centerIndex;

			var midiUp = centerMidi + 1;
			var tuningUp = centerIndex + 1;
			while (midiUp <= 127 && tuningUp < sortedNotes.length) {
				mapping[midiUp] = tuningUp;
				midiUp++;
				tuningUp++;
			}

			var midiDown = centerMidi - 1;
			var tuningDown = centerIndex - 1;
			while (midiDown >= 0 && tuningDown >= 0) {
				mapping[midiDown] = tuningDown;
				midiDown--;
				tuningDown--;
			}

			var firstMapped = 0;
			var lastMapped = 127;
			for (let i = 0; i < 128; i++) {
				if (mapping[i] !== 'x') {
					firstMapped = i;
					break;
				}
			}
			for (let i = 127; i >= 0; i--) {
				if (mapping[i] !== 'x') {
					lastMapped = i;
					break;
				}
			}

			var refFreq = sortedNotes[centerIndex][1];

			var scaleSize;
			var period = (tuning.edoData && tuning.edoData.multiplier) ? tuning.edoData.multiplier : 2;
			if (tuning.edoData && tuning.edoData.divisions) {
				scaleSize = tuning.edoData.divisions;
			} else {
				var baseFreq = sortedNotes[0][1];
				scaleSize = 0;
				for (const note of sortedNotes) {
					var ratio = note[1] / baseFreq;
					if (ratio >= period) break;
					scaleSize++;
				}
			}

			var kbm = `! ${tuning.name}.kbm\n`;
			kbm += `!\n`;
			kbm += `! Keyboard mapping for ${tuning.name}\n`;
			kbm += `! Exported from Spectra\n`;
			kbm += `!\n`;
			kbm += `! Size of map (scale degrees per period)\n`;
			kbm += `${scaleSize}\n`;
			kbm += `! First MIDI note number to retune\n`;
			kbm += `${firstMapped}\n`;
			kbm += `! Last MIDI note number to retune\n`;
			kbm += `${lastMapped}\n`;
			kbm += `! Middle note where scale degree 0 is mapped\n`;
			kbm += `${centerMidi}\n`;
			kbm += `! Reference note for frequency\n`;
			kbm += `${centerMidi}\n`;
			kbm += `! Frequency of reference note (Hz)\n`;
			kbm += `${refFreq.toFixed(6)}\n`;
			kbm += `! Scale degree to consider formal octave\n`;
			kbm += `${scaleSize}\n`;
			kbm += `! Mapping (scale degree for each entry in one period)\n`;

			for (let i = 0; i < scaleSize; i++) {
				kbm += `${i}\n`;
			}

			return kbm;
		},
		
		import: (e) => {
			var file = e.target.files[0];
			if (!file) return;

			var reader = new FileReader();
			reader.onload = async (event) => {
				try {
					var tuningData;

					if (file.name.endsWith('.scl')) {
						tuningData = Setup.tuning._parseSclFile(event.target.result);
					} else {
						var imported = JSON.parse(event.target.result);

						if (imported.spectraType !== 'tuning') {
							showStatus('Invalid tuning file format', { type: 'error' });
							return;
						}

						tuningData = {
							name: imported.name,
							notes: imported.notes || imported.data, // V1 mal 'data', teraz je to 'notes'.
							type: imported.type || 'custom',
							edoData: imported.edoData || null,
							jiLimitData: imported.jiLimitData || null,
							ratioData: imported.ratioData || null,
							linearData: imported.linearData || null,
							spectralData: imported.spectralData || null,
							subharmonicData: imported.subharmonicData || null,
							fmRingData: imported.fmRingData || null,
							spectralImportData: imported.spectralImportData || null,
							adaptiveData: imported.adaptiveData || null,
							microtuning: imported.microtuning || null,
							originalNotes: imported.originalNotes || null,
						};
					}

					var scales = DB.get('scales') || {};
					var key = tuningData.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

					if (scales[key]) {
						if (!await showConfirm(`Tuning "${tuningData.name}" already exists. Overwrite?`, { title: 'Overwrite Tuning', type: 'warning' })) {
							return;
						}
					}
					
					scales[key] = tuningData;
					DB.set('scales', scales);
					window.scales = scales;

					if (typeof EditorLists !== 'undefined') {
						EditorLists.populateTuningList();
						EditorLists.selectedTuning = key;
					}
					Setup.tuning.populateTuningSelect();

					Setup.currentTuning = {
						...tuningData, 
						key,
						notes: tuningData.notes || tuningData.data // 'notes' musí byť nastavené, aby sa dalo ladenie vykresliť.
					};
					sel('.tuning-name').value = tuningData.name;
					Setup.tuning.preview();
					
					showStatus(`Tuning "${tuningData.name}" imported`, { type: 'success' });
				} catch (err) {
					Logger.error('Import error:', err);
					showStatus('Failed to import tuning: ' + err.message, { type: 'error' });
				}
			};
			
			if (file.name.endsWith('.scl')) {
				reader.readAsText(file);
			} else {
				reader.readAsText(file);
			}

			e.target.value = '';
		},

		_parseSclFile: (content) => {
			var lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));
			
			if (lines.length < 2) {
				throw new Error('Invalid .scl file format');
			}
			
			var name = lines[0];
			var numNotes = parseInt(lines[1]);
			var ratios = [1]; // Unisono na začiatku (implicitné v SCL).
			
			for (let i = 2; i < lines.length && ratios.length <= numNotes; i++) {
				var line = lines[i];
				if (!line) continue;
				
				if (line.includes('.')) {
					// Hodnota v centoch.
					var cents = parseFloat(line);
					ratios.push(Math.pow(2, cents / 1200));
				} else if (line.includes('/')) {
					// Pomer
					var [num, den] = line.split('/').map(Number);
					ratios.push(num / den);
				} else {
					// Celočíselný pomer
					ratios.push(parseInt(line));
				}
			}
			
			var period = ratios[ratios.length - 1];
			var scaleSize = ratios.length - 1;
			
			var baseFreq = 440 * Math.pow(2, (60 - 69) / 12); // Frekvencia C4 v 12-EDO.
			var notes = [];
			
			for (let octave = -5; octave <= 5; octave++) {
				for (let degree = 0; degree < scaleSize; degree++) {
					var freq = baseFreq * ratios[degree] * Math.pow(period, octave);
					if (freq < 20 || freq > 20000) continue; // Mimo počuteľného rozsahu.
					var pitch = 69 + 12 * Math.log2(freq / 440); // Konverzia na MIDI výšku.
					notes.push([pitch, freq, 0]);
				}
			}

			notes.sort((a, b) => a[0] - b[0]);

			return {
				name: name,
				notes: notes,
				type: 'file'
			};
		},
		
		populateInstrumentSelect: () => {
			var select = sel('.spectral-instrument');
			if (!select) return;
			
			select.innerHTML = '';
			var spectra = DB.get('spectra');
			if (!spectra || spectra === null || typeof spectra !== 'object') return;
			
			var keys = spectra ? Object.keys(spectra) : [];
			if (!keys || keys.length === 0) return;
			
			for (const key of keys) {
				var option = document.createElement('option');
				option.value = key;
				option.textContent = spectra[key].name;
				select.appendChild(option);
			}
		},
		
		populateTuningSelect: () => {
			var select = sel('.tuning-load-select');
			if (!select) return;
			
			select.innerHTML = '<option value="_new">New Tuning</option>';
			var tunings = DB.get('scales');
			if (!tunings || tunings === null || typeof tunings !== 'object') return;
			
			var keys = tunings ? Object.keys(tunings) : [];
			if (!keys || keys.length === 0) return;
			for (const key of keys) {
				var option = document.createElement('option');
				option.value = key;
				option.textContent = tunings[key].name || key;
				select.appendChild(option);
			}
		},
		
		updateDefaultScaleDropdown: (selectKey) => {
			var defaultScaleSelect = sel('.default-scale');
			if (!defaultScaleSelect) return;
			
			var scalesList = DB.get('scales');
			if (!scalesList || typeof scalesList !== 'object') return;
			
			var scalesListKeys = scalesList ? Object.keys(scalesList) : [];
			if (!scalesListKeys || scalesListKeys.length === 0) return;
			var settingsList = DB.get('settings');

			defaultScaleSelect.innerHTML = '';

			for (let i = 0; i < scalesListKeys.length; i++) {
				var scaleOption = document.createElement('option');
				scaleOption.textContent = scalesList[scalesListKeys[i]].name;
				defaultScaleSelect.appendChild(scaleOption);
				
				if (selectKey && scalesListKeys[i] === selectKey) {
					defaultScaleSelect.selectedIndex = i;
				} else if (!selectKey && scalesListKeys[i] === settingsList.scale) {
					defaultScaleSelect.selectedIndex = i;
				}
			}
		},
		
		loadExisting: () => {
			Setup.tuning.hideMicrotune();

			var key = (typeof EditorLists !== 'undefined' && EditorLists.selectedTuning)
				? EditorLists.selectedTuning
				: sel('.tuning-load-select')?.value;

			if (!key || key === '_new') {
				sel('.tuning-name').value = 'Custom Tuning';
				Setup.currentTuning = null;
				var previewContent = sel('.tuning-preview-content');
				if (previewContent) previewContent.textContent = 'No tuning loaded';
				return;
			}

			var scales = DB.get('scales');
			if (!scales || !scales[key]) return;

			var tuning = scales[key];

			sel('.tuning-name').value = tuning.name;

			var notes = tuning.notes;

			// Kontrola, či má ladenie uložený explicitný typ (nový formát).
			if (tuning.type) {
				var tuningTypeSelect = selVisible('.tuning-type');
				if (tuningTypeSelect) {
					tuningTypeSelect.value = tuning.type;
					// Ak typ v dropdowne nie je dostupný, použije sa 'custom'.
					if (!tuningTypeSelect.value || tuningTypeSelect.value !== tuning.type) {
						tuningTypeSelect.value = 'custom';
					}
					Setup.tuning._showSettingsPanel(tuningTypeSelect.value);
				}

				switch (tuning.type) {
					case 'edo':
						{
							var multiplierInput = sel('.edo-multiplier');
							var divisionsInput = sel('.edo-divisions');
							var referenceInput = sel('.edo-reference');
							if (tuning.edoData) {
								// EDO ladenie vytvorené užívateľom s úplným edoData.
								if (multiplierInput) multiplierInput.value = tuning.edoData.multiplier || 2;
								if (divisionsInput) divisionsInput.value = tuning.edoData.divisions || 12;
								if (referenceInput) referenceInput.value = tuning.edoData.reference || 440;
							} else {
								// Prednastavené EDO má edoDivisions priamo na objekte ladenia.
								if (multiplierInput) multiplierInput.value = 2;
								if (divisionsInput) divisionsInput.value = tuning.edoDivisions || 12;
								if (referenceInput) referenceInput.value = tuning._generatedWithRefA || 440;
							}
						}
						break;

					case 'ji-limit':
						if (tuning.jiLimitData) {
							var limitSelect = sel('.ji-limit-value');
							const refInput = sel('.ji-limit-reference');
							const octavesInput = sel('.ji-limit-octaves');
							if (limitSelect) limitSelect.value = tuning.jiLimitData.limit || 5;
							if (refInput) refInput.value = tuning.jiLimitData.reference || 440;
							if (octavesInput) octavesInput.value = tuning.jiLimitData.octaves || 8;
						}
						break;

					case 'ratio':
						{
							var inputTextarea = sel('.ratio-input');
							const refInput = sel('.ratio-reference');
							const octavesInput = sel('.ratio-octaves');
							if (tuning.ratioData) {
								// Ladenie pomermi vytvorených užívateľom.
								if (inputTextarea) inputTextarea.value = tuning.ratioData.input || '';
								if (refInput) refInput.value = tuning.ratioData.reference || 261.63;
								if (octavesInput) octavesInput.value = tuning.ratioData.octaves || 8;
							} else if (tuning.ratios) {
								// Prednastavené JI ladenie má pomery uložené ako pole.
								if (inputTextarea) inputTextarea.value = tuning.ratios.join('\n');
								if (refInput) refInput.value = 261.63;
								if (octavesInput) octavesInput.value = 10;
							}
						}
						break;

					case 'linear':
						if (tuning.linearData) {
							var aInput = sel('.linear-a');
							var bInput = sel('.linear-b');
							const countInput = sel('.linear-count');
							if (aInput) aInput.value = tuning.linearData.a ?? 100;
							if (bInput) bInput.value = tuning.linearData.b ?? 100;
							if (countInput) countInput.value = tuning.linearData.count ?? 12;
						}
						break;

					case 'spectral':
						{
							var fundamentalInput = sel('.spectral-fundamental');
							const countInput = sel('.spectral-count');
							const stretchInput = sel('.spectral-stretch');
							if (tuning.spectralData) {
								// Spektrálne ladenie vytvorené užívateľom.
								if (fundamentalInput) fundamentalInput.value = tuning.spectralData.fundamental || 100;
								if (countInput) countInput.value = tuning.spectralData.count || 16;
								if (stretchInput) stretchInput.value = tuning.spectralData.stretch ?? 1;
							} else {
								// Prednastavené spektrálne ladenie.
								if (fundamentalInput) fundamentalInput.value = tuning.spectralFundamental || 100;
								if (countInput) countInput.value = tuning.spectralCount || 16;
								if (stretchInput) stretchInput.value = 1;
							}
						}
						break;

					case 'subharmonic':
						{
							const baseInput = sel('.subharmonic-base');
							const countInput = sel('.subharmonic-count');
							const stretchInput = sel('.subharmonic-stretch');
							if (tuning.subharmonicData) {
								// Subharmonické ladenie vytvorené užívateľom.
								if (baseInput) baseInput.value = tuning.subharmonicData.base || 3520;
								if (countInput) countInput.value = tuning.subharmonicData.count || 64;
								if (stretchInput) stretchInput.value = tuning.subharmonicData.stretch ?? 1;
							} else {
								// Prednastavené subharmonické ladenie.
								if (baseInput) baseInput.value = tuning.subharmonicBase || 3520;
								if (countInput) countInput.value = tuning.subharmonicCount || 64;
								if (stretchInput) stretchInput.value = 1;
							}
						}
						break;

					case 'fm-ring':
						if (tuning.fmRingData) {
							var carrierInput = sel('.fm-carrier');
							var modInput = sel('.fm-modulator');
							var sidebandsInput = sel('.fm-sidebands');
							var carrierCheckbox = sel('.fm-include-carrier');
							if (carrierInput) carrierInput.value = tuning.fmRingData.carrier || 440;
							if (modInput) modInput.value = tuning.fmRingData.modulator || 110;
							if (sidebandsInput) sidebandsInput.value = tuning.fmRingData.sidebands || 8;
							if (carrierCheckbox) carrierCheckbox.checked = tuning.fmRingData.includeCarrier !== false;
						}
						break;

					case 'spectral-import':
						if (tuning.spectralImportData) {
							var instrumentSelect = sel('.spectral-instrument');
							const baseInput = sel('.spectral-import-base');
							if (instrumentSelect) instrumentSelect.value = tuning.spectralImportData.instrument || '';
							if (baseInput) baseInput.value = tuning.spectralImportData.baseFreq ?? 440;
						}
						break;

					case 'audio-analysis':
						// Zvuková analýza používa iba pole notes; zobrazí sa len stav.
						if (notes && notes.length > 0) {
							var statusEl = sel('.audio-analysis-status');
							if (statusEl) {
								statusEl.textContent = `${notes.length} frequencies`;
							}
						}
						var midiOffsetInput = sel('.midi-offset-input');
						if (midiOffsetInput) midiOffsetInput.value = 0;
						break;

					case 'adaptive':
						if (tuning.adaptiveData) {
							var minInput = sel('.adaptive-min-freq');
							var maxInput = sel('.adaptive-max-freq');
							if (minInput) minInput.value = tuning.adaptiveData.minFreq ?? 20;
							if (maxInput) maxInput.value = tuning.adaptiveData.maxFreq ?? 20000;
						}
						break;

					case 'file':
						if (notes && notes.length > 0) {
							const customInput = sel('.custom-frequencies');
							if (customInput) {
								customInput.value = notes.map(n => n[1].toFixed(2)).join('\n');
							}
						}
						break;

					case 'custom':
						if (notes && notes.length > 0) {
							const customInput = sel('.custom-frequencies');
							if (customInput) {
								customInput.value = notes.map(n => n[1].toFixed(2)).join('\n');
							}
						}
						break;
				}
			} else if (notes && notes.length > 2) {
				// Táto vetva rozpoznáva typ ladenia priamo zo štruktúry, kvôli starším uloženým ladeniam.
				var firstNote = null;
				var firstNoteIndex = -1;

				for (let i = 0; i < notes.length; i++) {
					if (!firstNote || notes[i][1] < firstNote[1]) {
						firstNote = notes[i];
						firstNoteIndex = i;
					}
				}

				if (firstNote) {
					var targetFreq = firstNote[1] * 2;
					var tolerance = firstNote[1] * 0.01;

					var octaveNotes = [firstNote];
					for (let i = 0; i < notes.length; i++) {
						if (i !== firstNoteIndex &&
							notes[i][1] > firstNote[1] &&
							notes[i][1] < targetFreq - tolerance) {
							octaveNotes.push(notes[i]);
						}
					}

					octaveNotes.sort((a, b) => a[1] - b[1]);

					if (octaveNotes.length > 1) {
						var ratios = [];
						for (let i = 1; i < octaveNotes.length; i++) {
							var ratio = octaveNotes[i][1] / octaveNotes[i-1][1];
							ratios.push(ratio);
						}

						var avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
						var isConsistent = ratios.every(r => Math.abs(r - avgRatio) < 0.001);

						if (isConsistent) {
							selVisible('.tuning-type').value = 'edo';
							Setup.tuning._showSettingsPanel('edo');

							var divisions = octaveNotes.length;
							var octaveMultiplier = 2;
							for (let i = 0; i < notes.length; i++) {
								var freqRatio = notes[i][1] / firstNote[1];
								if (Math.abs(freqRatio - 2) < 0.01) {
									var indexDiff = notes[i][0] - firstNote[0];
									if (indexDiff > 0) {
										octaveMultiplier = Math.pow(freqRatio, divisions / indexDiff);
										break;
									}
								}
							}

							sel('.edo-multiplier').value = octaveMultiplier.toFixed(6);
							sel('.edo-divisions').value = divisions;
							sel('.edo-reference').value = 440;
						} else {
							selVisible('.tuning-type').value = 'custom';
							Setup.tuning._showSettingsPanel('custom');
							const customInput = sel('.custom-frequencies');
							if (customInput) {
								customInput.value = notes.map(n => n[1].toFixed(2)).join('\n');
							}
						}
					}
				}
			}

			Setup.currentTuning = {
				key: key,
				name: tuning.name,
				notes: JSON.parse(JSON.stringify(notes)),
				type: tuning.type || 'custom',
				microtuning: tuning.microtuning || null,
				originalNotes: tuning.originalNotes ? JSON.parse(JSON.stringify(tuning.originalNotes)) : null,
				multiplier: tuning.edoData?.multiplier || (tuning.edoDivisions ? 2 : undefined),
				divisions: tuning.edoData?.divisions || tuning.edoDivisions,
				reference: tuning.edoData?.reference,
				jiLimitValue: tuning.jiLimitData?.limit,
				jiLimitReference: tuning.jiLimitData?.reference,
				jiLimitOctaves: tuning.jiLimitData?.octaves,
				ratioInput: tuning.ratioData?.input,
				ratioReference: tuning.ratioData?.reference,
				ratioOctaves: tuning.ratioData?.octaves,
				linearA: tuning.linearData?.a,
				linearB: tuning.linearData?.b,
				linearCount: tuning.linearData?.count,
				spectralFundamental: tuning.spectralData?.fundamental,
				spectralCount: tuning.spectralData?.count,
				spectralStretch: tuning.spectralData?.stretch,
				subharmonicBase: tuning.subharmonicData?.base,
				subharmonicCount: tuning.subharmonicData?.count,
				subharmonicStretch: tuning.subharmonicData?.stretch,
				fmCarrier: tuning.fmRingData?.carrier,
				fmModulator: tuning.fmRingData?.modulator,
				fmSidebands: tuning.fmRingData?.sidebands,
				fmIncludeCarrier: tuning.fmRingData?.includeCarrier,
				spectralImportInstrument: tuning.spectralImportData?.instrument,
				spectralImportBase: tuning.spectralImportData?.baseFreq,
				adaptiveMinFreq: tuning.adaptiveData?.minFreq,
				adaptiveMaxFreq: tuning.adaptiveData?.maxFreq
			};

			Setup.tuning.preview();
		}
	},
	
	timbre: {
		populateSelect: () => {
			var select = sel('.timbre-select');
			if (!select) return;
			
			select.innerHTML = '<option value="_new">New Timbre</option>';
			var spectra = DB.get('spectra');
			if (!spectra) return;
			var keys = spectra ? Object.keys(spectra) : [];
			
			for (const key of keys) {
				var option = document.createElement('option');
				option.value = key;
				option.textContent = spectra[key].name;
				select.appendChild(option);
			}
		},
		
		load: () => {
			// Vynechá sa, ak práve prebieha ukladanie, aby opätovné načítanie neprepísalo stav.
			if (Setup.timbre._saving) return;

			var key = (typeof EditorLists !== 'undefined' && EditorLists.selectedTimbre)
				? EditorLists.selectedTimbre 
				: sel('.timbre-select')?.value;
			
			if (!key || key === '_new') {
				sel('.timbre-name').value = '';
				Setup.currentTimbre = null;
				Setup.timbre.resize();
				return;
			}
			
			var spectra = DB.get('spectra');
			if (!spectra) return;
			if (!spectra[key]) return;
			
			var timbre = spectra[key];
			sel('.timbre-name').value = timbre.name;

			// Migrácia farby do formátu keypoints zo starého statického aj dynamického formátu.
			var migrated;
			if (typeof DynamicTimbre !== 'undefined') {
				migrated = DynamicTimbre.migrate(timbre);
			} else if (timbre.keypoints && timbre.keypoints.length > 0) {
				migrated = timbre;
			} else {
				var partialsData = typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre) : (timbre.data || [[1, 1]]);
				migrated = { keypoints: [{ pitch: 60, data: partialsData }] };
			}

			Setup.currentTimbre = {
				key: key,
				keypoints: JSON.parse(JSON.stringify(migrated.keypoints)),
				selectedKeypoint: 0
			};
			sel('.timbre-partials-count').value = migrated.keypoints[0]?.data?.length || 8;
			
			Setup.timbre.render();
			if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();
		},
		
		resize: () => {
			var count = parseInt(sel('.timbre-partials-count').value);

			// currentTimbre musí existovať so správnou štruktúrou keypoints.
			if (!Setup.currentTimbre) {
				Setup.currentTimbre = {
					keypoints: [{ pitch: 60, data: [] }],
					selectedKeypoint: 0
				};
			} else if (!Setup.currentTimbre.keypoints || Setup.currentTimbre.keypoints.length === 0) {
				// Migrácia starého formátu alebo oprava chýbajúcich keypoints.
				Setup.currentTimbre.keypoints = [{ pitch: 60, data: Setup.currentTimbre.data || [] }];
				Setup.currentTimbre.selectedKeypoint = 0;
			}

			// Aktuálne dáta (z vybraného keypointu pre dynamickú farbu).
			var data = Setup.timbre.getCurrentData();
			if (!data) data = [];
			
			var oldLength = data.length;
			
			if (count > oldLength) {
				for (let i = oldLength; i < count; i++) {
					data.push([i + 1, 1 / (i + 1)]);
				}
			} else {
				data = data.slice(0, count);
			}
			
			Setup.timbre.setCurrentData(data);
			
			Setup.timbre.render();
			if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();
		},
		
		render: () => {
			var table = sel('.timbre-partials-table');
			table.innerHTML = '';
			
			var data = Setup.timbre.getCurrentData();
			if (!data || data.length === 0) return;
			
			for (let i = 0; i < data.length; i++) {
				var partial = data[i];
				var row = document.createElement('tr');
				
				var cellNum = document.createElement('td');
				cellNum.textContent = (i + 1);
				
				var cellMult = document.createElement('td');
				var inputMult = document.createElement('input');
				inputMult.type = 'number';
				inputMult.step = '0.001';
				inputMult.value = partial[0];
				inputMult.dataset.index = i;
				inputMult.dataset.field = 'mult';
				inputMult.addEventListener('input', Setup.timbre.updateValue);
				cellMult.appendChild(inputMult);
				
				var cellAmp = document.createElement('td');
				var inputAmp = document.createElement('input');
				inputAmp.type = 'number';
				inputAmp.step = '0.001';
				inputAmp.min = '0';
				inputAmp.max = '1';
				inputAmp.value = partial[1];
				inputAmp.dataset.index = i;
				inputAmp.dataset.field = 'amp';
				inputAmp.addEventListener('input', Setup.timbre.updateValue);
				cellAmp.appendChild(inputAmp);
				
				row.appendChild(cellNum);
				row.appendChild(cellMult);
				row.appendChild(cellAmp);
				table.appendChild(row);
			}

			if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();
		},
		
		updateValue: (e) => {
			var index = parseInt(e.target.dataset.index);
			var field = e.target.dataset.field;
			var value = parseFloat(e.target.value);
			
			var data = Setup.timbre.getCurrentData();
			if (!data || !data[index]) return;
			
			if (field === 'mult') {
				data[index][0] = value;
			} else if (field === 'amp') {
				data[index][1] = Math.max(0, Math.min(1, value));
			}
			Setup.timbre.setCurrentData(data);
			
			if (window.HarmonicsChart) {
				window.HarmonicsChart.refreshFromSetup();
			}
		},
		
		applyPreset: (type) => {
			if (!Setup.currentTimbre) return;
			
			var data = Setup.timbre.getCurrentData();
			if (!data || data.length === 0) return;
			
			var count = data.length;
	
				for (let i = 0; i < count; i++) {
				if (type === 'harmonic') {
					data[i][0] = i + 1;
					data[i][1] = 1 / (i + 1);
				} else if (type === 'odd') {
					data[i][0] = 2 * i + 1;
					data[i][1] = 1 / (2 * i + 1);
				} else if (type === 'inharmonic') {
					data[i][0] = (i + 1) * (1 + Math.random() * 0.1);
					data[i][1] = Math.random() * 0.5;
				}
			}
			
			Setup.timbre.setCurrentData(data);

			if (window.HarmonicsChart && window.HarmonicsChart.refreshFromSetup) {
				window.HarmonicsChart.refreshFromSetup();
			}

			Setup.timbre.render();
		},
		
		save: async () => {
			if (!Setup.currentTimbre) {
				showStatus('Create a timbre first', { type: 'warning' });
				return;
			}

			// Nastavenie indikátora, aby sa počas ukladania nespustil load().
			Setup.timbre._saving = true;

			if (!Setup.currentTimbre.keypoints || !Setup.currentTimbre.keypoints.length) {
				showStatus('Create a timbre first', { type: 'warning' });
				Setup.timbre._saving = false;
				return;
			}

			var name = sel('.timbre-name').value;
			if (!name || name.trim() === '') {
				Setup.timbre._saving = false;
				showStatus('Name the timbre first', { type: 'warning' });
				return;
			}

			var derivedKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

			var spectra = DB.get('spectra');
			if (!spectra) { Setup.timbre._saving = false; return; }

			try {

			var existingKey = (typeof EditorLists !== 'undefined' && EditorLists.selectedTimbre)
				? EditorLists.selectedTimbre
				: (sel('.timbre-select')?.value || '_new');

			var key;
			if (existingKey !== '_new' && spectra[existingKey] && spectra[existingKey].name === name) {
				key = existingKey;
			} else {
				key = derivedKey;
			}

			if (existingKey !== '_new' && existingKey !== key && spectra[existingKey]) {
				// Ak sa identifikátor zmenil pri premenovaní, je nutné migrovať referencie.
				if (!await showConfirm(`Rename timbre from "${spectra[existingKey].name}" to "${name}"?`, { title: 'Rename Timbre', type: 'info' })) {
					Setup.timbre._saving = false;
					return;
				}
				// Pri migrácii sa zmaže starý identifikátor a aktualizujú sa referencie.
				delete spectra[existingKey];
				if (window.scalesExt) {
					for (const scaleKey of Object.keys(window.scalesExt)) {
						const scaleExt = window.scalesExt[scaleKey];
						if (scaleExt?.orderedPartials) {
							for (let mode = 0; mode < 3; mode++) {
								if (scaleExt.orderedPartials[mode]) {
									delete scaleExt.orderedPartials[mode][existingKey];
								}
							}
						}
					}
				}
				const instruments = DB.get('instruments');
				if (instruments && instruments.length > 0) {
					var instrChanged = false;
					for (let i = 0; i < instruments.length; i++) {
						if (instruments[i].spectrum === existingKey) {
							instruments[i].spectrum = key;
							instrChanged = true;
						}
					}
					if (instrChanged) {
						DB.set('instruments', instruments);
					}
				}
			}

			// Pri prepisovaní sa zachovajú existujúce metadáta (kategória, deletable, popis a podobne).
			var existingMeta = spectra[key] || {};

			// Uloženie farby, keďže všetky používajú formát keypoints.
			spectra[key] = {
				...(existingMeta.category ? { category: existingMeta.category } : {}),
				...(existingMeta.deletable === false ? { deletable: false } : {}),
				...(existingMeta.description ? { description: existingMeta.description } : {}),
				name: name,
				keypoints: JSON.parse(JSON.stringify(Setup.currentTimbre.keypoints)),
				// Zároveň uloženie referenčných dát pre spätnú kompatibilitu (prvý keypoint).
				data: JSON.parse(JSON.stringify(
					Setup.currentTimbre.keypoints[0]?.data || [[1, 1]]
				))
			};

			if (typeof EnvelopeUI !== 'undefined' && EnvelopeUI.saveToTimbre) {
				EnvelopeUI.saveToTimbre(spectra[key]);
			}

			if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan) {
				DynamicTimbre.partialPan.applyToCurrentTimbre();
				var currentTimbre = DynamicTimbre.partialPan._getCurrentTimbre();
				if (currentTimbre) {
					spectra[key].partialPan = currentTimbre.partialPan;
					spectra[key].partialPanMode = currentTimbre.partialPanMode;
					spectra[key].partialPanSpread = currentTimbre.partialPanSpread;
					spectra[key].partialPanRule = currentTimbre.partialPanRule;
				}
			}

			DB.set('spectra', spectra);
			window.spectra = spectra;

			if (window.scalesExt) {
				for (const scaleKey of Object.keys(window.scalesExt)) {
					const scaleExt = window.scalesExt[scaleKey];
					if (scaleExt?.orderedPartials) {
						for (let mode = 0; mode < 3; mode++) {
							if (scaleExt.orderedPartials[mode]) {
								delete scaleExt.orderedPartials[mode][key];
							}
						}
					}
				}
			}

			if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
				DB.calculateOrderedPartials();
			}

			// EditorLists sa aktualizuje, ak je k dispozícii, a to bez opätovného načítania, pretože stav je už správny.
			if (typeof EditorLists !== 'undefined') {
				EditorLists.selectedTimbre = key;
				EditorLists.populateTimbreList(false);
			}
			
			// Starý dropdown sa aktualizuje, ak existuje; handler sa dočasne odstráni, aby sa zabránilo opätovnému načítaniu.
			Setup.timbre.populateSelect();
			var oldSelect = sel('.timbre-select');
			if (oldSelect) {
				// Handler udalosti change sa uloží a odstráni, aby sa nespustil load().
				oldSelect.value = key;
			}
			
			Setup.tuning.populateInstrumentSelect();
			if (UI && UI.select && UI.select.refreshAllSpectraDropdowns) {
				UI.select.refreshAllSpectraDropdowns();
			}

			Setup.timbre.render();
			if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();
			
			// Aktualizácia syntetizátorov pre všetky stopy používajúce danú farbu.
			const instruments = DB.get('instruments');
			if (instruments && typeof synths !== 'undefined') {
				for (let i = 0; i < instruments.length; i++) {
					if (instruments[i].spectrum === key) {
						if (synths[i]) {
							synths[i].dispose();
						}

						var timbre = spectra[key];
						var partialsData = typeof DynamicTimbre !== 'undefined'
							? DynamicTimbre.getPartialsAtPitch(timbre, 60)
							: getTimbrePartials(timbre, 60);
						var spectraPartials = partialsData.map(m => m[1]);

						if (!window.trackPanners) window.trackPanners = [];
						if (!window.trackPanners[i]) {
							var pan = instruments[i].pan || 0;
							window.trackPanners[i] = new Tone.Panner(pan).connect(
								typeof masterLimiter !== 'undefined' ? masterLimiter : Tone.Destination
							);
						}

						var env = timbre?.envelope || {};
						var envAttack = env.a !== undefined ? env.a : 0.01;
						var envDecay = env.d !== undefined ? env.d : 0.1;
						var envSustain = env.s !== undefined ? env.s : 0.8;
						var envRelease = env.r !== undefined ? env.r : 0.3;
						
						synths[i] = new Tone.PolySynth({
							volume: instruments[i].volume || -12
						}).connect(window.trackPanners[i]);
						
						synths[i].set({
							oscillator: { type: 'custom', partials: spectraPartials },
							envelope: {
								attack: envAttack,
								decay: envDecay,
								sustain: envSustain,
								release: envRelease
							}
						});
					}
				}
			}
			

			// Opätovné spustenie stôp používajúcich danú farbu, aby sa zmeny prejavili pri prehrávaní.
			if (typeof PlaybackManager !== 'undefined' && instruments) {
				for (let i = 0; i < instruments.length; i++) {
					if (instruments[i].spectrum === key) {
						PlaybackManager.retriggerTrack(i);
					}
				}
			}

			if (typeof Canvas !== 'undefined' && Canvas.refreshTimbreCache) {
				Canvas.refreshTimbreCache(key);
			}

			showStatus(`Timbre "${name}" saved`, { type: 'success' });

			} finally {
				Setup.timbre._saving = false;
			}
		},
		
		delete: async () => {
			var key = (typeof EditorLists !== 'undefined' && EditorLists.selectedTimbre)
				? EditorLists.selectedTimbre
				: sel('.timbre-select')?.value;

			if (!key || key === '_new') {
				showStatus('No timbre selected', { type: 'warning' });
				return;
			}

			var spectra = DB.get('spectra');
			if (!spectra) return;
			var timbreName = spectra[key]?.name || key;

			if (!await showConfirm(`Delete timbre "${timbreName}"?`, { title: 'Delete Timbre', type: 'danger' })) return;
			
			// Kontrola, či nejaké nástroje alebo stopy používajú danú farbu, a ich reset na 'sawtooth'.
			var instruments = DB.get('instruments');
			var tracksReset = 0;
			var affectedTracks = [];
			
			if (instruments && instruments.length > 0) {
				for (let i = 0; i < instruments.length; i++) {
					if (instruments[i].spectrum === key) {
						instruments[i].spectrum = DEFAULT_SPECTRUM;
						tracksReset++;
						affectedTracks.push(i);

						if (typeof synths !== 'undefined' && synths[i] && typeof spectra !== 'undefined' && spectra[DEFAULT_SPECTRUM]) {
							var sawtoothPartials = (typeof getTimbrePartials === 'function' ? getTimbrePartials(spectra[DEFAULT_SPECTRUM]) : (spectra[DEFAULT_SPECTRUM].data || [[1,1]])).map(m => m[1]);
							synths[i].set({
								oscillator: {
									type: "custom",
									partials: sawtoothPartials
								}
							});
						}
					}
				}
				
				if (tracksReset > 0) {
					DB.set('instruments', instruments);
					
					// Opätovné spustenie dotknutých stôp, aby používali novú farbu.
					if (typeof PlaybackManager !== 'undefined') {
						for (const trackIdx of affectedTracks) {
							PlaybackManager.retriggerTrack(trackIdx);
						}
					}
				}
			}

			delete spectra[key];
			DB.set('spectra', spectra);
			window.spectra = spectra;

			if (typeof EditorLists !== 'undefined') {
				EditorLists.selectedTimbre = null;
				EditorLists.populateTimbreList();
			}

			Setup.timbre.populateSelect();
			var oldSelect = sel('.timbre-select');
			if (oldSelect) {
				oldSelect.value = '_new';
				Setup.timbre.load();
			}

			Setup.tuning.populateInstrumentSelect();
			if (UI && UI.select && UI.select.refreshAllSpectraDropdowns) {
				UI.select.refreshAllSpectraDropdowns();
			}

			if (tracksReset > 0) {
				showStatus(`Timbre deleted. ${tracksReset} track(s) were using it and have been reset to Sawtooth.`, { type: 'success' });
			} else {
				showStatus('Timbre deleted', { type: 'success' });
			}
			
		},
		
		export: () => {
			var key = Setup.currentTimbre?.key ||
				(typeof EditorLists !== 'undefined' && EditorLists.selectedTimbre) ||
				sel('.timbre-select')?.value;
			
			if (!key || key === '_new') {
				showStatus('No timbre selected to export. Save the timbre first.', { type: 'warning' });
				return;
			}
			
			var spectra = DB.get('spectra') || {};
			var timbre = spectra[key];
			
			if (!timbre) {
				showStatus('Timbre not found', { type: 'error' });
				return;
			}
			
			var migrated = typeof DynamicTimbre !== 'undefined'
				? DynamicTimbre.migrate(timbre)
				: timbre;

			var exportData = {
				spectraType: 'timbre',
				version: 2,
				name: migrated.name || timbre.name,
				keypoints: migrated.keypoints,
				// Dáta prvého keypointu, ponechané pre spätnú kompatibilitu.
				data: migrated.keypoints[0]?.data || [[1, 1]],
				exportedAt: new Date().toISOString()
			};

			var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a');
			a.href = url;
			a.download = `${timbre.name.replace(/[^a-z0-9]/gi, '_')}.timbre.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		},
		
		import: (e) => {
			var file = e.target.files[0];
			if (!file) return;

			var reader = new FileReader();
			reader.onload = async (event) => {
				try {
					var imported = JSON.parse(event.target.result);

					if (imported.spectraType !== 'timbre') {
						showStatus('Invalid timbre file format', { type: 'error' });
						return;
					}

					if ((!imported.data || !Array.isArray(imported.data)) &&
						(!imported.keypoints || !Array.isArray(imported.keypoints))) {
						showStatus('Invalid timbre data', { type: 'error' });
						return;
					}

					var timbreData = typeof DynamicTimbre !== 'undefined'
						? DynamicTimbre.migrate(imported)
						: {
							name: imported.name,
							keypoints: imported.keypoints || [{ pitch: 60, data: imported.data }]
						};
					timbreData.name = imported.name;

					var spectra = DB.get('spectra') || {};
					var key = imported.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

					if (spectra[key]) {
						if (!await showConfirm(`Timbre "${imported.name}" already exists. Overwrite?`, { title: 'Overwrite Timbre', type: 'warning' })) {
							return;
						}
					}
					
					spectra[key] = timbreData;
					DB.set('spectra', spectra);
					window.spectra = spectra;

					if (typeof EditorLists !== 'undefined') {
						EditorLists.populateTimbreList();
						EditorLists.selectedTimbre = key;
					}
					Setup.timbre.populateSelect();
					Setup.tuning.populateInstrumentSelect();

					if (UI && UI.select && UI.select.refreshAllSpectraDropdowns) {
						UI.select.refreshAllSpectraDropdowns();
					}

					Setup.currentTimbre = { ...timbreData, key, selectedKeypoint: 0 };
					sel('.timbre-name').value = timbreData.name;
					Setup.timbre.render();
					
					showStatus(`Timbre "${imported.name}" imported`, { type: 'success' });
				} catch (err) {
					Logger.error('Import error:', err);
					showStatus('Failed to import timbre: ' + err.message, { type: 'error' });
				}
			};
			reader.readAsText(file);

			e.target.value = '';
		},

		initAudioAnalyzer: () => {
		},
		

		
		getCurrentData: () => {
			if (!Setup.currentTimbre) return [];
			var idx = Setup.currentTimbre.selectedKeypoint || 0;
			return Setup.currentTimbre.keypoints?.[idx]?.data || [];
		},

		setCurrentData: (data) => {
			if (!Setup.currentTimbre) return;
			var idx = Setup.currentTimbre.selectedKeypoint || 0;
			if (Setup.currentTimbre.keypoints?.[idx]) {
				Setup.currentTimbre.keypoints[idx].data = data;
			}
		}
	}
};



document.addEventListener('DOMContentLoaded', () => {
	// Oneskorenie 100 ms, kým sa DB inicializuje.
	setTimeout(() => {
		Setup.init();
		if (window.HarmonicsChart) window.HarmonicsChart.init();

		if (window.SpectraOSC) {
			SpectraOSC.init();
		}

		if (window.WebMIDI) {
			WebMIDI.init().then(() => {
				WebMIDI.setupUI();

				window.midiInputPreview = {
					notes: new Map(), // číslo tónu -> { velocity, startTime, snappedPitch }
					enabled: true,
					sustainPedal: false, // Stav pedálu CC64.
					sustainedNotes: new Set()
				};

				window.midiNoteMapping = new Map();

				// Globálna množina všetkých vytvorených oscilátorov, vďaka ktorej sa dá zastaviť všetko aj vtedy, keď mapovanie nôt zlyhá.
				window.allMidiOscillators = window.allMidiOscillators || new Set();

				window.midiPreviewPanic = () => {
					Logger.log('MIDI Preview Panic: Stopping all oscillators');

					var now = typeof Tone !== 'undefined' ? Tone.now() : 0;
					var ctx = typeof Tone !== 'undefined' ? Tone.context?.rawContext : null;

					// Prvá metóda zastaví oscilátory vedené podľa tónu.
					if (window.midiOscillators) {
						for (const [note, data] of window.midiOscillators) {
							try {
								const { oscillators, masterGain } = data;
								if (masterGain?.gain) {
									masterGain.gain.cancelScheduledValues(now);
									masterGain.gain.setValueAtTime(0, now);
								}
								for (const partial of oscillators || []) {
									try {
										if (partial.gain?.gain) {
											partial.gain.gain.cancelScheduledValues(now);
											partial.gain.gain.setValueAtTime(0, now);
										}
										if (partial.osc) partial.osc.stop(now + 0.01);
									} catch (e) {}
								}
								setTimeout(() => {
									try {
										for (const partial of oscillators || []) {
											partial.osc?.disconnect();
											partial.gain?.disconnect();
											partial.panner?.disconnect();
										}
										masterGain?.disconnect();
									} catch (e) {}
								}, 50);
							} catch (e) {}
						}
						window.midiOscillators.clear();
					}

					// Druhá metóda zastaví oscilátory z globálnej množiny.
					if (window.allMidiOscillators) {
						for (const data of window.allMidiOscillators) {
							try {
								const { oscillators, masterGain } = data;
								if (masterGain?.gain) {
									masterGain.gain.cancelScheduledValues(now);
									masterGain.gain.setValueAtTime(0, now);
								}
								for (const partial of oscillators || []) {
									try {
										if (partial.gain?.gain) {
											partial.gain.gain.cancelScheduledValues(now);
											partial.gain.gain.setValueAtTime(0, now);
										}
										if (partial.osc) {
											try { partial.osc.stop(now + 0.01); } catch (e) {}
										}
									} catch (e) {}
								}
								setTimeout(() => {
									try {
										for (const partial of oscillators || []) {
											partial.osc?.disconnect();
											partial.gain?.disconnect();
											partial.panner?.disconnect();
										}
										masterGain?.disconnect();
									} catch (e) {}
								}, 50);
							} catch (e) {}
						}
						window.allMidiOscillators.clear();
					}

					// Tretia metóda stlmí natívny master bus.
					if (window.nativeMasterBus?.gain) {
						try {
							window.nativeMasterBus.gain.cancelScheduledValues(now);
							window.nativeMasterBus.gain.setValueAtTime(0, now);
							// Obnovenie po 100 ms.
							setTimeout(() => {
								try {
									window.nativeMasterBus.gain.setValueAtTime(1, Tone.now());
								} catch (e) {}
							}, 100);
						} catch (e) {}
					}

					window.midiNoteMapping?.clear();
					window.midiInputPreview?.notes?.clear();
					window.midiInputPreview?.sustainedNotes?.clear();
					if (window.midiInputPreview) window.midiInputPreview.sustainPedal = false;

					if (typeof synths !== 'undefined') {
						for (const synth of synths) {
							try { synth?.releaseAll?.(now); } catch (e) {}
						}
					}

					if (typeof PlaybackManager !== 'undefined' && PlaybackManager.workletNode) {
						try {
							PlaybackManager.workletNode.port.postMessage({ type: 'panic' });
						} catch (e) {}
					}

					Logger.log('MIDI Preview Panic: Complete');
				};

				var panicBtn = sel('.midi-panic');
				if (panicBtn) {
					panicBtn.addEventListener('click', () => {
						window.midiPreviewPanic?.();
					});
				}
				
				window.snapMidiToTuning = (midiNote, time, overrideTrackIdx) => {
					// Ladenie v aktuálnom čase, obmedzené zdola na 0 kvôli záporným hodnotám.
					var clampedTime = Math.max(0, time);
					var tuningKey = settings.scale || scale;
					// Zadaný index stopy má prednosť (pri MIDI vstupe), inak sa berie z Timeline.
					var trackIdx = overrideTrackIdx !== undefined ? overrideTrackIdx
						: (typeof Timeline !== 'undefined' && Timeline.getCurrentTrackIdx
							? Timeline.getCurrentTrackIdx() : 0);

					if (typeof getTuningAtTime === 'function') {
						tuningKey = getTuningAtTime(clampedTime);
					} else if (typeof Timeline !== 'undefined' && Timeline.getTrackEvents) {
						var trackEvents = Timeline.getTrackEvents(trackIdx);
						if (trackEvents && trackEvents.tuningChanges && trackEvents.tuningChanges.length > 0) {
							var sorted = [...trackEvents.tuningChanges].sort((a, b) => a.time - b.time);
							for (let i = sorted.length - 1; i >= 0; i--) {
								if (sorted[i].time <= clampedTime) {
									tuningKey = sorted[i].tuningKey;
									break;
								}
							}
						}
					}

					if (typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(tuningKey)) {
						return AdaptiveTuning.processPreviewInput(midiNote, trackIdx, tuningKey);
					}

					if (!scales[tuningKey] || !scales[tuningKey].notes) {
						Logger.warn('snapMidiToTuning: scale not found or has no notes:', tuningKey, 'available:', Object.keys(scales));
						return midiNote;
					}

					const scaleNotes = scales[tuningKey].notes;
					if (scaleNotes.length === 0) {
						return midiNote;
					}

					// Najbližší tón v stupnici sa hľadá podľa frekvencie, takže funguje pri ľubovoľnom rozlíšení ladenia.
					var targetFreq = 440 * Math.pow(2, (midiNote - 69) / 12);

					// Binárne vyhľadávanie najbližšej frekvencie.
					var lo = 0, hi = scaleNotes.length - 1;
					while (lo < hi) {
						var mid = (lo + hi) >>> 1;
						if (scaleNotes[mid][1] < targetFreq) lo = mid + 1;
						else hi = mid;
					}

					// Porovnanie indexov lo a lo-1, ktorý z nich je bližšie.
					var bestIdx = lo;
					if (lo > 0) {
						var distLo = Math.abs(Math.log2(scaleNotes[lo][1] / targetFreq));
						var distPrev = Math.abs(Math.log2(scaleNotes[lo - 1][1] / targetFreq));
						if (distPrev < distLo) bestIdx = lo - 1;
					}

					var result = freq2note_440(scaleNotes[bestIdx][1]);
					if (Math.abs(result - midiNote) > 0.01) {
						Logger.log('snapMidiToTuning: snapped', midiNote.toFixed(2), '->', result.toFixed(2), 'tuning:', tuningKey, 'scaleNotes:', scaleNotes.length);
					}
					return result;
				};

				window.snapMidiToPartial = (midiNote, time) => {
					var pitchCenter = window.midiPitchCenter ?? 69;
					var trackIdx = typeof Timeline !== 'undefined' && Timeline.getCurrentTrackIdx
						? Timeline.getCurrentTrackIdx() : 0;

					var tuningKey = settings.scale || scale;
					if (typeof getTuningAtTime === 'function') {
						tuningKey = getTuningAtTime(time);
					} else if (typeof Timeline !== 'undefined' && Timeline.getTrackEvents) {
						var trackEvents = Timeline.getTrackEvents(trackIdx);
						if (trackEvents?.tuningChanges?.length > 0) {
							var sorted = [...trackEvents.tuningChanges].sort((a, b) => a.time - b.time);
							for (let i = sorted.length - 1; i >= 0; i--) {
								if (sorted[i].time <= time) {
									tuningKey = sorted[i].tuningKey;
									break;
								}
							}
						}
					}

					// Identifikátor spektra pre aktuálnu stopu.
					var spectrumKey = instruments[trackIdx]?.spectrum || DEFAULT_SPECTRUM;

					var partialMode = settings.orderedPartialsSelection || 0;

					var orderedPartials = typeof DB !== 'undefined' && DB.getOrderedPartials
						? DB.getOrderedPartials(tuningKey, spectrumKey, partialMode)
						: null;

					if (!orderedPartials || orderedPartials.length === 0) {
						return {
							pitch: window.snapMidiToTuning ? window.snapMidiToTuning(midiNote, time) : midiNote,
							partialInfo: null
						};
					}

					// Stredový parciál, najbližší k A4 (440 Hz).
					var centerIndex = 0;
					var centerDistance = Infinity;
					for (let i = 0; i < orderedPartials.length; i++) {
						const partialFreq = orderedPartials[i][0];
						var distance = Math.abs(Math.log2(partialFreq / 440));
						if (distance < centerDistance) {
							centerDistance = distance;
							centerIndex = i;
						}
					}

					var offset = midiNote - pitchCenter;

					var targetIndex = centerIndex + offset;

					// Maximálny platný index v rámci limitu parciálov.
					var maxIndex = orderedPartials.length - 1;
					if (window.partialLimit > 0) {
						for (let i = orderedPartials.length - 1; i >= 0; i--) {
							if (orderedPartials[i][4] <= window.partialLimit) {
								maxIndex = i;
								break;
							}
						}
					}

					if (targetIndex < 0) targetIndex = 0;
					if (targetIndex > maxIndex) targetIndex = maxIndex;

					// orderedPartials[i] = [freq, noteNum, scaleNote, ratio, partialNum].
					var targetPartial = orderedPartials[targetIndex];
					const partialFreq = targetPartial[0];
					var partialNoteNum = targetPartial[1];
					var scaleNote = targetPartial[2]; // [noteNumber, frequency, ...].
					var ratio = targetPartial[3];
					var partialNum = targetPartial[4];

					var fundamentalFreq = scaleNote[1];
					var fundamentalNote = freq2note(fundamentalFreq);

					return {
						pitch: fundamentalNote, // Použité pri prehrávaní.
						partialInfo: {
							index: targetIndex,
							frequency: partialFreq,
							fundamental: fundamentalFreq,
							fundamentalNote: fundamentalNote,
							partialPitch: partialNoteNum, // Pri nahrávaní ide o skutočnú výšku parciálu.
							ratio: ratio,
							partialNum: partialNum,
							tuningKey: tuningKey,
							spectrumKey: spectrumKey
						}
					};
				};

				// Stav nahrávania MIDI.
				window.midiRecording = {
					active: false,
					notes: new Map(), // číslo tónu -> { startTime, velocity, instIdx, noteIdx }
					finalizedNotes: new Set(), // Množina reťazcov "instIdx-noteIdx" pre noty, ktoré sú stále v prebiehajúcom nahrávaní.
					insertedNotes: [], // {instIdx, noteIdx}

					start: () => {
						window.midiRecording.active = true;
						window.midiRecording.notes.clear();
						window.midiRecording.finalizedNotes.clear();
						window.midiRecording.insertedNotes = [];

						var recordBtn = sel('.playback-record-button');
						if (recordBtn) {
							recordBtn.classList.add('recording');
							recordBtn.style.color = '#f44';
							recordBtn.blur();
						}

						// Nastavenie zamerania na plátno, aby fungoval medzerník.
						var canvas = sel('#canvasElement');
						if (canvas) canvas.focus();

						if (!playback.playing) {
							document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 32, bubbles: true }));
							document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 32, bubbles: true }));
						}
						
						Logger.log('MIDI Recording started');
					},
					
					stop: () => {
						if (!window.midiRecording.active) return;

						window.midiRecording.active = false;

						for (let [note, noteData] of window.midiRecording.notes) {
							if (noteData.noteIdx >= 0 && MIDI.data[noteData.instIdx]) {
								var midiNote = MIDI.data[noteData.instIdx][noteData.noteIdx];
								if (midiNote) {
									var releaseTime = 0.05;
									try {
										var timbre = instruments[noteData.instIdx]?.timbre;
										if (timbre && typeof Envelope !== 'undefined') {
											var env = Envelope.getForPartial(timbre, 1);
											releaseTime = env.r || 0.05;
										}
									} catch (e) {}

									midiNote[1] = (playback.time - midiNote[0]) + releaseTime;
								}
							}
							window.midiRecording.finalizeNote(noteData.instIdx, noteData.noteIdx);
						}
						window.midiRecording.notes.clear();
						window.midiRecording.finalizedNotes.clear();

						// Jeden záznam kroku vzad, aby Ctrl+Z odstránil celý nahratý úsek.
						if (typeof UndoManager !== 'undefined' && UndoManager.recordMultiTrackDelta
								&& window.midiRecording.insertedNotes.length > 0) {
							var trackChanges = {};
							for (const { instIdx, noteIdx } of window.midiRecording.insertedNotes) {
								var rec = MIDI.data[instIdx] && MIDI.data[instIdx][noteIdx];
								if (!rec) continue;
								(trackChanges[instIdx] = trackChanges[instIdx] || [])
									.push({ noteIndex: noteIdx, before: null, after: structuredClone(rec) });
							}
							if (Object.keys(trackChanges).length) {
								UndoManager.recordMultiTrackDelta('Record MIDI', trackChanges);
							}
						}
						window.midiRecording.insertedNotes = [];

						DB.set('MIDIdata', MIDI.data);

						var recordBtn = sel('.playback-record-button');
						if (recordBtn) {
							recordBtn.classList.remove('recording');
							recordBtn.style.color = '';
						}
						
						Logger.log('MIDI Recording stopped');
					},
					
					toggle: () => {
						if (window.midiRecording.active) {
							window.midiRecording.stop();
						} else {
							window.midiRecording.start();
						}
					},
					
					// Vytvorí notu v MIDI.data a vráti jej index; partialInfo je voliteľné a ak je zadané (z MIDI Partial Mode), nastaví konkrétny parciál.
					createNote: (midiNote, startTime, velocity, instIdx, partialInfo = null) => {
						if (typeof Canvas !== 'undefined' && Canvas.magnetMode && typeof gridSize !== 'undefined') {
							startTime = Math.round(startTime * gridSize) / gridSize;
						}

						var instrument = instruments[instIdx];
						if (!instrument) return -1;

						// Kontrola, či má nástroj platné dáta spektra, v starom formáte .data aj v novom .keypoints.
						var timbreObj = spectra[instrument.spectrum];
						var spectrumData = typeof getTimbrePartials === 'function'
							? getTimbrePartials(timbreObj)
							: (timbreObj?.data || timbreObj?.keypoints?.[0]?.data);
						if (!spectrumData || !spectrumData.length) return -1;

						var notePitch = midiNote;
						var partialNum = 1;

						if (partialInfo) {
							notePitch = partialInfo.partialPitch;
							partialNum = partialInfo.partialNum;
						}

						var newNote = [
							startTime,
							NOTE_MIN_LENGTH,
							notePitch,
							partialNum, // Číslo parciálu (z partialInfo alebo 1 pre fundamentál).
							null, // Dáta parciálov sa generujú v canvas.js.
							0, // Nevybrané
							0  // Hĺbka
						];

						MIDI.data[instIdx].push(newNote);
						var newIdx = MIDI.data[instIdx].length - 1;

						if (window.midiRecording.active) {
							window.midiRecording.insertedNotes.push({ instIdx, noteIdx: newIdx });
						}

						return newIdx;
					},

					finalizeNote: (instIdx, noteIdx) => {
						if (!MIDI.data[instIdx] || !MIDI.data[instIdx][noteIdx]) return;

						var note = MIDI.data[instIdx][noteIdx];

						if (typeof Canvas !== 'undefined' && Canvas.magnetMode && typeof gridSize !== 'undefined') {
							note[N_TIME] = Math.round(note[N_TIME] * gridSize) / gridSize;

							var duration = Math.round(note[N_DUR] * gridSize) / gridSize;
							if (duration < NOTE_MIN_LENGTH) duration = NOTE_MIN_LENGTH;
							note[N_DUR] = duration;
						}

						if (note[N_DUR] < NOTE_MIN_LENGTH) note[N_DUR] = NOTE_MIN_LENGTH;

						// Odstránenie cache parciálov, aby sa parciály znova vygenerovali z prichytených dát.
						note[N_DATA] = null;

						// Nota sa označí za dokončenú, aby sa neprehrala dvakrát.
						window.midiRecording.finalizedNotes.add(`${instIdx}-${noteIdx}`);

						Logger.log(`Finalized note: ${note[N_PITCH]} at ${note[N_TIME].toFixed(3)}, duration ${note[N_DUR].toFixed(3)}`);
					},
					
					// Aktualizácia trvania nahrávaných nôt, spúšťa sa z vykresľovacieho cyklu plátna.
					updateActiveNotes: () => {
						if (!window.midiRecording.active) return;

						var currentTime = playback.time;
						for (let [midiNote, noteData] of window.midiRecording.notes) {
							if (noteData.noteIdx >= 0 && MIDI.data[noteData.instIdx]) {
								var note = MIDI.data[noteData.instIdx][noteData.noteIdx];
								if (note) {
									var newDuration = currentTime - note[N_TIME];
									if (newDuration < NOTE_MIN_LENGTH) newDuration = NOTE_MIN_LENGTH;
									note[N_DUR] = newDuration;

									if (note[N_DATA] && note[N_DATA].partials) {
										for (let partial of note[N_DATA].partials) {
											partial[P_X] = note[N_TIME];
											partial[P_W] = newDuration;
										}
									}
								}
							}
						}
					}
				};

				var recordBtn = sel('.playback-record-button');
				if (recordBtn) {
					recordBtn.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						window.midiRecording.toggle();
					});
				}

				var getSelectedInstrumentIndex = () => {
					if (typeof primaryTrackIndex !== 'undefined' && primaryTrackIndex >= 0) {
						return primaryTrackIndex;
					}
					if (typeof instruments === 'undefined') return 0;
					for (let i = 0; i < instruments.length; i++) {
						if (instruments[i].selected) return i;
					}
					return 0;
				};

				WebMIDI.onNoteOn = (note, velocity, channel) => {
					var instIdx = getSelectedInstrumentIndex();
					var currentTime = Math.max(0, typeof playback !== 'undefined'
						? (playback.playing ? playback.time : (playback.midiTime !== undefined ? playback.midiTime : playback.time))
						: 0);

					Logger.log('MIDI noteOn:', note, 'time:', currentTime, 'scale:', settings.scale, 'window.scale:', window.scale, 'partialMode:', !!window.midiPartialMode, 'snapFn:', !!window.snapMidiToTuning);

					var snappedPitch;
					var partialInfo = null;

					if (window.midiPartialMode && window.snapMidiToPartial) {
						var result = window.snapMidiToPartial(note, currentTime);
						snappedPitch = result.pitch;
						partialInfo = result.partialInfo;
					} else {
						// Bežný režim ladenia odovzdá instIdx na vyhľadanie farby.
						snappedPitch = window.snapMidiToTuning ?
							window.snapMidiToTuning(note, currentTime, instIdx) : note;
					}

					// Uloženie mapovania, aby bolo možné ukončiť správny tón.
					window.midiNoteMapping.set(note, snappedPitch);
					if (partialInfo) {
						if (!window.midiPartialMapping) window.midiPartialMapping = new Map();
						window.midiPartialMapping.set(note, partialInfo);
					}

					var freq = note2freq(snappedPitch);
					if (freq > 20000 || freq < 20) {
						Logger.warn('MIDI preview: abnormal freq', freq, 'snappedPitch', snappedPitch, 'input note', note, 'scale', settings.scale);
					}
					var now = Tone.now();

					if (instIdx < 0 || !instruments || instIdx >= instruments.length) {
						Logger.warn('MIDI input: Invalid instrument index', instIdx);
						return;
					}

					// Priame oscilátory s ADSR pre každý parciál, pre neharmonické farby.
					var timbre = typeof spectra !== 'undefined' && typeof instruments !== 'undefined'
						? spectra[instruments[instIdx].spectrum] : null;

					if (timbre && typeof Tone !== 'undefined') {
						var ctx = Tone.context.rawContext;
						if (ctx && ctx.state === 'running') {
							var partialsData = typeof DynamicTimbre !== 'undefined'
								? DynamicTimbre.getPartialsAtPitch(timbre, snappedPitch)
								: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, snappedPitch) : null);
							if (partialsData && partialsData.length > 0) {
								var oscillators = [];
								var masterGain = ctx.createGain();

								try {
									var destination = (window.nativeMasterBus && window.nativeMasterBus.context === ctx)
										? window.nativeMasterBus
										: ctx.destination;
									masterGain.connect(destination);
								} catch (e) {
									try {
										masterGain.connect(ctx.destination);
									} catch (e2) {
										Logger.warn('MIDI input: Could not connect audio');
										return;
									}
								}

								var trackPan = instruments[instIdx]?.pan || 0;

								// Hlavný zisk riadi celkovú silu stlačenia a znižuje sa podľa počtu aktívnych tónov, aby sa predišlo orezaniu amplitúdy.
								var activeNotes = window.midiOscillators ? window.midiOscillators.size + 1 : 1;
								var gainCompensation = 1 / Math.sqrt(activeNotes);
								masterGain.gain.setValueAtTime(0.15 * (velocity / 127) * gainCompensation, now);

								var maxPartials = Math.min(partialsData.length, 32);
								var oscCount = 0;
								for (let i = 0; i < maxPartials; i++) {
									var ratio = partialsData[i]?.[0] || (i + 1);
									var amp = partialsData[i]?.[1] || 0;
									if (amp < 0.01) continue;

									// Obálka pre jednotlivý parciál (index od 1 pre Envelope API).
									var env = typeof Envelope !== 'undefined'
										? Envelope.getForPartial(timbre, i + 1)
										: { a: 0.005, d: 0, s: 1, r: 0.05 };

									var partialPan = 0;
									if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan) {
										partialPan = DynamicTimbre.partialPan.getPanForPartial(i, partialsData.length, timbre);
									}

									// Kombinácia panorámy stopy s panorámou parciálu.
									var finalPan;
									if (partialPan >= 0) {
										finalPan = trackPan + partialPan * (1 - trackPan);
									} else {
										finalPan = trackPan + partialPan * (1 + trackPan);
									}
									finalPan = Math.max(-1, Math.min(1, finalPan));

									var panner = ctx.createStereoPanner();
									panner.pan.value = finalPan;

									var osc = ctx.createOscillator();
									var gain = ctx.createGain();
									osc.type = 'sine';
									osc.frequency.value = freq * ratio;
									gain.gain.value = 0;
									osc.connect(gain);
									gain.connect(panner);
									panner.connect(masterGain);
									osc.start(now);

									var attackTime = env.a || 0.005;
									var decayTime = env.d || 0;
									var sustainLevel = env.s !== undefined ? env.s : 1;

									gain.gain.setValueAtTime(0, now);
									gain.gain.linearRampToValueAtTime(amp, now + attackTime);

									if (decayTime > 0 && sustainLevel < 1) {
										gain.gain.linearRampToValueAtTime(amp * sustainLevel, now + attackTime + decayTime);
									}

									oscillators.push({
										osc,
										gain,
										panner,
										env,
										amp,
										sustainLevel: amp * sustainLevel
									});
									oscCount++;
								}

								if (oscCount > 0) {
									if (!window.midiOscillators) window.midiOscillators = new Map();

									// Zastavenie existujúcich oscilátorov pre daný tón.
									if (window.midiOscillators.has(note)) {
										var old = window.midiOscillators.get(note);
										try {
											old.masterGain?.gain?.setValueAtTime(0, now);
											for (const p of old.oscillators || []) {
												try { p.osc?.stop(now + 0.01); } catch (e) {}
											}
											setTimeout(() => {
												try {
													for (const p of old.oscillators || []) {
														p.osc?.disconnect();
														p.gain?.disconnect();
														p.panner?.disconnect();
													}
													old.masterGain?.disconnect();
												} catch (e) {}
											}, 50);
											window.allMidiOscillators?.delete(old);
										} catch (e) {}
									}

									var oscData = { oscillators, masterGain, noteOnTime: now, velocity };
									window.midiOscillators.set(note, oscData);
									window.allMidiOscillators?.add(oscData);

									// Aktualizácia zisku všetkých aktívnych tónov kvôli vyrovnaniu celkovej hlasitosti.
									var totalNotes = window.midiOscillators.size;
									var newCompensation = 1 / Math.sqrt(totalNotes);
									for (const [, d] of window.midiOscillators) {
										if (d.masterGain?.gain) {
											var v = (d.velocity || 100) / 127;
											d.masterGain.gain.setValueAtTime(0.15 * v * newCompensation, now);
										}
									}
								} else {
									masterGain.disconnect();
									if (typeof synths !== 'undefined' && synths[instIdx]) {
										synths[instIdx].triggerAttack(freq, now, velocity / 127);
									}
								}
							} else if (typeof synths !== 'undefined' && synths[instIdx]) {
								synths[instIdx].triggerAttack(freq, now, velocity / 127);
							}
						} else {
							Logger.warn('MIDI input: Audio context not running');
						}
					} else if (typeof synths !== 'undefined' && synths[instIdx]) {
						synths[instIdx].triggerAttack(freq, now, velocity / 127);
					} else {
						Logger.warn('MIDI input: No synth available for track', instIdx);
					}
					
					// Sledovanie tónu na predprehrávanie (v záložke Write).
					if (window.pageNumber === 2 && window.midiInputPreview) {
						window.midiInputPreview.notes.set(note, {
							velocity: velocity,
							startTime: currentTime,
							snappedPitch: snappedPitch
						});

					}

					if (window.midiRecording && window.midiRecording.active) {
						var startTime = playback.time;
						// partialInfo z mapovania, nastavené skôr pri zapnutom režime parciálu.
						var recordPartialInfo = window.midiPartialMapping?.get(note) || null;
						var noteIdx = window.midiRecording.createNote(snappedPitch, startTime, velocity, instIdx, recordPartialInfo);

						window.midiRecording.notes.set(note, {
							startTime: startTime,
							velocity: velocity,
							instIdx: instIdx,
							noteIdx: noteIdx,
							snappedPitch: snappedPitch,
							partialInfo: recordPartialInfo
						});
					}
				};

				WebMIDI.onNoteOff = (note, channel) => {
					try {
						Logger.log('MIDI noteOff:', note, 'hasMapping:', window.midiNoteMapping?.has(note), 'hasOsc:', window.midiOscillators?.has(note));

						// Ochrana proti duplicitnému noteOff (niektoré kontroléry posielajú aj 0x80 alebo 0x90 s velocity 0).
						if (!window.midiNoteMapping || !window.midiNoteMapping.has(note)) {
							Logger.log('MIDI noteOff: SKIPPED (no mapping)');
							return;
						}

						if (window.midiInputPreview?.sustainPedal) {
							// Označenie tónu ako podržaného, uvoľní sa po pustení pedálu.
							window.midiInputPreview.sustainedNotes.add(note);
							return;
						}

						var instIdx = getSelectedInstrumentIndex();
						var now = Tone.now();

						var snappedPitch = window.midiNoteMapping.get(note) || note;

						if (window.midiOscillators && window.midiOscillators.has(note)) {
							var oscData = window.midiOscillators.get(note);
							const { oscillators, masterGain, noteOnTime } = oscData;

							// Doznenie obálky sa na jednotlivé parciály uplatní plynulým exponenciálnym poklesom.
							var maxReleaseTime = 0.05;
							for (const partial of oscillators) {
								const { gain, env } = partial;
								const releaseTime = Math.max(env?.r || 0.05, 0.03);
								maxReleaseTime = Math.max(maxReleaseTime, releaseTime);

								var timeConstant = releaseTime / 5;
								try {
									gain.gain.cancelScheduledValues(now);
									gain.gain.setTargetAtTime(0, now, timeConstant);
								} catch (e) {}
							}

							// Zastavenie sa naplánuje na koniec najdlhšieho doznenia, s rezervou 0,1 s na exponenciálne doznenie.
							var stopTime = now + maxReleaseTime + 0.1;
							for (const { osc } of oscillators) {
								try { osc.stop(stopTime); } catch(e){}
							}

							var cleanupDelay = (maxReleaseTime + 0.15) * 1000;
							setTimeout(() => {
								for (const { osc, gain, panner } of oscillators) {
									try {
										osc.disconnect();
										gain.disconnect();
										if (panner) panner.disconnect();
									} catch (e) {}
								}
								try { masterGain.disconnect(); } catch (e) {}
								window.allMidiOscillators?.delete(oscData);
							}, cleanupDelay);
							window.midiOscillators.delete(note);
						} else if (typeof synths !== 'undefined' && synths[instIdx]) {
							var freq = note2freq(snappedPitch);
							try { synths[instIdx].triggerRelease(freq, now); } catch (e) {}
						}

						// Mapovanie sa odstráni vždy, aj keď doznenie zlyhalo.
						window.midiNoteMapping.delete(note);
						// v režime parciálu sa odstráni mapovanie parciálov.
						if (window.midiPartialMapping) {
							window.midiPartialMapping.delete(note);
						}

						if (window.midiInputPreview) {
							window.midiInputPreview.notes.delete(note);
						}

						if (window.midiRecording && window.midiRecording.active && window.midiRecording.notes.has(note)) {
							var noteData = window.midiRecording.notes.get(note);

							if (noteData.noteIdx >= 0 && MIDI.data[noteData.instIdx]) {
								var midiNote = MIDI.data[noteData.instIdx][noteData.noteIdx];
								if (midiNote) {
									let releaseTime = 0.05;
									try {
										var timbre = instruments[noteData.instIdx]?.timbre;
										if (timbre && typeof Envelope !== 'undefined') {
											const env = Envelope.getForPartial(timbre, 1);
											releaseTime = env.r || 0.05;
										}
									} catch (e) {}

									// Predĺženie trvania noty o dĺžku doznenia, aby zaznela celá obálka.
									midiNote[1] = (playback.time - midiNote[0]) + releaseTime;
								}
							}

							window.midiRecording.finalizeNote(noteData.instIdx, noteData.noteIdx);
							window.midiRecording.notes.delete(note);
						}
					} catch (e) {
						Logger.error('MIDI note-off error:', e);
						window.midiNoteMapping?.delete(note);
						window.midiOscillators?.delete(note);
						window.midiInputPreview?.notes?.delete(note);
					}
				};

				// Spracovanie MIDI Control Change (CC64 = sustain pedál).
				WebMIDI.onControlChange = (cc, value, channel) => {
					if (cc === 64) {
						var pedalDown = value >= 64;

						if (window.midiInputPreview) {
							var wasDown = window.midiInputPreview.sustainPedal;
							window.midiInputPreview.sustainPedal = pedalDown;

							if (wasDown && !pedalDown) {
								var sustainedNotes = Array.from(window.midiInputPreview.sustainedNotes);
								window.midiInputPreview.sustainedNotes.clear();

								for (const note of sustainedNotes) {
									WebMIDI.onNoteOff(note, channel);
								}
							}
						}
					}
				};
			});
		}
	}, 100);
});


// Spektrogram
var audioFileButton = sel('.audio-file-button');
if (audioFileButton) {
	audioFileButton.addEventListener('click', () => {
		sel('.audio-file-input').click();
	});
}

var audioFileInput = sel('.audio-file-input');
if (audioFileInput) {
	audioFileInput.addEventListener('change', async (e) => {
		var file = e.target.files[0];
		if (!file) return;

		sel('.audio-file-name').textContent = file.name;
		sel('.spectrogram-container').style.display = 'block';
		sel('.analyzer-controls').style.display = 'block';
		sel('.analyzer-instructions').style.display = 'none';
		sel('.analyzer-info').style.display = 'none';

		AudioAnalyzer.selectionStart = 0;
		AudioAnalyzer.selectionEnd = 1;

		try {
			await AudioAnalyzer.loadFile(file);
			Logger.log('Audio file loaded successfully');
		} catch (error) {
			Logger.error('Error loading audio file:', error);
			showStatus('Error loading audio file: ' + error.message, { type: 'error' });
		}
	});
}

var analyzerExtractButton = sel('.analyzer-extract-button');
if (analyzerExtractButton) {
	analyzerExtractButton.addEventListener('click', () => {
		if (Math.abs(AudioAnalyzer.selectionEnd - AudioAnalyzer.selectionStart) < 0.01) {
			showStatus('Drag to select a region on the spectrogram', { type: 'warning' });
			return;
		}
		
		var maxPartials = parseInt(sel('.analyzer-max-partials').value);
		var threshold = parseFloat(sel('.analyzer-threshold').value) / 100;
		
		var result = AudioAnalyzer.extractHarmonics(maxPartials, threshold);
		
		if (result) {
			sel('.timbre-partials-count').value = result.harmonics.length;
			
			var harmonicsData = result.harmonics.map(h => [...h]);
			Setup.currentTimbre = {
				keypoints: [{ pitch: 60, data: harmonicsData }],
				selectedKeypoint: 0
			};
			
			Setup.timbre.render();
			if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();

			var info = sel('.analyzer-info');
			if (info) {
				var selStart = (AudioAnalyzer.selectionStart * AudioAnalyzer.spectrogramData.duration).toFixed(2);
				var selEnd = (AudioAnalyzer.selectionEnd * AudioAnalyzer.spectrogramData.duration).toFixed(2);
				info.innerHTML = `
					<strong>Analysis Results:</strong><br>
					Fundamental: ${result.fundamental.toFixed(2)} Hz<br>
					Time range: ${selStart}s - ${selEnd}s<br>
					Extracted ${result.harmonics.length} partials from ${result.peakCount} detected peaks
				`;
				info.style.display = 'block';
			}
		}
	});
}

var analyzerThreshold = sel('.analyzer-threshold');
var analyzerThresholdValue = sel('.analyzer-threshold-value');
if (analyzerThreshold && analyzerThresholdValue) {
	analyzerThreshold.addEventListener('change', (e) => {
		analyzerThresholdValue.textContent = e.target.value + '%';
	});
}


Setup.timbre.initAudioAnalyzer = () => {
	var audioFileButton = sel('.audio-file-button');
	if (audioFileButton) {
		audioFileButton.addEventListener('click', () => {
			sel('.audio-file-input').click();
		});
	}

	var audioFileInput = sel('.audio-file-input');
	if (audioFileInput) {
		audioFileInput.addEventListener('change', async (e) => {
			var file = e.target.files[0];
			if (!file) return;

			if (!file.type.includes('audio') && !file.name.endsWith('.wav')) {
				showStatus('Select a WAV file', { type: 'warning' });
				return;
			}

			sel('.audio-file-name').textContent = file.name;
			sel('.spectrogram-container').style.display = 'block';
			sel('.analyzer-controls').style.display = 'block';
			sel('.analyzer-instructions').style.display = 'none';
			sel('.analyzer-info').style.display = 'none';

			var info = sel('.analyzer-info');
			if (info) {
				info.innerHTML = 'Analyzing audio file...';
				info.style.display = 'block';
				info.style.borderLeftColor = '#f39c12';
			}

			AudioAnalyzer.selectionStart = 0;
			AudioAnalyzer.selectionEnd = 1;

			try {
				await AudioAnalyzer.loadFile(file);
				Logger.log('Audio file loaded and analyzed successfully');

				if (info) {
					info.style.display = 'none';
				}
			} catch (error) {
				Logger.error('Error loading audio file:', error);
				showStatus('Error loading audio file: ' + error.message, { type: 'error' });

				if (info) {
					info.innerHTML = 'Error loading audio file: ' + error.message;
					info.style.borderLeftColor = '#e74c3c';
				}
			}
		});
	}

	var analyzerExtractButton = sel('.analyzer-extract-button');
	if (analyzerExtractButton) {
		analyzerExtractButton.addEventListener('click', () => {
			if (Math.abs(AudioAnalyzer.selectionEnd - AudioAnalyzer.selectionStart) < 0.01) {
				showStatus('Drag to select a region on the spectrogram', { type: 'warning' });
				return;
			}
			
			var maxPartials = parseInt(sel('.analyzer-max-partials').value);
			var threshold = parseFloat(sel('.analyzer-threshold').value) / 100;
			
			var result = AudioAnalyzer.extractHarmonics(maxPartials, threshold);
			
			if (result) {
				sel('.timbre-partials-count').value = result.harmonics.length;
				
				var harmonicsData = result.harmonics.map(h => [...h]);
				Setup.currentTimbre = {
					keypoints: [{ pitch: 60, data: harmonicsData }],
					selectedKeypoint: 0
				};
				
				Setup.timbre.render();
				if (window.HarmonicsChart) window.HarmonicsChart.refreshFromSetup();

				var info = sel('.analyzer-info');
				if (info) {
					var selStart = (AudioAnalyzer.selectionStart * AudioAnalyzer.spectrogramData.duration).toFixed(2);
					var selEnd = (AudioAnalyzer.selectionEnd * AudioAnalyzer.spectrogramData.duration).toFixed(2);
					info.innerHTML = `
						<strong>Analysis Results:</strong><br>
						Fundamental: ${result.fundamental.toFixed(2)} Hz<br>
						Time range: ${selStart}s - ${selEnd}s<br>
						Extracted ${result.harmonics.length} partials from ${result.peakCount} detected peaks
					`;
					info.style.display = 'block';
					info.style.borderLeftColor = '#27ae60';
				}
			}
		});
	}

	var analyzerThreshold = sel('.analyzer-threshold');
	var analyzerThresholdValue = sel('.analyzer-threshold-value');
	if (analyzerThreshold && analyzerThresholdValue) {
		analyzerThreshold.addEventListener('input', (e) => {
			analyzerThresholdValue.textContent = e.target.value + '%';
		});
	}
};



// Editor harmonických zložiek s ťahaním jednotlivých bodov.
window.HarmonicsChart = (function () {


	var canvas = null,
		ctx2d = null,
		pts = [],
		view = { x1: 0.5, x2: 16, y1: 0, y2: 1 },
		xFloor = 0.25,
		xCeil = 4096,
		padL = 34, padR = 8, padT = 8, padB = 18,
		w = 0, h = 0,
		draggingPoint = null,
		hoverPoint = null,
		panning = false,
		panX = 0, panY = 0,
		panView = null;

	function plotW() { return w - padL - padR; }
	function plotH() { return h - padT - padB; }
	function lg(v) { return Math.log(v); }
	function px(x) { return padL + (lg(x) - lg(view.x1)) / (lg(view.x2) - lg(view.x1)) * plotW(); }
	function py(y) { return padT + (1 - (y - view.y1) / (view.y2 - view.y1)) * plotH(); }
	function xAt(p) { return Math.exp(lg(view.x1) + (p - padL) / plotW() * (lg(view.x2) - lg(view.x1))); }
	function yAt(p) { return view.y1 + (1 - (p - padT) / plotH()) * (view.y2 - view.y1); }

	function resize() {
		var dpr = window.devicePixelRatio || 1;
		w = canvas.clientWidth;
		h = canvas.clientHeight;
		if (w == 0 || h == 0) return false;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
		return true;
	}

	function draw() {
		if (!canvas) return;
		if (!resize()) return;
		ctx2d.clearRect(0, 0, w, h);
		ctx2d.font = '12px Lato, sans-serif';

		var i, x, y;
		ctx2d.strokeStyle = '#222';
		ctx2d.fillStyle = '#555';
		ctx2d.lineWidth = 1;
		ctx2d.textAlign = 'right';
		for (i = 0; i <= 4; i++) {
			y = view.y1 + (view.y2 - view.y1) * i / 4;
			var yp = Math.round(py(y)) + 0.5;
			ctx2d.beginPath();
			ctx2d.moveTo(padL, yp);
			ctx2d.lineTo(w - padR, yp);
			ctx2d.stroke();
			ctx2d.fillText(y.toFixed(2), padL - 4, yp + 3);
		}

		// Mriežka x a popisky sú 1, 2, 3, potom 10, 20 a podobne podľa rozsahu.
		ctx2d.textAlign = 'center';
		var step = 1;
		while ((view.x2 - Math.max(view.x1, step)) / step > 200) step *= 10;
		var lastLabelX = -999, lastLineX = -999;
		for (x = step; x <= view.x2; x += step) {
			if (x < view.x1) continue;
			var xp = Math.round(px(x)) + 0.5;
			// Čiary bližšie než dva body sú na logaritmickej osi nerozoznateľná kaša.
			if (xp - lastLineX < 2) continue;
			lastLineX = xp;
			ctx2d.beginPath();
			ctx2d.moveTo(xp, padT);
			ctx2d.lineTo(xp, h - padB);
			ctx2d.stroke();
			if (xp - lastLabelX > 22) {
				ctx2d.fillText(String(x), xp, h - padB + 12);
				lastLabelX = xp;
			}
		}

		ctx2d.save();
		ctx2d.beginPath();
		ctx2d.rect(padL, padT, plotW(), plotH());
		ctx2d.clip();

		var zero = py(0);
		for (i = 0; i < pts.length; i++) {
			var ptx = px(pts[i].x),
				pty = py(pts[i].y);

			ctx2d.strokeStyle = '#777';
			ctx2d.beginPath();
			ctx2d.moveTo(ptx, zero);
			ctx2d.lineTo(ptx, pty);
			ctx2d.stroke();

			ctx2d.beginPath();
			ctx2d.arc(ptx, pty, i == hoverPoint ? 6 : 4, 0, Math.PI * 2);
			ctx2d.fillStyle = '#4a9eff';
			ctx2d.fill();
			ctx2d.strokeStyle = '#7ab6ff';
			ctx2d.stroke();
		}
		ctx2d.restore();
	}

	function pointAt(mx, my) {
		for (var i = pts.length - 1; i >= 0; i--) {
			var dx = px(pts[i].x) - mx,
				dy = py(pts[i].y) - my;
			if (dx * dx + dy * dy < 100) return i;
		}
		return null;
	}

	// Udržanie y v rozsahu 0 až 1.
	function clampY(y1, y2) {
		if (y1 < 0) { y2 += 0 - y1; y1 = 0; }
		if (y2 > 1) { y1 -= y2 - 1; y2 = 1; if (y1 < 0) y1 = 0; }
		view.y1 = y1;
		view.y2 = y2;
	}
	// Udržanie x nad dolnou medzou logaritmickej osi.
	function clampX(x1, x2) {
		if (x1 < xFloor) { x2 *= xFloor / x1; x1 = xFloor; }
		if (x2 > xCeil) { x1 *= xCeil / x2; x2 = xCeil; }
		if (x1 < xFloor) x1 = xFloor;
		view.x1 = x1;
		view.x2 = x2;
	}

	function zoomX(cx, delta) {
		var span = lg(view.x2) - lg(view.x1),
			r = (lg(cx) - lg(view.x1)) / span,
			ns = span * delta;
		clampX(Math.exp(lg(cx) - r * ns), Math.exp(lg(cx) + (1 - r) * ns));
	}
	function zoomY(cy, delta) {
		var range = view.y2 - view.y1,
			r = (cy - view.y1) / range,
			nr = range * delta;
		clampY(cy - nr * r, cy + nr * (1 - r));
	}

	function init() {
		canvas = sel('.timbreChart');
		if (!canvas) return;
		ctx2d = canvas.getContext('2d');

		var data = Setup.currentTimbre?.data || [];
		pts = data.map(p => ({ x: p[0], y: p[1] }));

		canvas.addEventListener('mousedown', e => {
			var rect = canvas.getBoundingClientRect(),
				mx = e.clientX - rect.left,
				my = e.clientY - rect.top;
			draggingPoint = pointAt(mx, my);
			if (draggingPoint === null) {
				panning = true;
				panX = e.clientX;
				panY = e.clientY;
				panView = { x1: view.x1, x2: view.x2, y1: view.y1, y2: view.y2 };
			}
		});

		canvas.addEventListener('mousemove', e => {
			var rect = canvas.getBoundingClientRect(),
				mx = e.clientX - rect.left,
				my = e.clientY - rect.top;

			if (draggingPoint !== null) {
				var p = pts[draggingPoint];
				p.y = Math.min(1, Math.max(0, yAt(my)));
				if (e.shiftKey) p.x = Math.max(1, xAt(mx));
				draw();
			} else if (panning && panView) {
				// x sa posúva v logaritmickom priestore, teda rovnomerne voči logaritmickej osi.
				var f = Math.exp(-(e.clientX - panX) / plotW() * (lg(panView.x2) - lg(panView.x1)));
				clampX(panView.x1 * f, panView.x2 * f);
				var dy = (e.clientY - panY) / plotH() * (panView.y2 - panView.y1);
				clampY(panView.y1 + dy, panView.y2 + dy);
				draw();
			} else {
				var hp = pointAt(mx, my);
				if (hp !== hoverPoint) {
					hoverPoint = hp;
					canvas.style.cursor = hp === null ? '' : 'pointer';
					draw();
				}
			}
		});

		canvas.addEventListener('mouseup', () => {
			if (draggingPoint !== null) syncBackToSetup();
			draggingPoint = null;
			panning = false;
		});
		canvas.addEventListener('mouseleave', () => {
			draggingPoint = null;
			panning = false;
			hoverPoint = null;
		});

		canvas.addEventListener('dblclick', e => {
			var rect = canvas.getBoundingClientRect(),
				mx = e.clientX - rect.left,
				my = e.clientY - rect.top;
			// Rovnaké zóny ako pri koliesku: ľavý pruh ovláda os y, spodný pruh os x a plocha grafu obe.
			var maxMult = pts.length ? Math.max(...pts.map(p => p.x)) : 16;
			var fitX2 = Math.max(maxMult * 1.2, maxMult + 1);
			if (mx < padL + 20) {
				clampY(0, 1);
			} else if (my > h - padB - 20) {
				clampX(0.5, fitX2);
			} else {
				clampY(0, 1);
				clampX(0.5, fitX2);
			}
			draw();
		});

		canvas.addEventListener('wheel', e => {
			e.preventDefault();
			var rect = canvas.getBoundingClientRect(),
				mx = e.clientX - rect.left,
				my = e.clientY - rect.top,
				delta = e.deltaY < 0 ? 0.9 : 1.1;

			if (mx < padL + 20) {
				zoomY(yAt(my), delta);
			} else if (my > h - padB - 20) {
				zoomX(xAt(mx), delta);
			} else {
				zoomX(xAt(mx), delta);
				zoomY(yAt(my), delta);
			}
			draw();
		});

		window.addEventListener('resize', draw);

		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(() => { if (canvas.clientWidth > 0 && canvas.clientHeight > 0) draw(); }).observe(canvas);
		}

		draw();
	}

	function syncBackToSetup() {
		if (!Setup.currentTimbre) return;
		Setup.timbre.setCurrentData(pts.map(p => [p.x, p.y]));
		Setup.timbre.render();
	}

	function addHarmonic(multiplier, amplitude) {
		if (!canvas) return;
		pts.push({ x: multiplier, y: amplitude });
		draw();
		syncBackToSetup();
	}

	function removeHarmonic(index) {
		if (!canvas) return;
		if (index < 0 || index >= pts.length) return;
		pts.splice(index, 1);
		draw();
		syncBackToSetup();
	}

	function refreshFromSetup() {
		if (!canvas) return;
		if (!Setup.currentTimbre) return;

		var data = Setup.timbre.getCurrentData();
		if (!data || data.length == 0) return;

		pts = data.map(p => ({ x: p[0], y: p[1] }));

		// Reset okna x, aby zodpovedalo novým dátam.
		var maxMultiplier = Math.max(...pts.map(p => p.x));
		view.x1 = 0.5;
		view.x2 = Math.max(maxMultiplier * 1.2, maxMultiplier + 1);
		view.y1 = 0;
		view.y2 = 1;

		draw();
	}

	return {
		init,
		addHarmonic,
		removeHarmonic,
		refreshFromSetup
	};

})();