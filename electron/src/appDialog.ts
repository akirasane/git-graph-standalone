import { BrowserWindow } from 'electron';
import { openUiWindow } from './uiWindow';

/**
 * Themed replacement for `dialog.showMessageBox` / `showErrorBox`: a small frameless modal window
 * drawn with Nocturne's `.dialog` markup. Native OS file pickers (showOpenDialog/showSaveDialog)
 * stay native.
 */

export interface AppDialogProgress {
	/** 0-100, or null for indeterminate. */
	percent: number | null;
	transferred?: number;
	total?: number;
	bytesPerSecond?: number;
	/** Replaces the default "x MB of y MB" line. */
	label?: string;
}

export interface AppDialogOptions {
	type?: 'info' | 'error' | 'warning' | 'question' | 'success' | 'update';
	title: string;
	message: string;
	detail?: string;
	/** Electron order: index 0 is the default/primary action (drawn right-most). Defaults to ['OK']. */
	buttons?: string[];
	defaultId?: number;
	/** Returned for Esc / the close button. Defaults to the last button (or 0 with one button). */
	cancelId?: number;
	/** Style the default button as destructive. */
	danger?: boolean;
	progress?: AppDialogProgress;
	parent?: BrowserWindow | null;
}

export interface AppDialogHandle {
	/** The clicked button index (cancelId when dismissed). */
	result: Promise<number>;
	update(patch: Partial<Pick<AppDialogOptions, 'title' | 'message' | 'detail' | 'buttons' | 'type'>> & { progress?: AppDialogProgress | null }): void;
	close(): void;
	isOpen(): boolean;
}

export function openAppDialog(opts: AppDialogOptions): AppDialogHandle {
	const buttons = opts.buttons && opts.buttons.length > 0 ? opts.buttons : ['OK'];
	const cancelId = typeof opts.cancelId === 'number' ? opts.cancelId : buttons.length - 1;
	const handle = openUiWindow<number>({
		view: 'message',
		title: opts.title,
		width: 440,
		height: 200,
		fitContent: true,
		parent: opts.parent,
		data: {
			type: opts.type || 'info',
			title: opts.title,
			message: opts.message,
			detail: opts.detail || '',
			buttons,
			defaultId: typeof opts.defaultId === 'number' ? opts.defaultId : 0,
			cancelId,
			danger: opts.danger === true,
			progress: opts.progress || null
		}
	});
	let open = true;
	const result = handle.result.then((v) => {
		open = false;
		return typeof v === 'number' ? v : cancelId;
	});
	return {
		result,
		update: (patch) => handle.update(patch),
		close: () => handle.close(),
		isOpen: () => open
	};
}

/** Show a themed message dialog and resolve with the clicked button index. */
export function showAppDialog(opts: AppDialogOptions): Promise<number> {
	return openAppDialog(opts).result;
}
