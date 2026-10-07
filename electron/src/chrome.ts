import { BrowserWindow, Menu, MenuItem, ipcMain } from 'electron';

/**
 * Window chrome for the main window: the native menu bar is hidden (ui/titlebar.js draws the
 * Nocturne title bar), so this module feeds the title bar its title and exposes the application
 * Menu (menu.ts) as data, so the themed in-app menu shows exactly the same items and runs the same
 * click handlers. The native Menu stays installed, which keeps every accelerator working.
 */

export interface ChromeMenuItem {
	id: string;
	label: string;
	accelerator: string | null;
	enabled: boolean;
	separator: boolean;
}

export interface ChromeMenuGroup {
	id: string;
	label: string;
	items: ChromeMenuItem[];
}

function serializeMenu(menu: Menu | null): ChromeMenuGroup[] {
	if (menu === null) return [];
	return menu.items.filter((top) => top.submenu).map((top) => ({
		id: top.id || top.label,
		label: top.label,
		items: top.submenu!.items.filter((item) => item.visible).map((item) => ({
			id: item.id || '',
			label: item.label,
			accelerator: item.accelerator ? String(item.accelerator) : null,
			enabled: item.enabled,
			separator: item.type === 'separator'
		}))
	}));
}

function findItem(menu: Menu | null, id: string): MenuItem | null {
	return menu !== null && id !== '' ? menu.getMenuItemById(id) : null;
}

export function registerChrome(win: BrowserWindow) {
	// Keep the title bar in sync with every title change (repository name, update progress, ...).
	const setTitle = win.setTitle.bind(win);
	win.setTitle = (title: string) => {
		setTitle(title);
		if (!win.isDestroyed()) win.webContents.send('chrome:title', title);
	};
	win.setMenuBarVisibility(false);

	ipcMain.removeHandler('chrome:state');
	ipcMain.handle('chrome:state', () => ({ title: win.getTitle(), platform: process.platform }));
	ipcMain.removeHandler('chrome:menu');
	ipcMain.handle('chrome:menu', () => serializeMenu(Menu.getApplicationMenu()));
	ipcMain.removeHandler('chrome:menu-run');
	ipcMain.handle('chrome:menu-run', (_e, id: string) => {
		const item = findItem(Menu.getApplicationMenu(), id);
		if (item === null || !item.enabled) return false;
		// MenuItem.click runs roles (reload, quit, ...) as well as custom click handlers.
		item.click(undefined, win, win.webContents);
		return true;
	});
}
