// Sekundárne zoznamy v časti Setup na ladenia, farby a mriežky
// zároveň aktualizuje panel so zobrazením aktuálneho kontextu.

var EditorLists = {
	selectedTuning: null,
	selectedTimbre: null,
	selectedGrid: null,
	contextUpdaterInterval: null,
	activeSubmenu: null,
	activeCategory: null,
	hideSubmenuTimeout: null,

	// Funkcia vygeneruje noty 12-EDO: [noteValue, freq, isBlackKey].
	_default12EDONotes: () => {
		var referenceA = 440, divisions = 12, multiplier = 2;
		var notes = [];
		for (let i = 0; i < 128; i++) {
			var freq = referenceA * Math.pow(multiplier, (i - 69) / divisions);
			var noteValue = typeof freq2note === 'function' ? freq2note(freq) : i;
			var isBlackKey = [1, 3, 6, 8, 10].includes(((i % 12) + 12) % 12) ? 1 : 0;
			notes.push([noteValue, freq, isBlackKey]);
		}
		return notes;
	},

	init: () => {
		EditorLists.hideEditorContent('tuning');
		EditorLists.hideEditorContent('timbre');
		EditorLists.hideEditorContent('grid');

		EditorLists.hideAllListContainers();
		// Zobrazenie zoznamu ladení, keďže záložka Tuning je predvolene vybraná.
		EditorLists.showListContainer('tuning');

		EditorLists.populateTuningList();
		EditorLists.populateTimbreList();
		EditorLists.populateGridList();
		EditorLists.bindEvents();
		EditorLists.bindSubmenuEvents();
		EditorLists.startContextUpdater();
	},

	showSubmenu: (category, submenu) => {
		if (EditorLists.hideSubmenuTimeout) {
			clearTimeout(EditorLists.hideSubmenuTimeout);
			EditorLists.hideSubmenuTimeout = null;
		}

		if (EditorLists.activeSubmenu && EditorLists.activeSubmenu !== submenu) {
			EditorLists.activeSubmenu.classList.remove('visible');
		}

		EditorLists.activeCategory = category;
		EditorLists.activeSubmenu = submenu;
		EditorLists.positionSubmenu();
	},

	positionSubmenu: () => {
		var category = EditorLists.activeCategory;
		var submenu = EditorLists.activeSubmenu;
		if (!category || !submenu) return;

		var rect = category.getBoundingClientRect();
		var left = rect.right + 4;

		// Dočasne sa menu zobrazí mimo viditeľnej plochy na zmeranie skutočnej výšky.
		if (!submenu.classList.contains('visible')) {
			submenu.style.top = '-9999px';
			submenu.style.left = '-9999px';
			submenu.classList.add('visible');
		}

		var submenuHeight = submenu.offsetHeight;

		// Vertikálne sa horná hrana zarovná s kategóriou, ale bez presahu mimo obrazovky.
		var top = rect.top;
		if (top + submenuHeight > window.innerHeight - 10) {
			top = Math.max(10, window.innerHeight - submenuHeight - 10);
		}

		submenu.style.top = top + 'px';
		submenu.style.left = left + 'px';
		submenu.style.right = 'auto';
	},

	// Skryje sa menu s drobným oneskorením, aby bolo možné presunúť myš na sekundárne menu.
	// Jedným zo starších spôsobov bez použitia JS bolo prekryť obidva elementy skrz CSS alebo použiť ::before s absolútnou pozíciou. Tento spôsob však zaručuje funkčnosť, obzvlášť, keďže softvér nie je možné spustiť bez JS.

	hideSubmenuDelayed: () => {
		EditorLists.hideSubmenuTimeout = setTimeout(() => {
			if (EditorLists.activeSubmenu) {
				EditorLists.activeSubmenu.classList.remove('visible');
				EditorLists.activeSubmenu = null;
				EditorLists.activeCategory = null;
			}
		}, 100);
	},

	cancelHideSubmenu: () => {
		if (EditorLists.hideSubmenuTimeout) {
			clearTimeout(EditorLists.hideSubmenuTimeout);
			EditorLists.hideSubmenuTimeout = null;
		}
	},

	bindSubmenuEvents: () => {
		var editorContainer = document.querySelector('.editor-lists-container') || document.querySelector('.setup-content') || document;

		editorContainer.addEventListener('mouseover', (e) => {
			var category = e.target.closest('.editor-list-category');
			if (category) {
				const submenu = category.querySelector('.editor-list-submenu');
				if (submenu) {
					EditorLists.showSubmenu(category, submenu);
				}
				return;
			}

			const submenu = e.target.closest('.editor-list-submenu');
			if (submenu) {
				EditorLists.cancelHideSubmenu();
				return;
			}
		});

		editorContainer.addEventListener('mouseout', (e) => {
			var category = e.target.closest('.editor-list-category');
			var submenu = e.target.closest('.editor-list-submenu');

			// Pri opustení kategórie je potrebné skontrolovať, či ide o prechod na jej sekundárne menu.
			if (category && !submenu) {
				const relatedTarget = e.relatedTarget;
				const toSubmenu = relatedTarget?.closest('.editor-list-submenu');
				const toCategory = relatedTarget?.closest('.editor-list-category');

				if (!toSubmenu && !toCategory) {
					EditorLists.hideSubmenuDelayed();
				}
			}

			// Pri opustení sekundárneho menu je potrebné skontrolovať, či ide o prechod na kategóriu.
			if (submenu) {
				const relatedTarget = e.relatedTarget;
				const toCategory = relatedTarget?.closest('.editor-list-category');
				const toSubmenu = relatedTarget?.closest('.editor-list-submenu');

				if (!toCategory && !toSubmenu) {
					EditorLists.hideSubmenuDelayed();
				}
			}
		});

		document.querySelectorAll('.editor-list').forEach(list => {
			list.addEventListener('scroll', () => {
				EditorLists.positionSubmenu();
			});
		});

		document.querySelector('.page')?.addEventListener('scroll', () => {
			EditorLists.positionSubmenu();
		});

		window.addEventListener('resize', () => {
			EditorLists.positionSubmenu();
		});
	},
	
	// Tieto funkcie by som za normálnych okolností nepoužíval, ale pre prehľadnosť ich bolo nutné pridať.
	showEditorContent: (type) => {
		var container = document.querySelector(`.${type}-editor-content`);
		if (container) {
			container.style.display = 'block';
		}
	},
	
	hideEditorContent: (type) => {
		var container = document.querySelector(`.${type}-editor-content`);
		if (container) {
			container.style.display = 'none';
		}
	},
	
	showListContainer: (type) => {
		var container = document.querySelector(`.${type}-list-container`);
		if (container) {
			container.style.display = 'block';
		}
	},
	
	hideListContainer: (type) => {
		var container = document.querySelector(`.${type}-list-container`);
		if (container) {
			container.style.display = 'none';
		}
	},
	
	hideAllListContainers: () => {
		EditorLists.hideListContainer('tuning');
		EditorLists.hideListContainer('timbre');
		EditorLists.hideListContainer('grid');
	},

	createCategoryWithSubmenu: (categoryName) => {
		var category = document.createElement('div');
		category.className = 'editor-list-category';
		category.dataset.category = categoryName;

		var label = document.createElement('span');
		label.className = 'editor-list-category-label';
		label.textContent = categoryName;
		category.appendChild(label);

		var submenu = document.createElement('div');
		submenu.className = 'editor-list-submenu';
		category.appendChild(submenu);

		return { category, submenu };
	},

	// Objekt { categoryName: [keys...], ... } s kategóriou 'User' na konci.
	groupByCategory: (items, defaultCategory = 'Other') => {
		var groups = {};
		var userItems = [];

		for (const [key, item] of Object.entries(items)) {
			// Užívateľom vytvorené položky (bez kategórie a mazateľné).
			if (!item.category && item.deletable !== false) {
				userItems.push(key);
			} else {
				var cat = item.category || defaultCategory;
				if (!groups[cat]) groups[cat] = [];
				groups[cat].push(key);
			}
		}

		if (userItems.length > 0) {
			groups['User'] = userItems;
		}

		return groups;
	},

	populateTuningList: () => {
		var container = document.querySelector('.tuning-list');
		if (!container) return;

		container.innerHTML = '';
		var scalesList = DB.get('scales') || {};

		var groups = EditorLists.groupByCategory(scalesList, 'Standard');

		// Poradie kategórií, kategória User je vždy na konci.
		var categoryOrder = ['Standard', 'Microtonal', 'Just Intonation', 'Spectral', 'Experimental', 'Dynamic'];
		var sortedCategories = Object.keys(groups).sort((a, b) => {
			if (a === 'User') return 1;
			if (b === 'User') return -1;
			var aIdx = categoryOrder.indexOf(a);
			var bIdx = categoryOrder.indexOf(b);
			if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		});

		var builtInKeys = new Set(['free', 'edo12', 'edo24', 'edo36', 'edo48', 'edo31', 'adaptive',
			'pythagorean', 'ji5limit', 'ji7limit', 'harmonicSeries', 'subharmonicSeries',
			'bohlenPierce', 'trombone', 'clarinetSpectral', 'gong', 'monochord']);

		var selectedCategory = null;

		sortedCategories.forEach(categoryName => {
			var keys = groups[categoryName];
			if (!keys || keys.length === 0) return;

			var { category, submenu } = EditorLists.createCategoryWithSubmenu(categoryName);

			keys.forEach(key => {
				var scale = scalesList[key];
				var item = document.createElement('div');
				item.className = 'editor-list-item';
				item.dataset.key = key;

				var nameSpan = document.createElement('span');
				nameSpan.className = 'editor-list-item-name';
				nameSpan.textContent = scale.name || key;
				item.appendChild(nameSpan);

				if (key === 'edo12' && !EditorLists.selectedTuning) {
					item.classList.add('selected');
					EditorLists.selectedTuning = key;
					selectedCategory = category;
				} else if (key === EditorLists.selectedTuning) {
					item.classList.add('selected');
					selectedCategory = category;
				}

				submenu.appendChild(item);
			});

			container.appendChild(category);
		});

		if (selectedCategory) {
			selectedCategory.classList.add('has-selected');
		}

		if (!EditorLists.selectedTuning) {
			var firstItem = container.querySelector('.editor-list-item');
			if (firstItem) {
				EditorLists.selectedTuning = firstItem.dataset.key;
				firstItem.classList.add('selected');
				firstItem.closest('.editor-list-category')?.classList.add('has-selected');
			}
		}

		if (EditorLists.selectedTuning) {
			EditorLists.loadTuningSettings(EditorLists.selectedTuning);
		}
	},
	
	// Reload=true tiež automaticky vyberie predvolenú položku a načíta jej nastavenia; reload=false len
	// prekreslí zoznam; používa sa po uložení, aby sa zachoval aktuálny výber a nastavenia.
	populateTimbreList: (reload = true) => {
		var container = document.querySelector('.timbre-list');
		if (!container) return;

		container.innerHTML = '';
		var spectraList = DB.get('spectra') || {};

		var groups = EditorLists.groupByCategory(spectraList, 'Harmonic');

		// Rovnaký kód ako vyššie, možno by z toho mala byť funkcia, než aby stál inline.
		var categoryOrder = ['Harmonic', 'Inharmonic', 'Dynamic', 'Spectral'];
		var sortedCategories = Object.keys(groups).sort((a, b) => {
			if (a === 'User') return 1;
			if (b === 'User') return -1;
			var aIdx = categoryOrder.indexOf(a);
			var bIdx = categoryOrder.indexOf(b);
			if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		});

		var builtInKeys = new Set(['harmonic16', 'square', 'subharmonic', 'golden', 'stretched', 'tamtam',
			'flute', 'oboe', 'clarinet', 'violin', 'viola', 'cello', 'contrabass']);

		var selectedCategory = null;

		sortedCategories.forEach(categoryName => {
			var keys = groups[categoryName];
			if (!keys || keys.length === 0) return;

			var { category, submenu } = EditorLists.createCategoryWithSubmenu(categoryName);

			keys.forEach(key => {
				var spectrum = spectraList[key];
				var item = document.createElement('div');
				item.className = 'editor-list-item';
				item.dataset.key = key;

				var nameSpan = document.createElement('span');
				nameSpan.className = 'editor-list-item-name';
				nameSpan.textContent = spectrum.name || key;
				item.appendChild(nameSpan);

				if (key === EditorLists.selectedTimbre) {
					item.classList.add('selected');
					selectedCategory = category;
				} else if (reload && !EditorLists.selectedTimbre && key === DEFAULT_SPECTRUM) {
					item.classList.add('selected');
					EditorLists.selectedTimbre = key;
					selectedCategory = category;
				}

				submenu.appendChild(item);
			});

			container.appendChild(category);
		});

		if (selectedCategory) {
			selectedCategory.classList.add('has-selected');
		}

		if (reload) {
			if (!EditorLists.selectedTimbre) {
				var firstItem = container.querySelector('.editor-list-item');
				if (firstItem) {
					EditorLists.selectedTimbre = firstItem.dataset.key;
					firstItem.classList.add('selected');
					firstItem.closest('.editor-list-category')?.classList.add('has-selected');
				}
			}
			if (EditorLists.selectedTimbre) {
				EditorLists.loadTimbreSettings(EditorLists.selectedTimbre);
			}
		}
	},

	populateGridList: () => {
		var container = document.querySelector('.grid-list');
		if (!container) return;

		container.innerHTML = '';
		var gridsList = DB.get('grids') || {};

		var groups = EditorLists.groupByCategory(gridsList, 'Standard');

		// Poradie kategórií, kategória User je vždy na konci.
		var categoryOrder = ['Standard', 'Odd Meters', 'Polyrhythmic', 'Exponential', 'Extreme'];
		var sortedCategories = Object.keys(groups).sort((a, b) => {
			if (a === 'User') return 1;
			if (b === 'User') return -1;
			var aIdx = categoryOrder.indexOf(a);
			var bIdx = categoryOrder.indexOf(b);
			if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		});

		// Vstavané mriežky, pri ktorých sa nemá zobrazovať globálny prepínač.
		var builtInKeys = new Set(['off', 'seconds', 'seconds2', 'seconds4', 'seconds8',
			'harmonic', 'subharmonic', 'sinewave', 'golden', 'clarinet']);

		var selectedCategory = null;

		sortedCategories.forEach(categoryName => {
			var keys = groups[categoryName];
			if (!keys || keys.length === 0) return;

			var { category, submenu } = EditorLists.createCategoryWithSubmenu(categoryName);

			keys.forEach(key => {
				var grid = gridsList[key];
				var item = document.createElement('div');
				item.className = 'editor-list-item';
				item.dataset.key = key;

				var nameSpan = document.createElement('span');
				nameSpan.className = 'editor-list-item-name';
				nameSpan.textContent = grid.name || key;
				item.appendChild(nameSpan);

				if (key === EditorLists.selectedGrid) {
					item.classList.add('selected');
					selectedCategory = category;
				} else if (!EditorLists.selectedGrid && key === 'off') {
					item.classList.add('selected');
					EditorLists.selectedGrid = key;
					selectedCategory = category;
				}

				submenu.appendChild(item);
			});

			container.appendChild(category);
		});

		if (selectedCategory) {
			selectedCategory.classList.add('has-selected');
		}

		if (!EditorLists.selectedGrid) {
			var firstItem = container.querySelector('.editor-list-item');
			if (firstItem) {
				EditorLists.selectedGrid = firstItem.dataset.key;
				firstItem.classList.add('selected');
				firstItem.closest('.editor-list-category')?.classList.add('has-selected');
			}
		}
		if (EditorLists.selectedGrid) {
			EditorLists.loadGridSettings(EditorLists.selectedGrid);
		}
	},
	
	loadTuningSettings: (key) => {
		var scalesList = DB.get('scales') || {};
		var scale = scalesList[key];
		if (!scale) return;
		
		var nameInput = document.querySelector('.tuning-name');
		var typeSelect = selVisible('.tuning-type');
		
		if (nameInput) nameInput.value = scale.name || key;

		// Určenie typu
		var type = 'edo';
		if (scale.type === 'adaptive' || scale.isAdaptive) type = 'adaptive';
		else if (scale.type === 'linear') type = 'linear';
		else if (scale.type === 'spectral') type = 'spectral';
		else if (scale.type === 'spectral-import') type = 'spectral-import';
		else if (scale.type === 'audio-analysis') type = 'audio-analysis';
		else if (scale.type === 'file') type = 'file';
		else if (scale.type === 'custom') type = 'custom';
		
		if (typeSelect) {
			typeSelect.value = type;
			// Zobrazenie správneho panela nastavení bez automatického generovania.
			document.querySelectorAll('.tuning-settings').forEach(el => {
				el.classList.add('hidden');
			});
			var settingsMap = {
				'edo': '.edo-settings',
				'linear': '.linear-settings',
				'spectral': '.spectral-settings',
				'spectral-import': '.spectral-import-settings',
				'audio-analysis': '.audio-analysis-settings',
				'file': '.file-settings',
				'custom': '.custom-settings',
				'adaptive': '.adaptive-settings'
			};
			var panel = document.querySelector(settingsMap[type]);
			if (panel) {
				panel.classList.remove('hidden');
			}
			if (typeof Setup !== 'undefined' && Setup.tuning && Setup.tuning.loadExisting) {
				Setup.tuning.loadExisting();
			}
		}

		if (type === 'adaptive' && typeof AdaptiveTuning !== 'undefined') {
			AdaptiveTuning.loadEditorConfig(scale);
		}
	},
	
	loadTimbreSettings: (key) => {
		// Preskočenie v prípade, ak práve prebieha ukladanie.
		if (typeof Setup !== 'undefined' && Setup.timbre?._saving) return;
		
		var spectraList = DB.get('spectra') || {};
		var spectrum = spectraList[key];
		if (!spectrum) return;
		
		var nameInput = document.querySelector('.timbre-name');
		var countInput = document.querySelector('.timbre-partials-count');
		
		if (nameInput) nameInput.value = spectrum.name || key;

		// Nastavenie počtu z keypoints alebo zo staršieho poľa data.
		if (countInput) {
			if (spectrum.keypoints && spectrum.keypoints[0]) {
				countInput.value = spectrum.keypoints[0].data?.length || 8;
			} else if (spectrum.data) {
				countInput.value = spectrum.data.length;
			}
		}
		
		if (typeof Setup !== 'undefined' && Setup.timbre && Setup.timbre.load) {
			Setup.timbre.load();
		} else if (typeof UI !== 'undefined' && UI.timbre && UI.timbre.loadFromSpectrum) {
			UI.timbre.loadFromSpectrum(key);
		}
		
		if (typeof EnvelopeUI !== 'undefined' && EnvelopeUI.loadFromTimbre) {
			EnvelopeUI.loadFromTimbre(spectrum);
		}

		if (typeof DynamicTimbre !== 'undefined' && DynamicTimbre.partialPan) {
			DynamicTimbre.partialPan.loadFromTimbre(spectrum);
		}
	},
	
	loadGridSettings: (key) => {
		var gridsList = DB.get('grids') || {};
		var grid = gridsList[key];
		if (!grid) return;
		
		var nameInput = document.querySelector('.grid-name');
		var typeSelect = document.querySelector('.grid-type');
		
		if (nameInput) nameInput.value = grid.name || key;
		if (typeSelect && grid.type && grid.type !== 'off') {
			typeSelect.value = grid.type;
			typeSelect.dispatchEvent(new Event('change'));
		}
		
		if (grid.type === 'linear') {
			var spacingInput = document.querySelector('.grid-linear-spacing');
			var subdivInput = document.querySelector('.grid-linear-subdivisions');
			if (spacingInput) spacingInput.value = grid.spacingMs || 500;
			if (subdivInput) subdivInput.value = grid.subdivisions || 4;
		}
	},
	
	bindEvents: () => {
		document.querySelector('.tuning-list')?.addEventListener('click', async (e) => {
			const item = e.target.closest('.editor-list-item');
			if (!item) return;

			document.querySelectorAll('.tuning-list .editor-list-item').forEach(el =>
				el.classList.remove('selected'));
			document.querySelectorAll('.tuning-list .editor-list-category').forEach(el =>
				el.classList.remove('has-selected'));

			item.classList.add('selected');
			item.closest('.editor-list-category')?.classList.add('has-selected');

			EditorLists.selectedTuning = item.dataset.key;
			EditorLists.loadTuningSettings(item.dataset.key);
			EditorLists.showEditorContent('tuning');
		});

		document.querySelector('.timbre-list')?.addEventListener('click', async (e) => {
			const item = e.target.closest('.editor-list-item');
			if (!item) return;

			document.querySelectorAll('.timbre-list .editor-list-item').forEach(el =>
				el.classList.remove('selected'));
			document.querySelectorAll('.timbre-list .editor-list-category').forEach(el =>
				el.classList.remove('has-selected'));

			item.classList.add('selected');
			item.closest('.editor-list-category')?.classList.add('has-selected');

			EditorLists.selectedTimbre = item.dataset.key;
			EditorLists.loadTimbreSettings(item.dataset.key);
			EditorLists.showEditorContent('timbre');
		});

		document.querySelector('.grid-list')?.addEventListener('click', async (e) => {
			const item = e.target.closest('.editor-list-item');
			if (!item) return;

			document.querySelectorAll('.grid-list .editor-list-item').forEach(el =>
				el.classList.remove('selected'));
			document.querySelectorAll('.grid-list .editor-list-category').forEach(el =>
				el.classList.remove('has-selected'));

			item.classList.add('selected');
			item.closest('.editor-list-category')?.classList.add('has-selected');

			EditorLists.selectedGrid = item.dataset.key;
			// Zároveň synchronizácia GridSystem.editor.currentGrid.
			if (typeof GridSystem !== 'undefined' && GridSystem.editor) {
				GridSystem.editor.currentGrid = item.dataset.key;
			}
			EditorLists.loadGridSettings(item.dataset.key);
			EditorLists.showEditorContent('grid');
		});

		// Tlačidlá na pridanie.
		document.querySelector('.tuning-add')?.addEventListener('click', () => {
			var scalesList = DB.get('scales') || {};
			var baseName = 'New Tuning';
			var key = 'new_tuning';
			var counter = 1;
			while (scalesList[key]) {
				baseName = `New Tuning ${counter}`;
				key = `new_tuning_${counter}`;
				counter++;
			}
			
			scalesList[key] = {
				name: baseName,
				full: baseName,
				description: 'EDO tuning',
				type: 'edo',
				notes: [],
				orderedPartials: [{}, {}, {}]
			};

			scalesList[key].notes = EditorLists._default12EDONotes();

			DB.set('scales', scalesList);
			window.scales = scalesList;

			if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
				DB.calculateOrderedPartials();
			}

			EditorLists.selectedTuning = key;
			EditorLists.populateTuningList();
			EditorLists.loadTuningSettings(key);
			EditorLists.showEditorContent('tuning');

			// Setup.currentTuning už je nastavené cez loadTuningSettings -> Setup.tuning.loadExisting(),
			// ktoré načíta všetky dáta špecifické pre daný typ, čiže ho nie je na tomto mieste potrebné opäť volať,
			// len sa nastaví atribút.
			if (typeof Setup !== 'undefined' && Setup.currentTuning) {
				Setup.currentTuning.key = key;
			}
		});
		
		document.querySelector('.timbre-add')?.addEventListener('click', () => {
			var spectraList = DB.get('spectra') || {};
			var baseName = 'New Timbre';
			var key = 'new_timbre';
			var counter = 1;
			while (spectraList[key]) {
				baseName = `New Timbre ${counter}`;
				key = `new_timbre_${counter}`;
				counter++;
			}
			
			var partialCount = 16;
			var data = [];
			for (let i = 1; i <= partialCount; i++) {
				data.push([i, 1 / i]); // Harmonický rad s klesajúcou amplitúdou.
			}

			spectraList[key] = {
				name: baseName,
				data: data
			};

			DB.set('spectra', spectraList);
			window.spectra = spectraList;

			if (typeof UI !== 'undefined' && UI.instruments?.refresh) UI.instruments.refresh();

			if (typeof DB !== 'undefined' && DB.calculateOrderedPartials) {
				DB.calculateOrderedPartials();
			}

			EditorLists.selectedTimbre = key;
			EditorLists.populateTimbreList();
			EditorLists.loadTimbreSettings(key);
			EditorLists.showEditorContent('timbre');

			if (typeof Setup !== 'undefined' && Setup.currentTimbre) {
				Setup.currentTimbre.key = key;
			}
		});
		
		document.querySelector('.grid-add')?.addEventListener('click', () => {
			var gridsList = DB.get('grids') || {};
			var baseName = 'New Grid';
			var key = 'new_grid';
			var counter = 1;
			while (gridsList[key]) {
				baseName = `New Grid ${counter}`;
				key = `new_grid_${counter}`;
				counter++;
			}
			
			gridsList[key] = {
				name: baseName,
				type: 'linear',
				spacingMs: 500,
				subdivisions: 4,
				deletable: true
			};

			DB.set('grids', gridsList);
			window.grids = gridsList;

			EditorLists.selectedGrid = key;
			EditorLists.populateGridList();
			EditorLists.loadGridSettings(key);
			EditorLists.showEditorContent('grid');

			if (typeof GridSystem !== 'undefined' && GridSystem.editor) {
				GridSystem.editor.currentGrid = key;
			}
		});
		
		// Tlačidlá na odstránenie s potvrdením.
		document.querySelector('.tuning-remove')?.addEventListener('click', async () => {
			if (!EditorLists.selectedTuning) return;

			var scalesList = DB.get('scales') || {};
			var scale = scalesList[EditorLists.selectedTuning];

			if (await showConfirm(`Delete tuning "${scale?.name || EditorLists.selectedTuning}"?`, { title: 'Delete Tuning', type: 'danger' })) {
				delete scalesList[EditorLists.selectedTuning];
				DB.set('scales', scalesList);

				EditorLists.selectedTuning = null;
				EditorLists.populateTuningList();

				if (EditorLists.selectedTuning) {
					EditorLists.showEditorContent('tuning');
				} else {
					EditorLists.hideEditorContent('tuning');
				}
			}
		});
		
		document.querySelector('.timbre-remove')?.addEventListener('click', async () => {
			if (!EditorLists.selectedTimbre) return;

			var spectraList = DB.get('spectra') || {};
			var spectrum = spectraList[EditorLists.selectedTimbre];

			if (await showConfirm(`Delete timbre "${spectrum?.name || EditorLists.selectedTimbre}"?`, { title: 'Delete Timbre', type: 'danger' })) {
				delete spectraList[EditorLists.selectedTimbre];
				DB.set('spectra', spectraList);

				// Stopy, ktoré stále odkazujú na zmazanú farbu, by vykresľovali noty s jediným
				// parciálom a bez harmonických, a preto sa premapujú na sawtooth a užívateľ sa neskôr na to upozorní.
				var instrumentList = DB.get('instruments') || [];
				var remapped = [];
				for (let i = 0; i < instrumentList.length; i++) {
					if (instrumentList[i].spectrum === EditorLists.selectedTimbre) {
						instrumentList[i].spectrum = DEFAULT_SPECTRUM;
						remapped.push(i + 1);
					}
				}
				if (remapped.length) {
					DB.set('instruments', instrumentList, { skipUndo: true });
					showStatus('Deleted timbre was in use on track ' + remapped.join(', ') + ' - switched to Sawtooth', { type: 'warning' });
				}
				if (typeof UI !== 'undefined' && UI.instruments?.refresh) UI.instruments.refresh();
				if (typeof Canvas !== 'undefined' && Canvas.refreshCache) Canvas.refreshCache();

				EditorLists.selectedTimbre = null;
				EditorLists.populateTimbreList();

				if (EditorLists.selectedTimbre) {
					EditorLists.showEditorContent('timbre');
				} else {
					EditorLists.hideEditorContent('timbre');
				}
			}
		});
		
		document.querySelector('.grid-remove')?.addEventListener('click', async () => {
			if (!EditorLists.selectedGrid) return;

			var gridsList = DB.get('grids') || {};
			var grid = gridsList[EditorLists.selectedGrid];

			if (await showConfirm(`Delete grid "${grid?.name || EditorLists.selectedGrid}"?`, { title: 'Delete Grid', type: 'danger' })) {
				delete gridsList[EditorLists.selectedGrid];
				DB.set('grids', gridsList);

				EditorLists.selectedGrid = null;
				EditorLists.populateGridList();

				if (EditorLists.selectedGrid) {
					EditorLists.showEditorContent('grid');
				} else {
					EditorLists.hideEditorContent('grid');
				}
			}
		});
		
		document.querySelector('.tuning-save')?.addEventListener('click', () => {
			EditorLists.saveTuning();
		});
		
		document.querySelector('.timbre-save')?.addEventListener('click', () => {
			EditorLists.saveTimbre();
		});
		
		document.querySelector('.grid-save')?.addEventListener('click', () => {
			EditorLists.saveGrid();
		});
	},
	
	// pozn.: Setup.init() naviaže Setup.tuning.save() na to isté tlačidlo, takže samotné ukladanie prebieha tam.
	// Tu sa len obnoví UI.

	saveTuning: () => {
		// Ukladanie je asynchrónne, keďže jeho súčasťou môže byť premenovanie.
		setTimeout(() => {
			if (typeof Setup !== 'undefined' && Setup.currentTuning?.key) {
				EditorLists.selectedTuning = Setup.currentTuning.key;
			}
			if (EditorLists.selectedTuning) {
				EditorLists.showEditorContent('tuning');
			}
		}, 300);
	},

	saveTimbre: () => {
		// Kontrola opakovaným dopytovaním, kým _saving nie je false, keďže uloženie môže zahŕňať asynchrónne potvrdzovacie dialógy.
		var refreshWhenReady = () => {
			if (typeof Setup !== 'undefined' && Setup.timbre?._saving) {
				setTimeout(refreshWhenReady, 100);
				return;
			}
			if (typeof Setup !== 'undefined' && Setup.currentTimbre?.key) {
				EditorLists.selectedTimbre = Setup.currentTimbre.key;
			}
			EditorLists.populateTimbreList(false);
			if (EditorLists.selectedTimbre) {
				EditorLists.showEditorContent('timbre');
			}
		};
		setTimeout(refreshWhenReady, 100);
	},
	
	// GridSystem.editor.init() naviaže GridSystem.editor.save() na .grid-save,
	// takže ukladanie prebieha tam. Tu sa len obnoví UI modulu EditorLists.

	saveGrid: () => {
		// GridSystem.editor.save() zozbiera dáta z formulára a zavolá GridSystem.save(key, gridData).
		setTimeout(() => {
			if (typeof GridSystem !== 'undefined' && GridSystem.editor && GridSystem.editor.currentGrid) {
				EditorLists.selectedGrid = GridSystem.editor.currentGrid;
			}
			EditorLists.populateGridList();
			if (EditorLists.selectedGrid) {
				EditorLists.showEditorContent('grid');
			}
		}, 200);
	},
	
	startContextUpdater: () => {
		if (EditorLists.contextUpdaterInterval) return;

		EditorLists.contextUpdaterInterval = setInterval(() => {
			if (document.hidden) return;
			// Aktualizácia len vtedy, keď je aktívna stránka Write (strana 2); na stránke Setup ani inde sa neaktualizuje.
			var writePage = document.querySelector('.page');
			if (writePage && writePage.style.display === 'none') return;
			EditorLists.updateContextDisplay();
		}, 200); // Aktualizácia päťkrát za sekundu.

		window.addEventListener('beforeunload', EditorLists._onBeforeUnload);
	},

	_onBeforeUnload: () => {
		EditorLists.stopContextUpdater();
	},

	stopContextUpdater: () => {
		if (EditorLists.contextUpdaterInterval) {
			clearInterval(EditorLists.contextUpdaterInterval);
			EditorLists.contextUpdaterInterval = null;
		}
	},
	
	updateContextDisplay: () => {
		if (typeof Timeline === 'undefined') return;
		if (typeof playback === 'undefined') return;
		
		var trackIdx = Timeline.getCurrentTrackIdx?.() || 0;
		var time = playback?.time || 0;
		
		var tuningDisplay = document.querySelector('.info-window-tuning');
		if (tuningDisplay) {
			var tuningKey = Timeline.getTuningAtTime?.(time, trackIdx) || settings?.scale || 'edo12';
			var scale = scales?.[tuningKey];
			tuningDisplay.textContent = scale?.name || tuningKey;
		}

		var gridDisplay = document.querySelector('.info-window-grid');
		if (gridDisplay) {
			var gridKey = Timeline.getGridAtTime?.(time, trackIdx) || settings?.grid || 'off';
			var grid = grids?.[gridKey];
			gridDisplay.textContent = grid?.name || gridKey;
		}
	}
};
document.addEventListener('DOMContentLoaded', () => {
	// Polsekundové oneskorenie pre istotu.
	setTimeout(() => {
		EditorLists.init();
	}, 500);
});