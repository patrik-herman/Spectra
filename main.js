var { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
var path = require('path');
var fs = require('fs');

var oscUdp = null;
try {
	oscUdp = require('./osc-udp');
} catch (e) {
}

var networkDiscovery = null;
try {
	networkDiscovery = require('./network-discovery');
} catch (e) {
}

var DEBUG = !app.isPackaged;
var log = (...args) => { if (DEBUG) console.log('[Spectra]', ...args); };
var warn = (...args) => { if (DEBUG) console.warn('[Spectra]', ...args); };
var error = (...args) => { console.error('[Spectra]', ...args); };

app.commandLine.appendSwitch('enable-web-midi');
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

if (networkDiscovery && oscUdp) {
	networkDiscovery.setOscUdp(oscUdp);
}

var mainWindow;
var pendingFilePath = null;

var isDev = !app.isPackaged;

if (isDev) process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

app.on('open-file', (event, filePath) => {
	event.preventDefault();
	if (mainWindow) {
		mainWindow.webContents.send('open-project-file', filePath);
	} else {
		pendingFilePath = filePath;
	}
});

function getFilePathFromArgs(args) {
	for (const arg of args) {
		if (arg.endsWith('.spectra') || arg.endsWith('.spectra.json')) {
			return arg;
		}
	}
	return null;
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1500,
		height: 900,
		minWidth: 1024,
		minHeight: 600,
		title: 'Spectra',
		icon: path.join(__dirname, 'assets', 'icon.png'),
		backgroundColor: '#0a0a0a',
		frame: false,
		titleBarStyle: 'hidden',
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js'),
			webSecurity: !isDev
		},
		show: false
	});

	if (process.platform === 'darwin') {
		Menu.setApplicationMenu(Menu.buildFromTemplate([
			{ role: 'appMenu' },
			{ role: 'editMenu' },
			{ role: 'windowMenu' }
		]));
	} else {
		Menu.setApplicationMenu(null);
	}

	var rendererLog = app.isPackaged
		? path.join(app.getPath('userData'), 'renderer.log')
		: path.join(__dirname, 'renderer.log');
	var logRenderer = (line) => { try { fs.appendFileSync(rendererLog, line + '\n'); } catch (e) {} };
	try { fs.writeFileSync(rendererLog, '--- spectra session ' + new Date().toISOString() + ' ---\n'); } catch (e) {}

	mainWindow.webContents.on('console-message', function () {
		var a = arguments, lvl, msg, src, ln, ev = a[0];
		if (a[1] === undefined && ev && typeof ev === 'object') {
			lvl = ev.level; msg = ev.message; ln = ev.lineNumber; src = ev.sourceId;
		} else {
			lvl = a[1]; msg = a[2]; ln = a[3]; src = a[4];
		}
		var warnOrError = (typeof lvl === 'number') ? lvl >= 2 : (lvl === 'warning' || lvl === 'error');
		if (warnOrError) logRenderer('[' + lvl + '] ' + msg + '  (' + (src || '') + ':' + (ln || 0) + ')');
	});
	mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => logRenderer('[load-fail] ' + code + ' ' + desc + ' ' + url));
	mainWindow.webContents.on('render-process-gone', (e, details) => logRenderer('[render-gone] ' + JSON.stringify(details)));

    mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
	});

	if (isDev) {
		mainWindow.webContents.on('before-input-event', (event, input) => {
			if (input.key === 'F12' || (input.alt && input.key.toLowerCase() === 'd')) {
				mainWindow.webContents.toggleDevTools();
				event.preventDefault();
			}
		});
	}

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	mainWindow.on('maximize', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('window-maximized', true);
		}
	});
	mainWindow.on('unmaximize', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('window-maximized', false);
		}
	});
}

ipcMain.on('window-minimize', () => {
	if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
	if (mainWindow) {
		if (mainWindow.isMaximized()) {
			mainWindow.unmaximize();
		} else {
			mainWindow.maximize();
		}
	}
});

ipcMain.on('window-close', () => {
	if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
	return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.on('set-title', (event, title) => {
	if (mainWindow) {
		mainWindow.setTitle(title || 'Spectra');
	}
});

ipcMain.handle('save-file', async (event, { filePath, content }) => {
	try {
		fs.writeFileSync(filePath, content, 'utf-8');
		return { success: true };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('read-file', async (event, { filePath }) => {
	try {
		var content = fs.readFileSync(filePath, 'utf-8');
		return { success: true, content };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('show-open-dialog', async () => {
	var result = await dialog.showOpenDialog(mainWindow, {
		title: 'Open Spectra Project',
		filters: [
			{ name: 'Spectra Projects', extensions: ['spectra', 'spectra.json', 'json'] }
		],
		properties: ['openFile']
	});

	if (!result.canceled && result.filePaths.length > 0) {
		var filePath = result.filePaths[0];
		try {
			var content = fs.readFileSync(filePath, 'utf-8');
			return { success: true, filePath, content };
		} catch (err) {
			return { success: false, error: err.message };
		}
	}
	return { success: false, canceled: true };
});

ipcMain.handle('show-save-dialog', async (event, { defaultPath }) => {
	var result = await dialog.showSaveDialog(mainWindow, {
		title: 'Save Spectra Project',
		defaultPath: defaultPath || 'project.spectra',
		filters: [
			{ name: 'Spectra Projects', extensions: ['spectra'] }
		]
	});

	if (!result.canceled && result.filePath) {
		return { success: true, filePath: result.filePath };
	}
	return { success: false, canceled: true };
});


function getProjectsDir() {
	var userDataPath = app.getPath('userData');
	var projectsDir = path.join(userDataPath, 'projects');
	if (!fs.existsSync(projectsDir)) {
		fs.mkdirSync(projectsDir, { recursive: true });
	}
	return projectsDir;
}

function getProjectPath(projectId) {
	return path.join(getProjectsDir(), `${projectId}.spectra`);
}

function findProjectFile(projectId) {
	var projectsDir = getProjectsDir();
	var newPath = path.join(projectsDir, `${projectId}.spectra`);
	var oldPath = path.join(projectsDir, `${projectId}.spectra.json`);

	if (fs.existsSync(newPath)) {
		return { path: newPath, isOldFormat: false };
	}
	if (fs.existsSync(oldPath)) {
		return { path: oldPath, isOldFormat: true };
	}
	return null;
}

ipcMain.handle('project-get-dir', async () => {
	return { success: true, path: getProjectsDir() };
});

ipcMain.handle('project-open-folder', async () => {
	try {
		var projectsDir = getProjectsDir();
		shell.openPath(projectsDir);
		return { success: true, path: projectsDir };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('project-list', async () => {
	try {
		var projectsDir = getProjectsDir();
		var files = fs.readdirSync(projectsDir);
		var projects = [];
		var seenIds = new Set();

		for (const file of files) {
			var id = null;
			if (file.endsWith('.spectra') && !file.endsWith('.spectra.json')) {
				id = file.replace('.spectra', '');
			} else if (file.endsWith('.spectra.json')) {
				id = file.replace('.spectra.json', '');
			}

			if (id && !seenIds.has(id)) {
				seenIds.add(id);
				var filePath = path.join(projectsDir, file);
				try {
					var content = fs.readFileSync(filePath, 'utf-8');
					var project = JSON.parse(content);
					projects.push({
						id,
						name: project.name || 'Untitled',
						createdAt: project.createdAt,
						updatedAt: project.updatedAt,
						filePath
					});
				} catch (err) {
					error(`Error reading project file ${file}:`, err.message);
				}
			}
		}

		projects.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
		return { success: true, projects };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('project-read', async (event, { projectId }) => {
	try {
		var found = findProjectFile(projectId);
		if (!found) {
			return { success: false, error: 'Project not found' };
		}
		var content = fs.readFileSync(found.path, 'utf-8');
		var project = JSON.parse(content);
		project.id = projectId;
		return { success: true, project };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('project-save', async (event, { projectId, project }) => {
	try {
		var id = projectId || `project_${Date.now()}`;
		var filePath = getProjectPath(id);

		if (!project.createdAt) {
			project.createdAt = new Date().toISOString();
		}
		project.updatedAt = new Date().toISOString();
		project.id = id;

		fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
		return { success: true, projectId: id, filePath };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('project-delete', async (event, { projectId }) => {
	try {
		var found = findProjectFile(projectId);
		if (found) {
			fs.unlinkSync(found.path);
		}
		return { success: true };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

function getSettingsPath() {
	return path.join(app.getPath('userData'), 'settings.json');
}

ipcMain.handle('app-settings-read', async () => {
	try {
		var filePath = getSettingsPath();
		if (!fs.existsSync(filePath)) {
			return { success: true, settings: {} };
		}
		var content = fs.readFileSync(filePath, 'utf-8');
		return { success: true, settings: JSON.parse(content) };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('app-settings-save', async (event, { settings }) => {
	try {
		var filePath = getSettingsPath();
		fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
		return { success: true };
	} catch (err) {
		return { success: false, error: err.message };
	}
});



var MINI_EDITION_ERROR = { success: false, error: 'This feature requires Spectra Full edition' };

ipcMain.handle('network-get-local-info', async () => {
	if (!networkDiscovery) return MINI_EDITION_ERROR;
	try {
		return { success: true, ...networkDiscovery.getLocalInfo() };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('network-quick-scan', async () => {
	if (!networkDiscovery) return MINI_EDITION_ERROR;
	try {
		var devices = await networkDiscovery.quickScan();
		return { success: true, devices };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('network-full-scan', async (event, options = {}) => {
	if (!networkDiscovery) return MINI_EDITION_ERROR;
	try {
		var result = await networkDiscovery.fullScan(options);
		return { success: true, ...result };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

var discoveryCallback = null;
ipcMain.on('network-start-discovery-stream', (event) => {
	if (!networkDiscovery) return;
	if (discoveryCallback) {
		networkDiscovery.onDiscovery(() => {})();
	}

	discoveryCallback = networkDiscovery.onDiscovery((device) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('network-device-discovered', device);
		}
	});
});

ipcMain.on('network-stop-discovery-stream', () => {
	if (!networkDiscovery) return;
	if (discoveryCallback) {
		discoveryCallback();
		discoveryCallback = null;
	}
});


ipcMain.handle('osc-start-server', async () => {
	if (!oscUdp) return MINI_EDITION_ERROR;
	try {
		var result = await oscUdp.startServer((message) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('osc-message-received', message);
			}
		});
		return result;
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('osc-stop-server', async () => {
	if (!oscUdp) return { success: true };
	try {
		return oscUdp.stopServer();
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('osc-get-status', async () => {
	if (!oscUdp) return { success: true, running: false, port: null };
	try {
		return { success: true, ...oscUdp.getStatus() };
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('osc-add-device', async (event, { deviceId, host, port }) => {
	if (!oscUdp) return MINI_EDITION_ERROR;
	try {
		return oscUdp.addDevice(deviceId, host, port);
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('osc-remove-device', async (event, { deviceId }) => {
	if (!oscUdp) return { success: true };
	try {
		return oscUdp.removeDevice(deviceId);
	} catch (err) {
		return { success: false, error: err.message };
	}
});

ipcMain.handle('osc-send', async (event, { deviceId, address, args }) => {
	if (!oscUdp) return MINI_EDITION_ERROR;
	return oscUdp.send(deviceId, address, args);
});

app.whenReady().then(() => {
	createWindow();

	var cmdFilePath = getFilePathFromArgs(process.argv);
	if (cmdFilePath) {
		pendingFilePath = cmdFilePath;
	}

	mainWindow.webContents.once('did-finish-load', () => {
		if (pendingFilePath) {
			mainWindow.webContents.send('open-project-file', pendingFilePath);
			pendingFilePath = null;
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on('web-contents-created', (event, contents) => {
	contents.on('will-navigate', (event, url) => {
		var parsedUrl = new URL(url);
		if (parsedUrl.protocol !== 'file:') {
			event.preventDefault();
			shell.openExternal(url);
		}
	});
});

app.on('web-contents-created', (event, contents) => {
	contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
		if (permission === 'midi' || permission === 'midiSysex' || permission === 'media') {
			log('Granting permission:', permission);
			callback(true);
			return;
		}
		log('Denying permission:', permission);
		callback(false);
	});

	contents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
		return permission === 'midi' || permission === 'midiSysex' || permission === 'media';
	});
});
