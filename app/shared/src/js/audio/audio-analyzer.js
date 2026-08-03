// audioAnalyzer rieši frekvenčnú analýzu a analýzu harmonických tónov.

// Tento kód bol pôvodne písaný v Pythone v rámci hodín Kompoziční techniky 20. století a neskôr prepísaný do JavaScriptu
// pôvodne bol kód písaný pomocou knižnice matplotlib, neskôr JS verzia používala grafickú knižnicu
// a súčasný kód používa JS s HTML prvkom canvas.

// sel, note2freq, freq2note, showStatus pochádzajú z util.js.


// Moduly
var audioContext = null,
	audioBuffer = null,
	spectrumCanvas = null,
	spectrumCtx = null,
	waveformCanvas = null,
	waveformCtx = null,
	sampleRate = 44100,
	harmonics = [],
	harmonicsAmplitudes = [],
	lastFrequencies = [],
	lastMagnitudes = [];

// Časový rozsah
var rangeStart = 0.1,
	rangeEnd = 0.2,
	isDragging = false,
	dragMode = null, // 'start', 'end', alebo 'range'.
	dragStartX = 0,
	dragAnalysisTimeout = null;

// Frekvenčný rozsah (v Hz).
var freqRangeStart = 20,
	freqRangeEnd = 20000,
	isFreqDragging = false,
	freqDragMode = null, // 'start', 'end', alebo 'range'.
	freqDragStartX = 0;

// Callback pre externé využitie (napr. Grid editor).
var externalCallback = null;

// Jednoduchá konverzia pre jazdec používajúci exponenciálny prevod pre lepšie rozlíšenie.
function sliderToExp(value) {
	return Math.pow(value, 3); // Pretože 1 sa transformuje na 1, zvyšné matematické funkcie nie sú potrebné.
}

// Zobrazenie spektrálnych dát.

function previewTimbre() {
	// getCurrentData() funguje pre statické aj dynamické timbre.
	var Setup = window.Setup; // Len kvôli prehľadnosti kódu.
	if (!Setup?.timbre?.getCurrentData) return;

	var data = Setup.timbre.getCurrentData();
	if (!data || data.length === 0) {
		return;
	}

	var ctx = getAudioContext();
	var ctxSampleRate = ctx.sampleRate || sampleRate;
	var duration = 2.0;
	var bufferSize = Math.floor(ctxSampleRate * duration);
	var buffer = ctx.createBuffer(1, bufferSize, ctxSampleRate);
	var channelData = buffer.getChannelData(0);

	var envLevel = null;
	if (sel('.timbre-envelope-enable')?.checked) {
		var readEnv = (q, dflt) => {
			var v = parseFloat(sel(q)?.value);
			return Number.isFinite(v) ? v : dflt;
		};
		var envA = readEnv('.timbre-env-attack', 0.005);
		var envD = readEnv('.timbre-env-decay', 0);
		var envS = readEnv('.timbre-env-sustain', 1);
		var envR = readEnv('.timbre-env-release', 0.005);
		var releaseStart = Math.max(0, duration - envR);
		envLevel = (t) => {
			if (t >= releaseStart) {
				var base = releaseStart < envA ? (envA > 0 ? releaseStart / envA : 1)
					: releaseStart < envA + envD ? 1 - (1 - envS) * ((releaseStart - envA) / envD)
					: envS;
				return envR > 0 ? Math.max(0, base * (1 - (t - releaseStart) / envR)) : 0;
			}
			if (t < envA) return envA > 0 ? t / envA : 1;
			if (t < envA + envD) return envD > 0 ? 1 - (1 - envS) * ((t - envA) / envD) : envS;
			return envS;
		};
	}

	// Generovanie súčtu sínusoviek.
	for (let i = 0; i < bufferSize; i++) {
		var t = i / ctxSampleRate;
		var sample = 0;
		for (let h = 0; h < data.length; h++) {
			// Vzhľadom na komorné A.
			sample += Math.sin(2 * Math.PI * note2freq(69) * data[h][0] * t) * (1 / data.length) * data[h][1];
		}
		channelData[i] = envLevel ? sample * envLevel(t) : sample;
	}

	var source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(ctx.destination);
	source.start();
}

// Vrátenie AudioContextu pre prehrávanie (predprehrávanie, generovanie zvuku)
// ak je dostupný, opätovné použitie kontextu z Tone.js.

function getAudioContext() {
	if (audioContext && audioContext.state !== 'closed') {
		return audioContext;
	}

	// Opätovné použitie existujúceho natívneho kontextu z Tone.js (nastaveného v spectra.js).
	if (window.nativeAudioContext && window.nativeAudioContext.state !== 'closed') {
		audioContext = window.nativeAudioContext;
		return audioContext;
	}

	// Provizórny extraktor kontextu
	// spoliehať sa len na jeden spôsob extrahovania bolo nespoľahlivé, takže toto je odolnejšie riešenie.
	if (typeof Tone !== 'undefined' && Tone.context) {
		var toneCtx = Tone.context;
		if (toneCtx._context && toneCtx._context._nativeAudioContext) {
			audioContext = toneCtx._context._nativeAudioContext;
		} else if (toneCtx._context instanceof AudioContext) {
			audioContext = toneCtx._context;
		} else if (toneCtx.rawContext instanceof AudioContext) {
			audioContext = toneCtx.rawContext;
		}
		if (audioContext) {
			return audioContext;
		}
	}

	Logger.warn('[AudioAnalyzer] Creating new AudioContext - Tone.js context not available');
	window.AudioContext = window.AudioContext || window.webkitAudioContext;
	audioContext = new AudioContext();
	return audioContext;
}

// Ručné parsovanie WAV, pretože decodeAudioData v Chromiu bolo nespoľahlivé a padalo.

async function decodeAudioBuffer(arrayBuffer) {
	Logger.log('[AudioAnalyzer] Parsing WAV file manually...');

	var dataView = new DataView(arrayBuffer);

	// Naparsovanie WAV hlavičky (zdieľané spracovanie RIFF); extrakcia vzoriek nižšie je špecifická pre analyzátor.
	var header = SpectraDSP.parseWavHeader(dataView);
	var fmtChunk = header.fmt;
	var dataChunk = { offset: header.dataOffset, size: header.dataSize };

	// Podpora len pre PCM (formát 1) a IEEE float (formát 3).
	if (fmtChunk.audioFormat !== 1 && fmtChunk.audioFormat !== 3) {
		throw new Error(`Unsupported WAV format: ${fmtChunk.audioFormat} (only PCM and IEEE float supported)`);
	}

	var { numChannels, sampleRate: wavSampleRate, bitsPerSample } = fmtChunk; // Pythonovský zápis priradenia.
	var isFloat = fmtChunk.audioFormat === 3;
	var bytesPerSample = bitsPerSample / 8;
	var numSamples = Math.floor(dataChunk.size / (numChannels * bytesPerSample));

	Logger.log(`[AudioAnalyzer] WAV: ${numChannels}ch, ${wavSampleRate}Hz, ${bitsPerSample}bit${isFloat ? ' float' : ''}, ${numSamples} samples`);

	var ctx = getAudioContext();
	var buffer = ctx.createBuffer(numChannels, numSamples, wavSampleRate);

	var readOffset = dataChunk.offset;

	for (let channel = 0; channel < numChannels; channel++) {
		var channelData = buffer.getChannelData(channel);
		readOffset = dataChunk.offset;

		for (let i = 0; i < numSamples; i++) {
			var sampleOffset = readOffset + (i * numChannels + channel) * bytesPerSample;

			if (isFloat) {
				// IEEE 32-bitový float.
				channelData[i] = dataView.getFloat32(sampleOffset, true);
			} else if (bitsPerSample === 16) {
				// 16-bit
				const sample = dataView.getInt16(sampleOffset, true);
				channelData[i] = sample / 32768;
			} else if (bitsPerSample === 24) {
				// 24-bit, musí sa extrahovať po ôsmich bitoch a spraviť štandardné bitové operácie.
				var b0 = dataView.getUint8(sampleOffset);
				var b1 = dataView.getUint8(sampleOffset + 1);
				var b2 = dataView.getUint8(sampleOffset + 2);
				let sample = (b2 << 16) | (b1 << 8) | b0;
				if (sample & 0x800000) sample |= 0xFF000000; // Rozšírenie znamienka
				channelData[i] = sample / 8388608;
			} else if (bitsPerSample === 8) {
				// 8-bit
				const sample = dataView.getUint8(sampleOffset);
				channelData[i] = (sample - 128) / 128;
			} else if (bitsPerSample === 32 && !isFloat) {
				// 32-bit
				const sample = dataView.getInt32(sampleOffset, true);
				channelData[i] = sample / 2147483648;
			} else {
				throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
			}
		}
	}

	Logger.log(`[AudioAnalyzer] WAV parsing complete: ${buffer.duration.toFixed(2)}s`);
	return buffer;
}

function init() {
	// AudioContext sa tu nevytvára, vytvorí sa až v momente, keď je potrebný
	// tým sa predíde prípadným konfliktom audio systémov
	// (bolo nutné myslieť aj na túto možnosť).

	waveformCanvas = document.getElementById('analyzerWaveform');
	if (waveformCanvas) {
		waveformCtx = waveformCanvas.getContext('2d');
		setupWaveformCanvas();
	}

	// Inicializácia spectrum canvasu (náhrada za predtým použitý Chart.js).
	spectrumCanvas = document.getElementById('analyzerChart');
	if (spectrumCanvas) {
		spectrumCtx = spectrumCanvas.getContext('2d');
		setupSpectrumCanvas();
	}

	setupEventListeners();
}

function setupWaveformCanvas() {
	if (!waveformCanvas || !waveformCtx) return;

	var rect = waveformCanvas.getBoundingClientRect();

	waveformCanvas.width = rect.width || 400;
	waveformCanvas.height = 50;
}

function setupSpectrumCanvas() {
	if (!spectrumCanvas || !spectrumCtx) return;

	var rect = spectrumCanvas.getBoundingClientRect();
	spectrumCanvas.width = rect.width || 400;
	spectrumCanvas.height = rect.height || 200;

	spectrumCtx.fillStyle = '#1a1a1a';
	spectrumCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
}

function setupEventListeners() {
	var openFileBtn = sel('.analyzer-open-file');
	var fileInput = sel('.analyzer-file-input');
	var thresholdSlider = sel('.analyzer-threshold');
	var sensitivitySlider = sel('.analyzer-sensitivity');
	var generateAudioBtn = sel('.analyzer-generate-audio');
	var useAsTimbreBtn = sel('.analyzer-use-as-timbre');

	setupWaveformInteraction();
	setupSpectrumInteraction();

	if (openFileBtn) {
		openFileBtn.addEventListener('click', () => fileInput.click());
	}

	if (fileInput) {
		fileInput.addEventListener('change', handleFileSelect);
	}

	if (thresholdSlider) {
		thresholdSlider.addEventListener('input', (e) => {
			var expValue = sliderToExp(parseFloat(e.target.value));
			sel('.analyzer-threshold-value').textContent = expValue.toFixed(4);
			if (lastFrequencies.length > 0) {
				detectHarmonics(lastFrequencies, lastMagnitudes);
			}
		});
	}

	if (sensitivitySlider) {
		sensitivitySlider.addEventListener('input', (e) => {
			var expValue = sliderToExp(parseFloat(e.target.value));
			sel('.analyzer-sensitivity-value').textContent = expValue.toFixed(4);
			if (lastFrequencies.length > 0) {
				detectHarmonics(lastFrequencies, lastMagnitudes);
			}
		});
	}

	if (generateAudioBtn) {
		generateAudioBtn.addEventListener('click', generateAudio);
	}

	if (useAsTimbreBtn) {
		useAsTimbreBtn.addEventListener('click', useAsTimbre);
	}

	var midiOutput = sel('.analyzer-midi-output');
	var freqOutput = sel('.analyzer-freq-output');

	if (midiOutput) {
		midiOutput.addEventListener('click', () => {
			if (harmonics.length === 0) return;
			var text = harmonics.map(h => freq2note(h).toFixed(2)).join(', ');
			navigator.clipboard.writeText(text).then(() => {
				var original = midiOutput.textContent;
				midiOutput.textContent = 'Copied!';
				setTimeout(() => { midiOutput.textContent = original; }, 1000);
			});
		});
	}

	if (freqOutput) {
		freqOutput.addEventListener('click', () => {
			if (harmonics.length === 0) return;
			var text = harmonics.map(h => h.toFixed(1)).join(', ');
			navigator.clipboard.writeText(text).then(() => {
				var original = freqOutput.textContent;
				freqOutput.textContent = 'Copied!';
				setTimeout(() => { freqOutput.textContent = original; }, 1000);
			});
		});
	}

	// Pridanie tlačidla "Use Frequencies" pre callback.
	var useFreqBtn = sel('.analyzer-use-frequencies');
	if (useFreqBtn) {
		useFreqBtn.addEventListener('click', useFrequencies);
	}
}

function setupWaveformInteraction() {
	if (!waveformCanvas) return;

	waveformCanvas.addEventListener('mousedown', handleWaveformMouseDown);
	waveformCanvas.addEventListener('mousemove', handleWaveformMouseMove);
	waveformCanvas.addEventListener('mouseup', handleWaveformMouseUp);
	waveformCanvas.addEventListener('mouseleave', handleWaveformMouseUp);
}

function handleWaveformMouseDown(e) {
	if (!audioBuffer) return;

	var rect = waveformCanvas.getBoundingClientRect();
	var x = e.clientX - rect.left;
	var canvasWidth = waveformCanvas.width;

	// V prípade, ak canvas nemá šírku, prepočíta sa.
	if (canvasWidth <= 0 || rect.width <= 0) {
		setupWaveformCanvas();
		return;
	}

	var scaleX = canvasWidth / rect.width; // Prepočet pozície myši na súradnice canvasu.
	var canvasX = x * scaleX;

	var clickPosition = canvasX / canvasWidth;

	// Určenie toho, čo sa má ťahať.
	var startX = rangeStart * canvasWidth;
	var endX = rangeEnd * canvasWidth;
	var handleSize = 8;

	if (Math.abs(canvasX - startX) < handleSize) {
		dragMode = 'start';
		isDragging = true;
	} else if (Math.abs(canvasX - endX) < handleSize) {
		dragMode = 'end';
		isDragging = true;
	} else if (canvasX > startX && canvasX < endX) {
		dragMode = 'range';
		isDragging = true;
		dragStartX = clickPosition;
	} else {
		// Ak sa klikne mimo rozsahu, nastaví sa nová pozícia.
		rangeStart = clickPosition;
		rangeEnd = Math.min(1, clickPosition + 0.1);
		updateRangeDisplay();
		drawWaveform();
		analyzeAudio();
	}
}

function handleWaveformMouseMove(e) {
	if (!isDragging || !audioBuffer) return;

	var rect = waveformCanvas.getBoundingClientRect();
	var x = e.clientX - rect.left;
	var canvasWidth = waveformCanvas.width;

	if (canvasWidth <= 0 || rect.width <= 0) return;

	var scaleX = canvasWidth / rect.width; // To isté ako predtým.
	var canvasX = x * scaleX;
	var mousePosition = Math.max(0, Math.min(1, canvasX / canvasWidth));
	var oldStart = rangeStart;
	var oldEnd = rangeEnd;

	if (dragMode === 'start') {
		rangeStart = Math.min(mousePosition, rangeEnd - 0.01);
	} else if (dragMode === 'end') {
		rangeEnd = Math.max(mousePosition, rangeStart + 0.01);
	} else if (dragMode === 'range') {
		var delta = mousePosition - dragStartX;
		var rangeWidth = rangeEnd - rangeStart;

		if (delta < 0) {
			rangeStart = Math.max(0, rangeStart + delta);
			rangeEnd = rangeStart + rangeWidth;
		} else {
			rangeEnd = Math.min(1, rangeEnd + delta);
			rangeStart = rangeEnd - rangeWidth;
		}
		dragStartX = mousePosition;
	}

	updateRangeDisplay();
	drawWaveform();

	// Debounce ukončí spracovanie, ak sa istú dobu nič nestane (150 ms).
	if (Math.abs(rangeStart - oldStart) > 0.001 || Math.abs(rangeEnd - oldEnd) > 0.001) {
		clearTimeout(dragAnalysisTimeout);
		dragAnalysisTimeout = setTimeout(analyzeAudio, 150);
	}
}

function handleWaveformMouseUp() {
	if (isDragging) {
		isDragging = false;
		dragMode = null;
		analyzeAudio();
	}
}

function updateRangeDisplay() {
	var display = sel('.analyzer-range-display');
	if (display && audioBuffer) {
		var duration = audioBuffer.duration;
		var startTime = (rangeStart * duration).toFixed(2);
		var endTime = (rangeEnd * duration).toFixed(2);
		display.textContent = `${startTime}s - ${endTime}s`;
	}
}

function setupSpectrumInteraction() {
	if (!spectrumCanvas) return;

	spectrumCanvas.addEventListener('mousedown', handleSpectrumMouseDown);
	spectrumCanvas.addEventListener('mousemove', handleSpectrumMouseMove);
	spectrumCanvas.addEventListener('mouseup', handleSpectrumMouseUp);
	spectrumCanvas.addEventListener('mouseleave', handleSpectrumMouseUp);
}

function xToFreq(x, width) {
	var minFreq = 20;
	var maxFreq = 20000;
	var logMin = Math.log10(minFreq);
	var logMax = Math.log10(maxFreq);
	var ratio = x / width;
	return Math.pow(10, logMin + ratio * (logMax - logMin));
}

function freqToX(freq, width) {
	var minFreq = 20;
	var maxFreq = 20000;
	var logMin = Math.log10(minFreq);
	var logMax = Math.log10(maxFreq);
	return ((Math.log10(freq) - logMin) / (logMax - logMin)) * width;
}

function handleSpectrumMouseDown(e) {
	if (!spectrumCanvas) return;

	var rect = spectrumCanvas.getBoundingClientRect();
	var x = e.clientX - rect.left;
	var canvasWidth = spectrumCanvas.width;

	if (canvasWidth <= 0 || rect.width <= 0) return;

	var scaleX = canvasWidth / rect.width;
	var canvasX = x * scaleX;

	var startX = freqToX(freqRangeStart, canvasWidth);
	var endX = freqToX(freqRangeEnd, canvasWidth);
	var handleSize = 10;

	if (Math.abs(canvasX - startX) < handleSize) {
		freqDragMode = 'start';
		isFreqDragging = true;
	} else if (Math.abs(canvasX - endX) < handleSize) {
		freqDragMode = 'end';
		isFreqDragging = true;
	} else if (canvasX > startX && canvasX < endX) {
		freqDragMode = 'range';
		isFreqDragging = true;
		freqDragStartX = canvasX;
	} else {
		// Kliknutie mimo nastaví nové pozície, podobne ako vyššie.
		var clickFreq = xToFreq(canvasX, canvasWidth);
		freqRangeStart = Math.max(20, clickFreq * 0.5);
		freqRangeEnd = Math.min(20000, clickFreq * 2);
		updateFreqRangeDisplay();
		drawSpectrum();
		if (lastFrequencies.length > 0) {
			detectHarmonics(lastFrequencies, lastMagnitudes);
		}
	}
}

function handleSpectrumMouseMove(e) {
	if (!isFreqDragging || !spectrumCanvas) return;

	var rect = spectrumCanvas.getBoundingClientRect();
	var x = e.clientX - rect.left;
	var canvasWidth = spectrumCanvas.width;

	if (canvasWidth <= 0 || rect.width <= 0) return;

	var scaleX = canvasWidth / rect.width;
	var canvasX = x * scaleX;
	var mouseFreq = xToFreq(Math.max(0, Math.min(canvasWidth, canvasX)), canvasWidth);

	if (freqDragMode === 'start') {
		freqRangeStart = Math.max(20, Math.min(mouseFreq, freqRangeEnd * 0.9));
	} else if (freqDragMode === 'end') {
		freqRangeEnd = Math.min(20000, Math.max(mouseFreq, freqRangeStart * 1.1));
	} else if (freqDragMode === 'range') {
		var deltaX = canvasX - freqDragStartX;
		var startX = freqToX(freqRangeStart, canvasWidth);
		var endX = freqToX(freqRangeEnd, canvasWidth);

		var newStartX = Math.max(0, startX + deltaX);
		var newEndX = Math.min(canvasWidth, endX + deltaX);

		if (newStartX >= 0 && newEndX <= canvasWidth) {
			freqRangeStart = xToFreq(newStartX, canvasWidth);
			freqRangeEnd = xToFreq(newEndX, canvasWidth);
			freqDragStartX = canvasX;
		}
	}

	updateFreqRangeDisplay();
	drawSpectrum();
}

function handleSpectrumMouseUp() {
	if (isFreqDragging) {
		isFreqDragging = false;
		freqDragMode = null;
		// Detekcia harmonických s novým frekvenčným rozsahom.
		if (lastFrequencies.length > 0) {
			detectHarmonics(lastFrequencies, lastMagnitudes);
		}
	}
}

function updateFreqRangeDisplay() {
	var display = sel('.analyzer-freq-range-display');
	if (display) {
		var startStr = freqRangeStart >= 1000 ? (freqRangeStart / 1000).toFixed(1) + 'k' : Math.round(freqRangeStart);
		var endStr = freqRangeEnd >= 1000 ? (freqRangeEnd / 1000).toFixed(1) + 'k' : Math.round(freqRangeEnd);
		display.textContent = `${startStr} Hz - ${endStr} Hz`;
	}
}

function handleFileSelect(e) {
	var file = e.target.files[0];
	if (!file) return;

	var fileName = file.name;
	var fileSize = file.size;
	sel('.analyzer-file-name').textContent = fileName;

	Logger.log(`[AudioAnalyzer] Loading file: ${fileName}, size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

	var maxRecommendedSize = 50 * 1024 * 1024;
	if (fileSize > maxRecommendedSize) {
		Logger.warn(`[AudioAnalyzer] Large file detected (${(fileSize / 1024 / 1024).toFixed(0)} MB). This may take a while to process.`);
		showStatus(`Loading large file (${(fileSize / 1024 / 1024).toFixed(0)} MB)...`, { type: 'info' });
	}

	var reader = new FileReader();

	reader.onerror = (error) => {
		Logger.error('[AudioAnalyzer] FileReader error:', error);
		showStatus('Error reading audio file', { type: 'error' });
	};

	reader.onload = async (event) => {
		try {
			var arrayBuffer = event.target.result;
			if (!arrayBuffer || arrayBuffer.byteLength === 0) {
				throw new Error('File is empty or could not be read');
			}

			Logger.log(`[AudioAnalyzer] File read complete, ${arrayBuffer.byteLength} bytes. Decoding...`);

			// V krajnom prípade, ak by náhodou AudioContext bol pozastavený, a to už z rôznych dôvodov, opäť sa spustí.
			var ctx = getAudioContext();
			if (ctx && ctx.state === 'suspended') {
				Logger.log('[AudioAnalyzer] Resuming suspended AudioContext...');
				await ctx.resume();
			}

			// Ručné parsovanie WAV, aby sa predišlo zlyhaniu decodeAudioData v Chromiu.
			audioBuffer = await decodeAudioBuffer(arrayBuffer);

			sampleRate = audioBuffer.sampleRate;

			rangeStart = 0.1;
			rangeEnd = Math.min(0.2, 1); // Ide o pomer, nie o sekundy.

			freqRangeStart = 20;
			freqRangeEnd = 20000;

			// Opätovné zmeranie canvasu (mohol mať 0, keď bol skrytý).
			setupWaveformCanvas();
			setupSpectrumCanvas();

			updateRangeDisplay();
			updateFreqRangeDisplay();
			drawWaveform();
			analyzeAudio();

			showStatus('Audio loaded', { type: 'success', duration: 2000 });
		} catch (error) {
			Logger.error('[AudioAnalyzer] Error processing audio:', error);
			var errorMsg = error.message || 'Unknown error';
			if (errorMsg.includes('RIFF') || errorMsg.includes('WAVE')) {
				errorMsg = 'Not a valid WAV file. Please use a standard WAV format.';
			}
			showStatus(`Error: ${errorMsg}`, { type: 'error' });
		}
	};

	reader.readAsArrayBuffer(file);
}

function drawWaveform() {
	if (!waveformCanvas || !waveformCtx || !audioBuffer) return;

	Logger.log('[AudioAnalyzer] Drawing waveform...');

	var ctx = waveformCtx;
	var width = waveformCanvas.width;
	var height = waveformCanvas.height;

	if (width <= 0 || height <= 0) {
		Logger.warn('[AudioAnalyzer] Canvas has zero dimensions, skipping draw');
		return;
	}

	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, width, height);

	var channelData = audioBuffer.getChannelData(0);
	var samplesPerPixel = Math.ceil(channelData.length / width);
	Logger.log('[AudioAnalyzer] Samples per pixel:', samplesPerPixel);

	ctx.strokeStyle = '#444';
	ctx.lineWidth = 1;
	ctx.beginPath();

	var centerY = height / 2;

	for (let x = 0; x < width; x++) {
		var startSample = Math.floor(x * samplesPerPixel);
		var endSample = Math.min(startSample + samplesPerPixel, channelData.length);

		var min = 0, max = 0;
		for (let i = startSample; i < endSample; i++) {
			if (channelData[i] < min) min = channelData[i];
			if (channelData[i] > max) max = channelData[i];
		}

		var y1 = centerY - max * (height / 2 - 2);
		var y2 = centerY - min * (height / 2 - 2);

		ctx.moveTo(x, y1);
		ctx.lineTo(x, y2);
	}

	ctx.stroke();

	var startX = rangeStart * width;
	var endX = rangeEnd * width;

	ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
	ctx.fillRect(0, 0, startX, height);
	ctx.fillRect(endX, 0, width - endX, height);

	ctx.fillStyle = '#4a9eff';
	ctx.fillRect(startX - 2, 0, 4, height);
	ctx.fillRect(endX - 2, 0, 4, height);

	ctx.fillStyle = 'rgba(74, 158, 255, 0.1)';
	ctx.fillRect(startX, 0, endX - startX, height);
}

function analyzeAudio() {
	if (!audioBuffer) return;

	var harmonicsOutput = sel('.analyzer-harmonics-output');
	if (harmonicsOutput) harmonicsOutput.textContent = 'Analyzing...';

	Logger.log('[AudioAnalyzer] Starting analysis...');

	var channelData = audioBuffer.getChannelData(0);
	Logger.log('[AudioAnalyzer] Channel data length:', channelData.length);

	var startSample = Math.floor(rangeStart * channelData.length);
	var endSample = Math.floor(rangeEnd * channelData.length);

	var length = endSample - startSample;
	if (length < 4) {
		Logger.warn('[AudioAnalyzer] Selection too short for meaningful analysis');
		return;
	}
	var maxFFTSize = 32768;
	var minFFTSize = 64;
	var fftSize = 2;
	while (fftSize < length && fftSize < maxFFTSize) {
		fftSize *= 2;
	}
	fftSize = Math.max(minFFTSize, fftSize);

	Logger.log('[AudioAnalyzer] FFT size:', fftSize, 'Selection length:', length);

	var audioData;
	if (length <= maxFFTSize) {
		audioData = channelData.slice(startSample, endSample);
	} else {
		// Výber je príliš veľký, takže sa použije stredná časť.
		var middleSample = Math.floor((startSample + endSample) / 2);
		var halfWindow = Math.floor(maxFFTSize / 2);
		var windowStart = Math.max(startSample, middleSample - halfWindow);
		var windowEnd = Math.min(endSample, middleSample + halfWindow);

		audioData = channelData.slice(windowStart, windowEnd);
		fftSize = maxFFTSize;

		Logger.warn(`Selection too large (${length} samples). Analyzing ${audioData.length} samples from middle of selection.`);
	}

	var paddedData = new Float32Array(fftSize);
	paddedData.set(audioData.slice(0, Math.min(audioData.length, fftSize)));

	// [ZDROJ] HARRIS, Fredric J. On the Use of Windows for Harmonic Analysis with the Discrete Fourier
	//   Transform. Proceedings of the IEEE. 1978, roč. 66, č. 1, s. 51-83. ISSN 0018-9219. DOI
	//   10.1109/PROC.1978.10837.

	// Aplikovanie okna Hanning.
	var windowLen = Math.min(audioData.length, fftSize);
	if (windowLen > 1) {
		for (let i = 0; i < windowLen; i++) {
			paddedData[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowLen - 1)));
		}
	}

	var frequencyData = SpectraDSP.rfft(paddedData);
	var frequencyBins = frequencyData.length;

	// Využitie sampleRate z audioBuffer (nastaveného pri načítaní súboru) pre presný výpočet frekvencie.
	var analysisSampleRate = audioBuffer ? audioBuffer.sampleRate : sampleRate;
	var frequencies = [];
	var magnitudes = [];
	for (let i = 0; i < frequencyBins; i++) {
		var freq = (i * analysisSampleRate) / fftSize;
		frequencies.push(freq);
		magnitudes.push(frequencyData[i]);
	}

	// Normalizácia magnitúd (bez spread operátora, ktorý pri veľkých poliach spôsobí pretečenie zásobníka volaní).
	var maxMagnitude = 0;
	for (let i = 0; i < magnitudes.length; i++) {
		if (magnitudes[i] > maxMagnitude) maxMagnitude = magnitudes[i];
	}
	var normalizedMagnitudes = magnitudes.map(m => m / maxMagnitude);

	Logger.log('[AudioAnalyzer] FFT complete, max magnitude:', maxMagnitude);

	updateChart(frequencies, normalizedMagnitudes);

	detectHarmonics(frequencies, normalizedMagnitudes);
}

function updateChart(frequencies, magnitudes) {
	// Uloženie pre prekreslenie, keď sa zmení len prah alebo citlivosť
	// pôvodne bolo vykresľovanie nesmierne neefektívne vzhľadom na konštantné prekresľovanie obsahu.
	lastFrequencies = frequencies;
	lastMagnitudes = magnitudes;
	drawSpectrum();
}

function drawSpectrum() {
	if (!spectrumCanvas || !spectrumCtx || lastFrequencies.length === 0) return;

	var ctx = spectrumCtx;
	var width = spectrumCanvas.width;
	var height = spectrumCanvas.height;

	// Exponenciálne hodnoty z jazdcov.
	var thresholdLinear = parseFloat(sel('.analyzer-threshold')?.value || 0.3);
	var sensitivityLinear = parseFloat(sel('.analyzer-sensitivity')?.value || 0.15);
	var threshold = sliderToExp(thresholdLinear);
	var sensitivity = sliderToExp(sensitivityLinear);

	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, width, height);

	var minFreq = 20;
	var maxFreq = 20000;
	var logMin = Math.log10(minFreq);
	var logMax = Math.log10(maxFreq);

	ctx.strokeStyle = '#555';
	ctx.lineWidth = 1;
	ctx.beginPath();

	var started = false;
	for (let i = 0; i < lastFrequencies.length; i++) {
		const freq = lastFrequencies[i];
		if (freq < minFreq || freq > maxFreq) continue;

		const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * width;
		const y = height - lastMagnitudes[i] * height;

		if (!started) {
			ctx.moveTo(x, y);
			started = true;
		} else {
			ctx.lineTo(x, y);
		}
	}
	ctx.stroke();

	ctx.strokeStyle = 'rgba(239, 77, 77, 0.5)';
	ctx.lineWidth = 1;
	ctx.setLineDash([5, 5]);
	ctx.beginPath();
	ctx.moveTo(0, height - threshold * height);
	ctx.lineTo(width, height - threshold * height);
	ctx.stroke();

	ctx.strokeStyle = 'rgba(187, 153, 0, 0.55)';
	ctx.beginPath();
	ctx.moveTo(0, height - sensitivity * height);
	ctx.lineTo(width, height - sensitivity * height);
	ctx.stroke();
	ctx.setLineDash([]);

	// Vykreslenie jednotlivých vrcholov (parciálov) modrým akcentom Spectry, s výplňou a obrubou ako pri grafe farby.
	ctx.lineWidth = 1;
	for (let i = 0; i < harmonics.length; i++) {
		const freq = harmonics[i];
		var amp = harmonicsAmplitudes[i];
		const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * width;
		const y = height - amp * height;
		ctx.beginPath();
		ctx.arc(x, y, 4, 0, Math.PI * 2);
		ctx.fillStyle = '#4a9eff';
		ctx.fill();
		ctx.strokeStyle = '#7ab6ff';
		ctx.stroke();
	}

	var startX = freqToX(freqRangeStart, width);
	var endX = freqToX(freqRangeEnd, width);

	ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
	ctx.fillRect(0, 0, startX, height);
	ctx.fillRect(endX, 0, width - endX, height);

	ctx.fillStyle = '#4a9eff';
	ctx.fillRect(startX - 2, 0, 4, height);
	ctx.fillRect(endX - 2, 0, 4, height);

	ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
	ctx.lineWidth = 1;
	ctx.setLineDash([]);
	ctx.strokeRect(startX, 0, endX - startX, height);

	// Vykreslenie frekvenčných popiskov do HTML elementu pod canvasom.
	renderFrequencyLabels(width, logMin, logMax);
}

function renderFrequencyLabels(width, logMin, logMax) {
	var container = sel('.analyzer-freq-labels');
	if (!container) return;

	var freqLabels = [20, 50, 100, 200, 500, '1k', '2k', '5k', '10k', '20k'];
	var freqValues = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

	container.innerHTML = freqLabels.map((label, i) => {
		var f = freqValues[i];
		var x = ((Math.log10(f) - logMin) / (logMax - logMin)) * 100;
		return `<span style="position:absolute;left:${x}%;transform:translateX(-50%)">${label}</span>`;
	}).join('');
	container.style.position = 'relative';
}

function detectHarmonics(frequencies, magnitudes) {
	// Exponenciálne hodnoty z jazdcov (s poistkou proti null).
	var thresholdEl = sel('.analyzer-threshold');
	var sensitivityEl = sel('.analyzer-sensitivity');
	if (!thresholdEl || !sensitivityEl) return;
	var thresholdLinear = parseFloat(thresholdEl.value);
	var sensitivityLinear = parseFloat(sensitivityEl.value);
	var threshold = sliderToExp(thresholdLinear);
	var sensitivity = sliderToExp(sensitivityLinear);

	harmonics = [];
	harmonicsAmplitudes = [];

	var gateIndex = -1;

	for (let i = 0; i < magnitudes.length; i++) {
		var mag = magnitudes[i];

		// Koniec detekcie vrcholu.
		if (gateIndex > -1 && mag < sensitivity) {
			const peakRange = magnitudes.slice(gateIndex, i);
			let maxMag = -Infinity;
			for (let j = 0; j < peakRange.length; j++) if (peakRange[j] > maxMag) maxMag = peakRange[j];
			const maxIndex = peakRange.indexOf(maxMag) + gateIndex;
			const peakFreq = frequencies[maxIndex];

			if (peakFreq >= freqRangeStart && peakFreq <= freqRangeEnd) {
				harmonics.push(peakFreq);
				harmonicsAmplitudes.push(maxMag);
			}

			gateIndex = -1;
		}

		// Začiatok detekcie vrcholu.
		if (i > 0 && mag > threshold && gateIndex === -1) {
			gateIndex = i;
		}
	}

	// Dokončenie posledného vrcholu, ak analýza skončila ešte v jeho priebehu.
	if (gateIndex > -1) {
		const peakRange = magnitudes.slice(gateIndex, magnitudes.length);
		let maxMag = -Infinity;
		for (let i = 0; i < peakRange.length; i++) if (peakRange[i] > maxMag) maxMag = peakRange[i];
		const maxIndex = peakRange.indexOf(maxMag) + gateIndex;
		const peakFreq = frequencies[maxIndex];
		if (peakFreq >= freqRangeStart && peakFreq <= freqRangeEnd) {
			harmonics.push(peakFreq);
			harmonicsAmplitudes.push(maxMag);
		}
	}

	var midiOutput = sel('.analyzer-midi-output');
	var freqOutput = sel('.analyzer-freq-output');

	if (harmonics.length === 0) {
		if (midiOutput) midiOutput.textContent = 'No harmonics detected';
		if (freqOutput) freqOutput.textContent = 'No harmonics detected';
	} else {
		if (midiOutput) {
			midiOutput.textContent = harmonics.map(h => freq2note(h).toFixed(2)).join(', ');
		}
		if (freqOutput) {
			freqOutput.textContent = harmonics.map(h => h.toFixed(1)).join(', ');
		}
	}

	drawSpectrum();

	updateUseFrequenciesButton();
}

function generateAudio() {
	if (harmonics.length === 0) {
		showStatus('No harmonics found - load a file first.', { type: 'warning' });
		return;
	}

	var ctx = getAudioContext();
	var ctxSampleRate = ctx.sampleRate || sampleRate;
	var duration = 2.0;
	var bufferSize = Math.floor(ctxSampleRate * duration);
	var buffer = ctx.createBuffer(1, bufferSize, ctxSampleRate);
	var channelData = buffer.getChannelData(0);

	// Generovanie súčtu sínusoviek.
	for (let i = 0; i < bufferSize; i++) {
		var t = i / ctxSampleRate;
		var sample = 0;
		for (let h = 0; h < harmonics.length; h++) {
			sample += Math.sin(2 * Math.PI * harmonics[h] * t) * (1 / harmonics.length);
		}
		channelData[i] = sample;
	}

	var source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(ctx.destination);
	source.start();
}

function useAsTimbre() {
	if (harmonics.length === 0) {
		showStatus('No harmonics found - load a file first.', { type: 'warning' });
		return;
	}

	// Nájdenie najnižšej harmonickej, ktorá sa použije ako fundamentál.
	var fundamental = Math.min(...harmonics);

	var timbreData = harmonics.map((freq, i) => {
		var multiplier = freq / fundamental;
		var amplitude = harmonicsAmplitudes[i];
		return [multiplier, amplitude];
	});

	timbreData.sort((a, b) => a[0] - b[0]);

	// Aktualizácia Setup.currentTimbre pomocou setCurrentData (zároveň rozšírenie pre dynamické farby).
	var Setup = window.Setup;
	var UI = window.UI;

	if (Setup?.currentTimbre) {
		if (typeof Setup.timbre?.setCurrentData === 'function') {
			Setup.timbre.setCurrentData(timbreData);
		} else {
			// Cesta pre staršiu verziu.
			Setup.currentTimbre.data = timbreData;
		}

		if (typeof Setup.timbre?.render === 'function') {
			Setup.timbre.render();
		}

		if (window.HarmonicsChart?.refreshFromSetup) {
			window.HarmonicsChart.refreshFromSetup();
		}

		UI?.analyzer?.close();
	} else {
		showStatus('Open the Timbre Editor first.', { type: 'warning' });
	}
}

// Túto funkciu využíva Grid editor na získanie frekvencií pre mriežky založené na frekvenciách.

function useFrequencies() {
	if (harmonics.length === 0) {
		showStatus('No harmonics found - load a file first.', { type: 'warning' });
		return;
	}

	if (externalCallback) {
		externalCallback(harmonics.slice()); // Predá sa kópia harmonických.
		externalCallback = null;
		updateUseFrequenciesButton();
		window.UI?.analyzer?.close();
	}
}

function updateUseFrequenciesButton() {
	var btn = sel('.analyzer-use-frequencies');
	if (btn) {
		btn.style.display = externalCallback ? 'inline-block' : 'none';
	}
}

function openWithCallback(callback) {
	externalCallback = callback;

	updateUseFrequenciesButton();

	window.UI?.analyzer?.open();

	setTimeout(() => {
		setupWaveformCanvas();
		setupSpectrumCanvas();
		if (audioBuffer) {
			drawWaveform();
			drawSpectrum();
		}
	}, 50);
}

// Verejné API
var AudioAnalyzer = {
	init,
	openWithCallback,
	resizeCanvas: () => {
		setupWaveformCanvas();
		setupSpectrumCanvas();
		updateFreqRangeDisplay();
		if (audioBuffer) {
			drawWaveform();
		}
		if (lastFrequencies.length > 0) {
			drawSpectrum();
		}
	}
};
