// Podpora drag & drop súborov MIDI na časovej osi a hlavnom plátne
// pridáva drop zóny, ktoré akceptujú .mid/.midi súbory a importujú ich ako nové stopy.

var MidiDragDrop = {
	_overlay: null,
	_bound: false,

	init: function() {
		if (MidiDragDrop._bound) return;
		MidiDragDrop._bound = true;

		var targets = [
			document.getElementById('timelineCanvas'),
			document.getElementById('canvasElement')
		];

		for (var i = 0; i < targets.length; i++) {
			if (targets[i]) {
				MidiDragDrop._bindTarget(targets[i]);
			}
		}
	},

	_hasMidiFile: function(dt) {
		if (!dt || !dt.types) return false;
		// Spracujú sa len externé súbory, ťahanie v rámci okna nie.
		var hasFiles = false;
		for (var i = 0; i < dt.types.length; i++) {
			if (dt.types[i] === 'Files') { hasFiles = true; break; }
		}
		if (!hasFiles) return false;
		if (dt.items) {
			for (var j = 0; j < dt.items.length; j++) {
				var item = dt.items[j];
				if (item.kind === 'file') {
					var type = item.type.toLowerCase();
					// Počas ťahania je názov súboru neprístupný, k dispozícii je len typ MIME, a ten
					// si každý systém určuje sám, preto sa používa kontrola výrazu audio/ na začiatku pre rôzne typy.
					if (type === '' || type.indexOf('audio/') === 0) return true;
				}
			}
			return false;
		}
		return true; // Ak sa typ nedá skontrolovať, pustenie sa povolí a overí až pri ňom.
	},

	_isMidiFilename: function(name) {
		if (!name) return false;
		var lower = name.toLowerCase();
		return lower.endsWith('.mid') || lower.endsWith('.midi');
	},

	_showOverlay: function(target) {
		MidiDragDrop._hideOverlay();
		var rect = target.getBoundingClientRect();
		var overlay = document.createElement('div');
		overlay.className = 'midi-drop-overlay';
		overlay.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top +
			'px;width:' + rect.width + 'px;height:' + rect.height +
			'px;background:#252525;border:1px solid #4b4b4b;' +
			'display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;' +
			'font:12px sans-serif;color:#8e8e8e;';
		overlay.textContent = 'Drop MIDI file';
		document.body.appendChild(overlay);
		MidiDragDrop._overlay = overlay;
	},

	_hideOverlay: function() {
		if (MidiDragDrop._overlay) {
			MidiDragDrop._overlay.remove();
			MidiDragDrop._overlay = null;
		}
	},

	_bindTarget: function(el) {
		var dragCounter = 0;

		el.addEventListener('dragover', function(e) {
			if (!MidiDragDrop._hasMidiFile(e.dataTransfer)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
		});

		el.addEventListener('dragenter', function(e) {
			if (!MidiDragDrop._hasMidiFile(e.dataTransfer)) return;
			e.preventDefault();
			dragCounter++;
			if (dragCounter === 1) {
				MidiDragDrop._showOverlay(el);
			}
		});

		el.addEventListener('dragleave', function(e) {
			if (!MidiDragDrop._hasMidiFile(e.dataTransfer)) return;
			dragCounter--;
			if (dragCounter <= 0) {
				dragCounter = 0;
				MidiDragDrop._hideOverlay();
			}
		});

		el.addEventListener('drop', function(e) {
			dragCounter = 0;
			MidiDragDrop._hideOverlay();

			if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;

			var file = null;
			for (var i = 0; i < e.dataTransfer.files.length; i++) {
				if (MidiDragDrop._isMidiFilename(e.dataTransfer.files[i].name)) {
					file = e.dataTransfer.files[i];
					break;
				}
			}
			if (!file) return;

			e.preventDefault();
			e.stopPropagation();

			var reader = new FileReader();
			reader.onload = function(ev) {
				try {
					if (typeof window.loadMIDIFile !== 'function') {
						Logger.error('loadMIDIFile not available');
						return;
					}
					window.loadMIDIFile(ev.target.result, {
						MIDI: window.MIDI,
						DB: window.DB,
						UI: window.UI,
						instruments: window.instruments,
						showStatus: window.showStatus
					});

					if (window.UI && window.UI.instruments && typeof window.UI.instruments.refresh === 'function') {
						window.UI.instruments.refresh();
					}
					if (typeof Timeline !== 'undefined' && typeof Timeline.draw === 'function') {
						Timeline.draw();
					}
					if (typeof Canvas !== 'undefined' && typeof Canvas.step === 'function') {
						Canvas.step();
					}
				} catch (err) {
					Logger.error('Failed to import MIDI file:', err);
					if (typeof window.showStatus === 'function') {
						window.showStatus('Failed to import MIDI file: ' + err.message);
					}
				}
			};
			reader.onerror = function() {
				Logger.error('Failed to read MIDI file');
				if (typeof window.showStatus === 'function') {
					window.showStatus('Failed to read MIDI file');
				}
			};
			reader.readAsArrayBuffer(file);
		});
	}
};

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', function() {
		// Mierny hazard, avšak krátky timeout je nutný pre istotu, aby bolo jasné, že plátna už boli pripravené.
		setTimeout(MidiDragDrop.init, 100);
	});
} else {
	setTimeout(MidiDragDrop.init, 100);
}
