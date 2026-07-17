import { contextBridge, ipcRenderer } from 'electron';

/**
 * Shims VSCode's webview `acquireVsCodeApi()` global so the existing
 * media/out.min.js bundle (compiled from web/*.ts) runs unmodified in Electron.
 * postMessage -> ipcRenderer.send, and inbound IPC messages are redispatched
 * as window 'message' events (what web/main.ts's listener expects).
 */

let state: unknown = null;

contextBridge.exposeInMainWorld('acquireVsCodeApi', () => {
	return {
		getState: () => state,
		setState: (newState: unknown) => {
			state = newState;
			return newState;
		},
		postMessage: (message: unknown) => {
			ipcRenderer.send('git-graph-message', message);
		}
	};
});

ipcRenderer.on('git-graph-message', (_event, message) => {
	window.postMessage(message, '*');
});

/** Exposes the "Add Repository" folder-picker as an in-page button, separate from the app menu. */
contextBridge.exposeInMainWorld('electronAPI', {
	addRepository: () => ipcRenderer.send('add-repository')
});
