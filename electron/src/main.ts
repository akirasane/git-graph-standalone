import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import { AvatarManager } from './avatarManager';
import { createConfig } from './config';
import { getConfigStore } from './configStore';
import { ConfigChangeEvent, DataSource } from './dataSource';
import { GitGraphIpcHandler } from './ipc';
import { Logger } from './logger';
import { addRepository, buildMenu, cloneRepository } from './menu';
import { RepoManager } from './repoManager';
import { Store } from './store';
import { RequestMessage } from './types';
import { checkForUpdates, initAutoUpdater } from './updater';
import { GitExecutable, UNABLE_TO_FIND_GIT_MSG, findGit, showErrorMessage } from './utils';
import { EventEmitter } from './utils/event';

/**
 * Electron main process entry point - ports src/extension.ts's `activate()`. Wires the same
 * components (Logger, Store/ExtensionState, DataSource, AvatarManager, RepoManager) to a single
 * BrowserWindow + GitGraphIpcHandler instead of a vscode.ExtensionContext + GitGraphView webview.
 */

let mainWindow: BrowserWindow | null = null;
let ipcHandler: GitGraphIpcHandler | null = null;

function createWindow(page: string) {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.loadFile(path.join(__dirname, '..', page));

	mainWindow.on('closed', () => {
		mainWindow = null;
		ipcHandler = null;
	});

	return mainWindow;
}

async function activate() {
	const logger = new Logger();
	logger.log('Starting Git Graph ...');

	const userDataPath = app.getPath('userData');
	const configStore = getConfigStore(path.join(userDataPath, 'config.json'));
	const config = createConfig(configStore);
	const store = new Store(userDataPath);

	const gitExecutableEmitter = new EventEmitter<GitExecutable>();
	const onDidChangeGitExecutable = gitExecutableEmitter.subscribe;

	let gitExecutable: GitExecutable | null;
	try {
		gitExecutable = await findGit(store);
		gitExecutableEmitter.emit(gitExecutable);
		logger.log('Using ' + gitExecutable.path + ' (version: ' + gitExecutable.version + ')');
	} catch (_) {
		gitExecutable = null;
		showErrorMessage(UNABLE_TO_FIND_GIT_MSG);
		logger.logError(UNABLE_TO_FIND_GIT_MSG);
	}
	onDidChangeGitExecutable((updated) => { gitExecutable = updated; });

	const configurationEmitter = new EventEmitter<ConfigChangeEvent>();
	const onDidChangeConfiguration = configurationEmitter.subscribe;

	const dataSource = new DataSource(gitExecutable, onDidChangeConfiguration, onDidChangeGitExecutable, logger);
	const avatarManager = new AvatarManager(dataSource, store, logger);
	const repoManager = new RepoManager(dataSource, store, config);

	// index.html's initialState is built from this (via preload's sendSync), replacing what used to be a
	// hardcoded repo path. Must be registered before the window loads.
	ipcMain.on('get-initial-state', (event) => {
		event.returnValue = { repos: repoManager.getRepos(), lastActiveRepo: store.getLastActiveRepo() };
	});

	// With no known repositories the Git Graph frontend has nothing to render (it expects at least one),
	// so show a small landing page instead and swap to the real UI as soon as a repository is added.
	let showingLanding = Object.keys(repoManager.getRepos()).length === 0;
	const win = createWindow(showingLanding ? 'norepos.html' : 'index.html');
	repoManager.onDidChangeRepos((event) => {
		if (showingLanding && Object.keys(event.repos).length > 0 && !win.isDestroyed()) {
			showingLanding = false;
			win.loadFile(path.join(__dirname, '..', 'index.html'));
		}
	});
	// Repo changes emitted while the page was still loading would otherwise be lost.
	win.webContents.on('did-finish-load', () => {
		if (!showingLanding && ipcHandler !== null) ipcHandler.resendRepos();
	});
	ipcHandler = new GitGraphIpcHandler(win, dataSource, avatarManager, store, repoManager);

	initAutoUpdater(win);
	// Delayed so the update check never competes with the app's own initial repo-loading IPC traffic.
	setTimeout(() => checkForUpdates(win, false), 5000);

	Menu.setApplicationMenu(buildMenu(win, () => ipcHandler, dataSource, avatarManager, store, repoManager, () => gitExecutable));

	ipcMain.on('clone-repository', () => {
		cloneRepository(win, repoManager, dataSource, () => gitExecutable);
	});

	ipcMain.on('add-repository', () => {
		addRepository(win, repoManager, () => gitExecutable);
	});

	store.expireOldCodeReviews();
	logger.log('Started Git Graph - Ready to use!');
}

app.whenReady().then(activate);

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (mainWindow === null) activate();
});

ipcMain.on('git-graph-message', (_event, msg: RequestMessage) => {
	if (ipcHandler !== null) {
		ipcHandler.handleMessage(msg).catch((err) => console.error('[main] error handling message "' + msg.command + '":', err));
	}
});
