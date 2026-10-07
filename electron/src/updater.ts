import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { AppDialogHandle, openAppDialog, showAppDialog } from './appDialog';
import { Logger } from './logger';

/**
 * Wires electron-updater to GitHub Releases (see the `build.publish` config in package.json).
 * No-ops entirely when running unpacked from source (`npm start`) - electron-updater has no
 * real feed to hit there, and would otherwise error on every launch.
 *
 * Every prompt is a themed dialog (appDialog.ts). The download shows real progress (percentage,
 * bytes, speed) inside the dialog, plus the taskbar progress bar.
 */

const logger = new Logger();
let initialized = false;
let checkInFlight = false;

/** The themed "Downloading update" dialog (null when hidden / not downloading). */
let progressDialog: AppDialogHandle | null = null;

export function initAutoUpdater(win: BrowserWindow) {
	if (!app.isPackaged || initialized) return;
	initialized = true;

	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	// GitHub release assets can't be fetched with range requests reliably, and the previous version's
	// blockmap isn't always available - a plain full download is simpler and robust.
	autoUpdater.disableDifferentialDownload = true;

	const finishProgress = () => {
		if (!win.isDestroyed()) win.setProgressBar(-1);
		if (progressDialog !== null) progressDialog.close();
		progressDialog = null;
	};

	autoUpdater.on('update-available', (info) => {
		promptUpdateAvailable(win, info.version).then((download) => {
			if (!download) return;
			if (!win.isDestroyed()) win.setProgressBar(2); // indeterminate until the first progress event
			progressDialog = showDownloadProgress(win, info.version);
			autoUpdater.downloadUpdate().catch((err) => {
				logger.logError('Failed to download update: ' + err.message);
				finishProgress();
				showAppDialog({ parent: win, type: 'error', title: 'Update failed', message: 'The update could not be downloaded.', detail: err.message });
			});
		});
	});

	autoUpdater.on('download-progress', (progress) => {
		if (!win.isDestroyed()) win.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
		if (progressDialog !== null && progressDialog.isOpen()) {
			progressDialog.update({ progress: { percent: progress.percent, transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond } });
		}
	});

	autoUpdater.on('update-downloaded', (info) => {
		finishProgress();
		promptRestart(win, info.version).then((restart) => {
			if (restart) autoUpdater.quitAndInstall();
		});
	});

	autoUpdater.on('error', (err) => {
		checkInFlight = false;
		logger.logError('Auto-update failed: ' + err.message);
	});
}

export function promptUpdateAvailable(win: BrowserWindow, version: string): Promise<boolean> {
	return showAppDialog({
		parent: win,
		type: 'update',
		title: 'Update available',
		message: 'Git Graph ' + version + ' is available - you have ' + app.getVersion() + '.',
		detail: 'The download runs in the background; you can keep working and will be asked to restart when it is ready.',
		buttons: ['Download', 'Not now']
	}).then((r) => r === 0);
}

/** The progress dialog: "Hide" closes it while the download continues (taskbar progress stays). */
export function showDownloadProgress(win: BrowserWindow, version: string): AppDialogHandle {
	return openAppDialog({
		parent: win,
		type: 'update',
		title: 'Downloading update',
		message: 'Downloading Git Graph ' + version + '...',
		progress: { percent: null },
		buttons: ['Hide']
	});
}

export function promptRestart(win: BrowserWindow, version: string): Promise<boolean> {
	return showAppDialog({
		parent: win,
		type: 'success',
		title: 'Update ready',
		message: 'Git Graph ' + version + ' has been downloaded.',
		detail: 'Restart now to install it, or keep working and install it later.',
		buttons: ['Restart & install', 'Later']
	}).then((r) => r === 0);
}

/**
 * @param manual TRUE if triggered from the "Check for Updates..." menu item (shows a
 * "you're up to date" dialog when nothing is found); FALSE for the silent startup check.
 */
export function checkForUpdates(win: BrowserWindow, manual: boolean) {
	if (!app.isPackaged) {
		if (manual) {
			showAppDialog({ parent: win, type: 'info', title: 'Check for updates', message: 'Update checking is not available when running from source.' });
		}
		return;
	}
	if (checkInFlight) return;
	checkInFlight = true;

	autoUpdater.checkForUpdates().then((result) => {
		checkInFlight = false;
		if (manual && (result === null || result.updateInfo.version === app.getVersion())) {
			showAppDialog({ parent: win, type: 'success', title: 'You\'re up to date', message: 'Git Graph ' + app.getVersion() + ' is the latest version.' });
		}
	}).catch((err) => {
		checkInFlight = false;
		logger.logError('Auto-update check failed: ' + err.message);
		if (manual) {
			showAppDialog({ parent: win, type: 'error', title: 'Check for updates', message: 'Unable to check for updates.', detail: err.message });
		}
	});
}
