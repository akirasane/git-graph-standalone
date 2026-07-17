import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { Logger } from './logger';

/**
 * Wires electron-updater to GitHub Releases (see the `build.publish` config in package.json).
 * No-ops entirely when running unpacked from source (`npm start`) - electron-updater has no
 * real feed to hit there, and would otherwise error on every launch.
 */

const logger = new Logger();
let initialized = false;
let checkInFlight = false;

export function initAutoUpdater(win: BrowserWindow) {
	if (!app.isPackaged || initialized) return;
	initialized = true;

	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;

	autoUpdater.on('update-available', (info) => {
		dialog.showMessageBox(win, {
			type: 'info',
			title: 'Update Available',
			message: 'A new version of Git Graph (' + info.version + ') is available. Download it now?',
			buttons: ['Download', 'Not Now'],
			defaultId: 0,
			cancelId: 1
		}).then((result) => {
			if (result.response === 0) {
				autoUpdater.downloadUpdate().catch((err) => logger.logError('Failed to download update: ' + err.message));
			}
		});
	});

	autoUpdater.on('update-downloaded', (info) => {
		dialog.showMessageBox(win, {
			type: 'info',
			title: 'Update Ready',
			message: 'Git Graph ' + info.version + ' has been downloaded. Restart now to install it?',
			buttons: ['Restart & Install', 'Later'],
			defaultId: 0,
			cancelId: 1
		}).then((result) => {
			if (result.response === 0) {
				autoUpdater.quitAndInstall();
			}
		});
	});

	autoUpdater.on('error', (err) => {
		checkInFlight = false;
		logger.logError('Auto-update check failed: ' + err.message);
	});
}

/**
 * @param manual TRUE if triggered from the "Check for Updates..." menu item (shows a
 * "you're up to date" dialog when nothing is found); FALSE for the silent startup check.
 */
export function checkForUpdates(win: BrowserWindow, manual: boolean) {
	if (!app.isPackaged) {
		if (manual) {
			dialog.showMessageBox(win, {
				type: 'info',
				title: 'Check for Updates',
				message: 'Update checking is not available when running from source.'
			});
		}
		return;
	}
	if (checkInFlight) return;
	checkInFlight = true;

	autoUpdater.checkForUpdates().then((result) => {
		checkInFlight = false;
		if (manual && (result === null || result.updateInfo.version === app.getVersion())) {
			dialog.showMessageBox(win, {
				type: 'info',
				title: 'Check for Updates',
				message: 'You\'re already running the latest version (' + app.getVersion() + ').'
			});
		}
	}).catch((err) => {
		checkInFlight = false;
		logger.logError('Auto-update check failed: ' + err.message);
		if (manual) {
			dialog.showMessageBox(win, {
				type: 'error',
				title: 'Check for Updates',
				message: 'Unable to check for updates: ' + err.message
			});
		}
	});
}
