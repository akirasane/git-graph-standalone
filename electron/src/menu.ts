import { BrowserWindow, Menu } from 'electron';
import * as os from 'os';
import { showAppDialog } from './appDialog';
import { AvatarManager } from './avatarManager';
import { GitGraphIpcHandler } from './ipc';
import { DataSource } from './dataSource';
import { CodeReviewData, CodeReviews, Store } from './store';
import { RepoManager } from './repoManager';
import { getConfig } from './config';
import { PickerItem, showPicker } from './pickerWindow';
import { checkForUpdates } from './updater';
import { GitExecutable, abbrevCommit, abbrevText, copyToClipboard, getAppVersion, getRelativeTimeDiff, getRepoName, getSortedRepositoryPaths, showErrorMessage, showInformationMessage } from './utils';

/** Hub actions the menu can trigger (the repository hub owns the open / clone / new flows). */
export type HubAction = 'open' | 'clone' | 'new';

/**
 * The application menu. The native menu bar is hidden (custom Nocturne title bar), but this Menu
 * stays installed so its accelerators keep working, and ui/titlebar.js renders the same items as
 * a themed in-app menu (see chrome.ts). Every item therefore has a stable `id`.
 * Pickers use the themed `pickerWindow.ts`; messages use the themed `appDialog.ts`.
 */
export function buildMenu(
	win: BrowserWindow,
	getIpcHandler: () => GitGraphIpcHandler | null,
	dataSource: DataSource,
	avatarManager: AvatarManager,
	store: Store,
	repoManager: RepoManager,
	getGitExecutable: () => GitExecutable | null,
	showHome: () => void,
	hubAction: (action: HubAction) => void
): Menu {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			id: 'app-menu',
			label: 'Git Graph',
			submenu: [
				{
					id: 'repositories',
					label: 'Repositories',
					accelerator: 'CmdOrCtrl+Shift+H',
					click: () => showHome()
				},
				{ type: 'separator' },
				{
					id: 'add-repo',
					label: 'Add repository...',
					click: () => hubAction('open')
				},
				{
					id: 'clone-repo',
					label: 'Clone repository...',
					click: () => hubAction('clone')
				},
				{
					id: 'init-repo',
					label: 'New repository...',
					click: () => hubAction('new')
				},
				{
					id: 'remove-repo',
					label: 'Remove repository...',
					click: () => removeRepository(repoManager)
				},
				{ type: 'separator' },
				{
					id: 'fetch',
					label: 'Fetch from remotes',
					click: () => fetchCurrentRepo(getIpcHandler, dataSource)
				},
				{
					id: 'clear-avatars',
					label: 'Clear avatar cache',
					click: () => clearAvatarCache(avatarManager)
				},
				{ type: 'separator' },
				{
					id: 'end-all-reviews',
					label: 'End all code reviews',
					click: () => endAllCodeReviews(store)
				},
				{
					id: 'end-review',
					label: 'End a code review...',
					click: () => endSpecificCodeReview(store, repoManager, dataSource)
				},
				{ type: 'separator' },
				{
					id: 'check-updates',
					label: 'Check for updates...',
					click: () => checkForUpdates(win, true)
				},
				{
					id: 'version',
					label: 'About Git Graph',
					click: () => showVersion(getGitExecutable)
				},
				{ type: 'separator' },
				{ id: 'quit', role: 'quit', accelerator: 'CmdOrCtrl+Q' }
			]
		},
		{
			id: 'view-menu',
			label: 'View',
			submenu: [
				{ id: 'reload', role: 'reload', accelerator: 'CmdOrCtrl+R' },
				{ id: 'devtools', role: 'toggleDevTools', accelerator: 'F12' }
			]
		}
	];

	return Menu.buildFromTemplate(template);
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
		const response = await showAppDialog({ type: 'info', title: 'About Git Graph', message: 'Git Graph ' + appVersion, detail: information, buttons: ['OK', 'Copy'], cancelId: 0 });
		if (response === 1) {
			const error = await copyToClipboard(information);
			if (error !== null) showErrorMessage(error);
		}
	} catch (_) {
		showErrorMessage('An unexpected error occurred while retrieving version information.');
	}
}
