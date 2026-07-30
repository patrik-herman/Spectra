var UI = {
	pane: {
		toggle: t => {
			t.classList.toggle('s');
			t.parentNode.nextElementSibling.classList.toggle('closed');
		}
	},
	page: {
		toggle: pageNumber => {
			headerButtons.forEach(el => {
				if (el.dataset.page) {
					if (el.dataset.page == pageNumber) {
						el.classList.add('s');

						pages.forEach((page, i_page) => {
							if (i_page == parseInt(pageNumber)) {
								page.style.display = "";
							} else {
								page.style.display = "none";
							}
						})
					}
					else {
						el.classList.remove('s');
					}
				}
			});
		},

		toggleUI: pageNumber => {
			sel('.write-ui').style.display = pageNumber == 2 ? 'flex' : 'none';
			sel('.playback-ui').style.display = pageNumber == 2 ? 'flex' : 'none';

			// Skrytie ovládacích prvkov hlavičky, ktoré platia len pre stránku Write, keď je aktívna iná stránka.
			var isWritePage = pageNumber == 2;
			var brightnessControl = sel('.brightness-offset-control');
			var midiPartialSwitch = sel('.switch-midi-partial');
			var midiPartialLabel = midiPartialSwitch?.nextElementSibling;
			var computerKeyboardSwitch = sel('.switch-computer-keyboard');
			var computerKeyboardLabel = computerKeyboardSwitch?.nextElementSibling;

			if (brightnessControl) brightnessControl.style.display = isWritePage ? '' : 'none';
			if (midiPartialSwitch) midiPartialSwitch.style.display = isWritePage ? '' : 'none';
			if (midiPartialLabel) midiPartialLabel.style.display = isWritePage ? '' : 'none';
			if (computerKeyboardSwitch) computerKeyboardSwitch.style.display = isWritePage ? '' : 'none';
			if (computerKeyboardLabel) computerKeyboardLabel.style.display = isWritePage ? '' : 'none';
		}
	},
	info: {
		open: () => {
			helpSection.classList.remove('hidden');
		},
		close: () => {
			helpSection.classList.add('hidden');
		}
	},
	export: {
		open: () => {
			exportSection.classList.remove('hidden');
			UI.export.populateTracks();
		},
		close: () => {
			exportSection.classList.add('hidden');
		},
		populateTracks: () => {
			var container = sel('.export-tracks-container');
			if (!container) return;
			container.innerHTML = '';

			var instrumentList = DB.get('instruments');
			if (instrumentList && instrumentList.length > 0) {
				for (let i = 0; i < instrumentList.length; i++) {
					var label = document.createElement('label');
					label.className = 'export-checkbox-item';

					var checkbox = document.createElement('input');
					checkbox.type = 'checkbox';
					checkbox.className = 'export-track-checkbox';
					checkbox.dataset.trackIndex = i;
					checkbox.checked = true;

					var iconSpan = document.createElement('span');
					iconSpan.className = 'checkbox-icon';
					iconSpan.innerHTML = '<i class="fa fa-check"></i>';

					var labelSpan = document.createElement('span');
					labelSpan.className = 'checkbox-label';
					labelSpan.textContent = instrumentList[i].name;

					var colorStrip = document.createElement('span');
					colorStrip.className = 'checkbox-color-strip';
					colorStrip.style.background = instrumentList[i].color;

					label.appendChild(checkbox);
					label.appendChild(iconSpan);
					label.appendChild(labelSpan);
					label.appendChild(colorStrip);
					container.appendChild(label);
				}
			}
		},
		getSelectedTracks: () => {
			var allTracksBtn = sel('.export-from-tracks .ui-choice-option.selected');
			if (allTracksBtn && allTracksBtn.dataset.value === 'all-tracks') {
				return Array.from({length: MIDI.data.length}, (_, i) => i);
			}
			var checkboxes = sel('.export-track-checkbox', true);
			var selected = [];
			checkboxes.forEach(cb => {
				if (cb.checked) {
					selected.push(parseInt(cb.dataset.trackIndex));
				}
			});
			return selected;
		},
		getPartialMode: () => {
			var selectedBtn = sel('.export-from-partials .ui-choice-option.selected');
			if (!selectedBtn) return 'all';

			var value = selectedBtn.dataset.value;
			if (value === 'all-partials') return 'all';
			if (value === 'active-partials') return 'selected';
			if (value === 'fundamentals') return 'fundamental';
			if (value === 'custom') {
				var input = sel('.export-partials-input');
				if (!input) return 'all';
				var nums = input.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1);
				return nums.length > 0 ? nums : 'all';
			}
			return 'all';
		},
		getFormat: () => {
			var selectedBtn = sel('.export-format .ui-choice-option.selected');
			return selectedBtn ? selectedBtn.dataset.value : 'audio';
		},
		getQuantization: () => {
			var selectedBtn = sel('.musicxml-quantize .ui-choice-option.selected');
			var value = selectedBtn ? selectedBtn.dataset.value : 'off';

			if (value === 'tuning') {
				var dropdown = sel('.musicxml-tuning-dropdown');
				return { type: 'tuning', tuningKey: dropdown ? dropdown.value : 'edo12' };
			}
			return { type: value };
		},
		populateTuningDropdown: () => {
			var dropdown = sel('.musicxml-tuning-dropdown');
			if (!dropdown) return;

			dropdown.innerHTML = '';
			var scalesList = window.scales || {};
			for (const key in scalesList) {
				var option = document.createElement('option');
				option.value = key;
				option.textContent = scalesList[key].name || key;
				dropdown.appendChild(option);
			}
		},
		getMidiPitchBend: () => {
			var checkbox = sel('.midi-export-pitchbend');
			return checkbox ? checkbox.checked : true;
		},
		updateMusicXMLOptions: () => {
			var format = UI.export.getFormat();
			var midiOptionsDiv = sel('.midi-export-options');
			if (midiOptionsDiv) {
				midiOptionsDiv.style.display = format === 'midi' ? 'block' : 'none';
			}
			// Možnosti MusicXML
			var optionsDiv = sel('.musicxml-options');
			if (optionsDiv) {
				optionsDiv.style.display = format === 'musicxml' ? 'block' : 'none';
			}
		},
		updateQuantizeTuningSelect: () => {
			var selectedBtn = sel('.musicxml-quantize .ui-choice-option.selected');
			var value = selectedBtn ? selectedBtn.dataset.value : 'off';
			var tuningSelect = sel('.musicxml-tuning-select');
			if (tuningSelect) {
				tuningSelect.style.display = value === 'tuning' ? 'block' : 'none';
				if (value === 'tuning') {
					UI.export.populateTuningDropdown();
				}
			}
		},
		doExport: async () => {
			var tracks = UI.export.getSelectedTracks();
			var partialMode = UI.export.getPartialMode();
			var format = UI.export.getFormat();

			if (tracks.length === 0) {
				showStatus('Select a track to export.', { type: 'warning' });
				return;
			}

			var filename = await showPrompt('Enter filename:', 'spectra-export', { title: 'Export' });
			if (filename === null) return;

			Logger.log('Exporting:', { tracks, partialMode, format, filename });

			var cancelled = false;

			// Prekrytie s priebehom exportu.
			var overlay = document.createElement('div');
			overlay.className = 'export-progress-overlay';
			var safeFormat = String(format).replace(/[<>&"]/g, '');
			overlay.innerHTML = `
				<div class="export-progress-content">
					<div class="export-progress-title">Exporting ${safeFormat.toUpperCase()}</div>
					<div class="export-progress-bar-container">
						<div class="export-progress-bar"></div>
					</div>
					<div class="export-progress-percent">0%</div>
					<div class="export-progress-status">Preparing...</div>
					<button class="export-cancel-btn">Cancel</button>
				</div>
			`;
			overlay.style.cssText = `
				position: fixed;
				top: 0;
				left: 0;
				right: 0;
				bottom: 0;
				background: #030303b3;
				z-index: 100000;
				display: flex;
				align-items: center;
				justify-content: center;
			`;
			var content = overlay.querySelector('.export-progress-content');
			content.style.cssText = `
				text-align: center;
				color: #fff;
				min-width: 300px;
			`;
			var title = overlay.querySelector('.export-progress-title');
			title.style.cssText = `
				font-size: 16px;
				font-weight: 500;
				margin-bottom: 20px;
				color: #fff;
			`;
			var barContainer = overlay.querySelector('.export-progress-bar-container');
			barContainer.style.cssText = `
				width: 100%;
				height: 8px;
				background: #333;
				border-radius: 4px;
				overflow: hidden;
				margin-bottom: 10px;
			`;
			var bar = overlay.querySelector('.export-progress-bar');
			bar.style.cssText = `
				width: 0%;
				height: 100%;
				background: linear-gradient(90deg, #0b7dda, #4a9eff);
				border-radius: 4px;
				transition: width 0.3s ease-out;
			`;
			var percentText = overlay.querySelector('.export-progress-percent');
			percentText.style.cssText = `
				font-size: 24px;
				font-weight: 600;
				color: #4a9eff;
				margin-bottom: 8px;
			`;
			var statusText = overlay.querySelector('.export-progress-status');
			statusText.style.cssText = `
				font-size: 13px;
				color: #888;
				margin-bottom: 15px;
			`;

			// Dynamicky meniaci sa percentuálny počet a počítadlo nôt.
			var displayedPercent = 0;
			var targetPercent = 0;
			var displayedNote = 0;
			var targetNote = 0;
			var totalNotes = 0;
			var currentStatus = '';
			var animationFrame = null;

			var animateProgress = () => {
				var needsUpdate = false;

				if (displayedPercent < targetPercent) {
					displayedPercent = Math.min(displayedPercent + 2, targetPercent);
					needsUpdate = true;
				}

				if (displayedNote < targetNote) {
					// Animácia počítadla nôt proporčne k percentu.
					var noteStep = Math.max(1, Math.ceil(totalNotes / 50));
					displayedNote = Math.min(displayedNote + noteStep, targetNote);
					needsUpdate = true;
				}

				if (needsUpdate) {
					percentText.textContent = `${Math.round(displayedPercent)}%`;
					if (totalNotes > 0 && currentStatus.includes('Rendering')) {
						statusText.textContent = `Rendering note ${displayedNote}/${totalNotes}`;
					}
					animationFrame = requestAnimationFrame(animateProgress);
				} else {
					animationFrame = null;
				}
			};
			var cancelBtn = overlay.querySelector('.export-cancel-btn');
			cancelBtn.style.cssText = `
				padding: 8px 24px;
				background: #252525;
				border: none;
				color: #aaa;
				border-radius: 4px;
				cursor: pointer;
				font-size: 13px;
				transition: all 0.15s;
			`;
			cancelBtn.addEventListener('mouseenter', () => {
				cancelBtn.style.background = '#333';
				cancelBtn.style.color = '#fff';
			});
			cancelBtn.addEventListener('mouseleave', () => {
				cancelBtn.style.background = '#252525';
				cancelBtn.style.color = '#aaa';
			});
			cancelBtn.addEventListener('click', () => {
				cancelled = true;
				statusText.textContent = 'Cancelling...';
				cancelBtn.disabled = true;
				cancelBtn.style.opacity = '0.5';
			});

			var updateProgress = (progress) => {
				bar.style.width = `${progress.percent}%`;
				targetPercent = progress.percent;
				currentStatus = progress.status;

				// Počet nôt sa vyberie zo stavového hlásenia v tvare "Rendering note 45/120".
				var match = progress.status.match(/Rendering note (\d+)\/(\d+)/);
				if (match) {
					targetNote = parseInt(match[1], 10);
					totalNotes = parseInt(match[2], 10);
				} else {
					statusText.textContent = progress.status;
				}

				if (!animationFrame) {
					animationFrame = requestAnimationFrame(animateProgress);
				}
			};

			var isCancelled = () => cancelled;

			document.body.appendChild(overlay);

			// Počas exportu sa vykresľovanie plátna pozastaví, aby sa uvoľnilo CPU.
			if (typeof Canvas !== 'undefined' && Canvas.pause) {
				Canvas.pause();
			}

			// Drobná rezerva, aby sa UI stihlo aktualizovať počas celého spracovania.
			await new Promise(resolve => setTimeout(resolve, 50)); // Malý trik, podobne ako wait() v iných jazykoch.

			try {
				if (format === 'audio') {
					var result = await WavExport.exportWavWithTracks(partialMode, filename, tracks, {
						onProgress: updateProgress,
						isCancelled: isCancelled
					});
					if (cancelled || result?.cancelled) {
						showStatus('Export cancelled', { type: 'info' });
						return;
					}
				} else if (format === 'midi') {
					updateProgress({ percent: 50, status: 'Generating MIDI...' });
					var includePitchBend = UI.export.getMidiPitchBend();
					MIDIExport.exportMIDI(partialMode, filename, tracks, includePitchBend);
					updateProgress({ percent: 100, status: 'Complete' });
				} else if (format === 'musicxml') {
					updateProgress({ percent: 50, status: 'Generating MusicXML...' });
					var quantization = UI.export.getQuantization();
					MusicXMLExport.export(partialMode, filename, tracks, quantization);
					updateProgress({ percent: 100, status: 'Complete' });
				}
				// Drobná rezerva pre UI, aby sa zobrazilo dokončenie na 100 %.
				if (!cancelled) {
					await new Promise(resolve => setTimeout(resolve, 300));
				}
			} finally {
				if (animationFrame) {
					cancelAnimationFrame(animationFrame);
				}
				if (typeof Canvas !== 'undefined' && Canvas.resume) {
					Canvas.resume();
				}
				overlay.remove();
			}
		}
	},
	analyzer: {
		open: () => {
			analyzerOverlay.classList.remove('hidden');
			// Po zobrazení sa prepočíta veľkosť plátna so zvukovou vlnou.
			setTimeout(() => {
				if (typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.resizeCanvas) {
					AudioAnalyzer.resizeCanvas();
				}
			}, 50);
		},
		close: t => {
			analyzerOverlay.classList.add('hidden');
		}
	},
	instruments: {
		// Uloženie stavu na krok vzad pri operáciách so stopami.
		captureState: () => {
			return {
				instruments: structuredClone(window.instruments),
				MIDIdata: structuredClone(MIDI.data),
				trackEvents: structuredClone(window.trackEvents || {})
			};
		},

		recordUndo: (description, beforeState) => {
			if (typeof UndoManager === 'undefined') return;
			var afterState = UI.instruments.captureState();
			UndoManager.recordSnapshot(description, ['instruments', 'MIDIdata', 'trackEvents'], {
				instruments: beforeState.instruments,
				MIDIdata: beforeState.MIDIdata,
				trackEvents: beforeState.trackEvents
			}, {
				instruments: afterState.instruments,
				MIDIdata: afterState.MIDIdata,
				trackEvents: afterState.trackEvents
			});
		},

		refresh: () => {
			var paneInstruments = sel('#pane-instruments');
			if (!paneInstruments) return;
			paneInstruments.innerHTML = '';

			var instrumentList = DB.get('instruments');
			if (!instrumentList || instrumentList.length === 0) return;

			// Vybraný musí byť práve jeden z nich.
			var instrumentSelected = -1;
			for (let i = 0; i < instrumentList.length; i++) {
				if (instrumentList[i].selected) instrumentSelected = i;
			}
			if (instrumentSelected === -1) {
				instrumentList[0].selected = true;
				DB.set('instruments', instrumentList);
			}

			for (let i2 = 0; i2 < instrumentList.length; i2++) {
				var paneInstrument = document.createElement('div'),
					paneInstrumentName = document.createElement('input'),
					paneInstrumentClose = document.createElement('div'),
					paneInstrumentStrip = document.createElement('div');

				paneInstrument.className = 'pane-instrument';
				paneInstrumentName.className = 'pane-instrument-name';
				paneInstrumentClose.className = 'pane-instrument-close';
				paneInstrumentStrip.className = 'pane-instrument-strip';

				if (instrumentList[i2].selected)
					paneInstrument.classList.add('selected');

				var paneInstrumentSpectrum = UI.select.getSpectra(instrumentList[i2].spectrum);

				paneInstrumentName.value = instrumentList[i2].name;
				paneInstrumentName.setAttribute('readonly', 'true');
				paneInstrumentClose.textContent = "x";
				paneInstrumentStrip.style.background = instrumentList[i2].color;

				paneInstrument.appendChild(paneInstrumentName);
				paneInstrument.appendChild(paneInstrumentSpectrum);
				paneInstrument.appendChild(paneInstrumentClose);
				paneInstrument.appendChild(paneInstrumentStrip);

				paneInstruments.appendChild(paneInstrument);

			}
		},





		setTrackVolume: (trackIdx, db) => {
			var instruments = window.instruments;
			if (!instruments || !instruments[trackIdx]) return;
			instruments[trackIdx].volume = db;

			if (window.synths && window.synths[trackIdx]) {
				try { window.synths[trackIdx].volume.value = db; } catch (e) {}
			}

			// Aktualizácia hlasov workletu na danej stope v reálnom čase.
			if (typeof PlaybackManager !== 'undefined' && PlaybackManager.workletNode && PlaybackManager.workletReady) {
				var linearVolume = Math.pow(10, db / 20);
				PlaybackManager.workletNode.port.postMessage({
					// Musí zodpovedať prípadu, ktorý spracúva worklet (additive-processor.js).
					type: 'updateTrackVolume',
					trackIdx: trackIdx,
					volume: linearVolume
				});
			}

			DB.set('instruments', instruments);
		},

		setTrackPan: (trackIdx, pan) => {
			var instruments = window.instruments;
			if (!instruments || !instruments[trackIdx]) return;
			instruments[trackIdx].pan = pan;

			if (window.trackPanners && window.trackPanners[trackIdx]) {
				window.trackPanners[trackIdx].pan.value = pan;
			}

			// Aktualizácia hlasov workletu na danej stope v reálnom čase.
			if (typeof PlaybackManager !== 'undefined' && PlaybackManager.workletNode && PlaybackManager.workletReady) {
				PlaybackManager.workletNode.port.postMessage({
					// Musí zodpovedať prípadu, ktorý spracúva worklet (additive-processor.js).
					type: 'updateTrackPan',
					trackIdx: trackIdx,
					pan: pan
				});
			}

			DB.set('instruments', instruments);
		},


		sliderToDb: (slider) => {
			var normalized = slider / 100;
			return UI.instruments.volumeMin + (normalized * (UI.instruments.volumeMax - UI.instruments.volumeMin));
		},




		add: () => {
			var beforeState = UI.instruments.captureState();

			var paneInstrument = document.createElement('div'),
			paneInstrumentName = document.createElement('input'),
			paneInstrumentClose = document.createElement('div'),
			paneInstrumentStrip = document.createElement('div');

			paneInstrument.className = 'pane-instrument';
			paneInstrument.dataset.mark = '1'; // Drobný trik s datasetom.
			paneInstrumentName.className = 'pane-instrument-name';
			paneInstrumentClose.className = 'pane-instrument-close';
			paneInstrumentStrip.className = 'pane-instrument-strip';

			var paneInstrumentSpectrum = UI.select.getSpectra();

			var spectraList = DB.get('spectra');
			var spectraListKeys = Object.keys(spectraList);
			var firstKey = '';
			if (spectraListKeys.length > 0)
				firstKey = spectraList[Object.keys(spectraList)[0]].name;

			paneInstrumentName.value = 'Track ' + (MIDI.data.length + 1); // firstKey
			paneInstrumentName.setAttribute('readonly', 'true');
			paneInstrumentClose.textContent = "x";
			// Otočenie odtieňa podľa počtu stôp kvôli vizuálnemu odlíšeniu.
			var instruments = DB.get('instruments');
			var trackCount = instruments.length;
			var hueRotation = trackCount * 47; // 47 stupňov na jednu stopu.
			var baseColor = '#eba52c';
			var trackColor = rotateHexColor(baseColor, hueRotation);

			paneInstrumentStrip.style.background = trackColor;

			paneInstrument.appendChild(paneInstrumentName);
			paneInstrument.appendChild(paneInstrumentSpectrum);
			paneInstrument.appendChild(paneInstrumentClose);
			paneInstrument.appendChild(paneInstrumentStrip);


			// Zápis do databázy predchádza vloženiu do DOM
			// najskôr sa zruší výber všetkých doterajších stôp, aby zostala vybraná len nová.
			instruments.forEach(inst => { inst.selected = false; });
			sel('.pane-content .pane-instrument', true).forEach(el => {
				el.classList.remove('selected');
			});

			instruments.push({
				name: 'Track ' + (MIDI.data.length + 1),
				spectrum: DEFAULT_SPECTRUM,
				color: trackColor,
				fundamentalColor: trackColor,
				selected: true
			});
			DB.set('instruments', instruments);
			MIDI.data.push([]);
			DB.set('MIDIdata', MIDI.data);


			sel('#pane-instruments').appendChild(paneInstrument);
			paneInstrument.classList.add('selected');
			clickPaneInstrument(paneInstrument);


			// Vytvorenie syntetizátora s pannerom
			// v bloku try/catch, aby polia zostali synchronizované aj pri zlyhaní.
			try {
				var panner = new Tone.Panner(0).connect(masterLimiter || Tone.Destination);
				var synth = new Tone.PolySynth({
					volume: -12
				}).connect(panner);

				if (!window.trackPanners) window.trackPanners = [];
				window.trackPanners.push(panner);

				var _defTimbre = spectra[DEFAULT_SPECTRUM] || {};
				var spectraPartials = (typeof getTimbrePartials === 'function' ? getTimbrePartials(_defTimbre) : (_defTimbre.data || [[1,1]])).map(m => m[1]);
				synth.set({
					oscillator: {
						type: "custom",
						partials: spectraPartials
					}
				});
				synths.push(synth);
			} catch (synthErr) {
				Logger.error('Failed to create PolySynth for new track:', synthErr);
				// Synths, instruments, MIDI.data a trackPanners sú indexované rovnakým číslom stopy,
				// takže pri zlyhaní musí pribudnúť null, bez neho by sa pole skrátilo.
				synths.push(null);
				if (!window.trackPanners) window.trackPanners = [];
				window.trackPanners.push(null);
			}

			if (typeof Timeline !== 'undefined') {
				Timeline.handleTrackAdd(MIDI.data.length - 1);
			}

			if (typeof onTrackSwitch === 'function') {
				onTrackSwitch(MIDI.data.length - 1);
			}


			UI.instruments.recordUndo('Add track', beforeState);
		},
		delete: async (t) => {
			// Uloženie stavu ešte pred zobrazením dialógu, keďže klonovanie prebehne, kým užívateľ premýšľa.
			var beforeState = UI.instruments.captureState();

			if (await showConfirm("Are you sure?\nThis deletes note data!", { title: 'Delete Track', type: 'danger', confirmText: 'Delete' })) {
				t.parentNode.dataset.mark = '1';
				sel('.pane-content .pane-instrument', true).forEach((paneInstrument, i4) => {
					if (paneInstrument.dataset.mark == '1') {
						paneInstrument.dataset.mark = null;

						// Id je i4.
						var instrumentList = DB.get('instruments');

						// Pred zmazaním sa zastavia všetky znejúce noty na danej stope.
						if (typeof PlaybackManager !== 'undefined') {
							PlaybackManager.stopTrack(i4);
						}

						if (typeof Timeline !== 'undefined') {
							Timeline.handleTrackDelete(i4); // i4 je index stopy.
						}

						// Ukončenie všetkých podržaných nôt zo vstupu MIDI, ak ide o vybraný nástroj
						// nový index výberu sa určí ešte pred splice, upravený na stav po ňom.
						var newSelectedIdx = i4 > 0 ? i4 - 1 : 0;

						if (instrumentList[i4].selected && window.midiInputPreview && window.midiInputPreview.notes.size > 0) {
							var now = Tone.now();
							for (let [note, noteData] of window.midiInputPreview.notes) {
								if (typeof synths !== 'undefined' && synths[i4]) {
									synths[i4].triggerRelease(note2freq(note), now);
								}
							}
						}

						if (instrumentList[i4].selected && instrumentList.length > 1) {
							// Výber prvku, ktorý bude po splice na pozícii newSelectedIdx.
							var preSpliceSelectIdx = i4 > 0 ? i4 - 1 : i4 + 1;
							instrumentList[preSpliceSelectIdx].selected = true;

							if (window.primaryTrackIndex === i4) {
								window.primaryTrackIndex = newSelectedIdx;
							}
						}

						// Posun primaryTrackIndex, ak bola zmazaná stopa pred ním.
						if (window.primaryTrackIndex > i4) {
							window.primaryTrackIndex--;
						}

						instrumentList.splice(i4, 1);

						DB.set('instruments', instrumentList, { skipUndo: true });

						paneInstrument.remove();

						var paneInstruments = sel('.pane-content .pane-instrument', true);
						paneInstruments.forEach((el, idx) => {
							el.classList.toggle('selected', idx === newSelectedIdx);
							el.classList.toggle('primary', idx === window.primaryTrackIndex);
						});

						MIDI.data.splice(i4, 1);
						synths.splice(i4, 1);
						if (window.trackPanners && window.trackPanners[i4]) {
							window.trackPanners[i4].dispose();
							window.trackPanners.splice(i4, 1);
						}
						DB.set('MIDIdata', MIDI.data, { skipUndo: true });

						// Po splice opätovné spustenie vstupu MIDI na novo vybranom syntetizátore.
						if (window.midiInputPreview && window.midiInputPreview.notes.size > 0 && instrumentList.length > 0) {
							setTimeout(() => {
								var nowLater = Tone.now();
								for (let [note, noteData] of window.midiInputPreview.notes) {
									if (typeof synths !== 'undefined' && synths[newSelectedIdx]) {
										synths[newSelectedIdx].triggerAttack(note2freq(note), nowLater, noteData.velocity / 127);
									}
								}
							}, 50);
						}

						if (typeof PlaybackManager !== 'undefined') {
							PlaybackManager.reindexAfterTrackDelete(i4);
						}

						if (typeof Timeline !== 'undefined' && Timeline.draw) {
							Timeline.draw();
						}
						if (typeof GridSystem !== 'undefined') {
							GridSystem.refreshCache();
						}

						setTimeout(() => {
							UI.instruments.recordUndo('Delete track', beforeState);
						}, 0);

					}
				});
			}
		}
	},
	select: {
		getSpectra: selectedSpectrum => {
			var spectraList = DB.get('spectra'),
				sel = document.createElement('select'),
				keys = Object.keys(spectraList);
			var opt;

			sel.className = 'pane-instrument-spectrum';

			for (let i1=0; i1 < keys.length; i1++) {
				opt = document.createElement('option');
				opt.value = keys[i1];
				opt.textContent = spectraList[keys[i1]].name;

				if (selectedSpectrum && selectedSpectrum == keys[i1])
					opt.selected = true;
				sel.appendChild(opt);
			}

			return sel;
		},

		refreshAllSpectraDropdowns: () => {
			var spectraList = DB.get('spectra');
			var keys = Object.keys(spectraList);
			var instrumentList = DB.get('instruments');

			var dropdowns = sel('.pane-instrument-spectrum', true);
			dropdowns.forEach((dropdown, index) => {
				var instrumentSpectrum = instrumentList[index]?.spectrum;

				dropdown.innerHTML = '';
				for (let i = 0; i < keys.length; i++) {
					var opt = document.createElement('option');
					opt.value = keys[i];
					opt.textContent = spectraList[keys[i]].name;

					if (instrumentSpectrum && instrumentSpectrum === keys[i]) {
						opt.selected = true;
					}
					dropdown.appendChild(opt);
				}
			});
		}
	},
	checkNameChange: e => {
		var t = e.target;
		if (t.classList.contains('pane-instrument-name')) {
			t.parentNode.dataset.mark = '1';

			sel('.pane-content .pane-instrument', true).forEach((paneInstrument, i6) => {
				if (paneInstrument.dataset.mark == '1') {
					paneInstrument.dataset.mark = null;

					var beforeInstruments = structuredClone(window.instruments);

					// Id je i6.
					var instrumentList = DB.get('instruments');
					instrumentList[i6].name = t.value;

					DB.set('instruments', instrumentList, { skipUndo: true });

					if (typeof UndoManager !== 'undefined') {
						UndoManager.recordSnapshot('Rename track', ['instruments'],
							{ instruments: beforeInstruments },
							{ instruments: structuredClone(instrumentList) }
						);
					}

				}
			});
		}
	},



	init: () => {
		// Najprv globálne nastavenia.
		var settingsList = DB.get('settings');
		var scalesList = DB.get('scales');

		if (!scalesList) {
			Logger.warn('UI.init: scales not ready, retrying in 100ms');
			setTimeout(() => UI.init(), 100);
			return;
		}

		var scalesListKeys = Object.keys(scalesList);
		var scaleOption;
		var defaultScaleSelect = sel('.default-scale');

		if (defaultScaleSelect) {
			for (let i7=0; i7 < scalesListKeys.length; i7++) {
				scaleOption = document.createElement('option');
				scaleOption.textContent = scalesList[scalesListKeys[i7]].name;
				defaultScaleSelect.appendChild(scaleOption);
				if (scalesListKeys[i7] == settingsList.scale) {
					defaultScaleSelect.selectedIndex = i7;
				}
			}
		}

		var speedInput = sel('.playback-speed-input');
		if (speedInput) {
			speedInput.value = settings.playbackSpeed || 1;
			speedInput.addEventListener('change', (e) => {
				var speed = parseFloat(e.target.value);
				if (isNaN(speed) || speed <= 0) speed = 1;
				settings.playbackSpeed = speed;
				DB.set('settings', settings);
			});
		}

		sel('.playback-speed-preset', true).forEach(btn => {
			btn.addEventListener('click', () => {
				var speed = parseFloat(btn.dataset.speed);
				settings.playbackSpeed = speed;
				DB.set('settings', settings);
				sel('.playback-speed-input').value = speed;

				sel('.playback-speed-preset', true).forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
			});
		});

		// playbackPitch (posun v poltónoch).
		var playbackPitchInput = sel('.playback-pitch-input');
		if (playbackPitchInput) {
			// Ak existuje starý referenceA, migruje sa.
			if (settingsList.referenceA && settingsList.playbackPitch === undefined) {
				settingsList.playbackPitch = 12 * Math.log2(settingsList.referenceA / 440);
				delete settingsList.referenceA;
				DB.set('settings', settingsList);
			}
			playbackPitchInput.value = settingsList.playbackPitch ?? 0;
			window.playbackPitch = settingsList.playbackPitch ?? 0;
			if (typeof setPlaybackPitch === 'function') {
				setPlaybackPitch(window.playbackPitch);
			}
		}

		// Stred výšky MIDI (predvolene 69 = A4).
		var midiPitchCenterInput = sel('.midiPitchCenterInput');
		if (midiPitchCenterInput) {
			midiPitchCenterInput.value = settingsList.midiPitchCenter ?? 69;
			window.midiPitchCenter = settingsList.midiPitchCenter ?? 69;
		}

		// Limit parciálov (0 = bez limitu).
		var partialLimitInput = sel('.partialLimitInput');
		if (partialLimitInput) {
			partialLimitInput.value = settingsList.partialLimit ?? 0;
			window.partialLimit = settingsList.partialLimit ?? 0;
		}

		// Kompenzácia latencie zvuku v ms. Manuálne prepísanie platí len pri uloženej hodnote
		// ak sa jej užívateľ nedotkol, zostáva automatické meranie (measureLatency pri prvom prehraní).
		var latencyInput = sel('.audio-latency-input');
		if (latencyInput && typeof settingsList.audioLatency === 'number') {
			latencyInput.value = settingsList.audioLatency;
			window.AUDIO_LATENCY_OVERRIDE = settingsList.audioLatency / 1000;
			if (typeof PlaybackManager !== 'undefined' && PlaybackManager.setLatency) {
				PlaybackManager.setLatency(settingsList.audioLatency);
			}
		}
		var latencyAuto = sel('.audio-latency-auto');
		if (latencyAuto && !latencyAuto._latencyBound) {
			latencyAuto._latencyBound = true;
			latencyAuto.addEventListener('click', () => {
				if (typeof PlaybackManager === 'undefined') return;
				delete window.AUDIO_LATENCY_OVERRIDE;   // Vráti sa k automatickému meraniu.
				PlaybackManager.latencyMeasured = false;
				if (PlaybackManager.measureLatency) PlaybackManager.measureLatency();
				var ms = PlaybackManager.getLatency ? PlaybackManager.getLatency() : 0;
				if (latencyInput) latencyInput.value = ms;
				var sl = DB.get('settings'); delete sl.audioLatency; DB.set('settings', sl);
			});
		}

		sel('#switch-checkbox-T').checked = true;

		// Inicializácia režimu magnetu, za normálnych okolností zapnutý.
		sel('#switch-checkbox-magnet').checked = true;
		Canvas.magnetMode = true;

		// Typ prehrávania - continue/return - inými slovami, čo sa stane, ak sa dvakrát stlačí medzerník. Skočí kurzor na pôvodnú pozíciu, alebo bude pokračovať?
		settingsList = DB.get('settings');
		sel('.playback-ui-play').dataset.type = settingsList.playbackType;
		sel('.playback-options-menu-item', true).forEach(el => {
			el.classList.toggle('selected', el.dataset.type == settingsList.playbackType);
		});

		window.scale = defaultScaleSelect ? scalesListKeys[defaultScaleSelect.selectedIndex] : scalesListKeys[0];


		sel('.setup-section', true)[0].style.display = 'block';

		// pozn.: dropdown predvolenej mriežky teraz napĺňa GridSystem.init()
		// jednotlivé nástroje.
		var instrumentList = DB.get('instruments'),
			instrumentSelected = -1;
		if (instrumentList && instrumentList.length > 0) {
			for (let i2=0; i2 < instrumentList.length; i2++) {
				if (instrumentList[i2].selected) instrumentSelected = i2;
			}

			if (instrumentSelected == -1) instrumentList[0].selected = true;
			DB.set('instruments', instrumentList);
		}
		if (instrumentList && instrumentList.length > 0) {
			for (let i2=0; i2 < instrumentList.length; i2++) {
				var paneInstrument = document.createElement('div'),
				paneInstrumentName = document.createElement('input'),
				paneInstrumentClose = document.createElement('div'),
				paneInstrumentStrip = document.createElement('div');

				paneInstrument.className = 'pane-instrument';
				paneInstrumentName.className = 'pane-instrument-name';
				paneInstrumentClose.className = 'pane-instrument-close';
				paneInstrumentStrip.className = 'pane-instrument-strip';

				if (instrumentList[i2].selected)
					paneInstrument.classList.add('selected');

				var paneInstrumentSpectrum = UI.select.getSpectra(instrumentList[i2].spectrum);


				paneInstrumentName.value = instrumentList[i2].name;
				paneInstrumentName.setAttribute('readonly', 'true');
				paneInstrumentClose.textContent = "x";
				paneInstrumentStrip.style.background = instrumentList[i2].color;

				paneInstrument.appendChild(paneInstrumentName);
				paneInstrument.appendChild(paneInstrumentSpectrum);
				paneInstrument.appendChild(paneInstrumentClose);
				paneInstrument.appendChild(paneInstrumentStrip);

				sel('#pane-instruments').appendChild(paneInstrument);
			}

			// Obnovenie primaryTrackIndex na prvý vybraný nástroj.
			for (let i2 = 0; i2 < instrumentList.length; i2++) {
				if (instrumentList[i2].selected) {
					window.primaryTrackIndex = i2;
					break;
				}
			}

			var paneInstruments = sel('.pane-content .pane-instrument', true);
			if (paneInstruments && typeof window.primaryTrackIndex !== 'undefined') {
				paneInstruments.forEach((el, idx) => {
					if (idx === window.primaryTrackIndex) {
						el.classList.add('primary');
					} else {
						el.classList.remove('primary');
					}
				});
			}
		}

		Canvas.canvas = document.getElementById('canvasElement');
		var center = sel('.center');
		ctx = Canvas.setupHighDPICanvas(Canvas.canvas, center.offsetWidth, center.offsetHeight);

		initPlaybackSpeedControls();

		if (typeof GridSystem !== 'undefined') {
			GridSystem.init();
		}
		if (typeof Timeline !== 'undefined') {
			Timeline.init();

			// Prepočet veľkosti hlavného plátna s ohľadom na výšku časovej osi.
			if (center && Canvas.canvas) {
				var timelineHeight = Timeline.height || 40;
				ctx = Canvas.setupHighDPICanvas(Canvas.canvas, center.offsetWidth, center.offsetHeight - timelineHeight);
				// Vyššie DPI plátna síce spomalilo kreslenie, ale výrazne pomohlo celkovej kvalite obrazu.
			}
		}

		var defaultGridSelect = sel('.default-grid');
		if (defaultGridSelect) {
			defaultGridSelect.addEventListener('change', (e) => {
				settings.grid = e.target.value;
				DB.set('settings', settings);
			});
		}

		// Zmeny typu ladenia rieši Setup.tuning.switchType v setup.js; pri zaškrtnutí adaptívneho ladenia sa stupnica aktualizuje priamo v pamäti a ukladať netreba.
		var adaptiveCheckbox = sel('.adaptive-apply-preview');
		if (adaptiveCheckbox) {
			adaptiveCheckbox.addEventListener('change', (e) => {
				var loadSelect = sel('.tuning-load-select');
				if (loadSelect && loadSelect.value) {
					var selectedName = loadSelect.value;
					var scalesList = DB.get('scales');

					for (const key in scalesList) {
						if (scalesList[key].name === selectedName || key === selectedName) {
							if (scalesList[key].type === 'adaptive' || scalesList[key].isAdaptive) {
								scalesList[key].applyToPreview = e.target.checked;
								DB.set('scales', scalesList);
								window.scales = scalesList;

								// Obnovenie cache adaptívneho ladenia.
								if (typeof AdaptiveTuning !== 'undefined') {
									AdaptiveTuning.refresh();
								}
							}
							break;
						}
					}
				}
			});
		}

		var adaptiveMinFreq = sel('.adaptive-min-freq');
		var adaptiveMaxFreq = sel('.adaptive-max-freq');
		var updateAdaptiveFreqRange = () => {
			var loadSelect = sel('.tuning-load-select');
			if (loadSelect && loadSelect.value) {
				var selectedName = loadSelect.value;
				var scalesList = DB.get('scales');

				for (const key in scalesList) {
					if (scalesList[key].name === selectedName || key === selectedName) {
						if (scalesList[key].type === 'adaptive' || scalesList[key].isAdaptive) {
							scalesList[key].minFreq = parseInt(sel('.adaptive-min-freq')?.value) || 20;
							scalesList[key].maxFreq = parseInt(sel('.adaptive-max-freq')?.value) || 20000;
							DB.set('scales', scalesList);
							window.scales = scalesList;

							if (typeof AdaptiveTuning !== 'undefined') {
								AdaptiveTuning.refresh();
							}
						}
						break;
					}
				}
			}
		};
		if (adaptiveMinFreq) adaptiveMinFreq.addEventListener('change', updateAdaptiveFreqRange);
		if (adaptiveMaxFreq) adaptiveMaxFreq.addEventListener('change', updateAdaptiveFreqRange);

		// pozn.: uloženie ladenia rieši Setup.tuning.save v setup.js
		// vyššie uvedené funkcie slúžia len na okamžitú aktualizáciu hodnôt v pamäti.

		var tuningLoadSelect = sel('.tuning-load-select');
		if (tuningLoadSelect) {
			tuningLoadSelect.addEventListener('change', (e) => {
				var selectedName = e.target.value;
				var scalesList = DB.get('scales');

				var scaleKey = null;
				for (const key in scalesList) {
					if (scalesList[key].name === selectedName || key === selectedName) {
						scaleKey = key;
						break;
					}
				}

				if (!scaleKey || !scalesList[scaleKey]) return;

				var scale = scalesList[scaleKey];

				var nameInput = sel('.tuning-name');
				if (nameInput) nameInput.value = scale.name || selectedName;

				if (scale.type === 'adaptive' || scale.isAdaptive) {
					var typeSelect = selVisible('.tuning-type');
					if (typeSelect) {
						typeSelect.value = 'adaptive';
						typeSelect.dispatchEvent(new Event('change'));
					}

					var minFreq = sel('.adaptive-min-freq');
					var maxFreq = sel('.adaptive-max-freq');
					var applyPreview = sel('.adaptive-apply-preview');

					if (minFreq) minFreq.value = scale.minFreq || 20;
					if (maxFreq) maxFreq.value = scale.maxFreq || 20000;
					if (applyPreview) applyPreview.checked = scale.applyToPreview !== false;
				}
			});
		}
	},

	playback: {
		updateTime: () => {
			var timestamp = playback.time;
			var abs = Math.abs(timestamp);
			var hours = Math.floor(abs / 3600);
			var minutes = Math.floor((abs % 3600) / 60);
			var seconds = Math.floor(abs % 60);
			var millis = Math.floor((abs - Math.floor(abs)) * 1000);

			var hh = String(hours).padStart(2, "0");
			var mm = String(minutes).padStart(2, "0");
			var ss = String(seconds).padStart(2, "0");
			var mss = String(millis).padStart(3, "0");

			playbackUITime.textContent = (timestamp<0 ? '-' : "") + `${hh}:${mm}:${ss}:${mss}`;
		}
	}

};