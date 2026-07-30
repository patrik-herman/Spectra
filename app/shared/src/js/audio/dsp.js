// Zdieľané DSP funkcie, radix-2 FFT a spracovanie hlavičky WAV RIFF sú tu len raz, používajú ich audio-analyzer.js a audio-drop-analyzer.js (každý si drží vlastné okienkovanie a extrakciu vzoriek, tu žije len zhodné jadro).

(function() {
	'use strict';

	// [ZDROJ] COOLEY, James W. a TUKEY, John W. An Algorithm for the Machine Calculation of Complex Fourier
	//   Series. Mathematics of Computation. 1965, roč. 19, č. 90, s. 297-301. ISSN 0025-5718.

	// Cooley-Tukey FFT
	var _twiddleCache = {};
	function _getTwiddles(n) {
		if (_twiddleCache[n]) return _twiddleCache[n];
		var cos = new Float64Array(n / 2);
		var sin = new Float64Array(n / 2);
		for (let i = 0; i < n / 2; i++) {
			var angle = -2 * Math.PI * i / n;
			cos[i] = Math.cos(angle);
			sin[i] = Math.sin(angle);
		}
		_twiddleCache[n] = { cos, sin };
		return _twiddleCache[n];
	}

	function fft(real, imag) {
		var n = real.length;
		if (n <= 1) return;
		if ((n & (n - 1)) !== 0) {
			if (typeof Logger !== 'undefined') Logger.error('[DSP] FFT size must be power of 2, got:', n);
			return;
		}

		var tw = _getTwiddles(n);

		// Bit-reversal permutácia
		let j = 0;
		for (let i = 0; i < n - 1; i++) {
			if (i < j) {
				var temp = real[i]; real[i] = real[j]; real[j] = temp;
				temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
			}
			let k = n / 2;
			while (k <= j) { j -= k; k /= 2; }
			j += k;
		}

		for (let size = 2; size <= n; size *= 2) {
			var halfsize = size / 2;
			var tablestep = n / size;
			for (let i = 0; i < n; i += size) {
				for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
					var cos = tw.cos[k];
					var sin = tw.sin[k];
					var tpre = real[j + halfsize] * cos - imag[j + halfsize] * sin;
					var tpim = real[j + halfsize] * sin + imag[j + halfsize] * cos;
					real[j + halfsize] = real[j] - tpre;
					imag[j + halfsize] = imag[j] - tpim;
					real[j] += tpre;
					imag[j] += tpim;
				}
			}
		}
	}

	// Reálna FFT -> magnitúdové spektrum pre kladné frekvencie (biny 0..n/2), normalizované podľa n.
	function rfft(data) {
		var n = data.length;
		var real = new Float32Array(data);
		var imag = new Float32Array(n);
		fft(real, imag);
		var output = new Float32Array(n / 2 + 1);
		for (let i = 0; i <= n / 2; i++) {
			output[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
		}
		return output;
	}

	// [ZDROJ] IBM Corporation a Microsoft Corporation. Multimedia Programming Interface and Data
	//   Specifications 1.0 [online]. August 1991 [cit. 2026-07-30]. Dostupné z:
	//   https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/Docs/riffmci.pdf

	// Extrakcia dát z hlavičky súboru.
	function parseWavHeader(dataView) {
		var byteLength = dataView.byteLength;
		var str4 = (o) => String.fromCharCode(dataView.getUint8(o), dataView.getUint8(o + 1), dataView.getUint8(o + 2), dataView.getUint8(o + 3));

		if (str4(0) !== 'RIFF') throw new Error('Not a valid WAV file (missing RIFF header)');
		if (str4(8) !== 'WAVE') throw new Error('Not a valid WAV file (missing WAVE format)');

		var offset = 12;
		var fmt = null;
		var dataOffset = -1, dataSize = 0;
		while (offset < byteLength - 8) {
			var chunkId = str4(offset);
			var chunkSize = dataView.getUint32(offset + 4, true);
			if (chunkId === 'fmt ') {
				fmt = {
					audioFormat: dataView.getUint16(offset + 8, true),
					numChannels: dataView.getUint16(offset + 10, true),
					sampleRate: dataView.getUint32(offset + 12, true),
					byteRate: dataView.getUint32(offset + 16, true),
					blockAlign: dataView.getUint16(offset + 20, true),
					bitsPerSample: dataView.getUint16(offset + 22, true)
				};
			} else if (chunkId === 'data') {
				dataOffset = offset + 8;
				dataSize = chunkSize;
				break;
			}
			offset += 8 + chunkSize;
			if (chunkSize % 2 !== 0) offset++; // Zarovnanie na párnu hranicu (word-align).
		}

		if (!fmt) throw new Error('WAV file missing fmt chunk');
		if (dataOffset < 0) throw new Error('WAV file missing data chunk');
		return { fmt, dataOffset, dataSize };
	}

	window.SpectraDSP = { fft, rfft, parseWavHeader };
})();
