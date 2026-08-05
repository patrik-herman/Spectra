var _midiLog = function(...args) { if (typeof Logger !== 'undefined') Logger.log(...args); };
var _midiWarn = function(...args) { if (typeof Logger !== 'undefined') Logger.warn(...args); };
var _midiError = function(...args) { if (typeof Logger !== 'undefined') Logger.error(...args); else Logger.error(...args); };

var WebMIDI = {
	midi: null,
	inputs: [],
	outputs: [],
	selectedInputs: [],
	selectedOutputs: [],

	get selectedInput() {
		return this.selectedInputs[0] || null;
	},
	set selectedInput(value) {
		// Nastavením selectedInput sa aktualizuje pole.
		if (value === null) {
			if (this.selectedInputs.length > 0) {
				this.selectedInputs = [];
			}
		} else if (!this.selectedInputs.some(i => i.id === value.id)) {
			// Pridá sa do poľa, pokiaľ tam ešte nie je, a to na začiatok, aby bol vybraný.
			if (value.port && !value.port.onmidimessage) {
				value.port.onmidimessage = (e) => WebMIDI.handleMIDIMessage(e, value);
			}
			this.selectedInputs.unshift(value);
		}
	},
	get selectedOutput() {
		return this.selectedOutputs[0] || null;
	},
	set selectedOutput(value) {
		// Nastavením selectedOutput sa aktualizuje pole, aby hodnota zostala len na jednom mieste.
		if (value === null) {
			if (this.selectedOutputs.length > 0) {
				this.selectedOutputs = [];
			}
		} else if (!this.selectedOutputs.some(o => o.id === value.id)) {
			this.selectedOutputs.unshift(value);
		}
	},

	enabled: false,
	isRefreshing: false,

	permissionState: 'unknown', // 'unknown', 'prompt', 'granted', 'denied'.

	_failedOutputs: new Set(),
	_lastErrorNotification: 0,

	_stateChangeDebounce: {
		timer: null,
		pendingChanges: [],
		debounceMs: 100
	},


	// Kanál pre výstup (0-15, predvolene 0).
	_channel: 0,

	get channel() {
		return this._channel;
	},
	set channel(value) {
		var ch = parseInt(value, 10);
		if (isNaN(ch) || ch < 0 || ch > 15) {
			Logger.warn('Invalid MIDI channel:', value, '- must be 0-15, using channel 0');
			this._channel = 0;
			return;
		}
		this._channel = ch;
	},

	validateChannel: (channel) => {
		if (channel === null || channel === undefined) {
			return WebMIDI.channel;
		}
		var ch = parseInt(channel, 10);
		if (isNaN(ch) || ch < 0 || ch > 15) {
			Logger.warn('Invalid MIDI channel:', channel, '- clamping to valid range');
			return Math.max(0, Math.min(15, ch || 0));
		}
		return ch;
	},

	_activeInput: null,
	mpeDeviceConfig: {},

	deviceMpeOut: (output) => {
		if (!output.mpe) {
			var saved = WebMIDI.mpeDeviceConfig[output.id];
			output.mpe = {
				enabled: !!(saved && saved.enabled),
				bendRange: (saved && saved.bendRange) || 48,
				channels: (saved && saved.channels) || 15,
				_counts: null, _voices: new Map()
			};
		}
		return output.mpe;
	},

	deviceMpeIn: (input) => {
		if (!input.mpe) {
			var saved = WebMIDI.mpeDeviceConfig[input.id];
			input.mpe = {
				enabled: !!(saved && saved.enabled),
				bendRange: (saved && saved.bendRange) || 48,
				_channels: null
			};
		}
		return input.mpe;
	},

	bendToSemitones: (bend14, range) => ((bend14 - 8192) / 8192) * range,

	freqToBend: (midiNote, exactFreq, range) => {
		if (!exactFreq || exactFreq <= 0) return 8192;
		var noteInt = Math.round(midiNote);
		var nearestNoteFreq = 440 * Math.pow(2, (noteInt - 69) / 12);
		var deviationCents = 1200 * Math.log2(exactFreq / nearestNoteFreq);
		var centsPerUnit = (range * 200) / 16384;
		return Math.max(0, Math.min(16383, 8192 + Math.round(deviationCents / centsPerUnit)));
	},

	_allocChannelFor: (output) => {
		var m = WebMIDI.deviceMpeOut(output);
		if (!m._counts) m._counts = new Array(16).fill(0);
		var n = Math.max(1, Math.min(15, m.channels));
		var best = 1, bc = Infinity;
		for (var ch = 1; ch <= n; ch++) { if (m._counts[ch] < bc) { bc = m._counts[ch]; best = ch; } }
		m._counts[best]++;
		return best;
	},

	_freeChannelFor: (output, ch) => {
		var m = output.mpe;
		if (m && m._counts && m._counts[ch] > 0) m._counts[ch]--;
	},

	_sendRpnTo: (output, ch, rpnMsb, rpnLsb, data) => {
		WebMIDI.safeSend(output, [0xB0 | ch, 0x65, rpnMsb]);
		WebMIDI.safeSend(output, [0xB0 | ch, 0x64, rpnLsb]);
		WebMIDI.safeSend(output, [0xB0 | ch, 0x06, data]);
		WebMIDI.safeSend(output, [0xB0 | ch, 0x26, 0x00]);
		WebMIDI.safeSend(output, [0xB0 | ch, 0x65, 0x7F]);
		WebMIDI.safeSend(output, [0xB0 | ch, 0x64, 0x7F]);
	},

	sendMPEConfigTo: (output) => {
		var m = WebMIDI.deviceMpeOut(output);
		var n = Math.max(1, Math.min(15, m.channels));
		var range = Math.max(1, Math.min(96, m.bendRange));
		WebMIDI._sendRpnTo(output, 0, 0x00, 0x06, n);
		WebMIDI._sendRpnTo(output, 0, 0x00, 0x00, 2);
		for (var ch = 1; ch <= n; ch++) WebMIDI._sendRpnTo(output, ch, 0x00, 0x00, range);
	},

	sendAllMPEConfigs: () => {
		(WebMIDI.selectedOutputs || []).forEach(o => { if (o.mpe && o.mpe.enabled) WebMIDI.sendMPEConfigTo(o); });
	},

	_collectMpeDeviceConfig: () => {
		var out = {};
		(WebMIDI.selectedOutputs || []).forEach(o => { if (o.mpe) out[o.id] = { enabled: o.mpe.enabled, bendRange: o.mpe.bendRange, channels: o.mpe.channels }; });
		(WebMIDI.selectedInputs || []).forEach(i => { if (i.mpe) out[i.id] = { enabled: i.mpe.enabled, bendRange: i.mpe.bendRange }; });
		return out;
	},

	openMpeWindow: (device, isInput) => {
		var section = sel('.mpeSection');
		if (!section) return;
		var m = isInput ? WebMIDI.deviceMpeIn(device) : WebMIDI.deviceMpeOut(device);
		var title = sel('.mpe-window-title'); if (title) title.textContent = isInput ? 'MPE Input' : 'MPE Output';
		var body = sel('.mpe-window-body');
		if (body) {
			var rows = '<label style="display:flex;align-items:center;gap:8px;margin:4px 0 16px;color:#ccc;cursor:pointer;">' +
				'<input type="checkbox" class="mpe-win-enable"' + (m.enabled ? ' checked' : '') + '><span>MPE ON</span></label>';
			if (!isInput) {
				rows += '<div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0;color:#888;font-size:12px;">' +
					'<span>Member channels</span><input type="number" class="mpe-win-channels" min="1" max="15" value="' + m.channels + '" style="width:56px;"></div>';
			}
			rows += '<div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0;color:#888;font-size:12px;">' +
				'<span>Bend range</span><input type="number" class="mpe-win-bend" min="1" max="96" value="' + m.bendRange + '" style="width:56px;"></div>';
			body.innerHTML = rows;
			var enable = body.querySelector('.mpe-win-enable');
			var bend = body.querySelector('.mpe-win-bend');
			var chans = body.querySelector('.mpe-win-channels');
			var apply = () => {
				if (isInput) WebMIDI.mpeInReset(device);
				else if (m.enabled) WebMIDI.sendMPEConfigTo(device);
				WebMIDI.saveSettings();
				if (isInput) WebMIDI.updateInputsListUI(); else WebMIDI.updateOutputsListUI();
			};
			if (enable) enable.addEventListener('change', (e) => { m.enabled = e.target.checked; apply(); });
			if (bend) bend.addEventListener('change', (e) => { m.bendRange = Math.max(1, Math.min(96, parseInt(e.target.value, 10) || 48)); e.target.value = m.bendRange; apply(); });
			if (chans) chans.addEventListener('change', (e) => { m.channels = Math.max(1, Math.min(15, parseInt(e.target.value, 10) || 15)); e.target.value = m.channels; apply(); });
		}
		section.classList.remove('hidden');
		var closeBtn = sel('.mpe-window-close');
		if (closeBtn) closeBtn.onclick = () => section.classList.add('hidden');
	},

	_bendForFreqTo: (output, midiNote, exactFreq, ch, range) => {
		var bend = WebMIDI.freqToBend(midiNote, exactFreq, range);
		WebMIDI.safeSend(output, [0xE0 | ch, bend & 0x7F, (bend >> 7) & 0x7F]);
	},

	_noteOnTo: (output, note, velocity, ch) => {
		var n = Math.round(note);
		if (n < 0 || n > 127) return;
		WebMIDI.safeSend(output, [0x90 | ch, n, velocity]);
	},

	_noteOffTo: (output, note, ch) => {
		var n = Math.round(note);
		if (n < 0 || n > 127) return;
		WebMIDI.safeSend(output, [0x80 | ch, n, 0]);
	},

	_mpeInChannel: (input, ch) => {
		var m = WebMIDI.deviceMpeIn(input);
		if (!m._channels) m._channels = [];
		if (!m._channels[ch]) m._channels[ch] = { bend: 8192, bendRange: m.bendRange, rpnMsb: 0x7F, rpnLsb: 0x7F };
		return m._channels[ch];
	},

	mpeInPitch: (input, note, channel) => {
		if (!input) return note;
		var st = WebMIDI._mpeInChannel(input, channel);
		return note + WebMIDI.bendToSemitones(st.bend, st.bendRange);
	},

	mpeInHandlePitchBend: (input, bend14, channel) => {
		WebMIDI._mpeInChannel(input, channel).bend = bend14;
	},

	mpeInHandleCC: (input, cc, value, channel) => {
		var st = WebMIDI._mpeInChannel(input, channel);
		if (cc === 0x65) { st.rpnMsb = value; return true; }
		if (cc === 0x64) { st.rpnLsb = value; return true; }
		if ((cc === 0x06 || cc === 0x26) && st.rpnMsb === 0 && st.rpnLsb === 0) {
			if (cc === 0x06) st.bendRange = value + (st.bendRange - Math.floor(st.bendRange));
			else st.bendRange = Math.floor(st.bendRange) + value / 100;
			return true;
		}
		return false;
	},

	mpeInReset: (input) => { if (input && input.mpe) input.mpe._channels = null; },

	outputFilter: {
		trackMode: 'all',        // All / custom.
		tracks: [],              // Pole indexov stôp v režime 'custom'.
		partialMode: 'fundamentals',  // All / active / fundamentals / custom.
		partials: []             // Pole čísel parciálov v režime 'custom'.
	},

	transportSync: {
		enabled: true,
		mode: 'midi',            // Midi (štandard) / SysEx.

		// Synchronizácia cez MIDI, kompatibilná s rôznymi DAW.
		sendClock: true,         // Posielanie MIDI clocku počas prehrávania.
		sendStartStop: true,
		receiveClock: true,
		receiveStartStop: true,
		sendSPP: true,           // Posielanie Song Position Pointer pri zmene pozície.
		receiveSPP: true,

		clockInterval: null,     // ID setIntervalu na generovanie clocku.
		clockCount: 0,           // Počítadlo clockov na debugovanie.
		lastClockTime: 0,        // Na analýzu časovania clocku.
		externalClockCount: 0,
		externalTempo: 0,
		isExternalSync: false,

		// Ochrana proti spätnej väzbe.
		ignoreNextStart: false,
		ignoreNextStop: false,
		ignoreTimeout: null,
		ignoreWindow: 50         // Ms ignorovania prichádzajúcej synchronizácie po odoslaní, nízke kvôli rýchlym tempám.
	},

	// [ZDROJ] MIDI Manufacturers Association. The Complete MIDI 1.0 Detailed Specification: Incorporating all
	//   Recommended Practices, document version 96.1. Los Angeles: MMA, 1996. Kapitola o MIDI Clock a
	//   transportných správach.
	MIDI_CLOCK: 0xF8,           // Časovací clock (24 PPQN).
	MIDI_START: 0xFA,           // Štart od začiatku.
	MIDI_CONTINUE: 0xFB,        // Pokračovanie z aktuálnej pozície.
	MIDI_STOP: 0xFC,
	MIDI_SPP: 0xF2,             // Song Position Pointer (3 bajty).

	onNoteOn: null,
	onNoteOff: null,
	onPitchBend: null,       // Callback pre prichádzajúci pitch bend (bend, channel).
	onTransportStart: null,
	onTransportStop: null,

	checkPermissionState: async () => {
		try {
			if (navigator.permissions && navigator.permissions.query) {
				try {
					const result = await navigator.permissions.query({ name: 'midi', sysex: true });
					WebMIDI.permissionState = result.state;

					result.onchange = () => {
						WebMIDI.permissionState = result.state;

						if (result.state === 'granted') {
							WebMIDI.hidePermissionHelp();
							WebMIDI.init();
						} else if (result.state === 'denied') {
							WebMIDI.updateStatus('Permission denied');
							WebMIDI.showPermissionHelp('denied');
						}
					};

					return result.state;
				} catch (permErr) {
					try {
						const result = await navigator.permissions.query({ name: 'midi' });
						WebMIDI.permissionState = result.state;
						return result.state;
					} catch (e) {
						// Permissions API v danom prehliadači nepodporuje dotaz na MIDI.
						return 'unknown';
					}
				}
			}
		} catch (err) {
			Logger.warn('Could not query MIDI permission state:', err);
		}
		return 'unknown';
	},

	showPermissionHelp: (state) => {
		WebMIDI.hidePermissionHelp();

		var midiPanel = document.querySelector('.midi-panel, .midi-settings, .midi-section');
		if (!midiPanel) return;

		var helpDiv = document.createElement('div');
		helpDiv.className = 'midi-permission-help midi-help-warning';

		if (state === 'denied') {
			helpDiv.innerHTML = `
				<strong style="color: #f96;">MIDI Permission Blocked</strong><br><br>
				MIDI access was denied. To enable MIDI:<br><br>
				<strong>Chrome/Edge:</strong><br>
				1. Click the lock/tune icon in the address bar<br>
				2. Find "MIDI devices" and set to "Allow"<br>
				3. Reload the page<br><br>
				<strong>Or reset all permissions:</strong><br>
				1. Click the lock icon &rarr; "Site settings"<br>
				2. Click "Reset permissions"<br>
				3. Reload the page<br><br>
				<button class="midi-retry-permission midi-retry-btn">Retry MIDI Access</button>
			`;
		} else if (state === 'prompt') {
			helpDiv.innerHTML = `
				<strong style="color: #fc6;">MIDI Permission Required</strong><br><br>
				Please allow MIDI access when prompted.<br><br>
				<em>If no prompt appears:</em><br>
				- Check for a blocked popup or permission icon in your address bar<br>
				- Try clicking the button below<br><br>
				<button class="midi-retry-permission midi-retry-btn">Request MIDI Permission</button>
			`;
		} else {
			helpDiv.innerHTML = `
				<strong style="color: #f96;">MIDI Access Issue</strong><br><br>
				Could not access MIDI devices.<br><br>
				<button class="midi-retry-permission midi-retry-btn">Retry MIDI Access</button>
			`;
		}

		midiPanel.insertBefore(helpDiv, midiPanel.firstChild);

		var retryBtn = helpDiv.querySelector('.midi-retry-permission');
		if (retryBtn) {
			retryBtn.addEventListener('click', async () => {
				retryBtn.disabled = true;
				retryBtn.textContent = 'Requesting...';

				// Spustenie init znova vyžiada oprávnenie.
				var success = await WebMIDI.init();

				if (success) {
					WebMIDI.hidePermissionHelp();
				} else {
					retryBtn.disabled = false;
					retryBtn.textContent = 'Retry MIDI Access';
				}
			});
		}
	},

	hidePermissionHelp: () => {
		var helpDiv = document.querySelector('.midi-permission-help');
		if (helpDiv) {
			helpDiv.remove();
		}
	},

	// [ZDROJ] W3C. Web MIDI API [online]. W3C Working Draft, 21. 1. 2025 [cit. 2026-07-30]. Dostupné z:
	//   https://www.w3.org/TR/webmidi/
	init: async () => {
		if (!navigator.requestMIDIAccess) {
			Logger.warn('Web MIDI API not supported in this browser');
			WebMIDI.updateStatus('Not supported');

			if (typeof showSaveNotification === 'function') {
				showSaveNotification('MIDI requires Chrome, Edge, or Opera browser', true);
			}

			var midiPanel = document.querySelector('.midi-panel, .midi-settings');
			if (midiPanel) {
				var helpDiv = document.createElement('div');
				helpDiv.className = 'midi-browser-help';
				helpDiv.style.cssText = 'padding: 10px; margin: 10px 0; background: #442; border: none; border-left: 3px solid #aa8; border-radius: 4px; color: #ffa;';
				helpDiv.innerHTML = '<strong>MIDI not available</strong><br>' +
					'Web MIDI is supported in:<br>' +
					'- Chrome (recommended)<br>' +
					'- Edge<br>' +
					'- Opera<br><br>' +
					'Firefox and Safari do not support Web MIDI.';
				midiPanel.insertBefore(helpDiv, midiPanel.firstChild);
			}
			return false;
		}

		// Najprv zistenie povolení.
		var permState = await WebMIDI.checkPermissionState();

		if (permState === 'denied') {
			WebMIDI.updateStatus('Permission denied');
			WebMIDI.showPermissionHelp('denied');
			if (typeof showSaveNotification === 'function') {
				showSaveNotification('MIDI permission blocked - see MIDI panel for instructions', true);
			}
			return false;
		}

		if (permState === 'prompt') {
			WebMIDI.updateStatus('Awaiting permission...');
			WebMIDI.showPermissionHelp('prompt');
		} else {
			WebMIDI.updateStatus('Requesting...');
		}

		try {
			// Vyžiadanie prístupu k MIDI so zapnutým sysexom kvôli synchronizácii transportu.
			WebMIDI.midi = await navigator.requestMIDIAccess({ sysex: true });
			WebMIDI.midi.onstatechange = WebMIDI.onStateChange;

			WebMIDI.hidePermissionHelp();
			WebMIDI.permissionState = 'granted';

			await WebMIDI.refreshPorts();
			WebMIDI.enabled = true;
			var portCount = WebMIDI.inputs.length + WebMIDI.outputs.length;
			WebMIDI.updateStatus(portCount > 0 ? 'Ready (' + portCount + ' ports)' : 'Ready (no devices)');

			WebMIDI.loadSettings();
			return true;
		} catch (err) {
			Logger.error('Failed to initialize Web MIDI:', err);
			if (err.name === 'SecurityError') {
				WebMIDI.permissionState = 'denied';
				WebMIDI.updateStatus('Access denied');
				WebMIDI.showPermissionHelp('denied');
				if (typeof showSaveNotification === 'function') {
					showSaveNotification('MIDI access denied - see MIDI panel for instructions', true);
				}
			} else {
				WebMIDI.updateStatus('Error');
				WebMIDI.showPermissionHelp('error');
				if (typeof showSaveNotification === 'function') {
					showSaveNotification('MIDI initialization failed: ' + err.message, true);
				}
			}
			return false;
		}
	},

	// Odoslanie správy MIDI na výstupný port bez toho, aby chybný port zhodil systém prehrávania.
	safeSend: (output, message) => {
		try {
			if (!output || !output.port) {
				Logger.warn('MIDI safeSend: Invalid output or port reference');
				return false;
			}
			if (typeof output.port.send !== 'function') {
				Logger.warn('MIDI safeSend: Port send is not a function:', output.name);
				WebMIDI._failedOutputs.add(output.id);
				return false;
			}
			if (output.port.state === 'disconnected') {
				Logger.warn('MIDI safeSend: Port is disconnected:', output.name);
				WebMIDI._failedOutputs.add(output.id);
				return false;
			}

			output.port.send(message);
			WebMIDI._failedOutputs.delete(output.id);
			return true;
		} catch (err) {
			Logger.error('MIDI send failed:', output?.name || 'unknown', err);
			if (output?.id && !WebMIDI._failedOutputs.has(output.id)) {
				WebMIDI._failedOutputs.add(output.id);

				// Obmedzenie frekvencie notifikácií (max raz za 5 sekúnd).
				var now = Date.now();
				if (now - WebMIDI._lastErrorNotification > 5000) {
					WebMIDI._lastErrorNotification = now;
					if (typeof showSaveNotification === 'function') {
						showSaveNotification('MIDI device "' + (output?.name || 'unknown') + '" disconnected', true);
					}
					WebMIDI.updateStatus((output?.name || 'Device') + ' - send failed');
				}
			}
			return false;
		}
	},

	sendToAllOutputs: (message) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) {
			return 0;
		}
		var successCount = 0;
		for (const output of WebMIDI.selectedOutputs) {
			if (WebMIDI.safeSend(output, message)) {
				successCount++;
			}
		}
		return successCount;
	},

	refreshPorts: async () => {
		if (WebMIDI.isRefreshing) return;
		WebMIDI.isRefreshing = true;

		WebMIDI.inputs = [];
		WebMIDI.outputs = [];

		// Opätovné vyžiadanie prístupu k MIDI kvôli novému zoznamu portov.
		try {
			WebMIDI.midi = await navigator.requestMIDIAccess({ sysex: true });
			WebMIDI.midi.onstatechange = WebMIDI.onStateChange;
		} catch (err) {
			Logger.error('Failed to refresh MIDI:', err);
			WebMIDI.updateStatus('Refresh failed');
			WebMIDI.isRefreshing = false;
			return;
		}

		var seenInputIds = new Set();
		var seenOutputIds = new Set();

		for (const input of WebMIDI.midi.inputs.values()) {
			if (input.state === 'disconnected') continue;
			if (seenInputIds.has(input.id)) continue;
			seenInputIds.add(input.id);

			WebMIDI.inputs.push({
				id: input.id,
				name: input.name,
				manufacturer: input.manufacturer,
				state: input.state,
				port: input
			});
		}

		for (const output of WebMIDI.midi.outputs.values()) {
			if (output.state === 'disconnected') continue;
			if (seenOutputIds.has(output.id)) continue;
			seenOutputIds.add(output.id);

			WebMIDI.outputs.push({
				id: output.id,
				name: output.name,
				manufacturer: output.manufacturer,
				state: output.state,
				port: output
			});
		}

		WebMIDI.populateDropdowns();

		// Opätovný výber už predtým vybraných portov, pokiaľ sú stále dostupné.
		var settings = {};
		try {
			var saved = localStorage.getItem('spectra_midi_settings');
			if (saved) settings = JSON.parse(saved);
		} catch (e) {}

		if (settings.inputIds && Array.isArray(settings.inputIds)) {
			for (const inputId of settings.inputIds) {
				const inputExists = WebMIDI.inputs.some(i => i.id === inputId);
				if (inputExists) {
					WebMIDI.addInput(inputId);
				}
			}
			WebMIDI.updateInputsListUI();
		} else if (settings.inputId) {
			// Spätná kompatibilita pre jeden vstup.
			const inputExists = WebMIDI.inputs.some(i => i.id === settings.inputId);
			if (inputExists) {
				WebMIDI.addInput(settings.inputId);
				WebMIDI.updateInputsListUI();
			}
		}

		if (settings.outputId) {
			var outputExists = WebMIDI.outputs.some(o => o.id === settings.outputId);
			if (outputExists) {
				WebMIDI.selectOutput(settings.outputId);
				var outputSelect = sel('.midi-output-select');
				if (outputSelect) outputSelect.value = settings.outputId;
			}
		}

		WebMIDI.isRefreshing = false;
	},

	onStateChange: (e) => {
		if (WebMIDI.isRefreshing) return;

		var debounce = WebMIDI._stateChangeDebounce;
		debounce.pendingChanges.push({
			port: e.port,
			state: e.port.state,
			timestamp: Date.now()
		});

		if (debounce.timer) {
			clearTimeout(debounce.timer);
		}

		debounce.timer = setTimeout(() => {
			WebMIDI._processPendingStateChanges();
		}, debounce.debounceMs);
	},

	_processPendingStateChanges: () => {
		var debounce = WebMIDI._stateChangeDebounce;
		var changes = debounce.pendingChanges;
		debounce.pendingChanges = [];
		debounce.timer = null;

		if (changes.length === 0) return;

		_midiLog(`WebMIDI: Processing ${changes.length} state change(s)`);

		WebMIDI.inputs = [];
		WebMIDI.outputs = [];

		var seenInputIds = new Set();
		var seenOutputIds = new Set();

		for (const input of WebMIDI.midi.inputs.values()) {
			if (input.state === 'disconnected') continue;
			if (seenInputIds.has(input.id)) continue;
			seenInputIds.add(input.id);

			WebMIDI.inputs.push({
				id: input.id,
				name: input.name,
				manufacturer: input.manufacturer,
				state: input.state,
				port: input
			});
		}

		for (const output of WebMIDI.midi.outputs.values()) {
			if (output.state === 'disconnected') continue;
			if (seenOutputIds.has(output.id)) continue;
			seenOutputIds.add(output.id);

			WebMIDI.outputs.push({
				id: output.id,
				name: output.name,
				manufacturer: output.manufacturer,
				state: output.state,
				port: output
			});
		}

		WebMIDI.populateDropdowns();

		var connectedDevices = [];
		var disconnectedDevices = [];

		for (const change of changes) {
			if (change.state === 'connected') {
				connectedDevices.push(change.port);
				WebMIDI._failedOutputs.delete(change.port.id);

			} else if (change.state === 'disconnected') {
				disconnectedDevices.push(change.port);
			}
		}

		for (const port of disconnectedDevices) {
			// Pred odstránením výstupného zariadenia sa odošle All Notes Off, aby nezostali visieť noty.
			var wasOutput = WebMIDI.selectedOutputs.some(o => o.id === port.id);
			if (wasOutput) {
				for (let ch = 0; ch < 16; ch++) {
					WebMIDI.sendToAllOutputs([0xB0 | ch, 123, 0]);
				}
				if (WebMIDI.selectedOutputs.length > 0) {
					WebMIDI.sendSysExPanic();
				}
			}

			WebMIDI.selectedInputs = WebMIDI.selectedInputs.filter(i => i.id !== port.id);
			if (WebMIDI.selectedInput && WebMIDI.selectedInput.id === port.id) {
				WebMIDI.selectedInput = WebMIDI.selectedInputs[0] || null;
			}

			WebMIDI.selectedOutputs = WebMIDI.selectedOutputs.filter(o => o.id !== port.id);
			if (WebMIDI.selectedOutput && WebMIDI.selectedOutput.id === port.id) {
				WebMIDI.selectedOutput = WebMIDI.selectedOutputs[0] || null;
			}
		}

		WebMIDI.updateInputsListUI();
		WebMIDI.updateOutputsListUI();

		if (connectedDevices.length > 0 && disconnectedDevices.length === 0) {
			const names = connectedDevices.map(p => p.name).join(', ');
			WebMIDI.updateStatus(connectedDevices.length === 1 ? `${names} connected` : `${connectedDevices.length} devices connected`);
		} else if (disconnectedDevices.length > 0 && connectedDevices.length === 0) {
			const names = disconnectedDevices.map(p => p.name).join(', ');
			WebMIDI.updateStatus(disconnectedDevices.length === 1 ? `${names} disconnected` : `${disconnectedDevices.length} devices disconnected`);
		} else if (connectedDevices.length > 0 && disconnectedDevices.length > 0) {
			WebMIDI.updateStatus(`${connectedDevices.length} connected, ${disconnectedDevices.length} disconnected`);
		}
	},

	populateDropdowns: () => {
		var inputSelect = sel('.midi-input-select');
		var outputSelect = sel('.midi-output-select');

		if (inputSelect) {
			var currentValue = inputSelect.value;
			inputSelect.innerHTML = '<option value="">Select to Add</option>';
			WebMIDI.inputs.forEach(input => {
				var isSelected = WebMIDI.selectedInputs.some(i => i.id === input.id);
				if (!isSelected) {
					var opt = document.createElement('option');
					opt.value = input.id;
					opt.textContent = input.name + (input.manufacturer ? ` (${input.manufacturer})` : '');
					inputSelect.appendChild(opt);
				}
			});
		}

		if (outputSelect) {
			outputSelect.innerHTML = '<option value="">Select to Add</option>';
			WebMIDI.outputs.forEach(output => {
				var isSelected = WebMIDI.selectedOutputs.some(o => o.id === output.id);
				if (!isSelected) {
					var opt = document.createElement('option');
					opt.value = output.id;
					opt.textContent = output.name + (output.manufacturer ? ` (${output.manufacturer})` : '');
					outputSelect.appendChild(opt);
				}
			});
		}
	},


	addInput: (id) => {
		if (!id) return;

		if (WebMIDI.selectedInputs.some(i => i.id === id)) {
			return;
		}

		var input = WebMIDI.inputs.find(i => i.id === id);
		if (input) {
			input.port.onmidimessage = (e) => WebMIDI.handleMIDIMessage(e, input);
			WebMIDI.selectedInputs.push(input);

			// z dôvodu spätnej kompatibility.
			if (!WebMIDI.selectedInput) {
				WebMIDI.selectedInput = input;
			}
			WebMIDI.saveSettings();
			WebMIDI.updateInputsListUI();
			WebMIDI.populateDropdowns(); // Obnova dropdownu kvôli skrytiu pridaných položiek.
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
		}
	},

	removeInput: (id) => {
		var idx = WebMIDI.selectedInputs.findIndex(i => i.id === id);
		if (idx !== -1) {
			var input = WebMIDI.selectedInputs[idx];
			input.port.onmidimessage = null;
			WebMIDI.selectedInputs.splice(idx, 1);

			// Aktualizácia referencie z dôvodu spätnej kompatibility.
			if (WebMIDI.selectedInput && WebMIDI.selectedInput.id === id) {
				WebMIDI.selectedInput = WebMIDI.selectedInputs[0] || null;
			}
			WebMIDI.saveSettings();
			WebMIDI.updateInputsListUI();
			WebMIDI.populateDropdowns(); // Obnova dropdownu kvôli zobrazeniu odstránenej položky.
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
		}
	},

	updateInputsListUI: () => {
		var container = sel('.midi-inputs-list');
		if (!container) return;

		container.innerHTML = '';

		if (WebMIDI.selectedInputs.length === 0) {
			container.innerHTML = '<div style="color: #666; font-size: 12px; padding: 8px 0;">No inputs selected</div>';
			return;
		}

		WebMIDI.selectedInputs.forEach(input => {
			var item = cloneTemplate('tpl-midi-device', {
				'.midi-device-name': input.name
			});
			if (!item) return;

			item.classList.add('midi-input-item');
			item.querySelector('.midi-activity-indicator').classList.add('midi-input-indicator-' + input.id.replace(/[^a-zA-Z0-9]/g, '_'));
			item.querySelector('.midi-remove-btn').title = 'Remove this input';
			item.querySelector('.midi-remove-btn').addEventListener('click', () => WebMIDI.removeInput(input.id));

			var mpeBtnI = item.querySelector('.midi-mpe-btn');
			if (mpeBtnI) {
				mpeBtnI.classList.toggle('selected', !!WebMIDI.deviceMpeIn(input).enabled);
				mpeBtnI.addEventListener('click', () => WebMIDI.openMpeWindow(input, true));
			}

			container.appendChild(item);
		});
	},

	// Podpora viacerých výstupov, analogicky k viacerým vstupom.
	addOutput: (id) => {
		if (!id) return;

		if (WebMIDI.selectedOutputs.some(o => o.id === id)) {
			return;
		}

		var output = WebMIDI.outputs.find(o => o.id === id);
		if (output) {
			WebMIDI.selectedOutputs.push(output);

			// Zachovanie spätnej kompatibility.
			if (!WebMIDI.selectedOutput) {
				WebMIDI.selectedOutput = output;
			}
			WebMIDI.saveSettings();
			WebMIDI.updateOutputsListUI();
			WebMIDI.populateDropdowns(); // Obnova dropdownu kvôli skrytiu pridaných položiek.
			if (WebMIDI.deviceMpeOut(output).enabled) WebMIDI.sendMPEConfigTo(output);
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
		}
	},

	removeOutput: (id) => {
		var idx = WebMIDI.selectedOutputs.findIndex(o => o.id === id);
		if (idx !== -1) {
			var output = WebMIDI.selectedOutputs[idx];
			WebMIDI.selectedOutputs.splice(idx, 1);

			// Aktualizácia referencie kvôli spätnej kompatibilite.
			if (WebMIDI.selectedOutput && WebMIDI.selectedOutput.id === id) {
				WebMIDI.selectedOutput = WebMIDI.selectedOutputs[0] || null;
			}
			WebMIDI.saveSettings();
			WebMIDI.updateOutputsListUI();
			WebMIDI.populateDropdowns(); // Obnova dropdownu kvôli zobrazeniu odstránenej položky.
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
		}
	},

	updateOutputsListUI: () => {
		var container = sel('.midi-outputs-list');
		if (!container) return;

		container.innerHTML = '';

		if (WebMIDI.selectedOutputs.length === 0) {
			container.innerHTML = '<div style="color: #666; font-size: 12px; padding: 8px 0;">No outputs selected</div>';
			return;
		}

		WebMIDI.selectedOutputs.forEach(output => {
			var item = cloneTemplate('tpl-midi-device', {
				'.midi-device-name': output.name
			});
			if (!item) return;

			item.classList.add('midi-output-item');
			// Odstránenie indikátora pre výstupy.
			var indicator = item.querySelector('.midi-activity-indicator');
			if (indicator) indicator.remove();
			var removeBtn = item.querySelector('.midi-remove-btn');
			removeBtn.className = 'midi-remove-btn-subtle';
			removeBtn.addEventListener('click', () => WebMIDI.removeOutput(output.id));

			var mpeBtnO = item.querySelector('.midi-mpe-btn');
			if (mpeBtnO) {
				mpeBtnO.classList.toggle('selected', !!WebMIDI.deviceMpeOut(output).enabled);
				mpeBtnO.addEventListener('click', () => WebMIDI.openMpeWindow(output, false));
			}

			container.appendChild(item);
		});
	},

	// Staršie metódy pre jeden vstup, kvôli spätnej kompatibilite.
	selectInput: (id) => {
		WebMIDI.selectedInputs.forEach(input => {
			input.port.onmidimessage = null;
		});
		WebMIDI.selectedInputs = [];
		// selectedInput teraz vracia null, keďže pole je prázdne.

		if (id) {
			WebMIDI.addInput(id);
		}
		WebMIDI.saveSettings();
	},

	selectOutput: (id) => {
		if (!id) {
			WebMIDI.selectedOutputs = [];
			WebMIDI.saveSettings();
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
			return;
		}

		var output = WebMIDI.outputs.find(o => o.id === id);
		if (output) {
			// Nahradenie všetkých výstupov jediným, kvôli spätnej kompatibilite.
			WebMIDI.selectedOutputs = [output];
			WebMIDI.saveSettings();
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
		}
	},

	handleMIDIMessage: (e, sourceInput) => {
		WebMIDI.flashInputIndicator(sourceInput);
		WebMIDI._activeInput = sourceInput;

		var data = e.data;
		var status = data[0];

		// Spracovanie správ MIDI Realtime (jeden bajt, rozsah 0xF8-0xFF).
		if (status >= 0xF8) {
			WebMIDI.handleRealtimeMessage(status);
			return;
		}

		if (status === 0xF2 && data.length >= 3) {
			WebMIDI.handleSongPositionPointer(data[1], data[2]);
			return;
		}

		if (status === 0xF0) {
			WebMIDI.handleSysExMessage(data);
			return;
		}

		var data1 = data[1];
		var data2 = data[2];
		var messageType = status & 0xF0;
		var channel = status & 0x0F;

		// [ZDROJ] MIDI Manufacturers Association. The Complete MIDI 1.0 Detailed Specification: Incorporating all
		//   Recommended Practices, document version 96.1. Los Angeles: MMA, 1996.
		switch (messageType) {
			case 0x90: // Note On
				// Kanál sa posiela do callbacku, filtrovanie rieši handler.
				if (data2 > 0) {
					if (WebMIDI.onNoteOn) {
						WebMIDI.onNoteOn(data1, data2, channel);
					}
				} else {
					// Note On s velocity 0 = Note Off.
					if (WebMIDI.onNoteOff) {
						WebMIDI.onNoteOff(data1, channel);
					}
				}
				break;

			case 0x80: // Note Off
				// Kanál sa posiela do callbacku, filtrovanie rieši handler.
				if (WebMIDI.onNoteOff) {
					WebMIDI.onNoteOff(data1, channel);
				}
				break;

			case 0xB0: // Control Change
				if (sourceInput && sourceInput.mpe && sourceInput.mpe.enabled) WebMIDI.mpeInHandleCC(sourceInput, data1, data2, channel);
				if (WebMIDI.onControlChange) {
					WebMIDI.onControlChange(data1, data2, channel);
				}
				break;

			case 0xD0: // Channel Pressure (Aftertouch).
				Logger.log('MIDI Channel Pressure:', data1, 'ch:', channel);
				if (WebMIDI.onChannelPressure) {
					WebMIDI.onChannelPressure(data1, channel);
				}
				break;

			case 0xA0: // Polyphonic Key Pressure (Aftertouch).
				Logger.log('MIDI Poly Aftertouch: note', data1, 'pressure', data2, 'ch:', channel);
				if (WebMIDI.onPolyPressure) {
					WebMIDI.onPolyPressure(data1, data2, channel);
				}
				break;

			case 0xE0: // Pitch Bend
				var bend = (data2 << 7) | data1;
				if (sourceInput && sourceInput.mpe && sourceInput.mpe.enabled) WebMIDI.mpeInHandlePitchBend(sourceInput, bend, channel);
				if (WebMIDI.onPitchBend) {
					WebMIDI.onPitchBend(bend, channel);
				}
				break;
		}
	},


	// [ZDROJ] MIDI Manufacturers Association. The Complete MIDI 1.0 Detailed Specification: Incorporating all
	//   Recommended Practices, document version 96.1. Los Angeles: MMA, 1996. Manufacturer ID 0x7D: vyhradené
	//   na nekomerčné použitie.
	// protokol SysEx na synchronizáciu transportu (12 bajtov spolu, rovnako ako správy o notách):
	// F0 7D 03 [time0] [time1] [time2] [time3] [flags] 00 00 00 F7 = Transport Start
	// F0 7D 04 [time0] [time1] [time2] [time3] [flags] 00 00 00 F7 = Transport Stop
	//
	// čas je zakódovaný ako 28-bitová hodnota v milisekundách (maximálne 74,5 hodín)
	// time0: bity 0-6   (0-127)
	// time1: bity 7-13  (0-127)
	// time2: bity 14-20 (0-127)
	// time3: bity 21-27 (0-127)
	// príznaky sú rezervované na budúce použitie

	SYSEX_MANUFACTURER: 0x7D,  // Nekomerčné a vzdelávacie použitie.
	SYSEX_NOTE: 0x01,           // Note on/off s mikrotonálnymi dátami.
	SYSEX_PANIC: 0x02,          // Panic vypne všetky noty.
	SYSEX_TRANSPORT_START: 0x03,
	SYSEX_TRANSPORT_STOP: 0x04,

	handleSysExMessage: (data) => {
		if (data.length < 12 || data[1] !== WebMIDI.SYSEX_MANUFACTURER) {
			Logger.log('Non-Spectra SysEx received:', Array.from(data.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '), data.length > 8 ? '...' : '');
			return;
		}

		var messageType = data[2];

		// Dekódovanie času z 28-bitového kódovania (milisekundy, max 74,5 hodiny).
		var time0 = data[3] & 0x7F;
		var time1 = data[4] & 0x7F;
		var time2 = data[5] & 0x7F;
		var time3 = data[6] & 0x7F;
		var timeMs = time0 | (time1 << 7) | (time2 << 14) | (time3 << 21);
		var timeSeconds = timeMs / 1000;

		switch (messageType) {
			case WebMIDI.SYSEX_TRANSPORT_START:

				if (WebMIDI.transportSync.ignoreNextStart) {
					WebMIDI.transportSync.ignoreNextStart = false;
					return;
				}

				if (WebMIDI.onTransportStart) {
					WebMIDI.onTransportStart(timeSeconds);
				} else {
					WebMIDI.defaultTransportStart(timeSeconds);
				}
				break;

			case WebMIDI.SYSEX_TRANSPORT_STOP:

				if (WebMIDI.transportSync.ignoreNextStop) {
					WebMIDI.transportSync.ignoreNextStop = false;
					return;
				}

				if (WebMIDI.onTransportStop) {
					WebMIDI.onTransportStop(timeSeconds);
				} else {
					WebMIDI.defaultTransportStop(timeSeconds);
				}
				break;
		}
	},

	// Predvolené handlery transportu, dajú sa prepísať.
	defaultTransportStart: (timeSeconds) => {
		if (typeof playback !== 'undefined') {
			playback.time = timeSeconds;
			playback.midiTime = timeSeconds;

			if (!playback.playing) {
				playback.playing = true;
				playback.timestamp = Date.now();
				playback.timeOld = timeSeconds;

				var playBtn = sel('.playback-ui-play');
				if (playBtn) {
					playBtn.dataset.playing = 'true';
					var icon = playBtn.querySelector('i');
					if (icon) {
						icon.classList.remove('fa-play');
						icon.classList.add('fa-pause');
					}
				}
			}
		}
	},

	defaultTransportStop: (timeSeconds) => {
		if (typeof playback !== 'undefined' && playback.playing) {
			playback.playing = false;

			if (timeSeconds !== undefined) {
				playback.time = timeSeconds;
				playback.midiTime = timeSeconds;
			}

			var now = typeof Tone !== 'undefined' ? Tone.now() : 0;
			if (typeof MIDI !== 'undefined' && typeof synths !== 'undefined') {
				for (let i = 0; i < MIDI.data.length; i++) {
					if (synths[i]) {
						synths[i].releaseAll(now);
					}
					for (let j = 0; j < MIDI.data[i].length; j++) {
						if (!MIDI.data[i] || !MIDI.data[i][j]) continue;
						if (MIDI.data[i][j][4] && MIDI.data[i][j][4].playing) {
							MIDI.data[i][j][4].playing = false;
							if (typeof OSC !== 'undefined') OSC.send.noteOff(i, MIDI.data[i][j]);
						}
					}
				}
			}

			var playBtn = sel('.playback-ui-play');
			if (playBtn) {
				playBtn.dataset.playing = 'false';
				var icon = playBtn.querySelector('i');
				if (icon) {
					icon.classList.remove('fa-pause');
					icon.classList.add('fa-play');
				}
			}
		}
	},

	sendTransportStart: (timeSeconds) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.enabled) return;

		WebMIDI.transportSync.ignoreNextStart = true;
		WebMIDI.clearIgnoreAfterTimeout();

		var timeMs = Math.max(0, Math.floor(timeSeconds * 1000)) & 0xFFFFFFF; // 28 bitov (max 74,5 hodiny).
		var time0 = timeMs & 0x7F;
		var time1 = (timeMs >> 7) & 0x7F;
		var time2 = (timeMs >> 14) & 0x7F;
		var time3 = (timeMs >> 21) & 0x7F;

		// 12-bajtová správa SysEx.
		var message = [
			0xF0,                           // Začiatok SysEx
			WebMIDI.SYSEX_MANUFACTURER,     // ID výrobcu
			WebMIDI.SYSEX_TRANSPORT_START,  // Typ správy
			time0,                          // Bity času 0-6.
			time1,                          // Bity času 7-13.
			time2,                          // Bity času 14-20.
			time3,                          // Bity času 21-27.
			0x00,                           // Príznaky (rezervované)
			0x00,                           // Výplň
			0x00,                           // Výplň
			0x00,                           // Výplň (12-bajtový rámec; príjemca vyžaduje dĺžku >= 12).
			0xF7                            // Koniec SysEx
		];

		WebMIDI.sendToAllOutputs(message);
	},

	sendTransportStop: (timeSeconds) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.enabled) return;

		WebMIDI.transportSync.ignoreNextStop = true;
		WebMIDI.clearIgnoreAfterTimeout();

		var timeMs = Math.max(0, Math.floor(timeSeconds * 1000)) & 0xFFFFFFF; // 28 bitov (max 74,5 hodiny).
		var time0 = timeMs & 0x7F;
		var time1 = (timeMs >> 7) & 0x7F;
		var time2 = (timeMs >> 14) & 0x7F;
		var time3 = (timeMs >> 21) & 0x7F;

		// 12-bajtová správa SysEx.
		var message = [
			0xF0,                           // Začiatok SysEx
			WebMIDI.SYSEX_MANUFACTURER,     // ID výrobcu
			WebMIDI.SYSEX_TRANSPORT_STOP,   // Typ správy
			time0,                          // Bity času 0-6.
			time1,                          // Bity času 7-13.
			time2,                          // Bity času 14-20.
			time3,                          // Bity času 21-27.
			0x00,                           // Príznaky (rezervované)
			0x00,                           // Výplň
			0x00,                           // Výplň
			0x00,                           // Výplň (12-bajtový rámec; príjemca vyžaduje dĺžku >= 12).
			0xF7                            // Koniec SysEx
		];

		WebMIDI.sendToAllOutputs(message);
	},

	// Zrušenie indikátorov ignorovania po timeoute (poistka).
	clearIgnoreAfterTimeout: () => {
		if (WebMIDI.transportSync.ignoreTimeout) {
			clearTimeout(WebMIDI.transportSync.ignoreTimeout);
		}
		WebMIDI.transportSync.ignoreTimeout = setTimeout(() => {
			WebMIDI.transportSync.ignoreNextStart = false;
			WebMIDI.transportSync.ignoreNextStop = false;
		}, WebMIDI.transportSync.ignoreWindow);
	},


	handleRealtimeMessage: (status) => {
		switch (status) {
			case WebMIDI.MIDI_CLOCK: // 0xF8 - Timing Clock.
				if (!WebMIDI.transportSync.receiveClock) return;
				WebMIDI.handleMidiClock();
				break;

			case WebMIDI.MIDI_START: // 0xFA - Start.
				if (!WebMIDI.transportSync.receiveStartStop) return;
				if (WebMIDI.transportSync.ignoreNextStart) {
					WebMIDI.transportSync.ignoreNextStart = false;
					return;
				}
				WebMIDI.handleMidiStart();
				break;

			case WebMIDI.MIDI_CONTINUE: // 0xFB - Continue.
				if (!WebMIDI.transportSync.receiveStartStop) return;
				if (WebMIDI.transportSync.ignoreNextStart) {
					WebMIDI.transportSync.ignoreNextStart = false;
					return;
				}
				WebMIDI.handleMidiContinue();
				break;

			case WebMIDI.MIDI_STOP: // 0xFC - Stop.
				if (!WebMIDI.transportSync.receiveStartStop) return;
				if (WebMIDI.transportSync.ignoreNextStop) {
					WebMIDI.transportSync.ignoreNextStop = false;
					return;
				}
				WebMIDI.handleMidiStop();
				break;
		}
	},

	// Spracovanie prichádzajúceho MIDI clocku na zisťovanie tempa, čím sa sleduje tempo externého zdroju synchronizácie.
	handleMidiClock: () => {
		var now = performance.now();
		var sync = WebMIDI.transportSync;
		sync.externalClockCount++;

		if (sync.lastClockTime > 0) {
			var interval = now - sync.lastClockTime;
			var instantTempo = 60000 / (interval * 24);

			// Prijatie okamžitého tempa len v použiteľnom rozsahu (20-300 BPM).
			if (instantTempo >= 20 && instantTempo <= 300) {
				if (sync.externalTempo === 0) {
					sync.externalTempo = instantTempo;
				} else {
					var diff = Math.abs(instantTempo - sync.externalTempo);
					if (diff > 5) {
						sync.externalTempo = sync.externalTempo * 0.5 + instantTempo * 0.5;
					} else {
						sync.externalTempo = sync.externalTempo * 0.7 + instantTempo * 0.3;
					}
				}
			}
		}
		sync.lastClockTime = now;
		sync.isExternalSync = true;
	},

	handleSongPositionPointer: (lsb, msb) => {
		if (!WebMIDI.transportSync.receiveSPP) return;
		var sppBeats = (msb << 7) | lsb;

		var bpm = WebMIDI.transportSync.externalTempo;
		if (!bpm || bpm < 20 || bpm > 300) {
			bpm = (typeof playback !== 'undefined' && playback.bpm) ? playback.bpm : 120;
		}

		// SPP je v jednotkách šestnástinových nôt (MIDI beat = 6 clockov = 1/16 nota).
		var timeSeconds = sppBeats * (60 / bpm / 4);

		if (typeof playback !== 'undefined') {
			// Uloženie predošlej pozície kvôli plynulému prechodu.
			var oldTime = playback.time;
			playback.time = timeSeconds;
			playback.midiTime = timeSeconds;

			if (Math.abs(oldTime - timeSeconds) > 1) {
			}
		}
	},

	handleMidiStart: () => {
		WebMIDI.transportSync.externalClockCount = 0;
		WebMIDI.transportSync.isExternalSync = true;
		if (typeof playback !== 'undefined') {
			playback.time = 0;
			playback.midiTime = 0;
			if (!playback.playing) {
				playback.playing = true;
				playback.timestamp = Date.now();
				playback.timeOld = 0;
				var playBtn = sel('.playback-ui-play');
				if (playBtn) {
					playBtn.dataset.playing = 'true';
					var icon = playBtn.querySelector('i');
					if (icon) {
						icon.classList.remove('fa-play');
						icon.classList.add('fa-pause');
					}
				}
			}
		}
	},

	handleMidiContinue: () => {
		WebMIDI.transportSync.isExternalSync = true;
		if (typeof playback !== 'undefined' && !playback.playing) {
			playback.playing = true;
			playback.timestamp = Date.now();
			playback.timeOld = playback.time;
			var playBtn = sel('.playback-ui-play');
			if (playBtn) {
				playBtn.dataset.playing = 'true';
				var icon = playBtn.querySelector('i');
				if (icon) {
					icon.classList.remove('fa-play');
					icon.classList.add('fa-pause');
				}
			}
		}
	},

	handleMidiStop: () => {
		WebMIDI.transportSync.isExternalSync = false;
		if (typeof playback !== 'undefined' && playback.playing) {
			playback.playing = false;
			var playBtn = sel('.playback-ui-play');
			if (playBtn) {
				playBtn.dataset.playing = 'false';
				var icon = playBtn.querySelector('i');
				if (icon) {
					icon.classList.remove('fa-pause');
					icon.classList.add('fa-play');
				}
			}

			// Ukončenie všetkých nôt v syntetizátoroch, aby nezostali visieť.
			if (typeof synths !== 'undefined' && Array.isArray(synths)) {
				var now = typeof Tone !== 'undefined' ? Tone.now() : 0;
				for (let i = 0; i < synths.length; i++) {
					if (synths[i] && typeof synths[i].releaseAll === 'function') {
						try {
							synths[i].releaseAll(now);
						} catch (e) {
							Logger.warn('Error releasing synth', i, e);
						}
					}
				}
			}

			if (WebMIDI.selectedOutputs.length > 0) {
				for (let ch = 0; ch < 16; ch++) {
					WebMIDI.sendToAllOutputs([0xB0 | ch, 123, 0]);
				}
			}
		}
	},

	// Generovanie MIDI clocku kvôli synchronizácii s DAW.
	startMidiClock: (bpm) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.sendClock) return;
		WebMIDI.stopMidiClock();
		// Konfigurovateľné PPQN (pulzy na jednu štvrťovú notu).
		var ppqn = (typeof Config !== 'undefined' && Config.io?.midiClockPPQN) || 24;
		var intervalMs = 60000 / bpm / ppqn;
		WebMIDI.transportSync.clockCount = 0;
		WebMIDI.transportSync.clockInterval = setInterval(() => {
			WebMIDI.sendToAllOutputs([WebMIDI.MIDI_CLOCK]);
			WebMIDI.transportSync.clockCount++;
		}, intervalMs);
	},

	stopMidiClock: () => {
		if (WebMIDI.transportSync.clockInterval) {
			clearInterval(WebMIDI.transportSync.clockInterval);
			WebMIDI.transportSync.clockInterval = null;
		}
	},

	sendMidiStart: (bpm) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.sendStartStop) return;
		WebMIDI.transportSync.ignoreNextStart = true;
		WebMIDI.clearIgnoreAfterTimeout();
		WebMIDI.sendToAllOutputs([WebMIDI.MIDI_START]);
		if (WebMIDI.transportSync.sendClock && bpm) {
			WebMIDI.startMidiClock(bpm);
		}
	},

	sendMidiContinue: (bpm) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.sendStartStop) return;
		WebMIDI.transportSync.ignoreNextStart = true;
		WebMIDI.clearIgnoreAfterTimeout();
		WebMIDI.sendToAllOutputs([WebMIDI.MIDI_CONTINUE]);
		if (WebMIDI.transportSync.sendClock && bpm) {
			WebMIDI.startMidiClock(bpm);
		}
	},

	sendMidiStop: () => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.sendStartStop) return;
		WebMIDI.stopMidiClock();
		WebMIDI.transportSync.ignoreNextStop = true;
		WebMIDI.clearIgnoreAfterTimeout();
		WebMIDI.sendToAllOutputs([WebMIDI.MIDI_STOP]);
	},

	sendSongPositionPointer: (timeSeconds, bpm) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0 || !WebMIDI.transportSync.sendSPP) return;
		var sppBeats = Math.floor(timeSeconds * bpm / 60 * 4);
		var clampedBeats = Math.max(0, Math.min(16383, sppBeats));
		var lsb = clampedBeats & 0x7F;
		var msb = (clampedBeats >> 7) & 0x7F;
		WebMIDI.sendToAllOutputs([WebMIDI.MIDI_SPP, lsb, msb]);
	},

	// Ovládanie transportu na vyššej úrovni.
	sendTransport: (action, timeSeconds, bpm) => {
		if (!WebMIDI.transportSync.enabled) return;
		bpm = bpm || (typeof playback !== 'undefined' ? playback.bpm : 120) || 120;

		switch (action) {
			case 'start':
				if (timeSeconds > 0 && WebMIDI.transportSync.sendSPP) {
					WebMIDI.sendSongPositionPointer(timeSeconds, bpm);
					setTimeout(() => WebMIDI.sendMidiContinue(bpm), 10);
				} else {
					WebMIDI.sendMidiStart(bpm);
				}
				if (WebMIDI.transportSync.mode === 'sysex') {
					WebMIDI.sendTransportStart(timeSeconds);
				}
				break;
			case 'stop':
				WebMIDI.sendMidiStop();
				if (WebMIDI.transportSync.mode === 'sysex') {
					WebMIDI.sendTransportStop(timeSeconds);
				}
				break;
			case 'locate':
				if (WebMIDI.transportSync.sendSPP) {
					WebMIDI.sendSongPositionPointer(timeSeconds, bpm);
				}
				break;
		}
	},

	indicatorFlashDuration: 200,

	_inputIndicatorTimeouts: {},

	flashInputIndicator: (sourceInput) => {
		var flashDuration = WebMIDI.indicatorFlashDuration;

		// Spätne kompatibilný globálny indikátor.
		var globalIndicator = sel('.midi-input-indicator');
		if (globalIndicator) {
			globalIndicator.style.background = '#0f0';

			if (sourceInput && WebMIDI.selectedInputs.length > 1) {
				var inputLabel = sel('.midi-input-active-label');
				if (inputLabel) {
					inputLabel.textContent = sourceInput.name;
					inputLabel.style.opacity = '1';
				}
			}
		}

		if (sourceInput) {
			var sanitizedId = sourceInput.id.replace(/[^a-zA-Z0-9]/g, '_');
			var specificClass = '.midi-input-indicator-' + sanitizedId;
			var specificIndicator = sel(specificClass);

			if (specificIndicator) {
				specificIndicator.style.background = '#0f0';

				if (WebMIDI._inputIndicatorTimeouts[sanitizedId]) {
					clearTimeout(WebMIDI._inputIndicatorTimeouts[sanitizedId]);
				}

				WebMIDI._inputIndicatorTimeouts[sanitizedId] = setTimeout(() => {
					specificIndicator.style.background = '#333';
					delete WebMIDI._inputIndicatorTimeouts[sanitizedId];
				}, flashDuration);
			}
		}

		if (WebMIDI.indicatorTimeout) {
			clearTimeout(WebMIDI.indicatorTimeout);
		}

		WebMIDI.indicatorTimeout = setTimeout(() => {
			if (globalIndicator) {
				globalIndicator.style.background = '#333';
			}
			var inputLabel = sel('.midi-input-active-label');
			if (inputLabel) {
				inputLabel.style.opacity = '0';
			}
		}, flashDuration);
	},

	indicatorTimeout: null,

	noteOn: (note, velocity = 100, channel = null) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) return;

		var ch = WebMIDI.validateChannel(channel);
		var noteInt = Math.round(note);

		if (noteInt < 0 || noteInt > 127) {
			Logger.warn('Note out of MIDI range:', noteInt);
			return;
		}

		var message = [0x90 | ch, noteInt, velocity];
		WebMIDI.sendToAllOutputs(message);
		// Logger.log(`MIDI Out: Note On ch${ch + 1} note${noteInt} vel${velocity}`);
	},

	noteOff: (note, channel = null) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) return;

		var ch = WebMIDI.validateChannel(channel);
		var noteInt = Math.round(note);

		if (noteInt < 0 || noteInt > 127) return;

		var message = [0x80 | ch, noteInt, 0];
		WebMIDI.sendToAllOutputs(message);
		// Logger.log(`MIDI Out: Note Off ch${ch + 1} note${noteInt}`);
	},

	noteOnFreq: (freq, velocity = 100, channel = null) => {
		var note = freq2note(freq);
		WebMIDI.noteOn(note, velocity, channel);
	},

	noteOffFreq: (freq, channel = null) => {
		var note = freq2note(freq);
		WebMIDI.noteOff(note, channel);
	},

	// All Notes Off (panic).
	allNotesOff: (channel = null) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) return;

		var ch = WebMIDI.validateChannel(channel);
		// CC 123 = All Notes Off.
		WebMIDI.sendToAllOutputs([0xB0 | ch, 123, 0]);
	},

	// Value: 0-16383, stred = 8192 (bez bendu).
	sendPitchBend: (value, channel = null) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) return;

		var ch = WebMIDI.validateChannel(channel);
		var bendValue = Math.max(0, Math.min(16383, Math.round(value)));
		var lsb = bendValue & 0x7F;
		var msb = (bendValue >> 7) & 0x7F;
		WebMIDI.sendToAllOutputs([0xE0 | ch, lsb, msb]);
	},

	sendPitchBendForFreq: (midiNote, exactFreq, channel = null, bendRange = 2) => {
		if (!exactFreq || exactFreq <= 0) {
			WebMIDI.sendPitchBend(8192, channel);
			return;
		}

		var noteInt = Math.round(midiNote);
		var nearestNoteFreq = 440 * Math.pow(2, (noteInt - 69) / 12);
		var deviationCents = 1200 * Math.log2(exactFreq / nearestNoteFreq);

		// Prevod centov na hodnotu pitch bendu
		// bendRange poltónov = bendRange * 100 centov = celý rozsah 0-16383
		// 1 cent = 16384 / (bendRange * 200).
		var centsPerUnit = (bendRange * 200) / 16384;
		var bendOffset = Math.round(deviationCents / centsPerUnit);
		var bendValue = 8192 + bendOffset;

		WebMIDI.sendPitchBend(Math.max(0, Math.min(16383, bendValue)), channel);
	},

	// Formát: F0 7D 01 [trk] [note] [vel] [pitL] [pitH] [sign] [parciál] [amp] F7
	// - trk: index stopy (0-127)
	// - note je najbližšia MIDI nota (0-127)
	// - vel: velocity (0-127, 0 = note off).

	sendSysExNoteOn: (trackIdx, midiNote, velocity, partialNum = 1, amplitude = 100, exactFreq = null) => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) {
			return;
		}

		var noteInt = Math.round(midiNote) & 0x7F;
		var vel = Math.min(127, Math.max(0, velocity)) & 0x7F;
		var partial = Math.min(127, Math.max(1, partialNum)) & 0x7F;
		var amp = Math.min(127, Math.max(0, amplitude)) & 0x7F;
		var trk = Math.min(127, Math.max(0, trackIdx)) & 0x7F;

		var pitchDeviation = 0;
		var sign = 0;

		if (exactFreq !== null && exactFreq > 0) {
			// Pri výpočtoch MIDI sa vždy počíta s A=440.
			var nearestNoteFreq = 440 * Math.pow(2, (noteInt - 69) / 12);

			var deviationCents = 1200 * Math.log2(exactFreq / nearestNoteFreq);
			var deviationDecicents = Math.round(deviationCents * 10); // V desatinách centu.
			var absDecicents = Math.abs(deviationDecicents);

			// Kontrola presiahnutia rozsahu, keďže 16383 decicentov = 1638,3 centu (13,6 poltónu).
			if (absDecicents > 16383) {
				// Upozornenie na obmedzenie odchýlky, najviac raz za 5 sekúnd.
				if (!WebMIDI._lastPitchTruncationWarning ||
					Date.now() - WebMIDI._lastPitchTruncationWarning > 5000) {
					WebMIDI._lastPitchTruncationWarning = Date.now();
					Logger.warn(`MIDI SysEx: Pitch deviation truncated from ${(absDecicents/10).toFixed(1)} to 1638.3 cents (max 14-bit range)`);
					if (typeof showStatus === 'function') {
						showStatus(`Microtonal deviation exceeds MIDI range (${Math.abs(deviationCents).toFixed(0)} cents)`, { type: 'warning' });
					}
				}
			}

			if (deviationDecicents < 0) {
				sign = 1;
				pitchDeviation = Math.min(16383, absDecicents);
			} else {
				sign = 0;
				pitchDeviation = Math.min(16383, deviationDecicents);
			}
		}

		var pitL = pitchDeviation & 0x7F;
		var pitH = (pitchDeviation >> 7) & 0x7F;

		var message = [
			0xF0,                       // Začiatok SysEx
			WebMIDI.SYSEX_MANUFACTURER, // ID výrobcu (0x7D).
			WebMIDI.SYSEX_NOTE,         // Typ správy (0x01).
			trk,
			noteInt,
			vel,
			pitL,                       // Spodných 7 bitov odchýlky výšky.
			pitH,                       // Horných 7 bitov odchýlky výšky.
			sign,                       // Znamienko (0=kladné, 1=záporné).
			partial,
			amp,
			0xF7                        // Koniec SysEx
		];
		WebMIDI.sendToAllOutputs(message);
	},

	sendSysExNoteOff: (trackIdx, midiNote, partialNum = 1) => {
		// Note off je note on s hodnotou velocity 0.
		WebMIDI.sendSysExNoteOn(trackIdx, midiNote, 0, partialNum, 0, null);
	},

	// Odoslanie SysEx panic (All Notes Off); formát: F0 7D 02 0 0 0 0 0 0 0 0 F7.
	sendSysExPanic: () => {
		if (!WebMIDI.selectedOutputs || WebMIDI.selectedOutputs.length === 0) return;

		var message = [
			0xF0,                       // Začiatok SysEx
			WebMIDI.SYSEX_MANUFACTURER, // ID výrobcu (0x7D).
			WebMIDI.SYSEX_PANIC,        // Typ správy (0x02).
			0x00,                       // Stopa (0 = všetky).
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0xF7                        // Koniec SysEx
		];

		WebMIDI.sendToAllOutputs(message);
	},

	// Pomocná funkcia obchádza OSC.send.noteOn, ktoré rieši rovnaké odoslanie s plným rozpisom parciálov.
	sendNoteWithSysEx: (trackIdx, note, velocity, partialNum, amplitude, exactFreq) => {
		var midiNote = Math.round(exactFreq ? freq2note(exactFreq) : note);

		WebMIDI.noteOn(midiNote, velocity);
		WebMIDI.sendSysExNoteOn(trackIdx, midiNote, velocity, partialNum, amplitude, exactFreq);
	},

	sendNoteOffWithSysEx: (trackIdx, note, partialNum, exactFreq) => {
		var midiNote = Math.round(exactFreq ? freq2note(exactFreq) : note);

		WebMIDI.noteOff(midiNote);
		WebMIDI.sendSysExNoteOff(trackIdx, midiNote, partialNum);
	},

	sendPanic: () => {
		for (let ch = 0; ch < 16; ch++) {
			WebMIDI.allNotesOff(ch);
		}
		WebMIDI.sendSysExPanic();
	},


	saveSettings: (skipSync) => {
		var midiSettings = {
			inputIds: WebMIDI.selectedInputs.map(i => i.id),
			inputId: WebMIDI.selectedInput ? WebMIDI.selectedInput.id : '',
			outputIds: WebMIDI.selectedOutputs.map(o => o.id),
			outputId: WebMIDI.selectedOutput ? WebMIDI.selectedOutput.id : '', // Spätná kompatibilita
			channel: WebMIDI.channel,
			transportSyncEnabled: WebMIDI.transportSync.enabled,
			sendClock: WebMIDI.transportSync.sendClock,
			bpm: (typeof playback !== 'undefined' ? playback.bpm : 120),
			outputTrackMode: WebMIDI.outputFilter.trackMode,
			outputTracks: WebMIDI.outputFilter.tracks,
			outputPartialMode: WebMIDI.outputFilter.partialMode,
			outputPartials: WebMIDI.outputFilter.partials,
			mpeDevices: WebMIDI._collectMpeDeviceConfig()
		};

		try {
			localStorage.setItem('spectra_midi_settings', JSON.stringify(midiSettings));
		} catch (err) {
			if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
				Logger.error('Failed to save MIDI settings - storage quota exceeded');
				if (typeof showStatus === 'function') {
					showStatus('Storage full - MIDI settings not saved', { type: 'warning' });
				}
			} else {
				Logger.error('Failed to save MIDI settings:', err);
			}
		}


	},

	loadSettings: () => {
		var settings = {};
		try {
			var saved = localStorage.getItem('spectra_midi_settings');
			if (saved) {
				settings = JSON.parse(saved);
			}
		} catch (e) {
			Logger.warn('Failed to load MIDI settings:', e);
		}

		WebMIDI.mpeDeviceConfig = settings.mpeDevices || {};

		if (settings.channel !== undefined) {
			WebMIDI.channel = settings.channel;
			var channelSelect = sel('.midi-channel-select');
			if (channelSelect) channelSelect.value = WebMIDI.channel;
		}

		if (settings.transportSyncEnabled !== undefined) {
			WebMIDI.transportSync.enabled = settings.transportSyncEnabled;
			var syncCheckbox = sel('.midi-transport-enable');
			if (syncCheckbox) syncCheckbox.checked = WebMIDI.transportSync.enabled;
		}

		// Načíta sa, či sa má odosielať MIDI clock; checkbox nemusí existovať v niektorých buildoch.
		if (settings.sendClock !== undefined) {
			WebMIDI.transportSync.sendClock = settings.sendClock;
			var clockCheckbox = sel('.midi-clock-enable');
			if (clockCheckbox) clockCheckbox.checked = WebMIDI.transportSync.sendClock;
		}

		if (settings.bpm !== undefined) {
			if (typeof playback !== 'undefined') {
				playback.bpm = settings.bpm;
			}
			var bpmInput = sel('.midi-bpm-input');
			if (bpmInput) bpmInput.value = settings.bpm;
		}

		if (settings.outputTrackMode) {
			WebMIDI.outputFilter.trackMode = settings.outputTrackMode;
		}
		if (settings.outputTracks) {
			WebMIDI.outputFilter.tracks = settings.outputTracks;
		}
		if (settings.outputPartialMode) {
			WebMIDI.outputFilter.partialMode = settings.outputPartialMode;
		}
		if (settings.outputPartials) {
			WebMIDI.outputFilter.partials = settings.outputPartials;
		}

		// Výber portov a obnova UI až neskôr, kým sa nenaplnia dropdowny.
		setTimeout(() => {
			if (settings.inputIds && Array.isArray(settings.inputIds)) {
				WebMIDI.selectedInputs = [];
				for (const inputId of settings.inputIds) {
					WebMIDI.addInput(inputId);
				}
			} else if (settings.inputId) {
				// Spätná kompatibilita
				WebMIDI.addInput(settings.inputId);
			}
			WebMIDI.updateInputsListUI();

			if (settings.outputIds && Array.isArray(settings.outputIds)) {
				WebMIDI.selectedOutputs = [];
				for (const outputId of settings.outputIds) {
					WebMIDI.addOutput(outputId);
				}
			} else if (settings.outputId) {
				// Spätná kompatibilita pre jeden výstup.
				WebMIDI.addOutput(settings.outputId);
			}
			WebMIDI.updateOutputsListUI();

			WebMIDI.restoreOutputFilterUI();
		}, 100);
	},

	restoreOutputFilterUI: () => {
		var settings = {};
		try {
			var saved = localStorage.getItem('spectra_midi_settings');
			if (saved) settings = JSON.parse(saved);
		} catch (e) {}

		var trackButtons = sel('.midi-tracks-filter .ui-choice-option', true);
		if (trackButtons && trackButtons.length >= 2) {
			trackButtons.forEach(btn => btn.classList.remove('selected'));
			if (settings.outputTrackMode === 'custom') {
				trackButtons[1].classList.add('selected');
				var customSection = sel('.midi-tracks-custom');
				if (customSection) customSection.style.display = 'block';
				setTimeout(() => {
					var checkboxes = sel('.midi-tracks-container input[type="checkbox"]', true);
					if (checkboxes && settings.outputTracks) {
						checkboxes.forEach(cb => {
							var idx = parseInt(cb.dataset.trackIndex);
							cb.checked = settings.outputTracks.includes(idx);
						});
					}
				}, 100);
			} else {
				trackButtons[0].classList.add('selected');
			}
		}

		var partialButtons = sel('.midi-partials-filter .ui-choice-option', true);
		if (partialButtons) {
			partialButtons.forEach(btn => btn.classList.remove('selected'));
			var modeMap = {
				'all': 'all-partials',
				'active': 'active-partial',
				'fundamentals': 'fundamentals',
				'custom': 'custom'
			};
			var targetValue = modeMap[settings.outputPartialMode] || 'fundamentals';
			for (let btn of partialButtons) {
				if (btn.dataset.value === targetValue) {
					btn.classList.add('selected');
					break;
				}
			}

			if (settings.outputPartialMode === 'custom') {
				var customInput = sel('.midi-partials-custom');
				if (customInput) {
					customInput.style.display = 'block';
					if (settings.outputPartials) {
						customInput.value = settings.outputPartials.join(', ');
					}
				}
			}
		}
	},

	// Uplatnenie projektových nastavení MIDI, spúšťa sa po načítaní projektu.
	applyProjectSettings: () => {
		var settings = window.projectMidiSettings;
		if (!settings) return;

		if (settings.bpm && typeof playback !== 'undefined') {
			playback.bpm = settings.bpm;
			var bpmInput = sel('.midi-bpm-input');
			if (bpmInput) bpmInput.value = settings.bpm;
		}

		if (settings.channel !== undefined) {
			WebMIDI.channel = settings.channel;
			var channelSelect = sel('.midi-channel-select');
			if (channelSelect) channelSelect.value = settings.channel;
		}

		if (settings.transportSyncEnabled !== undefined) {
			WebMIDI.transportSync.enabled = settings.transportSyncEnabled;
			var syncCheckbox = sel('.midi-transport-enable');
			if (syncCheckbox) syncCheckbox.checked = settings.transportSyncEnabled;
		}

		if (settings.outputFilter) {
			WebMIDI.outputFilter.trackMode = settings.outputFilter.trackMode || 'all';
			WebMIDI.outputFilter.tracks = settings.outputFilter.tracks || [];
			WebMIDI.outputFilter.partialMode = settings.outputFilter.partialMode || 'fundamentals';
			WebMIDI.outputFilter.partials = settings.outputFilter.partials || [];

			WebMIDI.restoreOutputFilterUIFromProject(settings.outputFilter);
		}

		// Uplatnenie portov MIDI sa odkladá, aby už boli porty dostupné.
		setTimeout(() => {
			WebMIDI.selectedInputs = [];

			if (settings.inputIds && Array.isArray(settings.inputIds)) {
				for (const inputId of settings.inputIds) {
					WebMIDI.addInput(inputId);
				}
			}
			WebMIDI.updateInputsListUI();

			if (settings.outputId) {
				var outputSelect = sel('.midi-output-select');
				if (outputSelect) {
					outputSelect.value = settings.outputId;
					WebMIDI.selectOutput(settings.outputId);
				}
			}
		}, 200);

		window.projectMidiSettings = null;
	},

	restoreOutputFilterUIFromProject: (outputFilter) => {
		var trackButtons = sel('.midi-tracks-filter .ui-choice-option', true);
		if (trackButtons && trackButtons.length >= 2) {
			trackButtons.forEach(btn => btn.classList.remove('selected'));
			if (outputFilter.trackMode === 'custom') {
				trackButtons[1].classList.add('selected');
				var customSection = sel('.midi-tracks-custom');
				if (customSection) customSection.style.display = 'block';
				setTimeout(() => {
					var checkboxes = sel('.midi-tracks-container input[type="checkbox"]', true);
					if (checkboxes && outputFilter.tracks) {
						checkboxes.forEach(cb => {
							var idx = parseInt(cb.dataset.trackIndex);
							cb.checked = outputFilter.tracks.includes(idx);
						});
					}
				}, 100);
			} else {
				trackButtons[0].classList.add('selected');
			}
		}

		var partialButtons = sel('.midi-partials-filter .ui-choice-option', true);
		if (partialButtons) {
			partialButtons.forEach(btn => btn.classList.remove('selected'));
			var modeMap = {
				'all': 'all-partials',
				'active': 'active-partial',
				'fundamentals': 'fundamentals',
				'custom': 'custom'
			};
			var targetValue = modeMap[outputFilter.partialMode] || 'fundamentals';
			for (let btn of partialButtons) {
				if (btn.dataset.value === targetValue) {
					btn.classList.add('selected');
					break;
				}
			}

			if (outputFilter.partialMode === 'custom') {
				var customInput = sel('.midi-partials-custom');
				if (customInput) {
					customInput.style.display = 'block';
					if (outputFilter.partials) {
						customInput.value = outputFilter.partials.join(', ');
					}
				}
			}
		}
	},

	updateStatus: (text) => {
		var statusEl = sel('.midi-status');
		if (statusEl) {
			statusEl.textContent = text;
		}
	},

	// Kontrola, či sa má nota poslať na výstup podľa aktuálnych filtrov.
	shouldOutput: (trackIndex, partialNumber) => {
		if (WebMIDI.outputFilter.trackMode === 'custom') {
			if (!WebMIDI.outputFilter.tracks.includes(trackIndex)) {
				return false;
			}
		}
		return true;
	},

	getSelectedTracks: () => {
		var trackMode = sel('.midi-tracks-filter .ui-choice-option.selected');
		if (!trackMode || trackMode.dataset.value === 'all') {
			return 'all';
		}

		var checkboxes = sel('.midi-tracks-container input[type="checkbox"]', true);
		var selected = [];
		checkboxes.forEach((cb, i) => {
			if (cb.checked) selected.push(i);
		});
		return selected;
	},

	getPartialMode: () => {
		var selectedBtn = sel('.midi-partials-filter .ui-choice-option.selected');
		if (!selectedBtn) return { mode: 'all', partials: [] };

		var value = selectedBtn.dataset.value;
		if (value === 'all-partials') return { mode: 'all', partials: [] };
		if (value === 'active-partial') return { mode: 'active', partials: [] };
		if (value === 'fundamentals') return { mode: 'fundamentals', partials: [] };
		if (value === 'custom') {
			var input = sel('.midi-partials-input');
			if (!input) return { mode: 'all', partials: [] };
			var nums = input.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1);
			return { mode: 'custom', partials: nums };
		}
		return { mode: 'all', partials: [] };
	},

	updateOutputFilter: () => {
		var tracks = WebMIDI.getSelectedTracks();
		var partialConfig = WebMIDI.getPartialMode();

		WebMIDI.outputFilter.trackMode = (tracks === 'all') ? 'all' : 'custom';
		WebMIDI.outputFilter.tracks = (tracks === 'all') ? [] : tracks;
		WebMIDI.outputFilter.partialMode = partialConfig.mode;
		WebMIDI.outputFilter.partials = partialConfig.partials;

		WebMIDI.saveSettings();
	},

	populateTracksList: () => {
		var container = sel('.midi-tracks-container');
		if (!container) return;

		container.innerHTML = '';

		if (typeof MIDI === 'undefined' || !MIDI.data) return;

		var instruments = DB.get('instruments') || [];

		MIDI.data.forEach((track, i) => {
			var label = document.createElement('label');
			label.className = 'midi-checkbox-item';
			label.style.cssText = 'display: flex; align-items: center; margin: 5px 0; cursor: pointer;';

			var checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = true;
			checkbox.dataset.trackIndex = i;
			checkbox.style.marginRight = '8px';

			var trackName = instruments[i] ? instruments[i].name : `Track ${i + 1}`;
			var span = document.createElement('span');
			span.className = 'checkbox-label';
			span.textContent = trackName;

			if (instruments[i] && instruments[i].color) {
				var colorDot = document.createElement('span');
				colorDot.style.cssText = `display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${instruments[i].color}; margin-right: 8px;`;
				label.appendChild(checkbox);
				label.appendChild(colorDot);
				label.appendChild(span);
			} else {
				label.appendChild(checkbox);
				label.appendChild(span);
			}

			checkbox.addEventListener('change', () => {
				WebMIDI.updateOutputFilter();
			});

			container.appendChild(label);
		});
	},

	setupOutputOptions: () => {
		sel('.midi-tracks-filter .ui-choice-option', true).forEach(btn => {
			btn.addEventListener('click', () => {
				sel('.midi-tracks-filter .ui-choice-option', true).forEach(b => b.classList.remove('selected'));
				btn.classList.add('selected');

				var customDiv = sel('.midi-tracks-custom');
				if (customDiv) {
					customDiv.style.display = btn.dataset.value === 'custom' ? 'block' : 'none';
				}

				if (btn.dataset.value === 'custom') {
					WebMIDI.populateTracksList();
				}

				WebMIDI.updateOutputFilter();
			});
		});

		var selectAllTracks = sel('.midi-select-all-tracks');
		if (selectAllTracks) {
			selectAllTracks.addEventListener('change', () => {
				sel('.midi-tracks-container input[type="checkbox"]', true).forEach(cb => {
					cb.checked = selectAllTracks.checked;
				});
				WebMIDI.updateOutputFilter();
			});
		}

		sel('.midi-partials-filter .ui-choice-option', true).forEach(btn => {
			btn.addEventListener('click', () => {
				sel('.midi-partials-filter .ui-choice-option', true).forEach(b => b.classList.remove('selected'));
				btn.classList.add('selected');

				var customInput = sel('.midi-partials-input');
				if (customInput) {
					customInput.style.display = btn.dataset.value === 'custom' ? 'block' : 'none';
				}

				WebMIDI.updateOutputFilter();
			});
		});

		var partialsInput = sel('.midi-partials-input');
		if (partialsInput) {
			partialsInput.addEventListener('input', () => {
				WebMIDI.updateOutputFilter();
			});
		}

		WebMIDI.updateOutputFilter();
	},

	setupUI: () => {
		var inputSelect = sel('.midi-input-select');
		var outputSelect = sel('.midi-output-select');
		var channelSelect = sel('.midi-channel-select');
		var refreshBtn = sel('.midi-refresh');
		var panicBtn = sel('.midi-panic');
		var transportSyncCheckbox = sel('.midi-transport-enable');

		if (inputSelect) {
			inputSelect.addEventListener('change', (e) => {
				if (e.target.value) {
					WebMIDI.addInput(e.target.value);
					e.target.value = ''; // Reset dropdownu
				}
			});
		}

		if (outputSelect) {
			outputSelect.addEventListener('change', (e) => {
				if (e.target.value) {
					WebMIDI.addOutput(e.target.value);
					e.target.value = ''; // Reset dropdownu
				}
			});
		}

		if (channelSelect) {
			channelSelect.innerHTML = '';
			for (let i = 0; i < 16; i++) {
				var opt = document.createElement('option');
				opt.value = i;
				opt.textContent = 'Channel ' + (i + 1);
				channelSelect.appendChild(opt);
			}
			channelSelect.value = WebMIDI.channel;

			channelSelect.addEventListener('change', (e) => {
				WebMIDI.channel = parseInt(e.target.value);
				WebMIDI.saveSettings();
			});
		}

		if (transportSyncCheckbox) {
			transportSyncCheckbox.checked = WebMIDI.transportSync.enabled;
			transportSyncCheckbox.addEventListener('change', (e) => {
				WebMIDI.transportSync.enabled = e.target.checked;
				WebMIDI.saveSettings();
			});
		}

		var clockCheckbox = sel('.midi-clock-enable');
		if (clockCheckbox) {
			clockCheckbox.checked = WebMIDI.transportSync.sendClock;
			clockCheckbox.addEventListener('change', (e) => {
				WebMIDI.transportSync.sendClock = e.target.checked;
				if (!e.target.checked) {
					WebMIDI.stopMidiClock();
				} else if (typeof playback !== 'undefined' && playback.playing) {
					WebMIDI.startMidiClock(playback.bpm);
				}
				WebMIDI.saveSettings();
			});
		}

		var bpmInput = sel('.midi-bpm-input');
		if (bpmInput) {
			if (typeof playback !== 'undefined' && playback.bpm) {
				bpmInput.value = playback.bpm;
			}
			bpmInput.addEventListener('change', (e) => {
				var bpm = parseFloat(e.target.value) || 120;
				if (typeof playback !== 'undefined') {
					playback.bpm = bpm;
				}
				if (WebMIDI.transportSync.clockInterval) {
					WebMIDI.startMidiClock(bpm);
				}
				WebMIDI.saveSettings();
			});
		}

		if (refreshBtn) {
			refreshBtn.addEventListener('click', async () => {
				WebMIDI.updateStatus('Refreshing...');
				await WebMIDI.refreshPorts();
				WebMIDI.updateStatus('Ports refreshed (' + WebMIDI.outputs.length + ' outputs)');
			});
		}

		if (panicBtn) {
			panicBtn.addEventListener('click', () => {
				WebMIDI.sendPanic();
			});
		}

		WebMIDI.setupOutputOptions();
	}
};

var WebSocketBridge = {
	socket: null,

	init: () => {
		// V Electrone SpectraOSC rieši OSC cez UDP.
		if (typeof window !== 'undefined' && window.electronAPI) {
			return;
		}

		if (typeof SpectraAuth !== 'undefined') {
			WebSocketBridge.socket = SpectraAuth.getSocket();
			if (!WebSocketBridge.socket) {
				WebSocketBridge.socket = SpectraAuth.initSocketForOSC();
			}
		}

		WebSocketBridge.setupSocketListeners();
	},

	setupSocketListeners: () => {
		if (!WebSocketBridge.socket) {
			if (typeof SpectraAuth === 'undefined') {
				return;
			}
			Logger.warn('WebSocketBridge: No socket available, retrying in 1s...');
			setTimeout(() => {
				if (typeof SpectraAuth !== 'undefined') {
					WebSocketBridge.socket = SpectraAuth.getSocket() || SpectraAuth.initSocketForOSC();
				}
				if (WebSocketBridge.socket) {
					WebSocketBridge.setupSocketListeners();
				}
			}, 1000);
			return;
		}

		WebSocketBridge.socket.on('osc-bridge-connected', (data) => {
			if (typeof SpectraOSC !== 'undefined' && SpectraOSC.onWebSocketDeviceConnected) {
				SpectraOSC.onWebSocketDeviceConnected(data);
			}
		});

		WebSocketBridge.socket.on('osc-bridge-disconnected', (data) => {
			if (typeof SpectraOSC !== 'undefined' && SpectraOSC.onWebSocketDeviceDisconnected) {
				SpectraOSC.onWebSocketDeviceDisconnected(data);
			}
		});
	},

	isConnected: () => WebSocketBridge.socket && WebSocketBridge.socket.connected,
	getSocket: () => WebSocketBridge.socket,

	sendToDevice: (device, address, args) => {
		if (!WebSocketBridge.socket) return false;

		if (device.type === 'websocket' && device.code) {
			WebSocketBridge.socket.emit('osc-send', {
				code: device.code,
				message: { address, args }
			});
			return true;
		} else if (device.type === 'udp') {
			// Preposielanie UDP cez server, teda vo webovej verzii bez UDP.
			WebSocketBridge.socket.emit('osc-udp-send', {
				host: device.host,
				port: device.port,
				message: { address, args }
			});
			return true;
		}
		return false;
	},

	createDevice: async (name, type) => {
		try {
			var response = await fetch('/api/osc/create-device', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ name, type })
			});
			return await response.json();
		} catch (err) {
			return { error: err.message };
		}
	},

	unpairDevice: async (code) => {
		if (!WebSocketBridge.socket || !code) return;
		WebSocketBridge.socket.emit('osc-unpair', { code });
	}
};

var OSCBridge = {
	get enabled() { return typeof SpectraOSC !== 'undefined' ? SpectraOSC.isEnabled() : false; },
	set enabled(val) { if (typeof SpectraOSC !== 'undefined') SpectraOSC.setEnabled(val); },
	send: (address, args, target) => { if (typeof SpectraOSC !== 'undefined') SpectraOSC.send(address, args, target); },
	init: () => { WebSocketBridge.init(); },
	loadSettings: () => {},
	saveSettings: () => {},
	devices: []
};

document.addEventListener('DOMContentLoaded', () => {
	setTimeout(() => WebSocketBridge.init(), 500);
});

document.addEventListener('DOMContentLoaded', () => {
	setTimeout(() => SpatialImager.init(), 100);
});

// [ZDROJ] WRIGHT, Matthew a FREED, Adrian. Open Sound Control: A New Protocol for Communicating with Sound
//   Synthesizers. In: Proceedings of the International Computer Music Conference 1997. Thessaloniki: ICMA,
//   1997, s. 101-104.
// nahradenie alebo rozšírenie objektu OSC, ak existuje; inak jeho vytvorenie
var OSC = {
	send: {
		// Pomocná funkcia na prevod noty na frekvenciu s offsetom výšky pri prehrávaní.
		note2freq: (note) => {
			var pitchOffset = window.playbackPitch || 0;
			return 440 * Math.pow(2, (note - 69 + pitchOffset) / 12);
		},

		freq2note: (freq) => {
			// Pri výstupných výpočtoch MIDI sa vždy používa 440.
			return 69 + 12 * Math.log2(freq / 440);
		},

		getPartialsForNote: (note, instrumentIndex, mode) => {
			var partials = [];

			try {
				if (!note || note.length < 4) return partials;

				if (typeof instruments === 'undefined') return partials;
				var instrument = instruments[instrumentIndex];
				if (!instrument) return partials;

				if (typeof spectra === 'undefined') return partials;
				var timbre = spectra[instrument.spectrum];
				if (!timbre) return partials;

				var notePitch = note[N_PITCH];
				var spectrumData = typeof DynamicTimbre !== 'undefined'
					? DynamicTimbre.getPartialsAtPitch(timbre, notePitch)
					: (typeof getTimbrePartials === 'function' ? getTimbrePartials(timbre, notePitch) : (timbre.data || [[1, 1]]));

				if (!spectrumData || !spectrumData.length) return partials;

				var notePartialNum = note[N_PARTIAL];
				if (!notePartialNum || notePartialNum < 1 || notePartialNum > spectrumData.length) return partials;


				var noteFreq = OSC.send.note2freq(notePitch);

				// Výpočet fundamentu z pomeru parciálu noty, zhoduje sa s wav-export.js.
				var fundamentalFreq = noteFreq / spectrumData[notePartialNum - 1][0];

				if (!isFinite(fundamentalFreq) || fundamentalFreq <= 0) {
					Logger.warn('Invalid fundamental frequency calculated:', fundamentalFreq);
					return partials;
				}

				for (let k = 0; k < spectrumData.length; k++) {
					var include = false;

					if (mode === 'all') {
						include = true;
					} else if (mode === 'active') {
						include = (k === notePartialNum - 1);
					} else if (mode === 'fundamentals') {
						include = (k === 0);
					} else if (mode === 'custom') {
						include = WebMIDI.outputFilter.partials.includes(k + 1);
					}

					if (include) {
						// Pre pomery parciálov sa vždy používajú dáta spektra.
						var partialRatio = spectrumData[k][0];
						var partialAmplitude = spectrumData[k][1]; // Rozsah 0-1
						var freq = fundamentalFreq * partialRatio;
						var midiNote = Math.round(OSC.send.freq2note(freq));

						partials.push({
							frequency: freq,
							midiNote: midiNote,
							partialNum: k + 1,
							amplitude: Math.round(partialAmplitude * 127)
						});
					}
				}
			} catch (e) {
				Logger.warn('OSC.send.getPartialsForNote error:', e);
			}

			return partials;
		},

		noteOn: (instrumentIndex, note) => {
			try {
				if (WebMIDI.outputFilter.trackMode === 'custom') {
					if (!WebMIDI.outputFilter.tracks.includes(instrumentIndex)) {
						return;
					}
				}

				var mode = WebMIDI.outputFilter.partialMode;
				var partials = OSC.send.getPartialsForNote(note, instrumentIndex, mode);

				var velocity = (note[N_DATA] && note[N_DATA].velocity !== undefined)
					? Math.round(note[N_DATA].velocity)
					: DEFAULT_VELOCITY;

				var targetOutput = 'stereo';
				if (typeof SpatialImager !== 'undefined' && typeof instruments !== 'undefined') {
					var instrument = instruments[instrumentIndex];
					if (instrument) {
						var pan = instrument.pan !== undefined ? instrument.pan : 0;
						targetOutput = SpatialImager.getOutputForPan(pan);
					}
				}

				for (const output of WebMIDI.selectedOutputs) {
					var m = WebMIDI.deviceMpeOut(output);
					var useMpe = m.enabled;
					var voices = useMpe ? [] : null;
					for (const partial of partials) {
						var ch = useMpe ? WebMIDI._allocChannelFor(output) : WebMIDI.channel;
						var range = useMpe ? m.bendRange : 2;
						WebMIDI._bendForFreqTo(output, partial.midiNote, partial.frequency, ch, range);
						WebMIDI._noteOnTo(output, partial.midiNote, velocity, ch);
						if (voices) voices.push({ channel: ch, midiNote: partial.midiNote });
					}
					if (voices) m._voices.set(note, voices);
				}

				for (const partial of partials) {
					WebMIDI.sendSysExNoteOn(
						instrumentIndex,
						partial.midiNote,
						velocity,
						partial.partialNum,
						partial.amplitude,
						partial.frequency
					);

					if (typeof SpectraOSC !== 'undefined') {
						SpectraOSC.send('/spectra/note/on', [
							instrumentIndex,           // Stopa
							partial.partialNum,        // Číslo parciálu
							partial.frequency,         // Presná frekvencia (Hz).
							velocity / 127,            // Velocity (0-1)
							partial.amplitude / 127    // Amplitúda (0-1)
						], targetOutput);
					}
				}
			} catch (e) {
				Logger.warn('OSC.send.noteOn error:', e);
			}
		},

		noteOff: (instrumentIndex, note) => {
			try {
				if (WebMIDI.outputFilter.trackMode === 'custom') {
					if (!WebMIDI.outputFilter.tracks.includes(instrumentIndex)) {
						return;
					}
				}

				var mode = WebMIDI.outputFilter.partialMode;
				var partials = OSC.send.getPartialsForNote(note, instrumentIndex, mode);

				var targetOutput = 'stereo';
				if (typeof SpatialImager !== 'undefined' && typeof instruments !== 'undefined') {
					var instrument = instruments[instrumentIndex];
					if (instrument) {
						var pan = instrument.pan !== undefined ? instrument.pan : 0;
						targetOutput = SpatialImager.getOutputForPan(pan);
					}
				}

				for (const output of WebMIDI.selectedOutputs) {
					var m = WebMIDI.deviceMpeOut(output);
					if (m.enabled) {
						var voices = m._voices.get(note);
						if (voices) {
							for (const v of voices) { WebMIDI._noteOffTo(output, v.midiNote, v.channel); WebMIDI._freeChannelFor(output, v.channel); }
							m._voices.delete(note);
						}
					} else {
						for (const partial of partials) WebMIDI._noteOffTo(output, partial.midiNote, WebMIDI.channel);
					}
				}

				for (const partial of partials) {
					WebMIDI.sendSysExNoteOff(
						instrumentIndex,
						partial.midiNote,
						partial.partialNum
					);

					if (typeof SpectraOSC !== 'undefined') {
						SpectraOSC.send('/spectra/note/off', [
							instrumentIndex,      // Stopa
							partial.partialNum,   // Číslo parciálu
							partial.frequency     // Presná frekvencia pre mikrotonálnu výšku.
						], targetOutput);
					}
				}
			} catch (e) {
				Logger.warn('OSC.send.noteOff error:', e);
			}
		}
	}
};

// Spatial Imager rieši priestorové smerovanie pre viacero výstupov.
var SpatialImager = {
	zones: [],
	canvas: null,
	ctx: null,
	container: null,
	draggingBoundary: -1,
	_initialized: false,
	_animationFrame: null,

	init: () => {
		var section = document.querySelector('.spatial-imager-section');
		if (section) {
			SpatialImager._setupCanvas(section);
			SpatialImager._setupControls(section);
		}
		if (SpatialImager.zones.length === 0) {
			SpatialImager.loadSettings(typeof DB !== 'undefined' ? DB.get('spatialImager') : null);
		}
		SpatialImager._initialized = true;
		SpatialImager._startVisualization();
	},

	_startVisualization: () => {
		if (SpatialImager._animationFrame) return;

		var animate = () => {
			// Vykresľovanie pokračuje, len ak je viditeľná záložka Output.
			var section = document.querySelector('.io-section[data-section="3"]');
			if (section && section.style.display !== 'none') {
				SpatialImager.draw();
				SpatialImager._animationFrame = requestAnimationFrame(animate);
			} else {
				SpatialImager._animationFrame = null;
			}
		};
		SpatialImager._animationFrame = requestAnimationFrame(animate);
	},

	// Reštart vizualizácie, ak bola zastavená, spúšťa sa pri sprístupnení záložky Output.
	_ensureVisualization: () => {
		if (!SpatialImager._animationFrame && SpatialImager._initialized) {
			SpatialImager._startVisualization();
		}
	},

	refresh: () => {
		if (!SpatialImager._initialized) {
			SpatialImager.init();
			return;
		}
		var container = SpatialImager.container;
		var canvas = SpatialImager.canvas;
		if (!container || !canvas) return;

		var rect = container.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			var dpr = window.devicePixelRatio || 1;
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			canvas.style.width = rect.width + 'px';
			canvas.style.height = rect.height + 'px';
			SpatialImager.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			SpatialImager.draw();
			SpatialImager._updateZonesList();
		}
		SpatialImager._ensureVisualization();
	},

	_setupCanvas: (section) => {
		var container = section.querySelector('.spatial-imager-canvas-container');
		var canvas = section.querySelector('.spatial-imager-canvas');
		if (!canvas || !container) return;

		SpatialImager.canvas = canvas;
		SpatialImager.container = container;
		SpatialImager.ctx = canvas.getContext('2d');

		var resize = () => {
			var rect = container.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				var dpr = window.devicePixelRatio || 1;
				canvas.width = rect.width * dpr;
				canvas.height = rect.height * dpr;
				canvas.style.width = rect.width + 'px';
				canvas.style.height = rect.height + 'px';
				SpatialImager.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				SpatialImager.draw();
			}
		};
		resize();
		window.addEventListener('resize', resize);

		canvas.addEventListener('mousedown', (e) => {
			var { cx, cy, r } = SpatialImager._getDimensions();
			var rect = canvas.getBoundingClientRect();
			var mx = e.clientX - rect.left;
			var my = e.clientY - rect.top;

			for (let i = 0; i < SpatialImager.zones.length - 1; i++) {
				var pos = SpatialImager.zones[i].end;
				var angle = Math.PI * (1 - pos);
				var hx = cx + Math.cos(angle) * r;
				var hy = cy - Math.sin(angle) * r;

				var dist = Math.sqrt((mx - hx) ** 2 + (my - hy) ** 2);
				if (dist < 12) {
					SpatialImager.draggingBoundary = i;
					canvas.style.cursor = 'grabbing';
					e.preventDefault();
					return;
				}
			}
		});

		canvas.addEventListener('mousemove', (e) => {
			var { cx, cy, r } = SpatialImager._getDimensions();
			var rect = canvas.getBoundingClientRect();
			var mx = e.clientX - rect.left;
			var my = e.clientY - rect.top;

			if (SpatialImager.draggingBoundary >= 0) {
				var dx = mx - cx;
				var dy = my - cy;
				let angle = Math.atan2(dy, dx);

				if (angle > 0) angle = 0;
				if (angle < -Math.PI) angle = -Math.PI;

				var newPos = 1 + (angle / Math.PI); // angle=-PI -> 0, angle=0 -> 1.

				const i = SpatialImager.draggingBoundary;
				var minPos = i > 0 ? SpatialImager.zones[i - 1].end + 0.03 : 0.03;
				var maxPos = i < SpatialImager.zones.length - 2 ? SpatialImager.zones[i + 1].end - 0.03 : 0.97;
				newPos = Math.max(minPos, Math.min(maxPos, newPos));

				SpatialImager.zones[i].end = newPos;
				SpatialImager.zones[i + 1].start = newPos;
				SpatialImager.draw();
				SpatialImager._updateZonesList();
			} else {
				var near = false;
				for (let i = 0; i < SpatialImager.zones.length - 1; i++) {
					var pos = SpatialImager.zones[i].end;
					const angle = Math.PI * (1 - pos);
					var hx = cx + Math.cos(angle) * r;
					var hy = cy - Math.sin(angle) * r;

					var dist = Math.sqrt((mx - hx) ** 2 + (my - hy) ** 2);
					if (dist < 12) { near = true; break; }
				}
				canvas.style.cursor = near ? 'grab' : 'default';
			}
		});

		document.addEventListener('mouseup', () => {
			if (SpatialImager.draggingBoundary >= 0) {
				SpatialImager.draggingBoundary = -1;
				if (SpatialImager.canvas) SpatialImager.canvas.style.cursor = 'default';
				SpatialImager._saveSettings();
			}
		});
	},

	_getDimensions: () => {
		var canvas = SpatialImager.canvas;
		if (!canvas) return { w: 0, h: 0, cx: 0, cy: 0, r: 0 };
		var dpr = window.devicePixelRatio || 1;
		var w = canvas.width / dpr, h = canvas.height / dpr;
		return { w, h, cx: w / 2, cy: h - 22, r: Math.min(w / 2 - 30, h - 44) };
	},

	_setupControls: (section) => {
		var dec = section.querySelector('.spatial-imager-zones-dec');
		var inc = section.querySelector('.spatial-imager-zones-inc');
		var btn = section.querySelector('.spatial-imager-reset-btn');
		if (dec) dec.addEventListener('click', () => SpatialImager.setZoneCount(SpatialImager.zones.length - 1, true));
		if (inc) inc.addEventListener('click', () => SpatialImager.setZoneCount(SpatialImager.zones.length + 1, true));
		if (btn) btn.addEventListener('click', () => SpatialImager.setZoneCount(SpatialImager.zones.length));
		SpatialImager._updateZoneCountUI();
	},

	setZoneCount: (count, keepOutputs) => {
		count = Math.max(1, Math.floor(count) || 1);
		var previous = keepOutputs ? SpatialImager.zones.map(z => ({ output: z.output, muted: z.muted, soloed: z.soloed })) : [];

		SpatialImager.zones = [];
		for (let i = 0; i < count; i++) {
			var kept = previous[i];
			SpatialImager.zones.push({
				start: i / count, end: (i + 1) / count,
				output: kept ? kept.output : i + 1,
				muted: kept ? !!kept.muted : false,
				soloed: kept ? !!kept.soloed : false
			});
		}
		SpatialImager._updateZoneCountUI();
		SpatialImager.draw();
		SpatialImager._updateZonesList();
		SpatialImager._saveSettings();
	},

	_updateZoneCountUI: () => {
		var count = document.querySelector('.spatial-imager-zones-count');
		var dec = document.querySelector('.spatial-imager-zones-dec');
		if (count) count.textContent = SpatialImager.zones.length;
		if (dec) dec.disabled = SpatialImager.zones.length <= 1;
	},


	draw: () => {
		var canvas = SpatialImager.canvas, ctx = SpatialImager.ctx;
		if (!canvas || !ctx) return;
		var { w, h, cx, cy, r } = SpatialImager._getDimensions();

		ctx.fillStyle = '#181818';
		ctx.fillRect(0, 0, w, h);

		for (let i = 0; i < SpatialImager.zones.length; i++) {
			const zone = SpatialImager.zones[i];
			const sa = -Math.PI * (1 - zone.start);
			const ea = -Math.PI * (1 - zone.end);

			ctx.strokeStyle = SpatialImager.isZoneSilent(zone) ? '#3a3a3a' : '#999';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(cx, cy, r, sa, ea);
			ctx.stroke();
		}

		ctx.strokeStyle = '#444';
		ctx.lineWidth = 1;
		for (let i = 0; i < SpatialImager.zones.length - 1; i++) {
			const pos = SpatialImager.zones[i].end;
			const angle = Math.PI * (1 - pos);
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + Math.cos(angle) * r, cy - Math.sin(angle) * r);
			ctx.stroke();
		}

		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx - r, cy);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx + r, cy);
		ctx.stroke();

		ctx.strokeStyle = '#555';
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx, cy - r);
		ctx.stroke();
		ctx.setLineDash([]);

		var dbLevels = [0, -6, -12, -24, -48];
		ctx.strokeStyle = '#333';
		ctx.setLineDash([2, 4]);

		for (const db of dbLevels) {
			// Prevod dB na polomer.
			const trackVolume = Math.max(0.15, Math.min(1, (db + 60) / 66));
			const logVolume = Math.pow(trackVolume, 2);
			const arcRadius = (1 - logVolume) * (r - 10);

			ctx.beginPath();
			ctx.arc(cx, cy, arcRadius, -Math.PI, 0);
			ctx.stroke();
		}
		ctx.setLineDash([]);

		// Popisky dB sa vykreslia pozdĺž stredovej čiary.
		ctx.fillStyle = '#555';
		ctx.font = '9px sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (const db of dbLevels) {
			const trackVolume = Math.max(0.15, Math.min(1, (db + 60) / 66));
			const logVolume = Math.pow(trackVolume, 2);
			const arcRadius = (1 - logVolume) * (r - 10);
			ctx.fillText(db === 0 ? '0dB' : `${db}dB`, cx + 5, cy - arcRadius);
		}

		for (let i = 0; i < SpatialImager.zones.length; i++) {
			const zone = SpatialImager.zones[i];
			// Stred zóny
			var midAngle = -Math.PI * (1 - (zone.start + zone.end) / 2);
			var labelR = r * 0.85;
			const labelX = cx + Math.cos(midAngle) * labelR;
			const labelY = cy + Math.sin(midAngle) * labelR;

			ctx.fillStyle = '#777';
			ctx.font = 'bold 12px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText((i + 1).toString(), labelX, labelY);
		}

		if (typeof PlaybackManager !== 'undefined' && PlaybackManager.additiveSynths) {
			var instrumentsList = typeof DB !== 'undefined' ? DB.get('instruments') : [];

			for (const synth of PlaybackManager.additiveSynths) {
				if (synth.inUse && synth.noteKey !== null) {
					var amp = 0;
					try {
						amp = synth.gain.gain.value;
					} catch (e) {
						amp = 0;
					}

					if (amp > 0.001) {
						var pan = synth.currentPan !== undefined ? synth.currentPan : 0;
						var trackIdx = synth.trackIdx || 0;

						let trackVolume = 0.7;
						if (instrumentsList && instrumentsList[trackIdx]) {
							var volDb = instrumentsList[trackIdx].volume || -12;
							trackVolume = Math.max(0.15, Math.min(1, (volDb + 60) / 66));
						}

						// pan určuje uhol na polkruhu: -1 = PI (vľavo), 0 = PI/2 (stred), +1 = 0 (vpravo).
						const angle = Math.PI * (1 - (pan + 1) / 2);

						const logVolume = Math.pow(trackVolume, 2);
						var dotRadius = (1 - logVolume) * (r - 10);

						// Prevod na karteziánske súradnice, pričom Y sa odčíta, keďže Y plátna je obrátené.
						var dx = cx + Math.cos(angle) * dotRadius;
						var dy = cy - Math.sin(angle) * dotRadius;

						// Priesvitnosť podľa amplitúdy (obálka ADSR).
						var opacity = Math.min(1, amp / 0.08);

						// Vlastná farba stopy, rovnaká ako pri notách na plátne a pruhoch panelov.
						var color = instrumentsList?.[trackIdx]?.color || '#888';

						ctx.globalAlpha = opacity;
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.arc(dx, dy, 3, 0, Math.PI * 2);
						ctx.fill();
						ctx.globalAlpha = 1;
					}
				}
			}
		}

		for (let i = 0; i < SpatialImager.zones.length - 1; i++) {
			const pos = SpatialImager.zones[i].end;
			const angle = Math.PI * (1 - pos);
			var hx = cx + Math.cos(angle) * r;
			var hy = cy - Math.sin(angle) * r;

			ctx.fillStyle = '#ccc';
			ctx.beginPath();
			ctx.arc(hx, hy, 6, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = '#222';
			ctx.beginPath();
			ctx.arc(hx, hy, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = '#888';
		ctx.font = '11px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('L', cx - r, cy + 11);
		ctx.fillText('C', cx, cy + 11);
		ctx.fillText('R', cx + r, cy + 11);
	},

	_updateZonesList: () => {
		var list = document.querySelector('.spatial-imager-zones-list');
		if (!list) return;
		list.innerHTML = '';
		SpatialImager.zones.forEach((zone, i) => {
			var row = document.createElement('div');
			row.className = 'spatial-imager-zone-row';
			row.innerHTML = '<span class="spatial-imager-zone-num">' + (i + 1) + '</span>' +
				'<span class="spatial-imager-zone-output-label">OSC Device</span>' +
				'<input type="number" class="spatial-imager-zone-output" min="1" step="1" title="Sends this zone to the Nth device in the OSC Output list">' +
				'<button class="spatial-imager-zone-mute' + (zone.muted ? ' active' : '') + '" title="Mute zone">M</button>' +
				'<button class="spatial-imager-zone-solo' + (zone.soloed ? ' active' : '') + '" title="Solo zone">S</button>' +
				'<span class="spatial-imager-zone-range">' + Math.round((zone.start - 0.5) * 180) + '&deg; to ' + Math.round((zone.end - 0.5) * 180) + '&deg;</span>';

			var output = row.querySelector('.spatial-imager-zone-output');
			output.value = zone.output;
			output.addEventListener('change', () => {
				zone.output = Math.max(1, Math.floor(Number(output.value)) || 1);
				output.value = zone.output;
				SpatialImager._saveSettings();
			});

			row.querySelector('.spatial-imager-zone-mute').addEventListener('click', () => {
				zone.muted = !zone.muted;
				SpatialImager._updateZonesList();
				SpatialImager.draw();
				SpatialImager._saveSettings();
			});
			row.querySelector('.spatial-imager-zone-solo').addEventListener('click', () => {
				zone.soloed = !zone.soloed;
				SpatialImager._updateZonesList();
				SpatialImager.draw();
				SpatialImager._saveSettings();
			});

			list.appendChild(row);
		});
	},

	_saveSettings: () => {
		if (typeof DB !== 'undefined') {
			DB.set('spatialImager', { zones: SpatialImager.zones.map(z => ({
				start: z.start, end: z.end, output: z.output, muted: !!z.muted, soloed: !!z.soloed
			})) });
		}
	},

	loadSettings: (settings) => {
		if (!settings || !settings.zones) { SpatialImager.setZoneCount(1); return; }
		SpatialImager.zones = settings.zones.map((z, i) => {
			var output = z.output;
			var muted = !!z.muted;
			if (output === undefined) {
				var match = /^output(\d+)$/.exec(z.outputType || '');
				output = match ? parseInt(match[1]) : i + 1;
				muted = z.outputType === 'mute';
			}
			return {
				start: z.start, end: z.end,
				output: Math.max(1, output), muted: muted, soloed: !!z.soloed
			};
		});
		SpatialImager._updateZoneCountUI();
		SpatialImager.draw();
		SpatialImager._updateZonesList();
	},

	getZoneForPan: (pan) => {
		var pos = (pan + 1) / 2;
		for (let i = 0; i < SpatialImager.zones.length; i++) {
			if (pos >= SpatialImager.zones[i].start && pos < SpatialImager.zones[i].end) return i;
		}
		return SpatialImager.zones.length - 1;
	},

	isZoneSilent: (zone) => {
		if (!zone) return true;
		if (zone.muted) return true;
		return SpatialImager.zones.some(z => z.soloed) && !zone.soloed;
	},

	getOutputForPan: (pan) => {
		var zone = SpatialImager.zones[SpatialImager.getZoneForPan(pan)];
		if (SpatialImager.isZoneSilent(zone)) return 'mute';
		return 'output' + (zone.output || 1);
	}
};