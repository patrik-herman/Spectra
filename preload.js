var { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	platform: process.platform,
	isElectron: true,

	windowMinimize: () => ipcRenderer.send('window-minimize'),
	windowMaximize: () => ipcRenderer.send('window-maximize'),
	windowClose: () => ipcRenderer.send('window-close'),
	windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
	onWindowMaximized: (callback) => ipcRenderer.on('window-maximized', (event, isMaximized) => callback(isMaximized)),

	setTitle: (title) => ipcRenderer.send('set-title', title),

	saveFile: (filePath, content) => ipcRenderer.invoke('save-file', { filePath, content }),
	readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
	showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
	showSaveDialog: (defaultPath) => ipcRenderer.invoke('show-save-dialog', { defaultPath }),

	onOpenProjectFile: (callback) => ipcRenderer.on('open-project-file', (event, filePath) => callback(filePath)),


	projectGetDir: () => ipcRenderer.invoke('project-get-dir'),
	projectOpenFolder: () => ipcRenderer.invoke('project-open-folder'),
	projectList: () => ipcRenderer.invoke('project-list'),
	projectRead: (projectId) => ipcRenderer.invoke('project-read', { projectId }),
	projectSave: (projectId, project) => ipcRenderer.invoke('project-save', { projectId, project }),
	projectDelete: (projectId) => ipcRenderer.invoke('project-delete', { projectId }),
	appSettingsRead: () => ipcRenderer.invoke('app-settings-read'),
	appSettingsSave: (settings) => ipcRenderer.invoke('app-settings-save', { settings }),

	networkGetLocalInfo: () => ipcRenderer.invoke('network-get-local-info'),
	networkQuickScan: () => ipcRenderer.invoke('network-quick-scan'),
	networkFullScan: (options) => ipcRenderer.invoke('network-full-scan', options),
	networkStartDiscoveryStream: () => ipcRenderer.send('network-start-discovery-stream'),
	networkStopDiscoveryStream: () => ipcRenderer.send('network-stop-discovery-stream'),
	onNetworkDeviceDiscovered: (callback) => {
		var listener = (event, device) => callback(device);
		ipcRenderer.on('network-device-discovered', listener);
		return () => ipcRenderer.removeListener('network-device-discovered', listener);
	},

	removeAllListeners: (channel) => {
		var allowed = ['network-device-discovered', 'osc-message-received', 'window-maximized', 'open-project-file'];
		if (allowed.includes(channel)) ipcRenderer.removeAllListeners(channel);
	},


	oscStartServer: () => ipcRenderer.invoke('osc-start-server'),
	oscStopServer: () => ipcRenderer.invoke('osc-stop-server'),
	oscGetStatus: () => ipcRenderer.invoke('osc-get-status'),
	oscAddDevice: (deviceId, host, port) =>
		ipcRenderer.invoke('osc-add-device', { deviceId, host, port }),

	oscRemoveDevice: (deviceId) =>
		ipcRenderer.invoke('osc-remove-device', { deviceId }),

	oscSend: (deviceId, address, args) =>
		ipcRenderer.invoke('osc-send', { deviceId, address, args }),

	onOscMessage: (callback) => {
		var listener = (event, message) => callback(message);
		ipcRenderer.on('osc-message-received', listener);
		return () => ipcRenderer.removeListener('osc-message-received', listener);
	},

});

if (process.env.NODE_ENV !== 'production') {
	console.log('Spectra Desktop - Electron preload initialized');
}
