var MIDI = {
	data: [
		[ // Nástroj
			[0, 1, 69.68825906469125, 7], // MIDI čas, dĺžka, fundament, parciál.
			[1.25, 0.5, 69.688, 2]
		]
	],
	addNote: (xPos, yPos) => {
		if (instruments.length == 0) return;

		var iM1, noteX, noteY;
		noteX = (xPos - 60.5 - Canvas.offx) / barSize;
		noteY = (Canvas.offy - yPos) / octaveSpacingStep;

		// primaryTrackIndex, nastavuje sa kliknutím pri výbere stopy.
		var trackIdx = (typeof primaryTrackIndex !== 'undefined' && primaryTrackIndex >= 0 && primaryTrackIndex < instruments.length)
			? primaryTrackIndex : 0;

		// Ladenie v danom časovom bode, zohľadňujú sa zmeny ladenia na časovej osi.
		var currentTuning = settings.scale || 'edo12';
		if (typeof Timeline !== 'undefined') {
			currentTuning = Timeline.getTuningAtTime(noteX, trackIdx);
		}

		var isAdaptive = typeof AdaptiveTuning !== 'undefined' && AdaptiveTuning.isAdaptive(currentTuning);

		if (isAdaptive) {
			// Adaptívne ladenie, frekvencia je určená podľa práve znejúcich nôt.
			var freq = note2freq(noteY);
			var snappedFreq = AdaptiveTuning.snapFrequency(freq, noteX, trackIdx, currentTuning);
			noteY = freq2note(snappedFreq);
		} else {
			// Statické ladenie zo scalesExt.
			var currentScale = currentTuning;
			if (!scales[currentScale]) {
				Logger.warn('Invalid scale in settings:', currentScale, '- using edo12');
				currentScale = 'edo12';
			}

			// Najbližšia nota, orderedPartials sa dopočítajú až vtedy, keď sa na ne siahne.
			var instrumentSpectrum = instruments[trackIdx]?.spectrum;
			orderedPartialsM = instrumentSpectrum && typeof DB !== 'undefined'
				? DB.getOrderedPartials(currentScale, instrumentSpectrum, settings.orderedPartialsSelection)
				: null;
			if (!orderedPartialsM) {
				Logger.warn('orderedPartials not available for scale:', currentScale, 'spectrum:', instrumentSpectrum);
				return;
			}
			var fundamentalNotes = orderedPartialsM.filter(partial => partial[4] === 1);

			// Prichytenie na najbližší fundament (zhodne s vertikálnym ťahaním, pozri closestFundamental v canvas.js), aby novovytvorená nota pri prvom drobnom posune neodskočila.
			var closestF = null, closestD = Infinity;
			for (iM1 = 0; iM1 < fundamentalNotes.length; iM1++) {
				var d = Math.abs(fundamentalNotes[iM1][1] - noteY);
				if (d < closestD) { closestD = d; closestF = fundamentalNotes[iM1]; }
			}
			if (closestF) noteY = closestF[1];
		}

		if (typeof(MIDI.data[trackIdx]) !== 'undefined') {
			noteX = Math.max(0, noteX);
			if (typeof noteY !== 'number' || isNaN(noteY)) noteY = 60;  // Predvolené je stredné C.
			noteY = Math.max(-24, Math.min(150, noteY));

			var newNote = [noteX, 1, noteY, 1, null, 0, 0];
			var newNoteIndex = MIDI.data[trackIdx].length;
			MIDI.data[trackIdx].push(newNote);

			if (typeof UndoManager !== 'undefined') {
				UndoManager.recordNoteDelta('Add note', trackIdx, [{
					noteIndex: newNoteIndex,
					before: null,
					after: structuredClone(newNote)
				}]);
			}

			DB.set('MIDIdata', MIDI.data, { skipUndo: true });

			// Obnovenie cache hrán magnetu, keďže sa zmenili hrany nôt.
			if (typeof refreshMagnetEdgeCache === 'function') {
				refreshMagnetEdgeCache();
			}

			// Obnovenie cache adaptívneho ladenia, keďže sa zmenili noty.
			if (typeof AdaptiveTuning !== 'undefined') {
				AdaptiveTuning.refresh();
			}

			// Spustenie hooku onNoteCreate pre tutoriály a rozšírenia.
			if (typeof Spectra !== 'undefined' && Spectra.callHooks) {
				Spectra.callHooks('onNoteCreate', { trackIdx, noteIndex: newNoteIndex, note: newNote });
			}
		}
	}
}