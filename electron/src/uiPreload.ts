import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for the themed secondary windows created by uiWindow.ts (pickers, prompts, credential
 * prompt, message dialogs, diff viewer). Exposes a tiny `window.uiWindow` bridge: the window's
 * initial payload (read synchronously so the page renders in one pass), result submission, and
 * live updates (e.g. download progress).
 */
contextBridge.exposeInMainWorld('uiWindow', {
	init: ipcRenderer.sendSync('ui-window:init') as { view: string, title: string, platform: string, data: unknown },
	submit: (value: unknown) => ipcRenderer.send('ui-window:result', value),
	close: () => ipcRenderer.send('ui-window:result', null),
	/** Ask the main process to fit the window's height to the rendered content. */
	fit: (height: number) => ipcRenderer.send('ui-window:fit', height),
	onUpdate: (cb: (data: unknown) => void) => { ipcRenderer.on('ui-window:update', (_e, data) => cb(data)); }
});
