import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';

/**
 * One shared helper for every secondary window (list picker, text prompt, credential prompt,
 * themed message dialogs, diff viewer), so they all share the Nocturne look and the same keyboard
 * behaviour (Esc closes, Enter submits, focus stays inside).
 *
 * Pages live in electron/ui/ (window.html renders picker / input / credential / message views,
 * diff.html hosts Monaco) and link ../ui/nocturne.css + icons.js like every other page - which is
 * why they are real files loaded with `loadFile` rather than data: URLs. The payload is handed to
 * the page synchronously through uiPreload.ts.
 */

export type UiView = 'picker' | 'input' | 'credential' | 'message' | 'diff';

export interface UiWindowOptions {
	view: UiView;
	title: string;
	data: unknown;
	width: number;
	/** Initial height; with `fitContent` the page resizes the window to its content before it is shown. */
	height: number;
	fitContent?: boolean;
	resizable?: boolean;
	minWidth?: number;
	minHeight?: number;
	/** 'dialog' = frameless modal (own close button); 'window' = normal window with the themed title bar overlay. */
	chrome?: 'dialog' | 'window';
	/** Defaults to the focused window, else the main window. `null` = no parent. */
	parent?: BrowserWindow | null;
}

export interface UiWindowHandle<T> {
	win: BrowserWindow;
	result: Promise<T | null>;
	/** Push new data to the page (e.g. download progress). */
	update(data: unknown): void;
	/** Close the window, resolving `result` with null. */
	close(): void;
}

/** Nocturne colours the native window needs before the page paints (must match ui/nocturne.css). */
export const NOCTURNE = { bg: '#161826', surface: '#232532', text: '#e9e9ed', muted: '#9a9ba3' };

export const TITLEBAR_HEIGHT = 36;

const UI_DIR = path.join(__dirname, '..', 'ui');

interface Session {
	opts: UiWindowOptions;
	win: BrowserWindow;
	finish: (value: unknown) => void;
}

const sessions = new Map<number, Session>();
let defaultParent: BrowserWindow | null = null;
let ipcRegistered = false;

/** The app's main window: the parent of themed dialogs when no window is focused. */
export function setDefaultUiParent(win: BrowserWindow) {
	defaultParent = win;
}

/** Options for a frameless window drawn with the Nocturne title bar (used by the main window too). */
export function themedTitleBarOptions(): Electron.BrowserWindowConstructorOptions {
	return process.platform === 'darwin'
		? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } }
		: { titleBarStyle: 'hidden', titleBarOverlay: { color: NOCTURNE.bg, symbolColor: NOCTURNE.text, height: TITLEBAR_HEIGHT } };
}

function registerIpc() {
	if (ipcRegistered) return;
	ipcRegistered = true;
	ipcMain.on('ui-window:init', (event) => {
		const s = sessions.get(event.sender.id);
		event.returnValue = s ? { view: s.opts.view, title: s.opts.title, platform: process.platform, data: s.opts.data } : null;
	});
	ipcMain.on('ui-window:result', (event, value: unknown) => {
		const s = sessions.get(event.sender.id);
		if (s) s.finish(value);
	});
	ipcMain.on('ui-window:fit', (event, height: number) => {
		const s = sessions.get(event.sender.id);
		if (!s || s.win.isDestroyed()) return;
		const display = screen.getDisplayMatching(s.win.getBounds()).workArea;
		const h = Math.max(80, Math.min(Math.ceil(height), Math.floor(display.height * 0.85)));
		const [w] = s.win.getContentSize();
		s.win.setContentSize(w, h);
		centerOn(s.win, s.win.getParentWindow());
		if (!s.win.isVisible()) s.win.show();
	});
}

function centerOn(win: BrowserWindow, parent: BrowserWindow | null) {
	const b = win.getBounds();
	const area = parent !== null && !parent.isDestroyed() && parent.isVisible() ? parent.getBounds() : screen.getDisplayMatching(b).workArea;
	win.setPosition(Math.round(area.x + (area.width - b.width) / 2), Math.round(area.y + Math.max(0, (area.height - b.height) / 3)));
}

/** Open a themed secondary window. Resolves `result` with what the page submitted, or null when closed. */
export function openUiWindow<T>(opts: UiWindowOptions): UiWindowHandle<T> {
	registerIpc();
	const isDialog = (opts.chrome || 'dialog') === 'dialog';
	let parent = opts.parent === undefined ? (BrowserWindow.getFocusedWindow() || defaultParent) : opts.parent;
	if (parent !== null && parent.isDestroyed()) parent = null;

	const win = new BrowserWindow({
		width: opts.width,
		height: opts.height,
		useContentSize: true,
		minWidth: opts.minWidth,
		minHeight: opts.minHeight,
		resizable: opts.resizable === true,
		show: false,
		title: opts.title,
		parent: parent || undefined,
		modal: isDialog && parent !== null,
		minimizable: !isDialog,
		maximizable: !isDialog,
		fullscreenable: !isDialog,
		skipTaskbar: isDialog && parent !== null,
		backgroundColor: isDialog ? NOCTURNE.surface : NOCTURNE.bg,
		...(isDialog ? { frame: false } : themedTitleBarOptions()),
		webPreferences: {
			preload: path.join(__dirname, 'uiPreload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	win.setMenuBarVisibility(false);
	win.on('page-title-updated', (e) => e.preventDefault());

	let resolveResult: (value: T | null) => void = () => { };
	const result = new Promise<T | null>((resolve) => { resolveResult = resolve; });
	const contentsId = win.webContents.id;
	let done = false;
	const finish = (value: unknown) => {
		if (done) return;
		done = true;
		sessions.delete(contentsId);
		if (!win.isDestroyed()) {
			// Return focus to the owner before closing so the parent does not drop behind other apps.
			if (parent !== null && !parent.isDestroyed()) parent.focus();
			win.close();
		}
		resolveResult(value === undefined ? null : value as T);
	};
	sessions.set(contentsId, { opts, win, finish });
	win.on('closed', () => finish(null));

	if (!opts.fitContent) {
		win.once('ready-to-show', () => {
			centerOn(win, parent);
			win.show();
		});
	} else {
		// Safety net: show even if the page never reports its size.
		setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) { centerOn(win, parent); win.show(); } }, 1500);
	}

	win.loadFile(path.join(UI_DIR, opts.view === 'diff' ? 'diff.html' : 'window.html'));

	return {
		win,
		result,
		update: (data: unknown) => { if (!win.isDestroyed()) win.webContents.send('ui-window:update', data); },
		close: () => finish(null)
	};
}
