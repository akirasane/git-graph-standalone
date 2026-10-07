import { BrowserWindow, Menu, dialog } from 'electron';
import * as os from 'os';
import { AvatarManager } from './avatarManager';
import { GitGraphIpcHandler } from './ipc';
import { DataSource } from './dataSource';
import { CodeReviewData, CodeReviews, Store } from './store';
import { RepoManager } from './repoManager';
import { getConfig } from './config';
import { PickerItem, showInput, showPicker } from './pickerWindow';
import { checkForUpdates } from './updater';
import { GitExecutable, abbrevCommit, abbrevText, copyToClipboard, getAppVersion, getRelativeTimeDiff, getRepoName, getSortedRepositoryPaths, showErrorMessage, showInformationMessage } from './utils';

/**
 * The application menu (Electron Menu), plus the
 * Menu; `showOpenDialog` maps directly to Electron's native `dialog.showOpenDialog` (no change in
 * kind needed), but `showQuickPick` has no native Electron equivalent, so repo/code-review
 * pickers use the small bespoke `pickerWindow.ts` list instead.
 */
export function buildMenu(
	win: BrowserWindow,
	getIpcHandler: () => GitGraphIpcHandler | null,
	dataSource: DataSource,
	avatarManager: AvatarManager,
	store: Store,
	repoManager: RepoManager,
	getGitExecutable: () => GitExecutable | null
): Menu {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: 'Git Graph',
			submenu: [
				{
					label: 'Add Repository...',
					click: () => addRepository(win, repoManager, getGitExecutable)
				},
				{
					label: 'Clone Repository...',
					click: () => cloneRepository(win, repoManager, dataSource, getGitExecutable)
				},
				{
					label: 'Init Repository...',
					click: () => initRepository(win, repoManager, dataSource, getGitExecutable)
				},
				{
					label: 'Remove Repository...',
					click: () => removeRepository(repoManager)
				},
				{ type: 'separator' },
				{
					label: 'Fetch from Remote(s)',
					click: () => fetchCurrentRepo(getIpcHandler, dataSource)
				},
				{
					label: 'Clear Avatar Cache',
					click: () => clearAvatarCache(avatarManager)
				},
				{ type: 'separator' },
				{
					label: 'End All Code Reviews',
					click: () => endAllCodeReviews(store)
				},
				{
					label: 'End a specific Code Review...',
					click: () => endSpecificCodeReview(store, repoManager, dataSource)
				},
				{ type: 'separator' },
				{
					label: 'Check for Updates...',
					click: () => checkForUpdates(win, true)
				},
				{
					label: 'Version',
					click: () => showVersion(getGitExecutable)
				},
				{ type: 'separator' },
				{ role: 'quit' }
			]
		},
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'toggleDevTools' }
			]
		}
	];

	return Menu.buildFromTemplate(template);
}

export async function addRepository(win: BrowserWindow, repoManager: RepoManager, getGitExecutable: () => GitExecutable | null) {
	if (getGitExecutable() === null) {
		showErrorMessage('Unable to find a Git executable.');
		return;
	}

	const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
	if (result.canceled || result.filePaths.length === 0) return;

	const status = await repoManager.registerRepo(result.filePaths[0].replace(/\\/g, '/'), false);
	if (status.error === null) {
		showInformationMessage('The repository "' + status.root! + '" was added to Git Graph.');
	} else {
		showErrorMessage(status.error + ' Therefore it could not be added to Git Graph.');
	}
}

export async function cloneRepository(win: BrowserWindow, repoManager: RepoManager, dataSource: DataSource, getGitExecutable: () => GitExecutable | null) {
	if (getGitExecutable() === null) {
		showErrorMessage('Unable to find a Git executable.');
		return;
	}
	const url = await showInput('Clone Repository', 'Repository URL (https://..., git@...):', 'https://github.com/user/repo.git');
	if (url === null) return;
	const dir = await dialog.showOpenDialog(win, { title: 'Clone into folder...', properties: ['openDirectory', 'createDirectory'] });
	if (dir.canceled || dir.filePaths.length === 0) return;

	win.setTitle('Git Graph - cloning...');
	const result = await dataSource.cloneRepo(url, dir.filePaths[0]);
	win.setTitle('Git Graph');
	if (result.error !== null || result.path === null) {
		showErrorMessage('Clone failed: ' + result.error);
		return;
	}
	const status = await repoManager.registerRepo(result.path, true);
	if (status.error !== null) showErrorMessage(status.error);
}

async function initRepository(win: BrowserWindow, repoManager: RepoManager, dataSource: DataSource, getGitExecutable: () => GitExecutable | null) {
	if (getGitExecutable() === null) {
		showErrorMessage('Unable to find a Git executable.');
		return;
	}
	const dir = await dialog.showOpenDialog(win, { title: 'Folder to initialise as a Git repository', properties: ['openDirectory', 'createDirectory'] });
	if (dir.canceled || dir.filePaths.length === 0) return;
	const folder = dir.filePaths[0].replace(/\\/g, '/');
	const error = await dataSource.initRepo(folder);
	if (error !== null) {
		showErrorMessage('git init failed: ' + error);
		return;
	}
	const status = await repoManager.registerRepo(folder, true);
	if (status.error !== null) showErrorMessage(status.error);
}

async function removeRepository(repoManager: RepoManager) {
	const repos = repoManager.getRepos();
	const paths = getSortedRepositoryPaths(repos, getConfig().repoDropdownOrder);
	if (paths.length === 0) {
		showErrorMessage('There are no repositories known to Git Graph.');
		return;
	}

	const items: PickerItem[] = paths.map((p) => ({ label: repos[p].name || getRepoName(p), description: p }));
	const index = await showPicker('Remove Repository', 'Select a repository to remove from Git Graph:', items);
	if (index === null) return;

	const path = paths[index];
	if (repoManager.ignoreRepo(path)) {
		showInformationMessage('The repository "' + items[index].label + '" was removed from Git Graph.');
	} else {
		showErrorMessage('The repository "' + items[index].label + '" is not known to Git Graph.');
	}
}

async function fetchCurrentRepo(getIpcHandler: () => GitGraphIpcHandler | null, dataSource: DataSource) {
	const ipcHandler = getIpcHandler();
	const repo = ipcHandler !== null ? ipcHandler.getCurrentRepo() : null;
	if (repo === null) {
		showErrorMessage('Open a repository in Git Graph before fetching from its remote(s).');
		return;
	}
	const error = await dataSource.fetch(repo, null, false, false);
	if (error === null) {
		showInformationMessage('Successfully fetched from the remote(s) of "' + repo + '".');
	} else {
		showErrorMessage(error);
	}
}

async function clearAvatarCache(avatarManager: AvatarManager) {
	const errorInfo = await avatarManager.clearCache();
	if (errorInfo === null) {
		showInformationMessage('The Avatar Cache was successfully cleared.');
	} else {
		showErrorMessage(errorInfo);
	}
}

function endAllCodeReviews(store: Store) {
	store.endAllWorkspaceCodeReviews();
	showInformationMessage('Ended All Code Reviews');
}

async function endSpecificCodeReview(store: Store, repoManager: RepoManager, dataSource: DataSource) {
	const codeReviews = store.getCodeReviews();
	if (Object.keys(codeReviews).length === 0) {
		showErrorMessage('There are no Code Reviews in progress.');
		return;
	}

	const entries = await getCodeReviewPickerItems(codeReviews, repoManager, dataSource);
	const items: PickerItem[] = entries.map((e) => ({ label: e.label, description: e.description, detail: e.detail }));
	const index = await showPicker('End Code Review', 'Select the Code Review you want to end:', items);
	if (index === null) return;

	const entry = entries[index];
	const errorInfo = await store.endCodeReview(entry.repo, entry.id);
	if (errorInfo === null) {
		showInformationMessage('Successfully ended Code Review "' + entry.label + '".');
	} else {
		showErrorMessage(errorInfo);
	}
}

interface CodeReviewPickerEntry {
	repo: string;
	id: string;
	label: string;
	description: string;
	detail: string;
}

async function getCodeReviewPickerItems(codeReviews: CodeReviews, repoManager: RepoManager, dataSource: DataSource): Promise<CodeReviewPickerEntry[]> {
	const repos = repoManager.getRepos();
	const enriched: { repo: string, id: string, review: CodeReviewData, fromCommitHash: string, toCommitHash: string }[] = [];
	const fetchCommits: { repo: string, commitHash: string }[] = [];

	Object.keys(codeReviews).forEach((repo) => {
		if (typeof repos[repo] === 'undefined') return;
		Object.keys(codeReviews[repo]).forEach((id) => {
			const commitHashes = id.split('-');
			commitHashes.forEach((commitHash) => fetchCommits.push({ repo, commitHash }));
			enriched.push({
				repo, id, review: codeReviews[repo][id],
				fromCommitHash: commitHashes[0], toCommitHash: commitHashes[commitHashes.length > 1 ? 1 : 0]
			});
		});
	});

	const subjects = await Promise.all(fetchCommits.map((f) => dataSource.getCommitSubject(f.repo, f.commitHash)));
	const commitSubjects: { [repo: string]: { [commitHash: string]: string } } = {};
	subjects.forEach((subject, i) => {
		if (typeof commitSubjects[fetchCommits[i].repo] === 'undefined') commitSubjects[fetchCommits[i].repo] = {};
		commitSubjects[fetchCommits[i].repo][fetchCommits[i].commitHash] = subject !== null ? subject : '<Unknown Commit Subject>';
	});

	return enriched.sort((a, b) => b.review.lastActive - a.review.lastActive).map((cr) => {
		const fromSubject = commitSubjects[cr.repo][cr.fromCommitHash];
		const toSubject = commitSubjects[cr.repo][cr.toCommitHash];
		const isComparison = cr.fromCommitHash !== cr.toCommitHash;
		return {
			repo: cr.repo,
			id: cr.id,
			label: (repos[cr.repo].name || getRepoName(cr.repo)) + ': ' + abbrevCommit(cr.fromCommitHash) + (isComparison ? ' ↔ ' + abbrevCommit(cr.toCommitHash) : ''),
			description: getRelativeTimeDiff(Math.round(cr.review.lastActive / 1000)),
			detail: isComparison ? abbrevText(fromSubject, 50) + ' ↔ ' + abbrevText(toSubject, 50) : fromSubject
		};
	});
}

async function showVersion(getGitExecutable: () => GitExecutable | null) {
	try {
		const appVersion = await getAppVersion();
		const gitExecutable = getGitExecutable();
		const information = 'Git Graph (standalone): ' + appVersion + '\nElectron: ' + process.versions.electron + '\nOS: ' + os.type() + ' ' + os.arch() + ' ' + os.release() + '\nGit: ' + (gitExecutable !== null ? gitExecutable.version : '(none)');
		const result = await dialog.showMessageBox({ type: 'info', message: information, buttons: ['OK', 'Copy'] });
		if (result.response === 1) {
			const error = await copyToClipboard(information);
			if (error !== null) showErrorMessage(error);
		}
	} catch (_) {
		showErrorMessage('An unexpected error occurred while retrieving version information.');
	}
}
