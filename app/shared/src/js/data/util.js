// Pomocné funkcie pre Spectru
// pozn.: N_TIME, N_DUR, N_PITCH, N_PARTIAL pochádzajú z config.js (načítaný skôr).

// Posun výšky prehrávania v poltónoch (môže byť kladný aj záporný).
var playbackPitch = 0;

// Obmedzenie noty na menší rozsah a rozsah väčší než 0-127 je povolený kvôli mikrotonalite.
function validateMidiNote(note) {
	if (typeof note !== 'number' || isNaN(note)) {
		Logger.warn('validateMidiNote: Invalid note value, defaulting to 60 (middle C)');
		return 60;
	}
	return Math.max(-24, Math.min(150, note));
}

function validateVelocity(velocity) {
	if (typeof velocity !== 'number' || isNaN(velocity)) {
		return 100; // Predvolená sila stlačenia.
	}
	return Math.max(0, Math.min(127, Math.round(velocity)));
}

function validateTime(time, minValue = 0) {
	if (typeof time !== 'number' || isNaN(time)) {
		return minValue;
	}
	return Math.max(minValue, time);
}

function validateMidiNoteArray(note) {
	if (!Array.isArray(note) || note.length < 4) {
		Logger.warn('validateMidiNoteArray: Invalid note structure');
		return [0, 1, 60, 1, null, 0, 0, 0];
	}

	return [
		validateTime(note[N_TIME]),                           // Čas
		validateTime(note[N_DUR], 0.01),                      // Dĺžka (minimum 0.01).
		validateMidiNote(note[N_PITCH]),                      // Výška
		Math.max(1, Math.round(Number(note[N_PARTIAL]) || 1)),// Parciál
		note[N_DATA] || null,                                 // Objekt samotnej noty.
		note[N_SEL] || 0,                                     // Označenie
		note[N_DEPTH] || 0,                                   // Hĺbka
		note[N_HIDDEN] || 0                                   // Skrytie
	];
}

function setPlaybackPitch(semitones) {
	playbackPitch = semitones;
}

function getPlaybackPitch() {
	return playbackPitch;
}

// Spätná kompatibilita, teda prevod referenceA na playbackPitch.
function setReferenceA(freq) {
	playbackPitch = 12 * Math.log2(freq / 440);
}

function getReferenceA() {
	return 440 * Math.pow(2, playbackPitch / 12);
}

var rgb2hex = (rgb) => { var result = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/); if (!result) return rgb; return `#${result.slice(1).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('')}`; };

function sel(q, s) {
	return s ? document.querySelectorAll(q)
		: document.querySelector(q);
}
window.sel = sel;

function selVisible(q) {
	var elements = document.querySelectorAll(q);
	for (const el of elements) {
		if (window.getComputedStyle(el).display !== 'none') {
			return el;
		}
	}
	return elements[0] || null;
}
window.selVisible = selVisible;

// [ZDROJ] ISO 16:1975. Acoustics - Standard tuning frequency (Standard musical pitch). Geneva: ISO, 1975.
//   Referenčná výška a1 = 440 Hz, z ktorej vychádzajú prevody nižšie.

function freq2note_440(f) {
	return 12 * Math.log2(f / 440.0) + 69;
}

function freq2note(f) {
	// Aplikovanie posunu playbackPitch (kvôli súladu zobrazenia s prehrávaním).
	return 12 * Math.log2(f / 440) + 69 - playbackPitch;
}

function note2freq_440(n) {
	return Math.pow(2, (n-69)/12) * 440.0;
}

function note2freq(n) {
	return Math.pow(2, (n - 69 + playbackPitch) / 12) * 440;
}

function note2name(note) {
	return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((Math.floor(note) % 12) + 12) % 12] + (Math.floor(note / 12)-2);
}

// Funkcia vypíše dáta jednotlivých parciálov z objektu timbre
// a pri viacerých keypointoch vráti najbližší (bez interpolácie).
function getTimbrePartials(timbre, pitch) {
	if (!timbre) return [[1, 1]];

	// Starý formát: priame pole .data
	// podpora ostáva pre projekty, ktoré starší formát stále používajú.
	if (Array.isArray(timbre.data) && timbre.data.length > 0) {
		return timbre.data;
	}

	// Nový formát: pole s takzvanými keypoints, farby spojené s jednotlivými tónmi
	// daný formát umožňuje tvoriť nástroje s rôznymi registrami, podobne ako pri akustických nástrojoch.
	if (Array.isArray(timbre.keypoints) && timbre.keypoints.length > 0) {
		// Ak ide o jeden keypoint, výsledkom budú jeho dáta.
		if (timbre.keypoints.length === 1) {
			return timbre.keypoints[0].data || [[1, 1]];
		}

		// Pre viac keypointov sa vráti farba najbližšieho keypointu k danej výške.
		var targetPitch = pitch ?? 60;
		var closest = timbre.keypoints[0];
		var closestDist = Math.abs(closest.pitch - targetPitch);

		for (let i = 1; i < timbre.keypoints.length; i++) {
			var dist = Math.abs(timbre.keypoints[i].pitch - targetPitch);
			if (dist < closestDist) {
				closest = timbre.keypoints[i];
				closestDist = dist;
			}
		}

		return closest.data || [[1, 1]];
	}

	// V prípade, ak keypointy neexistujú, použije sa sínus.
	return [[1, 1]];
}

function getBWKey(noteNumber) {
	return [0,1,0,1,0,0,1,0,1,0,1,0][((Math.round(noteNumber) % 12) + 12) % 12];
}

function round4(n) {
	return Math.round(n * 10000)/10000;
}

// Jedna z najdôležitejších a vôbec prvých funkcií celého softvéru
// zoradenie parciálov podľa frekvenčnej výšky umožňuje preskakovať medzi parciálmi rôznych nôt
// bez ohľadu na ich číslo harmonického tónu.
function sortingFunction(a, b) {
	// Najprv zoradenie podľa frekvencie.
	if (a[0] !== b[0]) {
		return (a[0] < b[0]) ? -1 : 1;
	}
	// Ak sú frekvencie identické, zoradenie podľa čísla parciálu (index 4)
	// nižšie čísla parciálov (fundamentály) idú prvé.
	else if (a[4] !== b[4]) {
		return (a[4] < b[4]) ? -1 : 1;
	}
	// Ak sú rovnaké aj frekvencia aj parciál, sú totožné.
	else {
		return 0;
	}
}

function download(data, filename, type) {
	var file = new Blob([data], {type: type});
	var a = document.createElement("a");
	var url = URL.createObjectURL(file);
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	setTimeout(() => {
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}, 0);
}

/*
	Konverzia RGBA, hue a podobne
	Otočenie farby v hex formáte
	Kvôli efektivite sa daná hodnota ukladá spolu s dátami nástroja.
*/
// [ZDROJ] OTTOSSON, Björn. A perceptual color space for image processing [online]. 23. 12. 2020 [cit.
//   2026-07-30]. Dostupné z: https://bottosson.github.io/posts/oklab/
// [ZDROJ] IEC 61966-2-1:1999. Multimedia systems and equipment - Colour measurement and management - Part
//   2-1: Colour management - Default RGB colour space - sRGB. Geneva: IEC, 1999.

function rotateHexColor(hex, deg = 180, dL = 0, dC = 1) {
	hex = hex.replace(/^#/, "");
	var r = parseInt(hex.slice(0, 2), 16) / 255;
	var g = parseInt(hex.slice(2, 4), 16) / 255;
	var b = parseInt(hex.slice(4, 6), 16) / 255;

	// sRGB -> lineárne RGB (gamma expanzia).
	var toLinear = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	var lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);

	// Lineárne RGB -> OKLAB cez LMS.
	var l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	var m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	var s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

	var L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
	var A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
	var B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

	// OKLAB -> OKLCH (polárny tvar kvôli otočeniu odtieňu).
	var C = Math.sqrt(A * A + B * B) * dC;
	var h = Math.atan2(B, A) * (180 / Math.PI);
	if (h < 0) h += 360;

	// Aplikácia otočenia odtieňu.
	h = (h + deg) % 360;
	L = Math.max(0.05, Math.min(0.97, L + dL));
	var hRad = h * (Math.PI / 180);

	// OKLCH -> OKLAB.
	var A2 = C * Math.cos(hRad);
	var B2 = C * Math.sin(hRad);

	// OKLAB -> lineárne RGB cez LMS.
	var l2 = L + 0.3963377774 * A2 + 0.2158037573 * B2;
	var m2 = L - 0.1055613458 * A2 - 0.0638541728 * B2;
	var s2 = L - 0.0894841775 * A2 - 1.2914855480 * B2;

	var l3 = l2 * l2 * l2;
	var m3 = m2 * m2 * m2;
	var s3 = s2 * s2 * s2;

	var lr2 = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
	var lg2 = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
	var lb2 = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

	// Lineárne RGB -> sRGB (gamma kompresia).
	var toSRGB = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	var R = Math.round(Math.max(0, Math.min(1, toSRGB(lr2))) * 255);
	var G = Math.round(Math.max(0, Math.min(1, toSRGB(lg2))) * 255);
	var Bl = Math.round(Math.max(0, Math.min(1, toSRGB(lb2))) * 255);

	return "#" + R.toString(16).padStart(2, "0") + G.toString(16).padStart(2, "0") + Bl.toString(16).padStart(2, "0");
}

// Cache pre rgba reťazce, aby sa predišlo opakovaným prevodom pri vykresľovaní.
var rgbaCache = new Map();
var rgbaCacheMaxSize = 1000;

function rgbaWithAlpha(hex, alpha) {
	// Zaokrúhlením hodnoty na dve desatinné miesta sa zvýši pravdepodobnosť cachovania.
	var roundedAlpha = Math.round(alpha * 100) / 100;
	var key = hex + roundedAlpha;

	var result = rgbaCache.get(key);
	if (result !== undefined) return result;

	var r = parseInt(hex.slice(1, 3), 16);
	var g = parseInt(hex.slice(3, 5), 16);
	var b = parseInt(hex.slice(5, 7), 16);
	result = `rgba(${r},${g},${b},${roundedAlpha})`;

	// Ak je cache príliš veľké, vymaže sa polovica.
	if (rgbaCache.size >= rgbaCacheMaxSize) {
		var keys = Array.from(rgbaCache.keys());
		// rgbaCache je Map(), takže nezáleží na tom, či delete beží zospodu alebo zvrchu.
		for (let i = 0; i < rgbaCacheMaxSize / 2; i++)
			rgbaCache.delete(keys[i]);
	}
	rgbaCache.set(key, result);
	return result;
}

/*
	------------------------
	Spracovanie MIDI súborov
	------------------------
*/

// [ZDROJ] MIDI Manufacturers Association. Standard MIDI Files 1.0: RP-001 [online]. Los Angeles: MMA, 1996
//   [cit. 2026-07-30]. Dostupné z: https://midi.org/standard-midi-files-specification Formát chunkov MThd a
//   MTrk, premenlivá dĺžka hodnôt, running status, meta udalosti.

function parseMIDIFile(arrayBuffer) {
	var data = new Uint8Array(arrayBuffer);
	var offset = 0;

	var headerType = String.fromCharCode(...data.slice(0, 4));
	if (headerType !== 'MThd')
		throw new Error('Invalid MIDI file: Missing MThd header');

	var headerLength = readInt32(data, 4);
	var format = readInt16(data, 8); // Ak je to napríklad jedna alebo niekoľko stôp.
	var trackCount = readInt16(data, 10); // Počet stôp
	var ticksPerBeat = readInt16(data, 12); // Kladné hodnoty udávajú tiky na dobu, záporné udávajú SMPTE.

	offset = 14;

	Logger.log(`MIDI Format: ${format}, Tracks: ${trackCount}, Ticks/Beat: ${ticksPerBeat}`);

	var tracks = [];
	var tempo = 500000; // Predvolené tempo (120 BPM).

	for (let i = 0; i < trackCount; i++) {
		var trackType = String.fromCharCode(...data.slice(offset, offset + 4));
		if (trackType !== 'MTrk')
			throw new Error(`Invalid track ${i}: Missing MTrk header`);

		var trackLength = readInt32(data, offset + 4);
		offset += 8;

		var trackEnd = Math.min(offset + trackLength, data.length);
		var trackEvents = parseTrackEvents(data, offset, trackEnd, ticksPerBeat);

		if (i === 0 && trackEvents.tempo)
			tempo = trackEvents.tempo;

		tracks.push(trackEvents.notes);
		offset = trackEnd;
	}

	return { tracks, ticksPerBeat, tempo };
}

// [ZDROJ] MIDI Manufacturers Association. The Complete MIDI 1.0 Detailed Specification: Incorporating all
//   Recommended Practices, document version 96.1. Los Angeles: MMA, 1996. RPN 0,0: citlivosť pitch bendu.
// [ZDROJ] MIDI Manufacturers Association. MIDI Polyphonic Expression: Version 1.0, RP-053 [online]. Los
//   Angeles: MMA, 12. 3. 2018 [cit. 2026-07-30]. Dostupné z:
//   https://d30pueezughrda.cloudfront.net/campaigns/mpe/mpespec.pdf

function parseTrackEvents(data, start, end, ticksPerBeat) {
	var offset = start;
	var currentTick = 0;
	var notes = [];
	var noteOnEvents = new Map(); // Sledovanie note-on udalostí čakajúcich na note-off.
	var tempo = null;
	var channelPitchBend = new Map(); // Sledovanie pitch bendu pre každý kanál kvôli MPE importu.
	// Rozsah pitch bendu na kanál (v poltónoch) z RPN 0,0 (citlivosť pitch bendu). Ak súbor
	// žiadne RPN neuvádza, použije sa štandardné MIDI o veľkosti 2 poltónov. Importér musí rešpektovať rozsah určený súborom, pretože vlastný wav-export MIDIExport v Spectre
	// používa predvolené +-2, zatiaľ čo MPE je +-48.
	var defaultBendRange = 2; // V poltónoch; predvolené 2 podľa MIDI normy, keď súbor RPN neuvádza.
	var channelBendRange = new Map();
	var channelRpnMsb = new Map();
	var channelRpnLsb = new Map();
	var runningStatus = 0;

	while (offset < end) {
		const { value: deltaTime, bytesRead } = readVariableLength(data, offset);
		offset += bytesRead;
		currentTick += deltaTime;

		var eventType = data[offset];

		if (eventType < 0x80) {
			eventType = runningStatus;
		} else {
			// Running status sa neaktualizuje pri meta (0xFF) alebo SysEx (0xF0-0xF7) udalostiach.
			if (eventType < 0xF0) {
				runningStatus = eventType;
			}
			offset++;
		}

		var channel = eventType & 0x0F; // Maska pre dolné 4 bity (číslo kanála).
		var command = eventType & 0xF0; // Maska pre vrchné 4 bity (typ správy).

		if (command === 0x90) { // Note On
			const note = data[offset++];
			const velocity = data[offset++];

			if (velocity > 0) {
				// Uloženie note-on udalosti (so zachytením aktuálneho pitch bendu kvôli MPE).
				const key = `${channel}-${note}`;
				noteOnEvents.set(key, {
					tick: currentTick,
					note: note,
					velocity: velocity,
					pitchBend: channelPitchBend.get(channel) || 8192,
					bendRange: channelBendRange.get(channel) ?? defaultBendRange
				});
			} else {
				// Velocity 0 znamená note off.
				const key = `${channel}-${note}`;
				const noteOn = noteOnEvents.get(key);
				if (noteOn) {
					const startTime = noteOn.tick / ticksPerBeat;
					const duration = (currentTick - noteOn.tick) / ticksPerBeat;
					// Pitch bend sa aplikuje podľa rozsahu určeného kanálom (RPN 0,0), zachyteného pri note-on.
					const pbSemitones = ((noteOn.pitchBend - 8192) / 8192) * noteOn.bendRange;
					const noteValue = note + pbSemitones;

					if (Number.isFinite(startTime) && Number.isFinite(duration) && Number.isFinite(noteValue)) {
						notes.push([startTime, duration, noteValue, 1, {partials: [], velocity: noteOn.velocity}, 0, 0]);
					}
					noteOnEvents.delete(key);
				}
			}
		} else if (command === 0x80) { // Note Off
			const note = data[offset++];
			const velocity = data[offset++];

			const key = `${channel}-${note}`;
			const noteOn = noteOnEvents.get(key);
			if (noteOn) {
				const startTime = noteOn.tick / ticksPerBeat;
				const duration = (currentTick - noteOn.tick) / ticksPerBeat;
				// Pitch bend sa aplikuje podľa rozsahu určeného kanálom (RPN 0,0), zachyteného pri note-on.
				const pbSemitones = ((noteOn.pitchBend - 8192) / 8192) * noteOn.bendRange;
				const noteValue = note + pbSemitones;

				if (Number.isFinite(startTime) && Number.isFinite(duration) && Number.isFinite(noteValue)) {
					notes.push([startTime, duration, noteValue, 1, {partials: [], velocity: noteOn.velocity}, 0, 0]);
				}
				noteOnEvents.delete(key);
			}
		} else if (eventType === 0xFF) { // Meta udalosť
			var metaType = data[offset++];
			const { value: length, bytesRead } = readVariableLength(data, offset);
			offset += bytesRead;

			if (metaType === 0x51 && length === 3) { // Tempo
				tempo = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
			}

			offset += length;
		} else if (eventType === 0xF0 || eventType === 0xF7) {
			// SysEx
			const { value: length, bytesRead } = readVariableLength(data, offset);
			offset += bytesRead + length;
		} else if (command === 0xC0 || command === 0xD0) {
			// Zmena programu alebo channel pressure.
			offset++;
		} else if (command === 0xE0) {
			// Pitch bend sa načítava a ukladá pre každý kanál kvôli MPE importu.
			var pbLsb = data[offset++];
			var pbMsb = data[offset++];
			var pbValue = (pbMsb << 7) | pbLsb; // 0-16383, stred 8192.
			channelPitchBend.set(channel, pbValue);
		} else if (command === 0xB0) {
			// Control change (2 bajty).
			var controller = data[offset++];
			var ccValue = data[offset++];
			if (controller === 0x65) {          // RPN MSB (101).
				channelRpnMsb.set(channel, ccValue);
			} else if (controller === 0x64) {   // RPN LSB (100).
				channelRpnLsb.set(channel, ccValue);
			} else if (controller === 0x06 || controller === 0x26) { // Data Entry MSB/LSB.
				// Data entry nastavuje rozsah len vtedy, keď je vybraným parametrom RPN 0,0.
				if ((channelRpnMsb.get(channel) ?? 0x7F) === 0 && (channelRpnLsb.get(channel) ?? 0x7F) === 0) {
					var prev = channelBendRange.get(channel) ?? defaultBendRange;
					if (controller === 0x06) {
						// MSB = celé poltóny; so zachovaním prípadnej už nastavenej desatinnej časti (centy).
						channelBendRange.set(channel, ccValue + (prev - Math.floor(prev)));
					} else {
						// LSB = centy.
						channelBendRange.set(channel, Math.floor(prev) + ccValue / 100);
					}
				}
			}

		} else if (command === 0xA0) {
			// Polyphonic key pressure (2 bajty), momentálne nepoužívané.
			offset += 2;
		} else {
			// Program change alebo channel pressure (1 bajt).
			offset++;
		}
	}

	return { notes, tempo };
}

function readInt32(data, offset) {
	// Použitie posunu vpravo bez znamienka >>>, aby sa predišlo problémom so znamienkom pri veľkých hodnotách.
	return ((data[offset] << 24) | (data[offset + 1] << 16) |
		   (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readInt16(data, offset) {
	return (data[offset] << 8) | data[offset + 1];
}

function readVariableLength(data, offset) {
	var value = 0;
	var bytesRead = 0;
	var byte;

	do {
		byte = data[offset + bytesRead];
		if (byte === undefined) { // Prekročenie konca bufferu.
			bytesRead++;
			break;
		}
		// Namiesto << sa násobí, pretože bitový posun by pri dlhých sekvenciách pretiekol do záporných hodnôt a záporná dĺžka by hnala parser dozadu do nekonečného cyklu.
		value = value * 128 + (byte & 0x7F);
		bytesRead++;
		if (bytesRead >= 8) break; // Špecifikácia povoľuje max 4 bajty; poistka proti nesprávnym dátam.
	} while (byte & 0x80);

	return { value, bytesRead };
}

// Závisí od MIDI, DB, UI a instruments; tie sa počas prechodu odovzdávajú ako parametre alebo sa k nim pristupuje cez window.
function loadMIDIFile(arrayBuffer, { MIDI, DB, UI, instruments, showStatus }) {
	try {
		var parsedMIDI = parseMIDIFile(arrayBuffer);

		// Odfiltrovanie prázdnych stôp (napríklad metrických stôp vo formáte MIDI 1).
		var nonEmptyTracks = parsedMIDI.tracks.filter(track => track && track.length > 0);

		if (nonEmptyTracks.length === 0) {
			showStatus('MIDI file contains no notes', { type: 'error' });
			return false;
		}

		MIDI.data = [];

		var existingCount = instruments.length;
		var neededCount = nonEmptyTracks.length;

		// Ak je to nutné, doplnia sa nástroje (UI.instruments.add zapisuje aj do MIDI.data, takže MIDI.data sa potom prepíše).
		for (let i = existingCount; i < neededCount; i++) {
			UI.instruments.add();
		}

		MIDI.data = nonEmptyTracks.map(track => [...track]); // Klonovanie, aby sa predišlo problémom s referenciami.

		DB.set('MIDIdata', MIDI.data);

		// Obnovenie UI, aby sa zobrazila správna vybratá stopa.
		if (typeof clickPaneInstrument === 'function') {
			var firstTrack = document.querySelector('.pane-instrument');
			if (firstTrack) clickPaneInstrument(firstTrack);
		}

		Logger.log(`Loaded MIDI file with ${nonEmptyTracks.length} tracks (from ${parsedMIDI.tracks.length} total)`);
		showStatus(`Loaded ${nonEmptyTracks.length} track${nonEmptyTracks.length > 1 ? 's' : ''} from MIDI file`, { type: 'success' });
		return true;
	} catch (error) {
		Logger.error('Error loading MIDI file:', error);
		showStatus('Error loading MIDI file: ' + error.message, { type: 'error' });
		return false;
	}
}

var statusTimeout = null;
function showStatus(message, options = {}) {
	var statusEl = sel('.status-message');
	if (!statusEl) {
		Logger.log(`[Status] ${message}`);
		return;
	}

	if (statusTimeout) {
		clearTimeout(statusTimeout);
	}

	statusEl.textContent = message;
	statusEl.className = 'status-message';
	if (options.type) {
		statusEl.classList.add(`status-${options.type}`);
	}

	statusEl.classList.add('visible');

	// Automatické skrytie po uplynutí (momentálne 3 sekundy).
	var duration = options.duration || 3000;
	statusTimeout = setTimeout(() => {
		statusEl.classList.remove('visible');
	}, duration);
}

// Export pomocných funkcií do window, aby boli dostupné vo všetkých skriptoch.
window.freq2note = freq2note;
window.freq2note_440 = freq2note_440;
window.note2freq = note2freq;
window.note2freq_440 = note2freq_440;
window.note2name = note2name;
window.getBWKey = getBWKey;
window.round4 = round4;
window.sortingFunction = sortingFunction;
window.download = download;
window.rotateHexColor = rotateHexColor;
window.rgbaWithAlpha = rgbaWithAlpha;
window.rgb2hex = rgb2hex;
window.parseMIDIFile = parseMIDIFile;
window.loadMIDIFile = loadMIDIFile;
window.showStatus = showStatus;
window.validateMidiNote = validateMidiNote;
window.validateVelocity = validateVelocity;
window.validateTime = validateTime;
window.validateMidiNoteArray = validateMidiNoteArray;
window.setReferenceA = setReferenceA;
window.getReferenceA = getReferenceA;
