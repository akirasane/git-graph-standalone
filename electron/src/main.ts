import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import { AvatarManager } from './avatarManager';
import { createConfig } from './config';
import { getConfigStore } from './configStore';
import { ConfigChangeEvent, DataSource } from './dataSource';
import { GitGraphIpcHandler } from './ipc';
import { HomeStore } from './homeStore';
import { registerHomeIpc } from './homeIpc';
import { Logger } from './logger';
import { HubAction, buildMenu } from './menu';
import { RepoManager } from './repoManager';
import { Store } from './store';
import { RequestMessage } from './types';
import { checkForUpdates, initAutoUpdater } from './updater';
import { NOCTURNE, setDefaultUiParent, themedTitleBarOptions } from './uiWindow';
import { registerChrome } from './chrome';
import { GitExecutable, UNABLE_TO_FIND_GIT_MSG, findGit, getRepoName, showErrorMessage } from './utils';
import { EventEmitter } from './utils/event';

/**
 * Electron main process entry point - ports src/extension.ts's `activate()`. Wires the same
 * components (Logger, Store/ExtensionState, DataSource, AvatarManager, RepoManager) to a single
 * BrowserWindow + GitGraphIpcHandler.
 */

let mainWindow: BrowserWindow | null = null;
let ipcHandler: GitGraphIpcHandler | null = null;

function createWindow(page: string) {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 960,
		minHeight: 600,
		backgroundColor: NOCTURNE.bg,
		title: 'Git Graph',
		// Nocturne title bar (ui/titlebar.js) with native window controls drawn over it.
		...themedTitleBarOptions(),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.loadFile(path.join(__dirname, '..', page));
	// Titles are managed by main.ts (repository name while a repo is open), not by each page's <title>.
	mainWindow.on('page-title-updated', (e) => e.preventDefault());

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

	const homeStore = new HomeStore(userDataPath);
	const win = createWindow('home.html');
	registerChrome(win);
	setDefaultUiParent(win);
	let onRepoPage = false;

	/** The repository hub (first screen). */
	const showHome = () => {
		onRepoPage = false;
		win.setTitle('Git Graph');
		win.loadFile(path.join(__dirname, '..', 'home.html'));
	};
	/** The graph view for one repository. */
	const openRepo = (repo: string) => {
		store.setLastActiveRepo(repo);
		homeStore.touch(repo);
		onRepoPage = true;
		win.setTitle(getRepoName(repo) + ' - Git Graph');
		win.loadFile(path.join(__dirname, '..', 'index.html'));
	};

	repoManager.onDidChangeRepos((event) => {
		if (win.isDestroyed()) return;
		win.webContents.send('home:repos-changed');
		// The graph view needs at least one repository; fall back to the hub if the last one went away.
		if (onRepoPage && Object.keys(event.repos).length === 0) showHome();
	});
	// Repo changes emitted while the graph page was still loading would otherwise be lost.
	win.webContents.on('did-finish-load', () => {
		if (onRepoPage && ipcHandler !== null) ipcHandler.resendRepos();
		if (!onRepoPage && pendingHubAction !== null) {
			win.webContents.send('home:action', pendingHubAction);
			pendingHubAction = null;
		}
	});
	/** Menu "Add / Clone / New repository" open the hub's own flows (switching to the hub first if needed). */
	let pendingHubAction: HubAction | null = null;
	const hubAction = (action: HubAction) => {
		if (onRepoPage) {
			pendingHubAction = action;
			showHome();
		} else {
			win.webContents.send('home:action', action);
		}
	};
	ipcMain.on('go-home', showHome);
	registerHomeIpc(win, dataSource, repoManager, homeStore, () => gitExecutable !== null, openRepo);

	ipcHandler = new GitGraphIpcHandler(win, dataSource, avatarManager, store, repoManager);

	initAutoUpdater(win);
	// Delayed so the update check never competes with the app's own initial repo-loading IPC traffic.
	setTimeout(() => checkForUpdates(win, false), 5000);

	Menu.setApplicationMenu(buildMenu(win, () => ipcHandler, dataSource, avatarManager, store, repoManager, () => gitExecutable, showHome, hubAction));

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
