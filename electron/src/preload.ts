import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('electronAPI', {
	/** Back to the repository hub (first screen). */
	goHome: () => ipcRenderer.send('go-home'),
	/** Repos known to the main process at window-load time, read synchronously so index.html's initialState is real. */
	initial: ipcRenderer.sendSync('get-initial-state') as { repos: unknown, lastActiveRepo: string | null },
	/** Repository hub (home.html). */
	home: {
		list: () => invoke('home:list'),
		summary: (repo: string) => invoke('home:summary', repo),
		defaults: () => invoke('home:defaults'),
		pickFolder: (title: string) => invoke('home:pick-folder', title),
		open: (repo: string) => invoke('home:open', repo),
		add: (folder: string | null) => invoke('home:add', folder),
		scan: (folder: string | null) => invoke('home:scan', folder),
		clone: (opts: { url: string, parent: string, name: string }) => invoke('home:clone', opts),
		init: (opts: { parent: string, name: string }) => invoke('home:init', opts),
		remove: (repo: string) => invoke('home:remove', repo),
		pin: (repo: string) => invoke('home:pin', repo),
		reveal: (repo: string) => invoke('home:reveal', repo),
		terminal: (repo: string) => invoke('home:terminal', repo),
		copyPath: (repo: string) => invoke('home:copy-path', repo),
		checkTarget: (parent: string, name: string) => invoke('home:check-target', parent, name),
		cancelClone: () => invoke('home:cancel-clone'),
		pathForFile: (file: File) => webUtils.getPathForFile(file),
		onReposChanged: (cb: () => void) => { ipcRenderer.on('home:repos-changed', () => cb()); },
		onCloneProgress: (cb: (p: unknown) => void) => { ipcRenderer.on('home:clone-progress', (_e, p) => cb(p)); },
		/** Menu "Add / Clone / New repository" (see main.ts hubAction). */
		onAction: (cb: (action: string) => void) => { ipcRenderer.on('home:action', (_e, a) => cb(a)); }
	},
	/** Window chrome for ui/titlebar.js (see chrome.ts). */
	chrome: {
		state: () => invoke('chrome:state'),
		menu: () => invoke('chrome:menu'),
		run: (id: string) => invoke('chrome:menu-run', id),
		onTitle: (cb: (title: string) => void) => { ipcRenderer.on('chrome:title', (_e, t) => cb(t)); }
	}
});
