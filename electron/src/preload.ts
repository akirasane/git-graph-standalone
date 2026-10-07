import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposes an `acquireHostApi()` global (postMessage/getState/setState) so the
 * media/out.min.js bundle (compiled from web/*.ts) runs unmodified in Electron.
 * postMessage -> ipcRenderer.send, and inbound IPC messages are redispatched
 * as window 'message' events (what web/main.ts's listener expects).
 */

let state: unknown = null;

contextBridge.exposeInMainWorld('acquireHostApi', () => {
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
	addRepository: () => ipcRenderer.send('add-repository'),
	cloneRepository: () => ipcRenderer.send('clone-repository'),
	/** Repos known to the main process at window-load time, read synchronously so index.html's initialState is real. */
	initial: ipcRenderer.sendSync('get-initial-state') as { repos: unknown, lastActiveRepo: string | null }
});
