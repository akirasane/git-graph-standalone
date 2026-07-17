import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import { AvatarManager } from './avatarManager';
import { createConfig } from './config';
import { getConfigStore } from './configStore';
import { ConfigChangeEvent, DataSource } from './dataSource';
import { GitGraphIpcHandler } from './ipc';
import { Logger } from './logger';
import { buildMenu } from './menu';
import { RepoManager } from './repoManager';
import { Store } from './store';
import { RequestMessage } from './types';
import { GitExecutable, UNABLE_TO_FIND_GIT_MSG, findGit, showErrorMessage } from './utils';
import { EventEmitter } from './utils/event';

/**
 * Electron main process entry point - ports src/extension.ts's `activate()`. Wires the same
 * components (Logger, Store/ExtensionState, DataSource, AvatarManager, RepoManager) to a single
 * BrowserWindow + GitGraphIpcHandler instead of a vscode.ExtensionContext + GitGraphView webview.
 */

let mainWindow: BrowserWindow | null = null;
let ipcHandler: GitGraphIpcHandler | null = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
	mainWindow.webContents.openDevTools({ mode: 'detach' });

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

	const win = createWindow();
	ipcHandler = new GitGraphIpcHandler(win, dataSource, avatarManager, store, repoManager);

	Menu.setApplicationMenu(buildMenu(win, () => ipcHandler, dataSource, avatarManager, store, repoManager, () => gitExecutable));

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
