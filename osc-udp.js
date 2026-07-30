var dgram = require('dgram');

var DEBUG = process.env.NODE_ENV !== 'production';
var log = (...args) => { if (DEBUG) console.log('[OSC-UDP]', ...args); };
var warn = (...args) => { if (DEBUG) console.warn('[OSC-UDP]', ...args); };
var error = (...args) => { console.error('[OSC-UDP]', ...args); };

var OSC_RECEIVE_PORT = 9002;

class OscUdp {
	constructor() {
		this.server = null;
		this.clients = new Map();
		this.messageCallbacks = [];
		this.isListening = false;
	}

	startServer(callback) {
		if (this.server) {
			log('OSC UDP server already running');
			return { success: true, port: OSC_RECEIVE_PORT };
		}

		return new Promise((resolve) => {
			try {
				this.server = dgram.createSocket('udp4');

				this.server.on('error', (err) => {
					error('OSC UDP server error:', err);
					this.server.close();
					this.server = null;
					this.isListening = false;
					resolve({ success: false, error: err.message });
				});

				this.server.on('message', (msg, rinfo) => {
					var parsed = this.parseOscMessage(msg);
					if (parsed) {
						var oscMessage = {
							address: parsed.address,
							args: parsed.args,
							from: {
								address: rinfo.address,
								port: rinfo.port
							},
							timestamp: Date.now()
						};

						this.messageCallbacks.forEach(cb => {
							try {
								cb(oscMessage);
							} catch (e) {
								error('OSC callback error:', e);
							}
						});

						if (callback) {
							callback(oscMessage);
						}
					}
				});

				this.server.on('listening', () => {
					var addr = this.server.address();
					log(`OSC UDP server listening on ${addr.address}:${addr.port}`);
					this.isListening = true;
					resolve({ success: true, port: addr.port });
				});

				this.server.bind(OSC_RECEIVE_PORT);
			} catch (err) {
				error('Failed to start OSC UDP server:', err);
				resolve({ success: false, error: err.message });
			}
		});
	}

	stopServer() {
		if (this.server) {
			this.server.close();
			this.server = null;
			this.isListening = false;
			log('OSC UDP server stopped');
		}
		return { success: true };
	}

	onMessage(callback) {
		this.messageCallbacks.push(callback);
		return () => {
			var idx = this.messageCallbacks.indexOf(callback);
			if (idx >= 0) this.messageCallbacks.splice(idx, 1);
		};
	}

	addDevice(deviceId, host, port) {
		if (this.clients.has(deviceId)) {
			this.removeDevice(deviceId);
		}

		var socket = dgram.createSocket('udp4');
		this.clients.set(deviceId, { host, port, socket });
		log(`OSC UDP device added: ${deviceId} -> ${host}:${port}`);
		return { success: true, deviceId, host, port };
	}

	removeDevice(deviceId) {
		var device = this.clients.get(deviceId);
		if (device) {
			device.socket.close();
			this.clients.delete(deviceId);
			log(`OSC UDP device removed: ${deviceId}`);
			return { success: true };
		}
		return { success: false, error: 'Device not found' };
	}

	getDevices() {
		var devices = [];
		for (const [id, device] of this.clients.entries()) {
			devices.push({ id, host: device.host, port: device.port });
		}
		return devices;
	}

	send(deviceId, address, args = []) {
		var device = this.clients.get(deviceId);
		if (!device) {
			return { success: false, error: 'Device not found' };
		}

		try {
			var buffer = this.buildOscMessage(address, args);
			device.socket.send(buffer, device.port, device.host, (err) => {
				if (err) {
					error(`OSC send error to ${deviceId}:`, err);
				}
			});
			return { success: true };
		} catch (err) {
			return { success: false, error: err.message };
		}
	}

	sendFromServer(host, port, address, args = []) {
		if (!this.server || !this.isListening) {
			return { success: false, error: 'Server not running' };
		}

		try {
			var buffer = this.buildOscMessage(address, args);
			this.server.send(buffer, port, host, (err) => {
				if (err) {
					error(`OSC sendFromServer error (${host}:${port}):`, err);
				}
			});
			return { success: true };
		} catch (err) {
			return { success: false, error: err.message };
		}
	}

	parseOscMessage(buffer) {
		try {
			var offset = 0;

			var addressEnd = buffer.indexOf(0, offset);
			if (addressEnd === -1) return null;
			var address = buffer.toString('utf8', offset, addressEnd);
			offset = this.alignTo4(addressEnd + 1);

			if (offset >= buffer.length || buffer[offset] !== 0x2C) {
				return { address, args: [] };
			}

			// Typ
			var typeTagEnd = buffer.indexOf(0, offset);
			if (typeTagEnd === -1) return { address, args: [] };
			var typeTags = buffer.toString('utf8', offset + 1, typeTagEnd); // Preskoč ','
			offset = this.alignTo4(typeTagEnd + 1);

			var args = [];
			for (const tag of typeTags) {
				switch (tag) {
					case 'i':
						args.push({ type: 'i', value: buffer.readInt32BE(offset) });
						offset += 4;
						break;
					case 'f':
						args.push({ type: 'f', value: buffer.readFloatBE(offset) });
						offset += 4;
						break;
					case 's':
						var strEnd = buffer.indexOf(0, offset);
						if (strEnd === -1) break;
						args.push({ type: 's', value: buffer.toString('utf8', offset, strEnd) });
						offset = this.alignTo4(strEnd + 1);
						break;
					case 'b':
						var blobSize = buffer.readInt32BE(offset);
						offset += 4;
						args.push({ type: 'b', value: buffer.slice(offset, offset + blobSize) });
						offset = this.alignTo4(offset + blobSize);
						break;
					case 'T':
						args.push({ type: 'T', value: true });
						break;
					case 'F':
						args.push({ type: 'F', value: false });
						break;
					case 'N':
						args.push({ type: 'N', value: null });
						break;
					// Preskočiť
				}
			}

			return { address, args };
		} catch (e) {
			error('OSC parse error:', e);
			return null;
		}
	}

	buildOscMessage(address, args = []) {
		var parts = [];

		// Adresa
		var addressBuf = this.oscString(address);
		parts.push(addressBuf);

		// Typ
		var typeTags = ',';
		var argBuffers = [];

		for (const arg of args) {
			var type = typeof arg === 'object' && arg.type ? arg.type : this.inferType(arg);
			var value = typeof arg === 'object' && arg.hasOwnProperty('value') ? arg.value : arg;

			switch (type) {
				case 'i':
					typeTags += 'i';
					var intBuf = Buffer.alloc(4);
					intBuf.writeInt32BE(Math.round(value), 0);
					argBuffers.push(intBuf);
					break;
				case 'f':
					typeTags += 'f';
					var floatBuf = Buffer.alloc(4);
					floatBuf.writeFloatBE(value, 0);
					argBuffers.push(floatBuf);
					break;
				case 's':
					typeTags += 's';
					argBuffers.push(this.oscString(String(value)));
					break;
				case 'b':
					typeTags += 'b';
					var blobSizeBuf = Buffer.alloc(4);
					blobSizeBuf.writeInt32BE(value.length, 0);
					argBuffers.push(blobSizeBuf);
					argBuffers.push(this.oscBlob(value));
					break;
				case 'T':
					typeTags += 'T';
					break;
				case 'F':
					typeTags += 'F';
					break;
				case 'N':
					typeTags += 'N';
					break;
			}
		}

		parts.push(this.oscString(typeTags));
		parts.push(...argBuffers);

		return Buffer.concat(parts);
	}

	inferType(value) {
		if (value === null || value === undefined) return 'N';
		if (value === true) return 'T';
		if (value === false) return 'F';
		if (typeof value === 'number') {
			return Number.isInteger(value) ? 'i' : 'f';
		}
		if (typeof value === 'string') return 's';
		if (Buffer.isBuffer(value)) return 'b';
		return 's';
	}

	oscString(str) {
		var buf = Buffer.from(str + '\0', 'utf8');
		var padded = this.alignTo4(buf.length);
		if (padded > buf.length) {
			return Buffer.concat([buf, Buffer.alloc(padded - buf.length)]);
		}
		return buf;
	}

	oscBlob(data) {
		var buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		var padded = this.alignTo4(buf.length);
		if (padded > buf.length) {
			return Buffer.concat([buf, Buffer.alloc(padded - buf.length)]);
		}
		return buf;
	}

	alignTo4(n) {
		return (n + 3) & ~3;
	}

	getStatus() {
		return {
			listening: this.isListening,
			port: this.isListening ? OSC_RECEIVE_PORT : null,
			deviceCount: this.clients.size
		};
	}
}

module.exports = new OscUdp();
