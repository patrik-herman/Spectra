// OSC pre Spectru. Prenos sa koná skrz UDP, takže sysex cez MIDI je možný, avšak OSC sa nastavuje
// jednoduchšie a je spoľahlivejšie. Je nutné mať otvorené porty 9000 až 9002; ak ich sieť
// blokuje, pomôže mobilný hotspot. Ukážky sú v examples/.
var SpectraOSC = (function() {
	var log = (typeof Logger !== 'undefined' && Logger.log) ? Logger.log.bind(Logger) : function() {};
	var warn = (typeof Logger !== 'undefined' && Logger.warn) ? Logger.warn.bind(Logger) : function() {};
	var error = (typeof Logger !== 'undefined' && Logger.error) ? Logger.error.bind(Logger) : console.error.bind(console);

	var socket = null;
	var devices = [];
	var inputSelectedIds = [];
	var outputSelectedIds = [];
	var pairingKey = null;
	var pairingTimeout = null;
	var onDeviceChangeCallbacks = [];
	var enabled = false;
	var pairingModal = null;
	var deviceIdCounter = 0;
	var pendingDeleteId = null;
	var initialized = false;

	var selectedDevices = [];
	var inputDevices = [];
	var outputDevices = [];

	var messageQueue = [];
	var isConnecting = false;
	var maxQueueSize = 100;
	var queueFlushDelay = 50;
	var persistentQueueKey = 'spectra_osc_pending_messages';


	var connectionHealth = {
		lastActivity: 0,
		lastHeartbeat: 0,
		heartbeatInterval: null,
		heartbeatMs: 5000,
		staleThresholdMs: 15000,
		messagesSent: 0,
		messagesReceived: 0,
		messagesFailed: 0,
		reconnectAttempts: 0,
		maxReconnectAttempts: 10,
		isHealthy: true,
		latencyMs: 0,
		lastLatencyCheck: 0
	};

	var reconnectConfig = {
		enabled: false,
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 1.5,
		jitterMs: 500,
		currentDelay: 1000,
		reconnectTimer: null,
		isReconnecting: false
	};

	var retryConfig = {
		maxRetries: 3,
		retryDelayMs: 500,
		retryBackoff: 1.5,
		pendingRetries: new Map()
	};

	var throttleConfig = {
		enabled: true,
		maxMessagesPerSecond: 100,
		windowMs: 1000,
		messageTimestamps: [],
		throttledCount: 0,
		lastThrottleWarning: 0
	};


	function startHeartbeat() {
		stopHeartbeat();

		connectionHealth.heartbeatInterval = setInterval(() => {
			if (!socket || !socket.connected) {
				connectionHealth.isHealthy = false;
				updateConnectionStatusUI();
				return;
			}

			var now = Date.now();
			connectionHealth.lastHeartbeat = now;

			var timeSinceActivity = now - connectionHealth.lastActivity;
			if (connectionHealth.lastActivity > 0 && timeSinceActivity > connectionHealth.staleThresholdMs) {
				warn('SpectraOSC: Connection appears stale, no activity for', Math.round(timeSinceActivity / 1000), 'seconds');
				connectionHealth.isHealthy = false;
				updateConnectionStatusUI();
				return;
			}

			var pingStart = performance.now();
			socket.emit('osc-ping', { timestamp: now }, (response) => {
				var pingEnd = performance.now();
				connectionHealth.latencyMs = Math.round(pingEnd - pingStart);
				connectionHealth.lastLatencyCheck = now;
				connectionHealth.isHealthy = true;
				connectionHealth.messagesReceived++;
				recordActivity();
				updateConnectionStatusUI();
			});

			setTimeout(() => {
				if (Date.now() - connectionHealth.lastLatencyCheck > connectionHealth.heartbeatMs * 2) {
					connectionHealth.isHealthy = false;
					updateConnectionStatusUI();
				}
			}, connectionHealth.heartbeatMs);

		}, connectionHealth.heartbeatMs);

		log('SpectraOSC: Heartbeat monitoring started');
	}

	function stopHeartbeat() {
		if (connectionHealth.heartbeatInterval) {
			clearInterval(connectionHealth.heartbeatInterval);
			connectionHealth.heartbeatInterval = null;
		}
	}

	function recordActivity() {
		connectionHealth.lastActivity = Date.now();
	}

	function getConnectionHealth() {
		return {
			...connectionHealth,
			socketConnected: socket && socket.connected,
			queueSize: messageQueue.length,
			deviceCount: devices.length,
			connectedDevices: devices.filter(d => d.connected).length
		};
	}


	function scheduleReconnect() {
		if (!reconnectConfig.enabled) return;
		if (reconnectConfig.isReconnecting) return;
		if (connectionHealth.reconnectAttempts >= connectionHealth.maxReconnectAttempts) {
			error('SpectraOSC: Max reconnect attempts reached, giving up');
			if (typeof showStatus === 'function') {
				showStatus('OSC connection failed - please refresh the page', { type: 'error' });
			}
			return;
		}

		reconnectConfig.isReconnecting = true;
		connectionHealth.reconnectAttempts++;

		var jitter = Math.random() * reconnectConfig.jitterMs;
		var delay = Math.min(
			reconnectConfig.currentDelay + jitter,
			reconnectConfig.maxDelayMs
		);

		log(`SpectraOSC: Scheduling reconnect attempt ${connectionHealth.reconnectAttempts}/${connectionHealth.maxReconnectAttempts} in ${Math.round(delay)}ms`);

		if (typeof showStatus === 'function') {
			showStatus(`Reconnecting to OSC server... (attempt ${connectionHealth.reconnectAttempts})`, { type: 'info' });
		}

		reconnectConfig.reconnectTimer = setTimeout(() => {
			attemptReconnect();
		}, delay);

		reconnectConfig.currentDelay = Math.min(
			reconnectConfig.currentDelay * reconnectConfig.backoffMultiplier,
			reconnectConfig.maxDelayMs
		);
	}

	function attemptReconnect() {
		log('SpectraOSC: Attempting reconnection...');

		if (socket) {
			socket.removeAllListeners();
			socket.disconnect();
			socket = null;
		}

		isConnecting = false;
		reconnectConfig.isReconnecting = false;

		connectSocket();
	}

	function resetReconnectState() {
		reconnectConfig.currentDelay = reconnectConfig.baseDelayMs;
		reconnectConfig.isReconnecting = false;
		connectionHealth.reconnectAttempts = 0;

		if (reconnectConfig.reconnectTimer) {
			clearTimeout(reconnectConfig.reconnectTimer);
			reconnectConfig.reconnectTimer = null;
		}
	}

	function reconnectDevice(deviceId) {
		var device = devices.find(d => d.id === deviceId);
		if (!device) return;

		log('SpectraOSC: Attempting to reconnect device:', device.name);

		device.awaitingReconnect = true;
		device.reconnectAttempts = (device.reconnectAttempts || 0) + 1;

		if (socket && socket.connected && device.code) {
			socket.emit('osc-await-device', { code: device.code });
		}

		if (typeof showStatus === 'function') {
			showStatus(`Waiting for ${device.name} to reconnect...`, { type: 'info' });
		}
	}


	function savePendingMessages() {
		if (messageQueue.length === 0) {
			try {
				localStorage.removeItem(persistentQueueKey);
			} catch (e) {}
			return;
		}

		try {
			var criticalMessages = messageQueue.filter(msg =>
				msg.address && (
					msg.address.includes('/playback') ||
					msg.address.includes('/transport') ||
					msg.address.includes('/tempo') ||
					msg.address.includes('/instrument')
				)
			);

			if (criticalMessages.length > 0) {
				localStorage.setItem(persistentQueueKey, JSON.stringify({
					timestamp: Date.now(),
					messages: criticalMessages.slice(0, 20)
				}));
			}
		} catch (e) {
			warn('SpectraOSC: Failed to save pending messages:', e);
		}
	}

	function loadPendingMessages() {
		try {
			var saved = localStorage.getItem(persistentQueueKey);
			if (!saved) return;

			var data = JSON.parse(saved);
			var age = Date.now() - data.timestamp;

			if (age > 30000) {
				localStorage.removeItem(persistentQueueKey);
				return;
			}

			if (data.messages && data.messages.length > 0) {
				log('SpectraOSC: Restoring', data.messages.length, 'pending messages');
				messageQueue = [...data.messages, ...messageQueue];
			}

			localStorage.removeItem(persistentQueueKey);
		} catch (e) {
			warn('SpectraOSC: Failed to load pending messages:', e);
		}
	}


	function checkThrottle() {
		if (!throttleConfig.enabled) return true;

		var now = Date.now();

		throttleConfig.messageTimestamps = throttleConfig.messageTimestamps.filter(
			ts => now - ts < throttleConfig.windowMs
		);

		if (throttleConfig.messageTimestamps.length >= throttleConfig.maxMessagesPerSecond) {
			throttleConfig.throttledCount++;

			if (now - throttleConfig.lastThrottleWarning > 5000) {
				throttleConfig.lastThrottleWarning = now;
				warn(`SpectraOSC: Throttling messages (${throttleConfig.throttledCount} throttled)`);
			}
			return false;
		}

		throttleConfig.messageTimestamps.push(now);
		return true;
	}

	function getThrottleStatus() {
		return {
			enabled: throttleConfig.enabled,
			currentRate: throttleConfig.messageTimestamps.length,
			maxRate: throttleConfig.maxMessagesPerSecond,
			throttledCount: throttleConfig.throttledCount
		};
	}


	var messageIdCounter = 0;

	function sendWithRetry(message, options = {}) {
		return new Promise((resolve, reject) => {
			var messageId = ++messageIdCounter;
			var maxRetries = options.maxRetries ?? retryConfig.maxRetries;
			var baseDelay = options.retryDelayMs ?? retryConfig.retryDelayMs;

			var retryState = {
				messageId,
				message,
				attempts: 0,
				maxRetries,
				baseDelay,
				resolve,
				reject
			};

			retryConfig.pendingRetries.set(messageId, retryState);
			attemptSend(retryState);
		});
	}

	function attemptSend(retryState) {
		retryState.attempts++;

		if (!socket || !socket.connected) {
			if (messageQueue.length < maxQueueSize) {
				messageQueue.push(retryState.message);
				savePendingMessages();
			}
			retryConfig.pendingRetries.delete(retryState.messageId);
			retryState.resolve({ queued: true });
			return;
		}

		if (!checkThrottle()) {
			setTimeout(() => attemptSend(retryState), 100);
			return;
		}

		try {
			socket.emit('osc-send', retryState.message, (ack) => {
				if (ack && ack.success) {
					connectionHealth.messagesSent++;
					recordActivity();
					retryConfig.pendingRetries.delete(retryState.messageId);
					retryState.resolve({ sent: true });
				} else if (retryState.attempts < retryState.maxRetries) {
					var delay = retryState.baseDelay * Math.pow(retryConfig.retryBackoff, retryState.attempts - 1);
					log(`SpectraOSC: Retrying message (attempt ${retryState.attempts + 1}/${retryState.maxRetries}) in ${delay}ms`);
					setTimeout(() => attemptSend(retryState), delay);
				} else {
					connectionHealth.messagesFailed++;
					retryConfig.pendingRetries.delete(retryState.messageId);
					retryState.reject(new Error('Message failed after ' + retryState.maxRetries + ' attempts'));
				}
			});

			setTimeout(() => {
				if (retryConfig.pendingRetries.has(retryState.messageId)) {
					connectionHealth.messagesSent++;
					recordActivity();
					retryConfig.pendingRetries.delete(retryState.messageId);
					retryState.resolve({ sent: true, noAck: true });
				}
			}, 2000);

		} catch (err) {
			error('SpectraOSC: Send error:', err);
			if (retryState.attempts < retryState.maxRetries) {
				var delay = retryState.baseDelay * Math.pow(retryConfig.retryBackoff, retryState.attempts - 1);
				setTimeout(() => attemptSend(retryState), delay);
			} else {
				connectionHealth.messagesFailed++;
				retryConfig.pendingRetries.delete(retryState.messageId);
				retryState.reject(err);
			}
		}
	}


	function updateConnectionStatusUI() {
		var statusDot = document.querySelector('.osc-connection-status');
		var statusText = document.querySelector('.osc-connection-text');
		var healthPanel = document.querySelector('.osc-health-panel');

		var isConnected = socket && socket.connected;
		var isHealthy = connectionHealth.isHealthy;

		if (statusDot) {
			if (!isConnected) {
				statusDot.style.background = '#a44';
				statusDot.title = 'Disconnected';
			} else if (!isHealthy) {
				statusDot.style.background = '#a84';
				statusDot.title = 'Connection unstable';
			} else {
				statusDot.style.background = '#4a4';
				statusDot.title = `Connected (${connectionHealth.latencyMs}ms latency)`;
			}
		}

		if (statusText) {
			if (!isConnected) {
				statusText.textContent = reconnectConfig.isReconnecting
					? `Reconnecting (${connectionHealth.reconnectAttempts}/${connectionHealth.maxReconnectAttempts})...`
					: 'Disconnected';
			} else if (!isHealthy) {
				statusText.textContent = 'Connection unstable';
			} else {
				var latencyStr = connectionHealth.latencyMs > 0 ? ` (${connectionHealth.latencyMs}ms)` : '';
				statusText.textContent = `Connected${latencyStr}`;
			}
		}

		if (healthPanel) {
			healthPanel.innerHTML = `
				<div style="font-size: 11px; color: #888;">
					<div>Latency: ${connectionHealth.latencyMs}ms</div>
					<div>Sent: ${connectionHealth.messagesSent} | Failed: ${connectionHealth.messagesFailed}</div>
					<div>Queue: ${messageQueue.length}/${maxQueueSize}</div>
					${throttleConfig.throttledCount > 0 ? `<div style="color: #a84;">Throttled: ${throttleConfig.throttledCount}</div>` : ''}
				</div>
			`;
		}

		updateDeviceStatuses();
	}


	function resolveKeyByName(map, nameOrKey) {
		if (!map || typeof nameOrKey !== 'string') return null;
		if (map[nameOrKey]) return nameOrKey;
		var lower = nameOrKey.toLowerCase();
		for (var k in map) {
			if (map[k] && typeof map[k].name === 'string' && map[k].name.toLowerCase() === lower) return k;
		}
		return null;
	}

	function registerIncomingHandlers() {
		onMessage('/spectra/transport/start', (address, args) => {
			var playing = args[0];
			if (typeof playback === 'undefined' || typeof playbackUIPlay === 'undefined') return;

			var shouldPlay = playing === 1 || playing === true;

			if (shouldPlay && !playback.playing) {
				playback.playing = true;
				playbackUIPlay.dataset.playing = true;
				playback.timestamp = Date.now();
				playback.timeOld = playback.time;
				const icon = playbackUIPlay.querySelector('i');
				if (icon) {
					icon.classList.remove('fa-play');
					icon.classList.add('fa-pause');
				}
				if (typeof WebMIDI !== 'undefined' && WebMIDI.transportSync?.enabled && typeof WebMIDI.sendStart === 'function') {
					WebMIDI.sendStart();
				}
			} else if (!shouldPlay && playback.playing) {
				playback.playing = false;
				playbackUIPlay.dataset.playing = false;
				const icon = playbackUIPlay.querySelector('i');
				if (icon) {
					icon.classList.remove('fa-pause');
					icon.classList.add('fa-play');
				}
				if (playbackUIPlay.dataset.type === 'return') {
					playback.time = playback.timeOld;
				}
				if (typeof WebMIDI !== 'undefined' && WebMIDI.transportSync?.enabled && typeof WebMIDI.sendStop === 'function') {
					WebMIDI.sendStop();
				}
			}
		});

		onMessage('/spectra/transport/position', (address, args) => {
			var position = args[0];
			if (typeof playback === 'undefined') return;

			if (typeof position === 'number' && !isNaN(position)) {
				playback.time = Math.max(0, position);
				playback.midiTime = playback.time;
			}
		});

		onMessage('/spectra/transport/loop', (address, args) => {
			if (typeof Spectra === 'undefined' || Spectra.edition !== 'full') return;
			var enabled = args[0];
			if (typeof playback === 'undefined') return;

			var loopCheckbox = document.getElementById('playback-loop');

			if (enabled === 1 || enabled === true) {
				var start = args[1];
				var end = args[2];
				if (typeof start === 'number' && typeof end === 'number' && end > start) {
					playback.loopStart = Math.max(0, start);
					playback.loopEnd = end;
					if (loopCheckbox) loopCheckbox.checked = true;
				}
			} else {
				playback.loopStart = null;
				playback.loopEnd = null;
				if (loopCheckbox) loopCheckbox.checked = false;
			}
		});

		onMessage('/spectra/transport/speed', (address, args) => {
			var speed = args[0];
			if (typeof speed === 'number' && speed > 0 && speed <= 10) {
				if (typeof settings !== 'undefined') {
					settings.playbackSpeed = speed;
					if (typeof DB !== 'undefined') DB.set('settings', settings);
					var speedInput = document.querySelector('.playback-speed-input');
					if (speedInput) speedInput.value = speed;
					if (typeof updateSpeedPresetButtons === 'function') updateSpeedPresetButtons(speed);
				}
			}
		});

		onMessage('/spectra/note/on', (address, args) => {
			var pitch = args[0];
			var velocity = args[1] !== undefined ? args[1] : 100;
			var track = args[2] !== undefined ? args[2] : 0;

			if (pitch === undefined) return;

			if (typeof WebMIDI !== 'undefined' && typeof WebMIDI.onNoteOn === 'function') {
				WebMIDI.onNoteOn(Math.round(pitch), Math.round(velocity), track);
			}
			if (typeof WebMIDI !== 'undefined' && typeof WebMIDI.noteOn === 'function') {
				WebMIDI.noteOn(Math.round(pitch), Math.round(velocity));
			}
		});

		onMessage('/spectra/note/off', (address, args) => {
			var pitch = args[0];
			var track = args[1] !== undefined ? args[1] : 0;

			if (pitch === undefined) return;

			if (typeof WebMIDI !== 'undefined' && typeof WebMIDI.onNoteOff === 'function') {
				WebMIDI.onNoteOff(Math.round(pitch), track);
			}
			if (typeof WebMIDI !== 'undefined' && typeof WebMIDI.noteOff === 'function') {
				WebMIDI.noteOff(Math.round(pitch));
			}
		});

		onMessage('/spectra/transport/record', (address, args) => {
			var enabled = args[0];
			if (typeof window.midiRecording === 'undefined') return;

			var shouldRecord = enabled === 1 || enabled === true;
			var isRecording = window.midiRecording.active;

			if (shouldRecord && !isRecording) {
				window.midiRecording.start();
				const recordBtn = document.querySelector('.playback-record-button');
				if (recordBtn) recordBtn.classList.add('recording');
			} else if (!shouldRecord && isRecording) {
				window.midiRecording.stop();
				const recordBtn = document.querySelector('.playback-record-button');
				if (recordBtn) recordBtn.classList.remove('recording');
			}
		});

		onMessage('/spectra/write/note/create', (address, args) => {
			var time = args[0];
			var pitch = args[1];
			var duration = args[2] !== undefined ? args[2] : 1;
			var track = args[3] !== undefined ? args[3] : 0;
			var partial = args[4] !== undefined ? args[4] : 1;

			if (typeof time !== 'number' || typeof pitch !== 'number') return;
			if (typeof MIDI === 'undefined' || !MIDI.data) return;

			if (track < 0 || track >= MIDI.data.length) return;

			var note = [time, duration, pitch, partial, {}, false, 0, false];
			MIDI.data[track].push(note);
		});

		onMessage('/spectra/write/note/delete', (address, args) => {
			var time = args[0];
			var pitch = args[1];
			var track = args[2] !== undefined ? args[2] : 0;

			Logger.log('[OSC] note/delete args:', args, '-> time:', time, 'pitch:', pitch, 'track:', track);

			if (typeof time !== 'number' || typeof pitch !== 'number') {
				Logger.log('[OSC] note/delete: invalid time or pitch type');
				return;
			}
			if (typeof MIDI === 'undefined' || !MIDI.data) {
				Logger.log('[OSC] note/delete: MIDI.data not available');
				return;
			}
			if (track < 0 || track >= MIDI.data.length) {
				Logger.log('[OSC] note/delete: track out of range', track, 'max:', MIDI.data.length);
				return;
			}

			var trackData = MIDI.data[track];
			Logger.log('[OSC] note/delete: searching in track', track, 'with', trackData.length, 'notes');

			var TOL = 0.001;
			var bestIdx = -1, bestDist = Infinity;
			for (let i = 0; i < trackData.length; i++) {
				var note = trackData[i];
				var dt = Math.abs(note[0] - time);
				var dp = Math.abs(note[2] - pitch);
				if (dt < TOL && dp < TOL && (dt + dp) < bestDist) {
					bestDist = dt + dp;
					bestIdx = i;
				}
			}
			if (bestIdx >= 0) {
				trackData.splice(bestIdx, 1);
				Logger.log('[OSC] note/delete: DELETED note at index', bestIdx);
			} else {
				Logger.log('[OSC] note/delete: no matching note found');
			}
		});

		onMessage('/spectra/write/track/select', (address, args) => {
			var id = args[0];
			if (typeof id !== 'number') return;
			if (typeof instruments === 'undefined') return;
			if (id < 0 || id >= instruments.length) return;

			if (typeof clickPaneInstrument === 'function') {
				var paneInstrument = document.querySelectorAll('.pane-content .pane-instrument')[id];
				if (paneInstrument) {
					clickPaneInstrument(paneInstrument);
					return;
				}
			}

			window.primaryTrackIndex = id;

			for (let i = 0; i < instruments.length; i++) {
				instruments[i].selected = (i === id);
			}

			var paneInstruments = document.querySelectorAll('.pane-content .pane-instrument');
			paneInstruments.forEach((el, idx) => {
				el.classList.toggle('selected', idx === id);
				el.classList.toggle('primary', idx === id);
			});
		});

		onMessage('/spectra/write/track/instrument', (address, args) => {
			var id = args[0];
			var spectrumKey = resolveKeyByName(window.spectra, args[1]);
			if (typeof id !== 'number' || !spectrumKey) return;
			if (typeof instruments === 'undefined') return;
			if (id < 0 || id >= instruments.length) return;

			instruments[id].spectrum = spectrumKey;
			if (typeof DB !== 'undefined') DB.set('instruments', instruments);

			var paneInstruments = document.querySelectorAll('.pane-content .pane-instrument');
			if (paneInstruments[id]) {
				var dropdown = paneInstruments[id].querySelector('.pane-instrument-spectrum');
				if (dropdown) dropdown.value = spectrumKey;
			}
		});

		onMessage('/spectra/write/track/name', (address, args) => {
			var id = args[0];
			var name = args[1];
			if (typeof id !== 'number' || typeof name !== 'string') return;
			if (typeof instruments === 'undefined') return;
			if (id < 0 || id >= instruments.length) return;

			instruments[id].name = name;
			if (typeof DB !== 'undefined') DB.set('instruments', instruments);

			var paneInstruments = document.querySelectorAll('.pane-content .pane-instrument');
			if (paneInstruments[id]) {
				var nameEl = paneInstruments[id].querySelector('.pane-instrument-name');
				if (nameEl) nameEl.value = name;
			}
		});

		onMessage('/spectra/write/tuning/add', (address, args) => {
			var track = args[0];
			var time = args[1];
			var tuningKey = resolveKeyByName(window.scales, args[2]);
			var isGlobal = (typeof Spectra !== 'undefined' && Spectra.edition !== 'full') ? true : (args[3] === 1 || args[3] === true);

			if (typeof track !== 'number' || typeof time !== 'number' || !tuningKey) return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.tuningChanges) return;

			var existing = events.tuningChanges.find(tc => Math.abs(tc.time - time) < 0.001);
			if (!existing) {
				events.tuningChanges.push({ time, tuningKey, global: isGlobal });
				events.tuningChanges.sort((a, b) => a.time - b.time);
				Timeline.saveTrackEvents(track, events);
				if (Timeline.draw) Timeline.draw();
			}
		});

		onMessage('/spectra/write/tuning/remove', (address, args) => {
			var track = args[0];
			var time = args[1];

			if (typeof track !== 'number' || typeof time !== 'number') return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.tuningChanges) return;

			var idx = events.tuningChanges.findIndex(tc => Math.abs(tc.time - time) < 0.001);
			if (idx !== -1) {
				events.tuningChanges.splice(idx, 1);
				Timeline.saveTrackEvents(track, events);
				if (Timeline.draw) Timeline.draw();
			}
		});

		onMessage('/spectra/write/tuning/change', (address, args) => {
			var track = args[0];
			var time = args[1];
			var tuningKey = resolveKeyByName(window.scales, args[2]);
			var isGlobal = (typeof Spectra !== 'undefined' && Spectra.edition !== 'full') ? true : (args[3] === 1 || args[3] === true);

			if (typeof track !== 'number' || typeof time !== 'number' || !tuningKey) return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.tuningChanges) return;

			var existing = events.tuningChanges.find(tc => Math.abs(tc.time - time) < 0.001);
			if (existing) {
				existing.tuningKey = tuningKey;
				existing.global = isGlobal;
			} else {
				events.tuningChanges.push({ time, tuningKey, global: isGlobal });
				events.tuningChanges.sort((a, b) => a.time - b.time);
			}
			Timeline.saveTrackEvents(track, events);
			if (Timeline.draw) Timeline.draw();
		});

		onMessage('/spectra/write/grid/add', (address, args) => {
			var track = args[0];
			var time = args[1];
			var gridKey = resolveKeyByName(window.grids, args[2]);
			var isGlobal = (typeof Spectra !== 'undefined' && Spectra.edition !== 'full') ? true : (args[3] === 1 || args[3] === true);

			if (typeof track !== 'number' || typeof time !== 'number' || !gridKey) return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.gridChanges) return;

			var existing = events.gridChanges.find(gc => Math.abs(gc.time - time) < 0.001);
			if (!existing) {
				events.gridChanges.push({ time, gridKey, global: isGlobal });
				events.gridChanges.sort((a, b) => a.time - b.time);
				Timeline.saveTrackEvents(track, events);
				if (typeof GridSystem !== 'undefined' && GridSystem.invalidateCache) GridSystem.invalidateCache();
				if (Timeline.draw) Timeline.draw();
			}
		});

		onMessage('/spectra/write/grid/remove', (address, args) => {
			var track = args[0];
			var time = args[1];

			if (typeof track !== 'number' || typeof time !== 'number') return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.gridChanges) return;

			var idx = events.gridChanges.findIndex(gc => Math.abs(gc.time - time) < 0.001);
			if (idx !== -1) {
				events.gridChanges.splice(idx, 1);
				Timeline.saveTrackEvents(track, events);
				if (typeof GridSystem !== 'undefined' && GridSystem.invalidateCache) GridSystem.invalidateCache();
				if (Timeline.draw) Timeline.draw();
			}
		});

		onMessage('/spectra/write/grid/change', (address, args) => {
			var track = args[0];
			var time = args[1];
			var gridKey = resolveKeyByName(window.grids, args[2]);
			var isGlobal = (typeof Spectra !== 'undefined' && Spectra.edition !== 'full') ? true : (args[3] === 1 || args[3] === true);

			if (typeof track !== 'number' || typeof time !== 'number' || !gridKey) return;
			if (typeof Timeline === 'undefined' || !Timeline.getTrackEvents) return;

			var events = Timeline.getTrackEvents(track);
			if (!events || !events.gridChanges) return;

			var existing = events.gridChanges.find(gc => Math.abs(gc.time - time) < 0.001);
			if (existing) {
				existing.gridKey = gridKey;
				existing.global = isGlobal;
			} else {
				events.gridChanges.push({ time, gridKey, global: isGlobal });
				events.gridChanges.sort((a, b) => a.time - b.time);
			}
			Timeline.saveTrackEvents(track, events);
			if (typeof GridSystem !== 'undefined' && GridSystem.invalidateCache) GridSystem.invalidateCache();
			if (Timeline.draw) Timeline.draw();
		});
	}


	function init() {
		if (initialized) return;
		initialized = true;

		log('SpectraOSC initializing...');

		loadSettings();

		loadPendingMessages();

		createPairingModal();

		enabled = (inputDevices.length > 0 || outputDevices.length > 0);

		setupAddDeviceModal();

		setupDeleteModal();

		setupSelectHandlers();

		setupNetworkDiscoveryUI();

		registerIncomingHandlers();

		if (hasNativeOsc()) {
			initNativeOscServer();
		}

		if (enabled) {
			connectSocket();
		} else {
			log('SpectraOSC: No devices configured, skipping auto-connect');
		}

		window.addEventListener('beforeunload', () => {
			savePendingMessages();
			stopHeartbeat();
		});
	}


	var networkDiscoveryUnsubscribe = null;
	var isNetworkScanning = false;

	function isElectron() {
		return typeof window !== 'undefined' &&
			   window.electronAPI &&
			   window.electronAPI.isElectron === true;
	}

	function hasNativeOsc() {
		return typeof window !== 'undefined' &&
			   window.electronAPI &&
			   typeof window.electronAPI.oscStartServer === 'function';
	}

	function hasNetworkDiscovery() {
		return typeof window !== 'undefined' &&
			   window.electronAPI &&
			   typeof window.electronAPI.networkQuickScan === 'function';
	}

	async function getLocalNetworkInfo() {
		if (!hasNetworkDiscovery()) return null;
		try {
			return await window.electronAPI.networkGetLocalInfo();
		} catch (e) {
			error('Failed to get local network info:', e);
			return null;
		}
	}

	async function scanNetworkQuick() {
		if (!hasNetworkDiscovery()) return { success: false, error: 'Not in Electron' };
		if (isNetworkScanning) return { success: false, error: 'Already scanning' };

		isNetworkScanning = true;
		updateNetworkScanUI(true);

		try {
			var result = await window.electronAPI.networkQuickScan();
			isNetworkScanning = false;
			updateNetworkScanUI(false);
			updateDiscoveredDevicesUI(result.devices || []);
			return result;
		} catch (e) {
			isNetworkScanning = false;
			updateNetworkScanUI(false);
			return { success: false, error: e.message };
		}
	}

	async function scanNetworkFull(options = {}) {
		if (!hasNetworkDiscovery()) return { success: false, error: 'Not in Electron' };
		if (isNetworkScanning) return { success: false, error: 'Already scanning' };

		isNetworkScanning = true;
		updateNetworkScanUI(true);

		try {
			var result = await window.electronAPI.networkFullScan(options);
			isNetworkScanning = false;
			updateNetworkScanUI(false);
			updateDiscoveredDevicesUI(result.devices || []);
			return result;
		} catch (e) {
			isNetworkScanning = false;
			updateNetworkScanUI(false);
			return { success: false, error: e.message };
		}
	}

	function startNetworkDiscoveryStream() {
		if (!hasNetworkDiscovery()) return;

		if (networkDiscoveryUnsubscribe) {
			networkDiscoveryUnsubscribe();
		}

		window.electronAPI.networkStartDiscoveryStream();

		networkDiscoveryUnsubscribe = window.electronAPI.onNetworkDeviceDiscovered((device) => {
			log('Network device discovered:', device);
			addDiscoveredDeviceToUI(device);
		});
	}

	function stopNetworkDiscoveryStream() {
		if (!hasNetworkDiscovery()) return;

		if (networkDiscoveryUnsubscribe) {
			networkDiscoveryUnsubscribe();
			networkDiscoveryUnsubscribe = null;
		}

		window.electronAPI.networkStopDiscoveryStream();
	}


	var nativeOscServerStarted = false;
	var nativeOscMessageUnsubscribe = null;

	async function initNativeOscServer() {
		if (!hasNativeOsc() || nativeOscServerStarted) return;

		try {
			var result = await window.electronAPI.oscStartServer();
			if (result.success) {
				nativeOscServerStarted = true;
				log('Native OSC UDP server started on port', result.port);

				nativeOscMessageUnsubscribe = window.electronAPI.onOscMessage(handleNativeOscMessage);
			} else {
				error('Failed to start native OSC server:', result.error);
			}
		} catch (err) {
			error('Native OSC server init error:', err);
		}
	}

	function handleNativeOscMessage(message) {
		log('OSC received:', message.address, message.args);

		var args = message.args.map(arg => arg.value !== undefined ? arg.value : arg);

		processIncomingOscMessage(message.address, args, message.from);
	}

	function processIncomingOscMessage(address, args, source) {
		var matchedHandlers = [];
		for (const [pattern, callbacks] of Object.entries(messageHandlers)) {
			if (oscAddressMatch(pattern, address)) {
				callbacks.forEach(cb => matchedHandlers.push(() => cb(address, args, source)));
			}
		}

		matchedHandlers.forEach(fn => {
			try { fn(); } catch (e) { error('OSC handler error:', e); }
		});

		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('osc-message', {
				detail: { address, args, source }
			}));
		}
	}

	async function sendNativeOsc(deviceId, address, args) {
		if (!hasNativeOsc()) return { success: false, error: 'Not in Electron' };

		try {
			var oscArgs = args.map(arg => {
				if (typeof arg === 'number') {
					return Number.isInteger(arg) ? { type: 'i', value: arg } : { type: 'f', value: arg };
				}
				if (typeof arg === 'string') return { type: 's', value: arg };
				if (typeof arg === 'boolean') return { type: arg ? 'T' : 'F', value: arg };
				return { type: 's', value: String(arg) };
			});

			return await window.electronAPI.oscSend(deviceId, address, oscArgs);
		} catch (err) {
			error('Native OSC send error:', err);
			return { success: false, error: err.message };
		}
	}

	function oscAddressMatch(pattern, address) {
		if (pattern === '*' || pattern === address) return true;

		var regex = new RegExp('^' + pattern
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '.')
			.replace(/\[!/g, '[^')
			+ '$');

		return regex.test(address);
	}

	var messageHandlers = {};

	function onMessage(pattern, callback) {
		if (!messageHandlers[pattern]) {
			messageHandlers[pattern] = [];
		}
		messageHandlers[pattern].push(callback);

		return () => {
			var idx = messageHandlers[pattern].indexOf(callback);
			if (idx >= 0) messageHandlers[pattern].splice(idx, 1);
		};
	}

	function updateNetworkScanUI(isScanning) {
		var scanBtn = document.querySelector('.osc-network-scan-btn');
		if (scanBtn) {
			scanBtn.disabled = isScanning;
			scanBtn.textContent = isScanning ? 'Scanning...' : 'Scan Network';
		}
	}

	function updateDiscoveredDevicesUI(discoveredDevices) {
		var container = document.querySelector('.osc-discovered-devices');
		if (!container) return;

		if (discoveredDevices.length === 0) {
			container.innerHTML = '<div class="osc-no-devices" style="color: #666; font-size: 12px; padding: 8px 0;">No devices found on network</div>';
			return;
		}

		container.innerHTML = discoveredDevices.map(device => {
			var port = device.port || 9002;
			var name = sanitizeDeviceName(device.name);
			return `
			<div class="osc-discovered-device" data-host="${device.host}" data-port="${port}" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; margin: 4px 0; background: #181818; ">
				<div class="osc-discovered-device-info" style="flex: 1; min-width: 0;">
					<span class="osc-discovered-device-name" style="color: #fff; font-weight: 500; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
					<span class="osc-discovered-device-addr" style="color: #6a6; font-size: 11px; font-family: monospace;">${device.host}:${port}</span>
					<span class="osc-discovered-device-source" style="color: #666; font-size: 10px; margin-left: 8px;">${device.source || ''}</span>
				</div>
				<button class="osc-discovered-device-add" title="Add this device" style="padding: 8px 14px; background: #262626; border: none; color: #999; cursor: pointer; font-size: 12px; margin-left: 10px;">Add</button>
			</div>
		`}).join('');

		container.querySelectorAll('.osc-discovered-device-add').forEach(btn => {
			btn.addEventListener('click', (e) => {
				var deviceEl = e.target.closest('.osc-discovered-device');
				var host = deviceEl.dataset.host;
				var port = parseInt(deviceEl.dataset.port);
				var rawName = deviceEl.querySelector('.osc-discovered-device-name').textContent;
				var name = sanitizeDeviceName(rawName);

				addUDPDevice(name, 'both', host, port);

				if (typeof showStatus === 'function') {
					showStatus(`Added ${name} (${host}:${port})`, { type: 'success' });
				}

				deviceEl.remove();
			});
		});
	}

	function addDiscoveredDeviceToUI(device) {
		var container = document.querySelector('.osc-discovered-devices');
		if (!container) return;

		var port = device.port || 9002;
		var name = sanitizeDeviceName(device.name);

		var noDevices = container.querySelector('.osc-no-devices');
		if (noDevices) noDevices.remove();

		var existing = container.querySelector(`[data-host="${device.host}"][data-port="${port}"]`);
		if (existing) return;

		var deviceEl = document.createElement('div');
		deviceEl.className = 'osc-discovered-device';
		deviceEl.dataset.host = device.host;
		deviceEl.dataset.port = port;
		deviceEl.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; margin: 4px 0; background: #181818; ';
		deviceEl.innerHTML = `
			<div class="osc-discovered-device-info" style="flex: 1; min-width: 0;">
				<span class="osc-discovered-device-name" style="color: #fff; font-weight: 500; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
				<span class="osc-discovered-device-addr" style="color: #6a6; font-size: 11px; font-family: monospace;">${device.host}:${port}</span>
				<span class="osc-discovered-device-source" style="color: #666; font-size: 10px; margin-left: 8px;">${device.source || ''}</span>
			</div>
			<button class="osc-discovered-device-add" title="Add this device" style="padding: 8px 14px; background: #262626; border: none; color: #999; cursor: pointer; font-size: 12px; margin-left: 10px;">Add</button>
		`;

		deviceEl.querySelector('.osc-discovered-device-add').addEventListener('click', () => {
			addUDPDevice(name, 'both', device.host, port);
			if (typeof showStatus === 'function') {
				showStatus(`Added ${name} (${device.host}:${port})`, { type: 'success' });
			}
			deviceEl.remove();
		});

		container.appendChild(deviceEl);
	}

	function setupNetworkDiscoveryUI() {
		if (!hasNetworkDiscovery()) return;

		var scanBtn = document.querySelector('.osc-network-scan-btn');
		var fullScanBtn = document.querySelector('.osc-network-full-scan-btn');

		if (scanBtn) {
			scanBtn.addEventListener('click', async () => {
				var result = await scanNetworkQuick();
				if (!result.success && result.error) {
					warn('Network scan failed:', result.error);
					if (typeof showStatus === 'function') {
						showStatus('Network scan failed: ' + result.error, { type: 'error' });
					}
				} else if (result.devices && result.devices.length === 0) {
					if (typeof showStatus === 'function') {
						showStatus('No OSC devices found on network', { type: 'info' });
					}
				} else if (result.devices) {
					if (typeof showStatus === 'function') {
						showStatus(`Found ${result.devices.length} device(s) on network`, { type: 'success' });
					}
				}
			});
		}

		if (fullScanBtn) {
			fullScanBtn.addEventListener('click', async () => {
				var result = await scanNetworkFull({ fullSubnetScan: false });
				if (!result.success && result.error) {
					warn('Full network scan failed:', result.error);
				}
			});
		}

		var discoverySection = document.querySelector('.osc-network-discovery');
		if (discoverySection) {
			discoverySection.style.display = 'block';

			displayLocalNetworkInfo();
		}
	}

	async function displayLocalNetworkInfo() {
		var infoEl = document.querySelector('.osc-local-info');
		if (!infoEl) return;

		var info = await getLocalNetworkInfo();
		if (!info) {
			infoEl.innerHTML = '';
			return;
		}

		var networks = info.networks || [];
		if (networks.length === 0) {
			infoEl.innerHTML = '<span style="color: #a88;">No network interfaces found</span>';
			return;
		}

		var networkList = networks.map(n =>
			`<span style="color: #6a6;">${n.address}</span> <span style="color: #666;">(${n.interface})</span>`
		).join(' &nbsp;|&nbsp; ');

		infoEl.innerHTML = `Your IP: ${networkList}`;
	}


	function setupAddDeviceModal() {
		var addBtn = document.querySelector('.osc-add-device-btn');
		var modal = document.querySelector('.osc-add-device-modal');

		var cancelBtn = modal?.querySelector('.osc-modal-cancel');
		var addDeviceBtn = modal?.querySelector('.osc-modal-add');
		var typeSelect = modal?.querySelector('.osc-device-type');
		var typeSelectContainer = typeSelect?.closest('.osc-modal-config');
		var udpConfig = modal?.querySelector('.osc-modal-udp-config');
		var wsConfig = modal?.querySelector('.osc-modal-ws-config');
		var generateCodeBtn = modal?.querySelector('.osc-modal-generate-code');
		var pairingCodeDisplay = modal?.querySelector('.osc-modal-pairing-code');
		var codeTimerDisplay = modal?.querySelector('.osc-modal-code-timer');

		var inElectron = isElectron();
		var udpNote = modal?.querySelector('.osc-modal-udp-note');

		if (inElectron) {
			if (wsConfig) wsConfig.style.display = 'none';
			if (udpConfig) udpConfig.style.display = 'block';
			if (typeSelect) typeSelect.value = 'udp';
		} else {
			if (wsConfig) wsConfig.style.display = 'block';
			if (udpConfig) udpConfig.style.display = 'none';
			if (typeSelect) typeSelect.value = 'websocket';
		}

		if (addBtn) {
			addBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				var m = document.querySelector('.osc-add-device-modal');
				if (m) {
					m.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; right: 0; bottom: 0; align-items: center; justify-content: center; background: #030303b3; z-index: 10002;';

					if (inElectron) {
						const udp = m.querySelector('.osc-modal-udp-config');
						const ws = m.querySelector('.osc-modal-ws-config');
						if (udp) udp.style.display = 'block';
						if (ws) ws.style.display = 'none';
					} else {
						const udp = m.querySelector('.osc-modal-udp-config');
						const ws = m.querySelector('.osc-modal-ws-config');
						if (udp) udp.style.display = 'none';
						if (ws) ws.style.display = 'block';
						var codeEl = m.querySelector('.osc-modal-pairing-code');
						var timerEl = m.querySelector('.osc-modal-code-timer');
						if (codeEl) codeEl.textContent = '------';
						if (timerEl) timerEl.textContent = '';
					}
				}
			});
		}

		if (!modal) return;

		if (cancelBtn) {
			cancelBtn.addEventListener('click', () => {
				modal.style.display = 'none';
				pendingDevice = null;
				cancelPairing();
			});
		}

		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.style.display = 'none';
				pendingDevice = null;
				cancelPairing();
			}
		});

		if (typeSelect && !inElectron) {
			typeSelect.addEventListener('change', () => {
				if (typeSelect.value === 'udp') {
					if (udpConfig) udpConfig.style.display = 'block';
					if (wsConfig) wsConfig.style.display = 'none';
				} else {
					if (udpConfig) udpConfig.style.display = 'none';
					if (wsConfig) wsConfig.style.display = 'block';
				}
			});
		}

		if (generateCodeBtn) {
			generateCodeBtn.addEventListener('click', () => {
				generateCodeBtn.disabled = true;
				generateCodeBtn.textContent = 'Generating...';

				generatePairingKeyForModal(pairingCodeDisplay, codeTimerDisplay, generateCodeBtn);
			});
		}

		if (addDeviceBtn) {
			addDeviceBtn.addEventListener('click', () => {
				var name = document.querySelector('.osc-device-name-input')?.value?.trim() || 'OSC Device';
				var type = typeSelect?.value || 'websocket';

				if (type === 'udp') {
					var defaultHost = (typeof Config !== 'undefined' && Config.io?.oscDefaultHost) || '127.0.0.1';
					var defaultPort = (typeof Config !== 'undefined' && Config.io?.oscDefaultPort) || 9000;
					var host = document.querySelector('.osc-modal-udp-host')?.value || defaultHost;
					var port = parseInt(document.querySelector('.osc-modal-udp-port')?.value) || defaultPort;

					addUDPDevice(name, 'bidirectional', host, port);
					modal.style.display = 'none';
				} else {
					if (pendingDevice) {
						addPendingDevice();
						modal.style.display = 'none';
						if (typeof showStatus === 'function') {
							showStatus('Device added - waiting for pairing', { type: 'info' });
						}
					} else {
						if (generateCodeBtn) generateCodeBtn.click();
					}
				}
			});
		}
	}

	var pendingDevice = null;

	async function generatePairingKeyForModal(codeDisplay, timerDisplay, generateBtn) {
		try {
			var nameInput = document.querySelector('.osc-device-name-input');
			var typeSelect = document.querySelector('.osc-device-type');
			var deviceName = nameInput?.value?.trim() || 'OSC Device';
			var type = typeSelect?.value || 'websocket';

			var response = await fetch('/api/osc/create-device', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					name: deviceName,
					type
				})
			});

			var data = await response.json();

			if (data.error) {
				throw new Error(data.error);
			}

			pairingKey = data.code;

			if (codeDisplay) {
				codeDisplay.textContent = pairingKey;
				codeDisplay.style.color = '#4a9eff';
			}

			if (generateBtn) {
				generateBtn.disabled = false;
				generateBtn.textContent = 'Regenerate Code';
			}

			if (timerDisplay) {
				timerDisplay.textContent = '(code never expires)';
				timerDisplay.style.color = '#4a4';
			}

			pendingDevice = {
				id: 'osc_' + Date.now(),
				name: deviceName,
				type: type,
				code: data.code,
				connected: false
			};

			log('SpectraOSC: Code generated, pending device:', pendingDevice.name, data.code);

		} catch (err) {
			error('Failed to generate pairing code:', err);
			if (generateBtn) {
				generateBtn.disabled = false;
				generateBtn.textContent = 'Generate Code';
			}
			if (codeDisplay) {
				codeDisplay.textContent = '------';
				codeDisplay.style.color = '#f66';
			}
			if (timerDisplay) {
				timerDisplay.textContent = err.message || 'Failed to generate code';
				timerDisplay.style.color = '#f66';
			}
		}
	}

	function addPendingDevice() {
		if (!pendingDevice) return null;

		devices.push(pendingDevice);
		selectedDevices.push(pendingDevice.id);
		saveSettings();
		updateDevicesList();
		updateInputSelect();
		updateOutputSelect();

		var added = pendingDevice;
		pendingDevice = null;
		pairingKey = null;

		log('SpectraOSC: Device added:', added.name);
		return added;
	}

	function generatePairingKeyLegacy(codeDisplay, timerDisplay, generateBtn) {
		if (!socket || !socket.connected) {
			connectSocket();
			setTimeout(() => generatePairingKeyLegacy(codeDisplay, timerDisplay, generateBtn), 500);
			return;
		}

		socket.emit('osc-generate-key');
		socket.once('osc-key-generated', (data) => {
			if (data && data.key) {
				pairingKey = data.key;

				if (codeDisplay) {
					codeDisplay.textContent = pairingKey;
					codeDisplay.style.color = '#4a9eff';
				}

				if (generateBtn) {
					generateBtn.disabled = false;
					generateBtn.textContent = 'Regenerate Code';
				}

				var remaining = 300;
				if (pairingTimeout) clearInterval(pairingTimeout);

				pairingTimeout = setInterval(() => {
					remaining--;
					if (timerDisplay) {
						var mins = Math.floor(remaining / 60);
						var secs = remaining % 60;
						timerDisplay.textContent = `Expires in ${mins}:${secs.toString().padStart(2, '0')}`;
					}

					if (remaining <= 0) {
						clearInterval(pairingTimeout);
						pairingKey = null;
						if (codeDisplay) {
							codeDisplay.textContent = '------';
							codeDisplay.style.color = '#666';
						}
						if (timerDisplay) {
							timerDisplay.textContent = 'Code expired';
						}
						if (generateBtn) {
							generateBtn.textContent = 'Generate Code';
						}
					}
				}, 1000);
			}
		});
	}

	function sanitizeDeviceName(str) {
		if (!str || typeof str !== 'string') return 'OSC Device';
		var sanitized = str.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
		return sanitized.length > 0 ? sanitized : 'OSC Device';
	}

	function addUDPDevice(name, direction, host, port) {
		var cleanName = sanitizeDeviceName(name);
		var device = {
			id: 'udp-' + (++deviceIdCounter),
			name: cleanName,
			type: 'udp',
			direction: direction || 'both',
			host: host,
			port: port,
			enabled: true
		};

		devices.push(device);

		if (hasNativeOsc()) {
			window.electronAPI.oscAddDevice(device.id, host, port)
				.then(result => {
					if (result.success) {
						log('Registered native UDP device:', device.id);
					} else {
						error('Failed to register native UDP device:', result.error);
					}
				})
				.catch(err => error('Native UDP device error:', err));

			initNativeOscServer();
		}

		log('Added UDP device:', device);
		enabled = true;
		saveSettings();

		updateDevicesList();
		updateInputSelect();
		updateOutputSelect();

		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function removeDeviceById(id) {
		if (hasNativeOsc() && id.startsWith('udp-')) {
			window.electronAPI.oscRemoveDevice(id)
				.catch(err => error('Failed to remove native OSC device:', err));
		}

		var deviceIndex = devices.findIndex(d => d.id === id);
		if (deviceIndex !== -1) {
			devices.splice(deviceIndex, 1);
		}

		inputSelectedIds = inputSelectedIds.filter(i => i !== id);
		outputSelectedIds = outputSelectedIds.filter(i => i !== id);

		inputDevices = inputDevices.filter(d => d.id !== id);
		outputDevices = outputDevices.filter(d => d.id !== id);

		if (devices.length === 0) {
			enabled = false;
		}
		saveSettings();

		updateDevicesList();
		updateInputSelect();
		updateOutputSelect();
		updateInputList();
		updateOutputList();

		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function toggleDeviceEnabled(id, enabled) {
		var updateDevice = (list) => {
			var device = list.find(d => d.id === id);
			if (device) device.enabled = enabled;
		};
		updateDevice(inputDevices);
		updateDevice(outputDevices);
		saveSettings();
	}

	function updateDevicesUI() {
		var inputList = document.querySelector('.osc-input-devices-list');
		if (inputList) {
			if (inputDevices.length === 0) {
				inputList.innerHTML = '<div style="color: #666; font-size: 12px; padding: 8px 0;">No input devices configured</div>';
			} else {
				inputList.innerHTML = inputDevices.map(d => `
					<div class="osc-device-item" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #181818; margin: 4px 0;">
						<input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="SpectraOSC.toggleDevice('${d.id}', this.checked)">
						<span style="flex: 1; font-size: 12px; color: #fff;">${d.name}</span>
						<span style="font-size: 10px; color: #666;">${d.host}:${d.port}</span>
						<button onclick="SpectraOSC.removeDeviceById('${d.id}')" style="background: none; border: none; color: #a66; cursor: pointer; font-size: 14px;">×</button>
					</div>
				`).join('');
			}
		}

		var outputList = document.querySelector('.osc-output-devices-list');
		if (outputList) {
			if (outputDevices.length === 0) {
				outputList.innerHTML = '<div style="color: #666; font-size: 12px; padding: 8px 0;">No output devices configured</div>';
			} else {
				outputList.innerHTML = outputDevices.map(d => `
					<div class="osc-device-item" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #181818; margin: 4px 0;">
						<input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="SpectraOSC.toggleDevice('${d.id}', this.checked)">
						<span style="flex: 1; font-size: 12px; color: #fff;">${d.name}</span>
						<span style="font-size: 10px; color: #666;">${d.host}:${d.port}</span>
						<button onclick="SpectraOSC.removeDeviceById('${d.id}')" style="background: none; border: none; color: #a66; cursor: pointer; font-size: 14px;">×</button>
					</div>
				`).join('');
			}
		}
	}

	function connectSocket() {
		if (typeof io === 'undefined') {
			warn('Socket.io not available for OSC');
			connectionHealth.isHealthy = false;
			updateConnectionStatusUI();
			return;
		}

		isConnecting = true;
		updateConnectionStatusUI();

		socket = io({
			withCredentials: true,
			forceNew: false,
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			timeout: 10000
		});

		socket.on('connect', () => {
			log('SpectraOSC connected to server');
			isConnecting = false;

			resetReconnectState();

			connectionHealth.isHealthy = true;
			recordActivity();
			updateConnectionStatusUI();

			startHeartbeat();

			setupSocketListeners();

			socket.emit('osc-get-devices');

			flushMessageQueue();

			if (typeof showStatus === 'function') {
				showStatus('OSC connected to server', { type: 'success' });
			}
		});

		socket.on('disconnect', (reason) => {
			log('SpectraOSC disconnected:', reason);
			isConnecting = false;
			connectionHealth.isHealthy = false;

			stopHeartbeat();

			updateConnectionStatusUI();

			devices.forEach(d => {
				d.connected = false;
				d.maxSocketId = null;
			});
			updateDeviceStatuses();

			if (reason !== 'io client disconnect' && reconnectConfig.enabled) {
				scheduleReconnect();
			}

			if (typeof showStatus === 'function') {
				showStatus('OSC disconnected from server', { type: 'warning' });
			}
		});

		socket.on('connect_error', (err) => {
			warn('SpectraOSC connection error:', err);
			isConnecting = false;
			connectionHealth.isHealthy = false;
			connectionHealth.messagesFailed++;
			updateConnectionStatusUI();

			if (messageQueue.length > 0) {
				log('SpectraOSC: Preserving', messageQueue.length, 'queued messages for retry');
				savePendingMessages();
			}

			if (reconnectConfig.enabled && !reconnectConfig.isReconnecting) {
				scheduleReconnect();
			}
		});

		socket.on('reconnect', (attemptNumber) => {
			log('SpectraOSC reconnected after', attemptNumber, 'attempts');
			resetReconnectState();
			connectionHealth.isHealthy = true;
			recordActivity();
			startHeartbeat();
			updateConnectionStatusUI();
		});

		socket.on('reconnect_attempt', (attemptNumber) => {
			log('SpectraOSC reconnect attempt', attemptNumber);
			updateConnectionStatusUI();
		});

		socket.on('reconnect_error', (err) => {
			warn('SpectraOSC reconnect error:', err);
		});

		socket.on('reconnect_failed', () => {
			error('SpectraOSC reconnect failed after all attempts');
			if (reconnectConfig.enabled && !reconnectConfig.isReconnecting) {
				scheduleReconnect();
			}
		});

		if (socket.connected) {
			isConnecting = false;
			resetReconnectState();
			connectionHealth.isHealthy = true;
			recordActivity();
			startHeartbeat();
			updateConnectionStatusUI();
			setupSocketListeners();
			socket.emit('osc-get-devices');
			flushMessageQueue();
		}
	}

	function flushMessageQueue() {
		if (messageQueue.length === 0) return;
		if (!socket || !socket.connected) return;

		log(`Flushing ${messageQueue.length} queued OSC messages`);

		try {
			localStorage.removeItem(persistentQueueKey);
		} catch (e) {}

		var index = 0;
		var sentCount = 0;
		var processNext = () => {
			if (index >= messageQueue.length) {
				log(`SpectraOSC: Flushed ${sentCount} messages`);
				messageQueue = [];
				connectionHealth.messagesSent += sentCount;
				recordActivity();
				return;
			}

			var msg = messageQueue[index];

			if (checkThrottle()) {
				socket.emit('osc-send', msg);
				sentCount++;
			}

			index++;

			if (index < messageQueue.length) {
				setTimeout(processNext, queueFlushDelay);
			} else {
				log(`SpectraOSC: Flushed ${sentCount} messages`);
				messageQueue = [];
				connectionHealth.messagesSent += sentCount;
				recordActivity();
			}
		};

		processNext();
	}

	var pairingRequestTimeout = null;
	var PAIRING_REQUEST_TIMEOUT = 10000;

	function setupSocketListeners() {
		socket.on('osc-pairing-key', (data) => {
			if (pairingRequestTimeout) {
				clearTimeout(pairingRequestTimeout);
				pairingRequestTimeout = null;
			}

			pairingKey = data.key;
			log(`OSC Pairing Key: ${data.key} (expires in ${data.expiresIn}s)`);
			notifyDeviceChange('pairing-key', { key: data.key, expiresIn: data.expiresIn });

			updatePairingModal(data.key, data.expiresIn);

			if (pairingTimeout) clearTimeout(pairingTimeout);
			pairingTimeout = setTimeout(() => {
				pairingKey = null;
				notifyDeviceChange('pairing-expired', null);
				showPairingExpiredWithRetry();
			}, data.expiresIn * 1000);
		});

		socket.on('osc-bridge-connected', (data) => {
			log('OSC device connected:', data);

			var device = devices.find(d => d.code === data.code);

			if (device) {
				device.connected = true;
				device.maxSocketId = data.maxSocketId;
			} else if (pendingDevice && pendingDevice.code === data.code) {
				pendingDevice.connected = true;
				pendingDevice.maxSocketId = data.maxSocketId;
				devices.push(pendingDevice);
				selectedDevices.push(pendingDevice.id);
				device = pendingDevice;
				pendingDevice = null;
				updateDevicesList();
				updateInputSelect();
				updateOutputSelect();
			} else {
				var newDevice = {
					id: 'osc_' + Date.now(),
					code: data.code,
					type: data.type || 'websocket',
					name: 'OSC Device',
					connected: true,
					maxSocketId: data.maxSocketId
				};
				devices.push(newDevice);
				selectedDevices.push(newDevice.id);
				updateDevicesList();
				updateInputSelect();
				updateOutputSelect();
			}

			saveSettings();
			pairingKey = null;
			if (pairingTimeout) clearTimeout(pairingTimeout);
			notifyDeviceChange('connected', data);
			hidePairingModal();
			hideAddDeviceModal();
			updateDeviceStatuses();
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
			if (typeof showStatus === 'function') {
				showStatus('OSC device connected', { type: 'success' });
			}
		});

		socket.on('osc-bridge-disconnected', (data) => {
			log('OSC device disconnected:', data);

			var device = devices.find(d => d.code === data.code);
			if (device) {
				device.connected = false;
				device.maxSocketId = null;
				device.disconnectedAt = Date.now();

				if (reconnectConfig.enabled && device.code) {
					reconnectDevice(device.id);
				}
			}

			notifyDeviceChange('disconnected', data);
			updateDeviceStatuses();
			if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();

			if (typeof showStatus === 'function') {
				var deviceName = device ? device.name : 'Unknown device';
				showStatus(`OSC device disconnected: ${deviceName}`, { type: 'warning' });
			}
		});

		socket.on('osc-devices', (data) => {
			var serverDevices = data.devices || [];
			log('OSC devices from server:', serverDevices);

			var serverDeviceIds = serverDevices.map(d => d.id);
			var localOnlyDevices = devices.filter(d => !serverDeviceIds.includes(d.id));

			serverDevices.forEach(serverDevice => {
				var localDevice = devices.find(d => d.id === serverDevice.id || d.code === serverDevice.code);
				if (localDevice) {
					serverDevice.connected = localDevice.connected;
					serverDevice.maxSocketId = localDevice.maxSocketId;
				}
			});

			devices = [...serverDevices, ...localOnlyDevices];
			log('OSC devices merged:', devices.length, 'devices');

			selectedDevices = selectedDevices.filter(id => devices.some(d => d.id === id));

			if (selectedDevices.length === 0 && devices.length > 0) {
				selectedDevices = devices.map(d => d.id);
				saveSettings();
			}
			notifyDeviceChange('devices', devices);
			updateUI();
		});

		socket.on('osc-test-result', (data) => {
			log('OSC test result:', data);
			if (data.success) {
				if (typeof showStatus === 'function') {
					showStatus(`OSC test sent to ${data.device || 'devices'}`, { type: 'success' });
				}
			} else {
				if (typeof showStatus === 'function') {
					showStatus(`OSC test failed: ${data.message}`, { type: 'error' });
				} else {
					error('OSC test failed:', data.message);
				}
			}
		});

		socket.on('osc-pair-error', (data) => {
			log('OSC pair error:', data);
			if (typeof showStatus === 'function') {
				showStatus(`OSC pairing failed: ${data.message || 'Pairing failed'}`, { type: 'error' });
			} else {
				error('OSC pair error:', data.message);
			}
		});
	}


	function testSend() {
		if (!socket || !socket.connected) {
			if (typeof showStatus === 'function') {
				showStatus('Not connected to server', { type: 'warning' });
			}
			return;
		}
		log('Sending OSC test...');
		socket.emit('osc-test');
	}


	function createPairingModal() {
		if (pairingModal) return;

		pairingModal = document.createElement('div');
		pairingModal.className = 'osc-pairing-modal hidden';
		pairingModal.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;align-items:center;justify-content:center;background:#040404;';
		pairingModal.innerHTML = `
			<div class="osc-pairing-content" style="background:#1a1a1a;padding:30px;text-align:center;max-width:420px;">
				<h3 style="margin:0 0 15px 0;color:#fff;">Pair OSC Device</h3>
				<p style="color:#888;font-size:13px;margin:0 0 20px 0;">Enter this pairing code in your OSC application:</p>

				<div class="osc-pairing-key" style="font-family:monospace;font-size:42px;font-weight:bold;color:#4a9eff;letter-spacing:10px;padding:25px;background:#252525;margin-bottom:15px;">...</div>

				<div class="osc-pairing-timer" style="font-size:12px;color:#666;margin-bottom:20px;">Generating code...</div>

				<div style="text-align:left;background:#252525;padding:15px;margin-bottom:20px;">
					<p style="margin:0 0 10px 0;font-size:12px;color:#888;"><b>How to connect:</b></p>
					<ol style="margin:0;padding-left:20px;font-size:12px;color:#aaa;line-height:1.6;">
						<li>Open your OSC client (Max/MSP, TouchOSC, etc.)</li>
						<li>Connect to the Spectra WebSocket server</li>
						<li>Send the pairing code shown above</li>
						<li>Your device will appear in the OSC panel</li>
					</ol>
					<p style="margin:10px 0 0 0;font-size:12px;color:#666;">
						<b>Max/MSP example:</b> Use <code style="color:#4a9eff;">spectra-osc</code> external or WebSocket object
					</p>
				</div>

				<button class="osc-pairing-cancel" style="padding:8px 14px;background:#262626;border:none;color:#999;cursor:pointer;font-size:12px;" onclick="SpectraOSC.hidePairingModal()">Cancel</button>
			</div>
		`;
		document.body.appendChild(pairingModal);

		pairingModal.addEventListener('click', (e) => {
			if (e.target === pairingModal) {
				hidePairingModal();
			}
		});
	}

	function showPairingModal() {
		if (!pairingModal) {
			createPairingModal();
		}

		if (!pairingModal.parentNode) {
			document.body.appendChild(pairingModal);
		}

		var keyEl = pairingModal.querySelector('.osc-pairing-key');
		var timerEl = pairingModal.querySelector('.osc-pairing-timer');

		if (keyEl) keyEl.textContent = '...';
		if (timerEl) timerEl.textContent = 'Generating key...';

		pairingModal.style.display = 'flex';
		pairingModal.classList.remove('hidden');

		generatePairingKey();
	}

	function hidePairingModal() {
		if (pairingModal) {
			pairingModal.style.display = 'none';
			pairingModal.classList.add('hidden');
		}
		cancelPairing();
	}

	function hideAddDeviceModal() {
		var modal = document.querySelector('.osc-add-device-modal');
		if (modal) {
			modal.style.display = 'none';
		}
		var generateBtn = document.querySelector('.osc-modal-generate-code');
		if (generateBtn) {
			generateBtn.disabled = false;
			generateBtn.textContent = 'Generate Code';
		}
		var codeDisplay = document.querySelector('.osc-modal-pairing-code');
		if (codeDisplay) {
			codeDisplay.textContent = '------';
			codeDisplay.style.color = '';
		}
		var timerDisplay = document.querySelector('.osc-modal-code-timer');
		if (timerDisplay) {
			timerDisplay.textContent = '';
			timerDisplay.style.color = '';
		}
		var nameInput = document.querySelector('.osc-device-name-input');
		if (nameInput) {
			nameInput.value = '';
		}
	}

	var countdownInterval = null;

	function updatePairingModal(key, expiresIn) {
		if (!pairingModal) return;

		var keyEl = pairingModal.querySelector('.osc-pairing-key');
		var timerEl = pairingModal.querySelector('.osc-pairing-timer');

		if (keyEl) keyEl.textContent = key;
		if (timerEl) timerEl.textContent = `Expires in ${expiresIn} seconds`;

		if (countdownInterval) clearInterval(countdownInterval);

		var remaining = expiresIn;
		countdownInterval = setInterval(() => {
			remaining--;
			if (remaining > 0) {
				if (timerEl) timerEl.textContent = `Expires in ${remaining} seconds`;
			} else {
				clearInterval(countdownInterval);
				countdownInterval = null;
				if (timerEl) timerEl.textContent = 'Key expired - click Cancel and try again';
			}
		}, 1000);
	}


	function generatePairingKey() {
		log('Generating OSC pairing key, socket connected:', socket?.connected);

		if (!socket) {
			error('OSC: No socket available');
			const timerEl = pairingModal?.querySelector('.osc-pairing-timer');
			if (timerEl) timerEl.textContent = 'Error: Not connected to server';
			showPairingRetryButton();
			return;
		}

		if (!socket.connected) {
			error('OSC: Socket not connected');
			const timerEl = pairingModal?.querySelector('.osc-pairing-timer');
			if (timerEl) timerEl.textContent = 'Connecting to server...';

			socket.once('connect', () => {
				generatePairingKey();
			});
			return;
		}

		if (pairingRequestTimeout) {
			clearTimeout(pairingRequestTimeout);
		}

		pairingRequestTimeout = setTimeout(() => {
			error('OSC: Server did not respond to pairing key request');
			var timerEl = pairingModal?.querySelector('.osc-pairing-timer');
			if (timerEl) timerEl.textContent = 'Server not responding';
			showPairingRetryButton();
		}, PAIRING_REQUEST_TIMEOUT);

		socket.emit('osc-generate-pairing-key');
		log('OSC: Pairing key request sent');
	}

	function showPairingRetryButton() {
		if (!pairingModal) return;

		var keyDisplay = pairingModal.querySelector('.osc-pairing-key');
		if (keyDisplay) {
			keyDisplay.innerHTML = `
				<button class="osc-pairing-retry-btn" style="
					background: #262626;
color: #999;
border: none;
padding: 8px 14px;
cursor: pointer;
font-size: 12px;
				">Retry</button>
			`;

			var retryBtn = keyDisplay.querySelector('.osc-pairing-retry-btn');
			if (retryBtn) {
				retryBtn.addEventListener('click', () => {
					keyDisplay.innerHTML = '<span style="color:#888;">Requesting...</span>';
					generatePairingKey();
				});
			}
		}
	}

	function showPairingExpiredWithRetry() {
		if (!pairingModal) {
			hidePairingModal();
			return;
		}

		var keyDisplay = pairingModal.querySelector('.osc-pairing-key');
		var timerEl = pairingModal.querySelector('.osc-pairing-timer');

		if (timerEl) {
			timerEl.textContent = 'Key expired';
		}

		if (keyDisplay) {
			keyDisplay.innerHTML = `
				<div style="text-align: center;">
					<div style="color: #ffa; margin-bottom: 10px;">Pairing key expired</div>
					<button class="osc-pairing-retry-btn" style="
						background: #262626;
color: #999;
border: none;
padding: 8px 14px;
cursor: pointer;
font-size: 12px;
					">Generate New Key</button>
				</div>
			`;

			var retryBtn = keyDisplay.querySelector('.osc-pairing-retry-btn');
			if (retryBtn) {
				retryBtn.addEventListener('click', () => {
					keyDisplay.innerHTML = '<span style="color:#888;">Requesting...</span>';
					if (timerEl) timerEl.textContent = '';
					generatePairingKey();
				});
			}
		}
	}

	function cancelPairing() {
		pairingKey = null;
		if (pairingTimeout) clearTimeout(pairingTimeout);
		notifyDeviceChange('pairing-cancelled', null);
	}


	function getDevices() {
		return devices;
	}

	function getSelectedDevices() {
		return selectedDevices;
	}

	function selectDevice(deviceId, selected) {
		if (selected && !selectedDevices.includes(deviceId)) {
			selectedDevices.push(deviceId);
		} else if (!selected) {
			selectedDevices = selectedDevices.filter(id => id !== deviceId);
		}
		saveSettings();
		notifyDeviceChange('selection', selectedDevices);
		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function selectAllDevices() {
		selectedDevices = devices.map(d => d.id);
		saveSettings();
		notifyDeviceChange('selection', selectedDevices);
		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function deselectAllDevices() {
		selectedDevices = [];
		saveSettings();
		notifyDeviceChange('selection', selectedDevices);
		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function removeDevice(deviceId) {
		var device = devices.find(d => d.id === deviceId);

		devices = devices.filter(d => d.id !== deviceId);
		selectedDevices = selectedDevices.filter(id => id !== deviceId);
		inputSelectedIds = inputSelectedIds.filter(id => id !== deviceId);
		outputSelectedIds = outputSelectedIds.filter(id => id !== deviceId);
		inputDevices = inputDevices.filter(d => d.id !== deviceId);
		outputDevices = outputDevices.filter(d => d.id !== deviceId);

		saveSettings();
		updateUI();

		if (socket && socket.connected && device?.code) {
			fetch('/api/osc/delete-device', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ code: device.code })
			}).catch(err => warn('Failed to delete device from server:', err));
		}

		log('SpectraOSC: Removed device', deviceId);
		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();
	}

	function renameDevice(deviceId, name) {
		if (!socket || !socket.connected) return;
		socket.emit('osc-rename-device', { deviceId, name });
	}

	function refreshDevices() {
		if (!socket || !socket.connected) return;
		socket.emit('osc-get-devices');
	}


	function send(address, args = [], targetOrDeviceIds = null) {
		if (targetOrDeviceIds === 'mute') return;

		var targets;
		if (typeof targetOrDeviceIds === 'string' && targetOrDeviceIds.startsWith('output')) {
			var outputIndex = parseInt(targetOrDeviceIds.replace('output', '')) - 1;
			if (outputIndex >= 0 && outputIndex < outputSelectedIds.length) {
				targets = [outputSelectedIds[outputIndex]];
			} else {
				targets = selectedDevices.length > 0 ? selectedDevices : outputSelectedIds;
			}
		} else if (Array.isArray(targetOrDeviceIds)) {
			targets = targetOrDeviceIds;
		} else {
			targets = selectedDevices.length > 0 ? selectedDevices : outputSelectedIds;
		}
		if (targets.length === 0) return;

		if (!checkThrottle()) {
			return;
		}

		if (hasNativeOsc()) {
			var udpTargets = targets.filter(id => {
				var device = devices.find(d => d.id === id);
				return device && device.type === 'udp';
			});

			udpTargets.forEach(deviceId => {
				sendNativeOsc(deviceId, address, args);
			});

			if (udpTargets.length > 0) {
				connectionHealth.messagesSent += udpTargets.length;
				recordActivity();
			}

			if (udpTargets.length === targets.length) {
				return;
			}
		}

		if (!enabled) return;

		var message = {
			address,
			args,
			deviceIds: targets
		};

		if (isConnecting || (socket && !socket.connected)) {
			if (messageQueue.length < maxQueueSize) {
				messageQueue.push(message);
				if (address.includes('/playback') || address.includes('/transport') || address.includes('/tempo')) {
					savePendingMessages();
				}
			}
			return;
		}

		if (!socket) return;

		socket.emit('osc-send', message);

		connectionHealth.messagesSent++;
		recordActivity();
	}

	function sendReliable(address, args = [], deviceIds = null) {
		var targets = deviceIds || (selectedDevices.length > 0 ? selectedDevices : outputSelectedIds);
		if (targets.length === 0) return Promise.resolve({ noTargets: true });

		if (hasNativeOsc()) {
			var udpTargets = targets.filter(id => {
				var device = devices.find(d => d.id === id);
				return device && device.type === 'udp';
			});

			udpTargets.forEach(deviceId => {
				sendNativeOsc(deviceId, address, args);
			});

			if (udpTargets.length === targets.length) {
				return Promise.resolve({ success: true, udp: true });
			}
		}

		if (!enabled) return Promise.resolve({ skipped: true });

		var message = {
			address,
			args,
			deviceIds: targets
		};

		return sendWithRetry(message);
	}


	function sendNoteOn(pitch, velocity, instrument, partial) {
		send('/spectra/note/on', [pitch, velocity, instrument, partial || 0]);
	}

	function sendNoteOff(pitch, instrument) {
		send('/spectra/note/off', [pitch, instrument]);
	}

	function sendInstrumentChange(index, name) {
		send('/spectra/instrument', [index, name || '']);
	}

	function sendTransportStart(position) {
		send('/spectra/transport/start', [1]);
		send('/spectra/transport/position', [position || 0]);
	}

	function sendTransportStop(position) {
		send('/spectra/transport/start', [0]);
		send('/spectra/transport/position', [position || 0]);
	}

	function sendTransportPosition(position) {
		send('/spectra/transport/position', [position]);
	}

	function sendLoopPoint(position) {
		send('/spectra/transport/loop', [position]);
	}

	function onWebSocketDeviceConnected(data) {
		var device = devices.find(d => d.code === data?.code);
		if (device) {
			device.connected = true;
			updateUI();
			hidePairingModal();
		}
	}

	function onWebSocketDeviceDisconnected(data) {
		var device = devices.find(d => d.code === data?.code);
		if (device) {
			device.connected = false;
			updateUI();
		}
	}


	function loadSettings() {
		try {
			var saved = localStorage.getItem('spectra_osc_settings');
			if (saved) {
				var settings = JSON.parse(saved);
				devices = settings.devices || [];
				devices.forEach(d => {
					d.connected = false;
					d.maxSocketId = null;
				});
				inputSelectedIds = settings.inputSelectedIds || [];
				outputSelectedIds = settings.outputSelectedIds || [];
				selectedDevices = settings.selectedDevices || [];
				inputDevices = settings.inputDevices || [];
				outputDevices = settings.outputDevices || [];
				enabled = settings.enabled !== false;
				deviceIdCounter = settings.deviceIdCounter || 0;
				log('SpectraOSC: Loaded', devices.length, 'devices from settings (all set to disconnected)');

				if (hasNativeOsc()) {
					devices.filter(d => d.type === 'udp').forEach(device => {
						window.electronAPI.oscAddDevice(device.id, device.host, device.port)
							.then(result => {
								if (result.success) {
									log('Re-registered native UDP device:', device.id);
								} else {
									error('Failed to re-register UDP device:', device.id, result.error);
								}
							})
							.catch(err => error('Native UDP re-register error:', err));
					});
				}
			}
			setTimeout(() => {
				updateUI();
			}, 100);
		} catch (e) {
			warn('Failed to load OSC settings:', e);
		}
	}

	function saveSettings() {
		try {
			localStorage.setItem('spectra_osc_settings', JSON.stringify({
				devices,
				inputSelectedIds,
				outputSelectedIds,
				selectedDevices,
				inputDevices,
				outputDevices,
				enabled,
				deviceIdCounter
			}));
			log('SpectraOSC: Saved', devices.length, 'devices to settings');
		} catch (e) {
			if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
				error('Failed to save OSC settings - storage quota exceeded');
				if (typeof showStatus === 'function') {
					showStatus('Storage full - OSC settings not saved', { type: 'warning' });
				}
			} else {
				warn('Failed to save OSC settings:', e);
			}
		}
	}

	function setEnabled(value) {
		enabled = value;
		saveSettings();
		notifyDeviceChange('enabled', enabled);
	}

	function isEnabled() {
		return enabled;
	}


	function onDeviceChange(callback) {
		onDeviceChangeCallbacks.push(callback);
	}

	function notifyDeviceChange(event, data) {
		onDeviceChangeCallbacks.forEach(cb => cb(event, data));
	}


	function updateDeviceStatuses() {
		devices.forEach(device => {
			var statusColor = device.connected ? '#4a4' : '#a44';
			var title = device.connected ? 'Connected' : 'Awaiting pairing';

			document.querySelectorAll(`.osc-status-dot[data-device-id="${device.id}"]`).forEach(dot => {
				dot.style.background = statusColor;
				dot.title = title;
			});
		});

		updateInputSelect();
		updateOutputSelect();
		updateInputList();
		updateOutputList();
		updateDevicesList();
	}

	function getDeviceTypeLabel(device) {
		if (device.type === 'websocket' || device.type === 'ws') {
			return 'WS';
		}
		var host = device.host || '127.0.0.1';
		var port = device.port || 9002;
		return `UDP (${host}:${port})`;
	}

	function updateInputSelect() {
		var inputSelect = document.querySelector('.osc-input-select');
		if (inputSelect) {
			inputSelect.innerHTML = '<option value="">Select device to add</option>';
			devices.filter(d => !inputSelectedIds.includes(d.id)).forEach(device => {
				var typeLabel = getDeviceTypeLabel(device);
				var option = document.createElement('option');
				option.value = device.id;
				option.textContent = `${device.name} [${typeLabel}]`;
				inputSelect.appendChild(option);
			});
		}
	}

	function updateOutputSelect() {
		var outputSelect = document.querySelector('.osc-output-select');
		if (outputSelect) {
			outputSelect.innerHTML = '<option value="">Select device to add</option>';
			devices.filter(d => !outputSelectedIds.includes(d.id)).forEach(device => {
				var typeLabel = getDeviceTypeLabel(device);
				var option = document.createElement('option');
				option.value = device.id;
				option.textContent = `${device.name} [${typeLabel}]`;
				outputSelect.appendChild(option);
			});
		}
	}

	function updateInputList() {
		var inputList = document.querySelector('.osc-input-devices-list');
		if (inputList) {
			var inputDevicesSelected = devices.filter(d => inputSelectedIds.includes(d.id));
			if (inputDevicesSelected.length === 0) {
				inputList.innerHTML = '';
			} else {
				inputList.innerHTML = inputDevicesSelected.map(device => {
					var typeLabel = getDeviceTypeLabel(device);
					var statusDot = (device.type === 'udp' || hasNativeOsc())
						? ''
						: `<span class="osc-status-dot" data-device-id="${device.id}" style="display: inline-block; width: 8px; height: 8px; background: ${device.connected ? '#4a4' : '#a44'}; " title="${device.connected ? 'Connected' : 'Awaiting pairing'}"></span>`;
					return `
						<div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 15px; background: #252525; margin-bottom: 6px;">
							${statusDot}
							<span style="flex: 1; color: #ccc; font-size: 12px;">${device.name}</span>
							<span style="color: #666; font-size: 10px; background: #343434; padding: 2px 6px; ">${typeLabel}</span>
							<button onclick="SpectraOSC.removeFromInput('${device.id}')" style="background: none; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 2px 6px;" title="Remove from input">&times;</button>
						</div>
					`;
				}).join('');
			}
		}
	}

	function updateOutputList() {
		var outputList = document.querySelector('.osc-output-devices-list');
		if (outputList) {
			var outputDevicesSelected = devices.filter(d => outputSelectedIds.includes(d.id));
			if (outputDevicesSelected.length === 0) {
				outputList.innerHTML = '';
			} else {
				outputList.innerHTML = outputDevicesSelected.map(device => {
					var typeLabel = getDeviceTypeLabel(device);
					var statusDot = (device.type === 'udp' || hasNativeOsc())
						? ''
						: `<span class="osc-status-dot" data-device-id="${device.id}" style="display: inline-block; width: 8px; height: 8px; background: ${device.connected ? '#4a4' : '#a44'}; " title="${device.connected ? 'Connected' : 'Awaiting pairing'}"></span>`;
					return `
						<div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 15px; background: #252525; margin-bottom: 6px;">
							${statusDot}
							<span style="flex: 1; color: #ccc; font-size: 12px;">${device.name}</span>
							<span style="color: #666; font-size: 10px; background: #343434; padding: 2px 6px; ">${typeLabel}</span>
							<button onclick="SpectraOSC.removeFromOutput('${device.id}')" style="background: none; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 2px 6px;" title="Remove from output">&times;</button>
						</div>
					`;
				}).join('');
			}
		}
	}

	function updateDevicesList() {
		var devicesList = document.querySelector('.osc-devices-list');
		if (devicesList) {
			if (devices.length === 0) {
				devicesList.innerHTML = '<div style="color: #666; font-size: 12px; padding: 8px 0;">No devices configured</div>';
			} else {
				devicesList.innerHTML = devices.map(device => {
					var typeLabel = getDeviceTypeLabel(device);
					var statusDot = (device.type === 'udp' || hasNativeOsc())
						? ''
						: `<span class="osc-status-dot" data-device-id="${device.id}" style="display: inline-block; width: 8px; height: 8px; background: ${device.connected ? '#4a4' : '#a44'}; " title="${device.connected ? 'Connected' : 'Awaiting pairing'}"></span>`;
					var codeDisplay = device.code
						? `<span style="color: #888; font-size: 10px; font-family: monospace; background: #151515; padding: 2px 5px; cursor: pointer;" onclick="event.stopPropagation(); navigator.clipboard.writeText('${device.code}').then(() => { if(typeof showStatus === 'function') showStatus('Code copied!', {type:'success'}); })" title="Click to copy">${device.code}</span>`
						: '';
					return `
						<div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 15px; background: #252525; margin-bottom: 6px;">
							${statusDot}
							<span style="flex: 1; color: #ccc; font-size: 12px;">${device.name}</span>
							${codeDisplay}
							<span style="color: #666; font-size: 10px; background: #343434; padding: 2px 6px; ">${typeLabel}</span>
							<button onclick="SpectraOSC.confirmDelete('${device.id}')" style="background: none; border: none; color: #a44; cursor: pointer; font-size: 12px; padding: 2px 6px;" title="Delete device">&times;</button>
						</div>
					`;
				}).join('');
			}
		}
	}

	function updateUI() {
		if (typeof updateIOFlowDiagram === 'function') updateIOFlowDiagram();

		updateDevicesList();
		updateInputSelect();
		updateOutputSelect();
		updateInputList();
		updateOutputList();
	}

	function addToInput(deviceId) {
		if (deviceId && !inputSelectedIds.includes(deviceId)) {
			inputSelectedIds.push(deviceId);
			saveSettings();
			updateInputSelect();
			updateInputList();
		}
	}

	function removeFromInput(deviceId) {
		inputSelectedIds = inputSelectedIds.filter(id => id !== deviceId);
		saveSettings();
		updateInputSelect();
		updateInputList();
	}

	function addToOutput(deviceId) {
		if (deviceId && !outputSelectedIds.includes(deviceId)) {
			outputSelectedIds.push(deviceId);
			saveSettings();
			updateOutputSelect();
			updateOutputList();
		}
	}

	function removeFromOutput(deviceId) {
		outputSelectedIds = outputSelectedIds.filter(id => id !== deviceId);
		saveSettings();
		updateOutputSelect();
		updateOutputList();
	}

	function confirmDelete(deviceId) {
		var device = devices.find(d => d.id === deviceId);
		if (!device) return;

		pendingDeleteId = deviceId;
		var modal = document.querySelector('.osc-delete-modal');
		var nameEl = document.querySelector('.osc-delete-device-name');
		var confirmBtn = document.querySelector('.osc-delete-confirm');
		if (modal && nameEl) {
			nameEl.textContent = device.name + (device.code ? ` (${device.code})` : '');
			modal.style.display = 'flex';
			if (confirmBtn) {
				setTimeout(() => confirmBtn.focus(), 50);
			}
		}
	}

	function setupDeleteModal() {
		var modal = document.querySelector('.osc-delete-modal');
		var cancelBtn = document.querySelector('.osc-delete-cancel');
		var confirmBtn = document.querySelector('.osc-delete-confirm');

		var closeModal = () => {
			pendingDeleteId = null;
			if (modal) modal.style.display = 'none';
		};

		var doDelete = () => {
			if (pendingDeleteId) {
				removeDevice(pendingDeleteId);
				pendingDeleteId = null;
			}
			if (modal) modal.style.display = 'none';
		};

		if (cancelBtn) {
			cancelBtn.addEventListener('click', closeModal);
		}

		if (confirmBtn) {
			confirmBtn.addEventListener('click', doDelete);
			confirmBtn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					doDelete();
				}
			});
		}

		if (modal) {
			modal.addEventListener('click', (e) => {
				if (e.target === modal) {
					closeModal();
				}
			});
			modal.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					closeModal();
				}
			});
		}
	}

	function setupSelectHandlers() {
		var inputSelect = document.querySelector('.osc-input-select');
		var outputSelect = document.querySelector('.osc-output-select');

		if (inputSelect) {
			inputSelect.addEventListener('change', () => {
				if (inputSelect.value) {
					addToInput(inputSelect.value);
					inputSelect.value = '';
				}
			});
		}

		if (outputSelect) {
			outputSelect.addEventListener('change', () => {
				if (outputSelect.value) {
					addToOutput(outputSelect.value);
					outputSelect.value = '';
				}
			});
		}
	}

	function promptRename(deviceId) {
		var device = devices.find(d => d.id === deviceId);
		if (!device) return;

		var newName = prompt('Device name:', device.name);
		if (newName && newName.trim()) {
			renameDevice(deviceId, newName.trim());
		}
	}

	function showPairingUI() {
		generatePairingKey();
	}

	function getPairingKey() {
		return pairingKey;
	}


	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		setTimeout(init, 100);
	}


	return {
		init,

		generatePairingKey,
		cancelPairing,
		getPairingKey,
		showPairingUI: showPairingModal,
		showPairingModal,
		hidePairingModal,

		getDevices,
		getSelectedDevices,
		selectDevice,
		selectAllDevices,
		deselectAllDevices,
		removeDevice,
		renameDevice,
		refreshDevices,
		promptRename,

		addUDPDevice,
		removeDeviceById,
		toggleDevice: toggleDeviceEnabled,
		getInputDevices: () => inputDevices,
		getOutputDevices: () => outputDevices,
		updateDevicesUI,

		addToInput,
		removeFromInput,
		addToOutput,
		removeFromOutput,
		confirmDelete,

		send,
		sendReliable,
		sendNoteOn,
		sendNoteOff,
		sendInstrumentChange,
		testSend,

		sendTransportStart,
		sendTransportStop,
		sendTransportPosition,
		sendLoopPoint,

		onWebSocketDeviceConnected,
		onWebSocketDeviceDisconnected,

		loadSettings,
		isEnabled,
		setEnabled,

		onDeviceChange,

		isConnected: () => socket && socket.connected,
		getDeviceCount: () => devices.length,

		getConnectionHealth,
		getThrottleStatus,
		reconnectDevice,
		startHeartbeat,
		stopHeartbeat,

		setThrottleEnabled: (enabled) => { throttleConfig.enabled = enabled; },
		setMaxMessagesPerSecond: (max) => { throttleConfig.maxMessagesPerSecond = max; },
		setReconnectEnabled: (enabled) => { reconnectConfig.enabled = enabled; },
		setHeartbeatInterval: (ms) => { connectionHealth.heartbeatMs = ms; if (connectionHealth.heartbeatInterval) { startHeartbeat(); } },

		hasNetworkDiscovery,
		getLocalNetworkInfo,
		scanNetworkQuick,
		scanNetworkFull,
		startNetworkDiscoveryStream,
		stopNetworkDiscoveryStream,

		isElectron,
		hasNativeOsc,
		initNativeOscServer,

		onMessage,
		processIncomingOscMessage,

		cleanup: () => {
			stopHeartbeat();

			if (reconnectConfig.reconnectTimer) {
				clearTimeout(reconnectConfig.reconnectTimer);
				reconnectConfig.reconnectTimer = null;
			}

			if (pairingTimeout) {
				clearTimeout(pairingTimeout);
				pairingTimeout = null;
			}

			retryConfig.pendingRetries.forEach((state, msgId) => {
				if (state.timer) clearTimeout(state.timer);
			});
			retryConfig.pendingRetries.clear();

			messageQueue.length = 0;

			if (typeof stopNetworkDiscoveryStream === 'function') {
				stopNetworkDiscoveryStream();
			}

			if (socket) {
				socket.removeAllListeners();
				socket.disconnect();
				socket = null;
			}

			log('SpectraOSC: Cleanup complete');
		}
	};
})();

function showOSCPairingModal() {
	SpectraOSC.showPairingModal();
}