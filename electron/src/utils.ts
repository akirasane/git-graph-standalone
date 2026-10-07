import { clipboard, shell } from 'electron';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { DataSource } from './dataSource';
import { Store } from './store';
import { openGitTerminal as spawnGitTerminal } from './terminal';
import { ErrorInfo, GitFileStatus, GitRepoSet, PullRequestConfig, PullRequestProvider, RepoDropdownOrder } from './types';

/**
 * Helpers shared by the main process (viewDiff/
 * viewDiffWithWorkingFile/viewFileAtRevision - Phase 5's job), functions are stubbed with a clear
 * "not yet implemented" ErrorInfo rather than silently doing nothing. Where an Electron API is a
 * direct substitute (clipboard, shell.openExternal, shell.openPath, dialog, terminal.ts), they're
 * wired for real here rather than stubbed, since the cost of doing so is the same as stubbing.
 */

export const UNCOMMITTED = '*';
export const UNABLE_TO_FIND_GIT_MSG = 'Unable to find a Git executable. Set it in the app config file ("git.path"), or install Git and restart the app.';


/* Path Manipulation */

const FS_REGEX = /\\/g;

export function getPathFromStr(str: string) {
	return str.replace(FS_REGEX, '/');
}

export function pathWithTrailingSlash(path: string) {
	return path.endsWith('/') ? path : path + '/';
}

export function realpath(path: string, native: boolean = false) {
	return new Promise<string>((resolve) => {
		(native ? fs.realpath.native : fs.realpath)(path, (err, resolvedPath) => resolve(err !== null ? path : getPathFromStr(resolvedPath)));
	});
}

export function doesFileExist(path: string) {
	return new Promise<boolean>((resolve) => {
		fs.access(path, fs.constants.R_OK, (err) => resolve(err === null));
	});
}


/* General Methods */

export function abbrevCommit(commitHash: string) {
	return commitHash.substring(0, 8);
}

export function abbrevText(text: string, toChars: number) {
	return text.length <= toChars ? text : text.substring(0, toChars - 1) + '...';
}

export function getRelativeTimeDiff(unixTimestamp: number) {
	let diff = Math.round((new Date()).getTime() / 1000) - unixTimestamp, unit;
	if (diff < 60) {
		unit = 'second';
	} else if (diff < 3600) {
		unit = 'minute';
		diff /= 60;
	} else if (diff < 86400) {
		unit = 'hour';
		diff /= 3600;
	} else if (diff < 604800) {
		unit = 'day';
		diff /= 86400;
	} else if (diff < 2629800) {
		unit = 'week';
		diff /= 604800;
	} else if (diff < 31557600) {
		unit = 'month';
		diff /= 2629800;
	} else {
		unit = 'year';
		diff /= 31557600;
	}
	diff = Math.round(diff);
	return diff + ' ' + unit + (diff !== 1 ? 's' : '') + ' ago';
}

export function getAppVersion(): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.readFile(path.join(__dirname, '..', 'package.json'), (err, data) => {
			if (err) return reject();
			try {
				resolve(JSON.parse(data.toString()).version);
			} catch (_) {
				reject();
			}
		});
	});
}

export function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getRepoName(path: string) {
	const firstSep = path.indexOf('/');
	if (firstSep === path.length - 1 || firstSep === -1) {
		return path;
	} else {
		const p = path.endsWith('/') ? path.substring(0, path.length - 1) : path;
		return p.substring(p.lastIndexOf('/') + 1);
	}
}

/**
 * `workspaceFolderIndex` is repurposed by the ported repoManager.ts as an index into `rootFolders`;
 * `RepoDropdownOrder.WorkspaceFullPath` sorts by that index the same way the original sorted by
 * folder order.
 */
export function getSortedRepositoryPaths(repos: GitRepoSet, order: RepoDropdownOrder): ReadonlyArray<string> {
	const repoPaths = Object.keys(repos);
	if (order === RepoDropdownOrder.WorkspaceFullPath) {
		return repoPaths.sort((a, b) => repos[a].workspaceFolderIndex === repos[b].workspaceFolderIndex
			? a.localeCompare(b)
			: repos[a].workspaceFolderIndex === null
				? 1
				: repos[b].workspaceFolderIndex === null
					? -1
					: repos[a].workspaceFolderIndex! - repos[b].workspaceFolderIndex!
		);
	} else if (order === RepoDropdownOrder.FullPath) {
		return repoPaths.sort((a, b) => a.localeCompare(b));
	} else {
		return repoPaths.map((path) => ({ name: repos[path].name || getRepoName(path), path: path }))
			.sort((a, b) => a.name !== b.name ? a.name.localeCompare(b.name) : a.path.localeCompare(b.path))
			.map((x) => x.path);
	}
}


/* Electron Command Wrappers */

/**
 * Create an archive of a repository at a specific reference, and save to disk.
 * Phase 5/6: currently prompts via Electron's native save dialog (a real implementation, not a stub).
 */
export async function archive(repo: string, ref: string, dataSource: DataSource): Promise<ErrorInfo> {
	const { dialog } = await import('electron');
	const result = await dialog.showSaveDialog({
		defaultPath: repo,
		filters: [{ name: 'TAR Archive', extensions: ['tar'] }, { name: 'ZIP Archive', extensions: ['zip'] }]
	});
	if (result.canceled || !result.filePath) {
		return 'No file name was provided for the archive.';
	}
	const extension = result.filePath.substring(result.filePath.lastIndexOf('.') + 1).toLowerCase();
	if (extension === 'tar' || extension === 'zip') {
		return dataSource.archive(repo, ref, result.filePath, extension);
	} else {
		return 'Invalid file extension "*.' + extension + '". The archive file must have a *.tar or *.zip extension.';
	}
}

export function copyFilePathToClipboard(repo: string, filePath: string, absolute: boolean) {
	return copyToClipboard(absolute ? path.join(repo, filePath) : filePath);
}

export function copyToClipboard(text: string): Promise<ErrorInfo> {
	try {
		clipboard.writeText(text);
		return Promise.resolve(null);
	} catch (_) {
		return Promise.resolve('Unable to write to the Clipboard.');
	}
}

export function createPullRequest(config: PullRequestConfig, sourceOwner: string, sourceRepo: string, sourceBranch: string) {
	let templateUrl;
	switch (config.provider) {
		case PullRequestProvider.Bitbucket:
			templateUrl = '$1/$2/$3/pull-requests/new?source=$2/$3::$4&dest=$5/$6::$8';
			break;
		case PullRequestProvider.Custom:
			templateUrl = config.custom.templateUrl;
			break;
		case PullRequestProvider.GitHub:
			templateUrl = '$1/$5/$6/compare/$8...$2:$4';
			break;
		case PullRequestProvider.GitLab:
			templateUrl = '$1/$2/$3/-/merge_requests/new?merge_request[source_branch]=$4&merge_request[target_branch]=$8' +
				(config.destProjectId !== '' ? '&merge_request[target_project_id]=$7' : '');
			break;
	}

	const urlFieldValues = [
		config.hostRootUrl,
		sourceOwner, sourceRepo, sourceBranch,
		config.destOwner, config.destRepo, config.destProjectId, config.destBranch
	];

	const url = templateUrl.replace(/\$([1-8])/g, (_, index) => urlFieldValues[parseInt(index) - 1]);

	return openExternalUrl(url, 'Pull Request URL');
}

/** No standalone equivalent yet - Phase 6 adds a real settings screen. */
export function openExtensionSettings(): Promise<ErrorInfo> {
	return Promise.resolve('Settings are not yet available in the standalone app.');
}

export async function openExternalUrl(url: string, type: string = 'External URL'): Promise<ErrorInfo> {
	// URLs come from commit messages and from a repository's own .git-graph.json (issue linking / pull
	// request templates), i.e. untrusted content: never hand file:, smb:, custom-protocol etc. URLs to the
	// OS, which could launch local programs.
	let protocol: string;
	try { protocol = new URL(url).protocol; } catch (_) { protocol = ''; }
	if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'mailto:') {
		return 'Only http(s) and mailto links can be opened (' + type + ': ' + url + ').';
	}
	try {
		await shell.openExternal(url);
		return null;
	} catch (_) {
		return 'Unable to open the ' + type + ': ' + url;
	}
}

/**
 * Open a file within a repository using the OS's default application (Electron `shell.openPath`,
 * opens the file with the OS default application).
 */
export async function openFile(repo: string, filePath: string, hash: string | null = null, dataSource: DataSource | null = null) {
	let newFilePath = filePath;
	let newAbsoluteFilePath = path.join(repo, newFilePath);
	let fileExists = await doesFileExist(newAbsoluteFilePath);
	if (!fileExists && hash !== null && dataSource !== null) {
		const renamedFilePath = await dataSource.getNewPathOfRenamedFile(repo, hash, filePath);
		if (renamedFilePath !== null) {
			const renamedAbsoluteFilePath = path.join(repo, renamedFilePath);
			if (await doesFileExist(renamedAbsoluteFilePath)) {
				newFilePath = renamedFilePath;
				newAbsoluteFilePath = renamedAbsoluteFilePath;
				fileExists = true;
			}
		}
	}

	if (fileExists) {
		const result = await shell.openPath(newAbsoluteFilePath);
		return result === '' ? null : 'Unable to open ' + newFilePath + ': ' + result;
	} else {
		return 'The file ' + newFilePath + ' doesn\'t currently exist in this repository.';
	}
}

export async function viewDiff(repo: string, fromHash: string, toHash: string, oldFilePath: string, newFilePath: string, type: GitFileStatus, dataSource: DataSource): Promise<ErrorInfo> {
	if (type === GitFileStatus.Untracked) {
		return openFile(repo, newFilePath);
	}
	const diffWindow = await import('./diffWindow');
	return diffWindow.viewDiff(dataSource, repo, fromHash, toHash, oldFilePath, newFilePath, type);
}

export async function viewDiffWithWorkingFile(repo: string, hash: string, filePath: string, dataSource: DataSource): Promise<ErrorInfo> {
	let newFilePath = filePath;
	let fileExists = await doesFileExist(path.join(repo, newFilePath));
	if (!fileExists) {
		const renamedFilePath = await dataSource.getNewPathOfRenamedFile(repo, hash, filePath);
		if (renamedFilePath !== null && await doesFileExist(path.join(repo, renamedFilePath))) {
			newFilePath = renamedFilePath;
			fileExists = true;
		}
	}

	const type = fileExists
		? filePath === newFilePath
			? GitFileStatus.Modified
			: GitFileStatus.Renamed
		: GitFileStatus.Deleted;

	return viewDiff(repo, hash, UNCOMMITTED, filePath, newFilePath, type, dataSource);
}

export async function viewFileAtRevision(repo: string, hash: string, filePath: string, dataSource: DataSource): Promise<ErrorInfo> {
	const diffWindow = await import('./diffWindow');
	return diffWindow.viewFileAtRevision(dataSource, repo, hash, filePath);
}

/** No-op: there is no separate Source Control view in the standalone app. */
export function viewScm(): Promise<ErrorInfo> {
	return Promise.resolve(null);
}

export function openGitTerminal(cwd: string, gitPath: string, command: string | null, name: string): void {
	spawnGitTerminal(cwd, gitPath, command, name);
}


/* Electron API Wrappers */

/** Themed (Nocturne) message dialogs - see appDialog.ts. Imported lazily to keep utils.ts free of window code. */
export async function showInformationMessage(message: string) {
	const { showAppDialog } = await import('./appDialog');
	await showAppDialog({ type: 'info', title: 'Git Graph', message });
}

export async function showErrorMessage(message: string) {
	const { showAppDialog } = await import('./appDialog');
	await showAppDialog({ type: 'error', title: 'Something went wrong', message });
}


/* Promise Methods */

export function evalPromises<X, Y>(data: X[], maxParallel: number, createPromise: (val: X) => Promise<Y>) {
	return new Promise<Y[]>((resolve, reject) => {
		if (data.length === 1) {
			createPromise(data[0]).then(v => resolve([v])).catch(() => reject());
		} else if (data.length === 0) {
			resolve([]);
		} else {
			let results: Y[] = new Array(data.length), nextPromise = 0, rejected = false, completed = 0;
			function startNext() {
				let cur = nextPromise;
				nextPromise++;
				createPromise(data[cur]).then(result => {
					if (!rejected) {
						results[cur] = result;
						completed++;
						if (nextPromise < data.length) startNext();
						else if (completed === data.length) resolve(results);
					}
				}).catch(() => {
					reject();
					rejected = true;
				});
			}
			for (let i = 0; i < maxParallel && i < data.length; i++) startNext();
		}
	});
}

export function resolveSpawnOutput(cmd: cp.ChildProcess) {
	return Promise.all([
		new Promise<{ code: number, error: Error | null }>((resolve) => {
			let resolved = false;
			cmd.on('error', (error) => {
				if (resolved) return;
				resolve({ code: -1, error: error });
				resolved = true;
			});
			cmd.on('exit', (code) => {
				if (resolved) return;
				resolve({ code: code || 0, error: null });
				resolved = true;
			});
		}),
		new Promise<Buffer>((resolve) => {
			let buffers: Buffer[] = [];
			cmd.stdout!.on('data', (b: Buffer) => { buffers.push(b); });
			cmd.stdout!.on('close', () => resolve(Buffer.concat(buffers)));
		}),
		new Promise<string>((resolve) => {
			let stderr = '';
			cmd.stderr!.on('data', (d) => { stderr += d; });
			cmd.stderr!.on('close', () => resolve(stderr));
		})
	]);
}


/* Find Git Executable */

// Git-finding logic, based on the Git extension in Microsoft's VS Code (MIT) - pure Node child_process/fs.

export interface GitExecutable {
	readonly path: string;
	readonly version: string;
}

export async function findGit(store: Store) {
	const lastKnownPath = store.getLastKnownGitPath();
	if (lastKnownPath !== null) {
		try {
			return await getGitExecutable(lastKnownPath);
		} catch (_) { }
	}

	const configGitPaths = getConfig().gitPaths;
	if (configGitPaths.length > 0) {
		try {
			return await getGitExecutableFromPaths(configGitPaths);
		} catch (_) { }
	}

	switch (process.platform) {
		case 'darwin':
			return findGitOnDarwin();
		case 'win32':
			return findGitOnWin32();
		default:
			return getGitExecutable('git');
	}
}

function findGitOnDarwin() {
	return new Promise<GitExecutable>((resolve, reject) => {
		cp.exec('which git', (err, stdout) => {
			if (err) return reject();

			const path = stdout.trim();
			if (path !== '/usr/bin/git') {
				getGitExecutable(path).then((exec) => resolve(exec), () => reject());
			} else {
				cp.exec('xcode-select -p', (err: any) => {
					if (err && err.code === 2) {
						reject();
					} else {
						getGitExecutable(path).then((exec) => resolve(exec), () => reject());
					}
				});
			}
		});
	});
}

function findGitOnWin32() {
	return findSystemGitWin32(process.env['ProgramW6432'])
		.then(undefined, () => findSystemGitWin32(process.env['ProgramFiles(x86)']))
		.then(undefined, () => findSystemGitWin32(process.env['ProgramFiles']))
		.then(undefined, () => findSystemGitWin32(process.env['LocalAppData'] ? path.join(process.env['LocalAppData']!, 'Programs') : undefined))
		.then(undefined, () => findGitWin32InPath());
}
function findSystemGitWin32(pathBase?: string) {
	return pathBase
		? getGitExecutable(path.join(pathBase, 'Git', 'cmd', 'git.exe'))
		: Promise.reject<GitExecutable>();
}
async function findGitWin32InPath() {
	let dirs = (process.env['PATH'] || '').split(';');
	dirs.unshift(process.cwd());

	for (let i = 0; i < dirs.length; i++) {
		let file = path.join(dirs[i], 'git.exe');
		if (await isExecutable(file)) {
			try {
				return await getGitExecutable(file);
			} catch (_) { }
		}
	}
	return Promise.reject<GitExecutable>();
}

function isExecutable(path: string) {
	return new Promise<boolean>(resolve => {
		fs.stat(path, (err, stat) => {
			resolve(!err && (stat.isFile() || stat.isSymbolicLink()));
		});
	});
}

export function getGitExecutable(path: string) {
	return new Promise<GitExecutable>((resolve, reject) => {
		resolveSpawnOutput(cp.spawn(path, ['--version'])).then((values) => {
			if (values[0].code === 0) {
				resolve({ path: path, version: values[1].toString().trim().replace(/^git version /, '') });
			} else {
				reject();
			}
		});
	});
}

export async function getGitExecutableFromPaths(paths: string[]): Promise<GitExecutable> {
	for (let i = 0; i < paths.length; i++) {
		try {
			return await getGitExecutable(paths[i]);
		} catch (_) { }
	}
	throw new Error('None of the provided paths are a Git executable');
}


/* Version Handling / Requirements */

export const enum GitVersionRequirement {
	FetchAndPruneTags = '2.17.0',
	GpgInfo = '2.4.0',
	PushStash = '2.13.2',
	TagDetails = '1.7.8'
}

export function doesVersionMeetRequirement(version: string, requiredVersion: GitVersionRequirement) {
	const v1 = parseVersion(version);
	const v2 = parseVersion(requiredVersion);

	if (v1 === null || v2 === null) {
		return true;
	}

	if (v1.major > v2.major) return true;
	if (v1.major < v2.major) return false;

	if (v1.minor > v2.minor) return true;
	if (v1.minor < v2.minor) return false;

	if (v1.patch > v2.patch) return true;
	if (v1.patch < v2.patch) return false;

	return true;
}

function parseVersion(version: string) {
	const match = version.trim().match(/^[0-9]+(\.[0-9]+|)(\.[0-9]+|)/);
	if (match === null) {
		return null;
	}

	const comps = match[0].split('.');
	return {
		major: parseInt(comps[0], 10),
		minor: comps.length > 1 ? parseInt(comps[1], 10) : 0,
		patch: comps.length > 2 ? parseInt(comps[2], 10) : 0
	};
}

export function constructIncompatibleGitVersionMessage(executable: GitExecutable, version: GitVersionRequirement, feature?: string) {
	return 'A newer version of Git (>= ' + version + ') is required for ' + (feature ? feature : 'this feature') + '. Git ' + executable.version + ' is currently installed. Please install a newer version of Git to use this feature.';
}
