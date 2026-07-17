import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { RepoDataSource } from './gitRootResolver';
import { DEFAULT_REPO_STATE, Store } from './store';
import { BooleanOverride, ErrorInfo, FileViewType, GitRepoSet, GitRepoState, PullRequestConfig, PullRequestConfigBase, PullRequestProvider, RepoCommitOrdering } from './types';
import { evalPromises, getPathFromStr, getRepoName, pathWithTrailingSlash, realpath, showErrorMessage, showInformationMessage } from './utils';
import { BufferedQueue } from './utils/bufferedQueue';
import { Disposable, toDisposable } from './utils/disposable';
import { EventEmitter } from './utils/event';

export interface RepoChangeEvent {
	readonly repos: GitRepoSet;
	readonly numRepos: number;
	readonly loadRepo: string | null;
}

/**
 * Ported from src/repoManager.ts. VSCode's `vscode.workspace.workspaceFolders` (implicitly
 * managed by the editor) is replaced by an explicit, user-managed `rootFolders` list persisted
 * in the Store - the standalone app has no notion of an open "workspace", so root folders are
 * added/removed one at a time (via `addRootFolder`/`removeRootFolder`, wired to an "Add
 * Repository/Folder" UI action in a later phase) instead of following editor window state.
 *
 * `vscode.workspace.createFileSystemWatcher` is replaced by `chokidar`. The original's two
 * separate watcher sets (per-workspace-folder `folderWatchers`, plus one workspace-wide
 * `configWatcher` glob for `.vscode/vscode-git-graph.json`) are merged into a single chokidar
 * instance per root folder, whose event handler does both jobs - there's no need to run two
 * overlapping recursive watchers over the same directory tree.
 */
export class RepoManager extends Disposable {
	private readonly dataSource: RepoDataSource;
	private readonly store: Store;

	private repos: GitRepoSet;
	private ignoredRepos: string[];
	private rootFolders: string[];
	private maxDepthOfRepoSearch: number;

	private readonly folderWatchers: { [folder: string]: chokidar.FSWatcher } = {};

	private readonly repoEventEmitter: EventEmitter<RepoChangeEvent>;

	private readonly onWatcherCreateQueue: BufferedQueue<string>;
	private readonly onWatcherChangeQueue: BufferedQueue<string>;
	private readonly checkRepoConfigQueue: BufferedQueue<string>;

	constructor(dataSource: RepoDataSource, store: Store, config: Config) {
		super();
		this.dataSource = dataSource;
		this.store = store;
		this.repos = store.getRepos();
		this.ignoredRepos = store.getIgnoredRepos();
		this.rootFolders = store.getRootFolders();
		this.maxDepthOfRepoSearch = config.maxDepthOfRepoSearch;

		this.repoEventEmitter = new EventEmitter<RepoChangeEvent>();

		this.onWatcherCreateQueue = new BufferedQueue<string>(this.processOnWatcherCreateEvent.bind(this), this.sendRepos.bind(this));
		this.onWatcherChangeQueue = new BufferedQueue<string>(this.processOnWatcherChangeEvent.bind(this), this.sendRepos.bind(this));
		this.checkRepoConfigQueue = new BufferedQueue<string>(this.checkRepoForNewConfig.bind(this), this.sendRepos.bind(this));

		this.startupTasks();

		this.registerDisposables(
			this.repoEventEmitter,
			this.onWatcherCreateQueue,
			this.onWatcherChangeQueue,
			this.checkRepoConfigQueue,
			toDisposable(() => {
				const folders = Object.keys(this.folderWatchers);
				for (let i = 0; i < folders.length; i++) {
					this.stopWatchingFolder(folders[i]);
				}
			})
		);
	}

	get onDidChangeRepos() {
		return this.repoEventEmitter.subscribe;
	}


	/* Root Folder Management (standalone replacement for workspace folders) */

	public getRootFolders() {
		return this.rootFolders.slice();
	}

	/**
	 * Add a root folder to search for repositories, and start watching it for changes.
	 */
	public async addRootFolder(folder: string) {
		folder = getPathFromStr(folder);
		if (this.rootFolders.includes(folder)) return false;

		this.rootFolders.push(folder);
		this.store.setRootFolders(this.rootFolders);

		const changes = await this.searchDirectoryForRepos(folder, this.maxDepthOfRepoSearch);
		if (this.updateReposRootFolderIndex()) {
			this.store.saveRepos(this.repos);
		}
		this.startWatchingFolder(folder);
		if (changes) this.sendRepos();
		return true;
	}

	/**
	 * Remove a root folder, its watcher, and any repositories found only within it.
	 */
	public removeRootFolder(folder: string) {
		folder = getPathFromStr(folder);
		const index = this.rootFolders.indexOf(folder);
		if (index === -1) return false;

		this.rootFolders.splice(index, 1);
		this.store.setRootFolders(this.rootFolders);

		const changes = this.removeReposWithinFolder(folder);
		this.stopWatchingFolder(folder);
		if (this.updateReposRootFolderIndex()) {
			this.store.saveRepos(this.repos);
		}
		if (changes) this.sendRepos();
		return true;
	}

	/**
	 * Apply a new value of `maxDepthOfRepoSearch` (e.g. after a config file edit).
	 */
	public maxDepthOfRepoSearchChanged(newDepth: number) {
		const increased = newDepth > this.maxDepthOfRepoSearch;
		this.maxDepthOfRepoSearch = newDepth;
		if (increased) this.searchWorkspaceForRepos();
	}

	private async startupTasks() {
		this.removeReposNotInRootFolders();
		if (this.updateReposRootFolderIndex()) {
			this.store.saveRepos(this.repos);
		}
		if (!await this.checkReposExist()) {
			this.sendRepos();
		}
		this.checkReposForNewConfig();
		await this.checkReposForNewSubmodules();
		await this.searchWorkspaceForRepos();
		this.startWatchingFolders();
	}

	private removeReposNotInRootFolders() {
		const rootsExact = this.rootFolders, rootsFolder = this.rootFolders.map(pathWithTrailingSlash);
		const repoPaths = Object.keys(this.repos);
		for (let i = 0; i < repoPaths.length; i++) {
			const repoPathFolder = pathWithTrailingSlash(repoPaths[i]);
			if (rootsExact.indexOf(repoPaths[i]) === -1 && !rootsFolder.find(root => repoPaths[i].startsWith(root)) && !rootsExact.find(root => root.startsWith(repoPathFolder))) {
				this.removeRepo(repoPaths[i]);
			}
		}
	}

	/**
	 * Register a new repository with Git Graph.
	 */
	public registerRepo(repoPath: string, loadRepo: boolean) {
		return new Promise<{ root: string | null, error: string | null }>(async resolve => {
			let root = await this.dataSource.repoRoot(repoPath);
			if (root === null) {
				resolve({ root: null, error: 'The folder "' + repoPath + '" is not a Git repository.' });
			} else if (typeof this.repos[root] !== 'undefined') {
				resolve({ root: null, error: 'The folder "' + repoPath + '" is contained within the known repository "' + root + '".' });
			} else {
				if (this.ignoredRepos.includes(root)) {
					this.ignoredRepos.splice(this.ignoredRepos.indexOf(root), 1);
					this.store.setIgnoredRepos(this.ignoredRepos);
				}
				await this.addRepo(root);
				this.sendRepos(loadRepo ? root : null);
				resolve({ root: root, error: null });
			}
		});
	}

	public ignoreRepo(repo: string) {
		if (this.isKnownRepo(repo)) {
			if (!this.ignoredRepos.includes(repo)) this.ignoredRepos.push(repo);
			this.store.setIgnoredRepos(this.ignoredRepos);
			this.removeRepo(repo);
			this.sendRepos();
			return true;
		} else {
			return false;
		}
	}


	/* Repo Management */

	public getRepos() {
		return Object.assign({}, this.repos);
	}

	public getNumRepos() {
		return Object.keys(this.repos).length;
	}

	public getRepoContainingFile(filePath: string) {
		let repoPaths = Object.keys(this.repos), repo = null;
		for (let i = 0; i < repoPaths.length; i++) {
			if (filePath.startsWith(pathWithTrailingSlash(repoPaths[i])) && (repo === null || repo.length < repoPaths[i].length)) repo = repoPaths[i];
		}
		return repo;
	}

	private getReposInFolder(folderPath: string) {
		let pathFolder = pathWithTrailingSlash(folderPath), repoPaths = Object.keys(this.repos), reposInFolder: string[] = [];
		for (let i = 0; i < repoPaths.length; i++) {
			if (repoPaths[i] === folderPath || repoPaths[i].startsWith(pathFolder)) reposInFolder.push(repoPaths[i]);
		}
		return reposInFolder;
	}

	public async getKnownRepo(repo: string) {
		if (this.isKnownRepo(repo)) {
			return repo;
		}

		let canonicalRepo = await realpath(repo);
		let repoPaths = Object.keys(this.repos);
		for (let i = 0; i < repoPaths.length; i++) {
			if (canonicalRepo === (await realpath(repoPaths[i]))) {
				return repoPaths[i];
			}
		}

		return null;
	}

	public isKnownRepo(repo: string) {
		return typeof this.repos[repo] !== 'undefined';
	}

	private async addRepo(repo: string) {
		if (this.ignoredRepos.includes(repo)) {
			return false;
		} else {
			this.repos[repo] = Object.assign({}, DEFAULT_REPO_STATE);
			this.updateReposRootFolderIndex(repo);
			this.store.saveRepos(this.repos);
			console.log('Added new repo: ' + repo);
			await this.checkRepoForNewConfig(repo, true);
			await this.searchRepoForSubmodules(repo);
			return true;
		}
	}

	private removeRepo(repo: string) {
		delete this.repos[repo];
		this.store.saveRepos(this.repos);
		console.log('Removed repo: ' + repo);
	}

	private removeReposWithinFolder(folderPath: string) {
		let reposInFolder = this.getReposInFolder(folderPath);
		for (let i = 0; i < reposInFolder.length; i++) {
			this.removeRepo(reposInFolder[i]);
		}
		return reposInFolder.length > 0;
	}

	private isDirectoryWithinRepos(dirPath: string) {
		let repoPaths = Object.keys(this.repos);
		for (let i = 0; i < repoPaths.length; i++) {
			if (dirPath === repoPaths[i] || dirPath.startsWith(pathWithTrailingSlash(repoPaths[i]))) return true;
		}
		return false;
	}

	private sendRepos(loadRepo: string | null = null) {
		this.repoEventEmitter.emit({
			repos: this.getRepos(),
			numRepos: this.getNumRepos(),
			loadRepo: loadRepo
		});
	}

	public checkReposExist() {
		let repoPaths = Object.keys(this.repos), changes = false;
		return evalPromises(repoPaths, 3, (p) => this.dataSource.repoRoot(p)).then((results) => {
			for (let i = 0; i < repoPaths.length; i++) {
				if (results[i] === null) {
					this.removeRepo(repoPaths[i]);
					changes = true;
				} else if (repoPaths[i] !== results[i]) {
					this.transferRepoState(repoPaths[i], results[i]!);
					changes = true;
				}
			}
		}).catch(() => { }).then(() => {
			if (changes) {
				this.sendRepos();
			}
			return changes;
		});
	}

	/**
	 * Update each repository's `workspaceFolderIndex` (repurposed here as an index into `rootFolders`).
	 */
	private updateReposRootFolderIndex(repo: string | null = null) {
		const rootsExact = this.rootFolders, rootsFolder = this.rootFolders.map(pathWithTrailingSlash);
		const repoPaths = repo !== null && this.isKnownRepo(repo) ? [repo] : Object.keys(this.repos);
		let changes = false, rootIndex: number, folderIndex: number | null;
		for (let i = 0; i < repoPaths.length; i++) {
			rootIndex = rootsExact.indexOf(repoPaths[i]);
			if (rootIndex === -1) {
				rootIndex = rootsFolder.findIndex((root) => repoPaths[i].startsWith(root));
			}
			if (rootIndex === -1) {
				const repoPathFolder = pathWithTrailingSlash(repoPaths[i]);
				rootIndex = rootsExact.findIndex((root) => root.startsWith(repoPathFolder));
			}
			folderIndex = rootIndex > -1 ? rootIndex : null;
			if (this.repos[repoPaths[i]].workspaceFolderIndex !== folderIndex) {
				this.repos[repoPaths[i]].workspaceFolderIndex = folderIndex;
				changes = true;
			}
		}
		return changes;
	}

	public setRepoState(repo: string, state: GitRepoState) {
		this.repos[repo] = state;
		this.store.saveRepos(this.repos);
	}

	private transferRepoState(oldRepo: string, newRepo: string) {
		this.repos[newRepo] = this.repos[oldRepo];
		delete this.repos[oldRepo];
		this.updateReposRootFolderIndex(newRepo);
		this.store.saveRepos(this.repos);
		this.store.transferRepo(oldRepo, newRepo);

		console.log('Transferred repo state: ' + oldRepo + ' -> ' + newRepo);
	}


	/* Repo Searching */

	public async searchWorkspaceForRepos() {
		console.log('Searching root folders for new repos ...');
		let changes = false;
		for (let i = 0; i < this.rootFolders.length; i++) {
			if (await this.searchDirectoryForRepos(this.rootFolders[i], this.maxDepthOfRepoSearch)) changes = true;
		}
		console.log('Completed searching root folders for new repos');
		if (changes) this.sendRepos();
		return changes;
	}

	private searchDirectoryForRepos(directory: string, maxDepth: number) {
		return new Promise<boolean>(resolve => {
			if (this.isDirectoryWithinRepos(directory)) {
				resolve(false);
				return;
			}

			this.dataSource.repoRoot(directory).then(async (root) => {
				if (root !== null) {
					resolve(await this.addRepo(root));
				} else if (maxDepth > 0) {
					fs.readdir(directory, async (err, dirContents) => {
						if (err) {
							resolve(false);
						} else {
							let dirs = [];
							for (let i = 0; i < dirContents.length; i++) {
								if (dirContents[i] !== '.git' && await isDirectory(directory + '/' + dirContents[i])) {
									dirs.push(directory + '/' + dirContents[i]);
								}
							}
							resolve((await evalPromises(dirs, 2, dir => this.searchDirectoryForRepos(dir, maxDepth - 1))).indexOf(true) > -1);
						}
					});
				} else {
					resolve(false);
				}
			}).catch(() => resolve(false));
		});
	}

	private async checkReposForNewSubmodules() {
		let repoPaths = Object.keys(this.repos), changes = false;
		for (let i = 0; i < repoPaths.length; i++) {
			if (await this.searchRepoForSubmodules(repoPaths[i])) changes = true;
		}
		if (changes) this.sendRepos();
	}

	private async searchRepoForSubmodules(repo: string) {
		let submodules = await this.dataSource.getSubmodules(repo), changes = false;
		for (let i = 0; i < submodules.length; i++) {
			if (!this.isKnownRepo(submodules[i])) {
				if (await this.addRepo(submodules[i])) changes = true;
			}
		}
		return changes;
	}


	/* Root Folder Watching */

	private startWatchingFolders() {
		for (let i = 0; i < this.rootFolders.length; i++) {
			this.startWatchingFolder(this.rootFolders[i]);
		}
	}

	private startWatchingFolder(folderPath: string) {
		// Excludes node_modules and .git internals from the recursive watch setup - onWatcherCreate/
		// onWatcherChange/onWatcherDelete already discard everything under .git anyway (they only
		// care about the bare .git directory appearing/disappearing), so this is a pure startup-time
		// perf fix, not a behaviour change.
		const watcher = chokidar.watch(folderPath, { ignoreInitial: true, disableGlobbing: true, ignored: ['**/node_modules/**', '**/.git/**'] });
		watcher.on('add', (p) => this.onWatcherCreate(p));
		watcher.on('addDir', (p) => this.onWatcherCreate(p));
		watcher.on('change', (p) => this.onWatcherChange(p));
		watcher.on('unlink', (p) => this.onWatcherDelete(p));
		watcher.on('unlinkDir', (p) => this.onWatcherDelete(p));
		this.folderWatchers[folderPath] = watcher;
	}

	private stopWatchingFolder(folderPath: string) {
		this.folderWatchers[folderPath].close();
		delete this.folderWatchers[folderPath];
	}

	private onWatcherCreate(rawPath: string) {
		let p = getPathFromStr(rawPath);
		if (p.indexOf('/.git/') > -1) return;
		if (p.endsWith('/.git')) p = p.slice(0, -5);
		if (this.isRepoConfigFile(p)) {
			const repo = this.getRepoContainingFile(p);
			if (repo !== null) this.checkRepoConfigQueue.enqueue(repo);
			return;
		}
		this.onWatcherCreateQueue.enqueue(p);
	}

	private onWatcherChange(rawPath: string) {
		let p = getPathFromStr(rawPath);
		if (p.indexOf('/.git/') > -1) return;
		if (p.endsWith('/.git')) p = p.slice(0, -5);
		if (this.isRepoConfigFile(p)) {
			const repo = this.getRepoContainingFile(p);
			if (repo !== null) this.checkRepoConfigQueue.enqueue(repo);
			return;
		}
		this.onWatcherChangeQueue.enqueue(p);
	}

	private onWatcherDelete(rawPath: string) {
		let p = getPathFromStr(rawPath);
		if (p.indexOf('/.git/') > -1) return;
		if (p.endsWith('/.git')) p = p.slice(0, -5);
		if (this.removeReposWithinFolder(p)) this.sendRepos();
	}

	private isRepoConfigFile(filePath: string) {
		return filePath.endsWith('/.vscode/vscode-git-graph.json');
	}

	private async processOnWatcherCreateEvent(p: string) {
		if (await isDirectory(p)) {
			if (await this.searchDirectoryForRepos(p, this.maxDepthOfRepoSearch)) {
				return true;
			}
		}
		return false;
	}

	private async processOnWatcherChangeEvent(p: string) {
		if (!await doesPathExist(p)) {
			if (this.removeReposWithinFolder(p)) {
				return true;
			}
		}
		return false;
	}


	/* Repository Configuration Management */

	private checkReposForNewConfig() {
		Object.keys(this.repos).forEach((repo) => this.checkRepoConfigQueue.enqueue(repo));
	}

	private async checkRepoForNewConfig(repo: string, isRepoNew: boolean = false) {
		try {
			const file = await readExternalConfigFile(repo);
			const state = this.repos[repo];
			if (state && file !== null && typeof file.exportedAt === 'number' && file.exportedAt > state.lastImportAt) {
				const validationError = validateExternalConfigFile(file);
				if (validationError === null) {
					// Auto-accept for new repos; existing repos are auto-imported too for now -
					// Phase 6 wires this to a real confirmation dialog (was `showInformationMessage(...,'Yes','No')`).
					if (this.isKnownRepo(repo)) {
						const state = this.repos[repo];
						applyExternalConfigFile(file, state);
						state.lastImportAt = file.exportedAt;
						this.store.saveRepos(this.repos);
						if (!isRepoNew) {
							showInformationMessage('Git Graph Repository Configuration was successfully imported for the repository "' + (state.name || getRepoName(repo)) + '".');
						}
						return true;
					}
				} else {
					showErrorMessage('The value for "' + validationError + '" in the configuration file "' + getPathFromStr(path.join(repo, '.vscode', 'vscode-git-graph.json')) + '" is invalid.');
				}
			}
		} catch (_) { }
		return false;
	}

	public exportRepoConfig(repo: string): Promise<ErrorInfo> {
		const file = generateExternalConfigFile(this.repos[repo]);
		return writeExternalConfigFile(repo, file).then((message) => {
			showInformationMessage(message);
			if (this.isKnownRepo(repo)) {
				this.repos[repo].lastImportAt = file.exportedAt!;
				this.store.saveRepos(this.repos);
			}
			return null;
		}, (error) => error);
	}
}

function isDirectory(p: string) {
	return new Promise<boolean>(resolve => {
		fs.stat(p, (err, stats) => {
			resolve(err ? false : stats.isDirectory());
		});
	});
}

function doesPathExist(p: string) {
	return new Promise<boolean>(resolve => {
		fs.stat(p, err => resolve(!err));
	});
}


/* External Repo Config File */

export namespace ExternalRepoConfig {

	export const enum FileViewType {
		Tree = 'tree',
		List = 'list'
	}

	export interface IssueLinkingConfig {
		readonly issue: string;
		readonly url: string;
	}

	export const enum PullRequestProvider {
		Bitbucket = 'bitbucket',
		Custom = 'custom',
		GitHub = 'github',
		GitLab = 'gitlab'
	}

	interface PullRequestConfigBuiltIn extends PullRequestConfigBase {
		readonly provider: Exclude<PullRequestProvider, PullRequestProvider.Custom>;
		readonly custom: null;
	}

	interface PullRequestConfigCustom extends PullRequestConfigBase {
		readonly provider: PullRequestProvider.Custom;
		readonly custom: {
			readonly name: string,
			readonly templateUrl: string
		};
	}

	export type PullRequestConfig = PullRequestConfigBuiltIn | PullRequestConfigCustom;

	export interface File {
		commitOrdering?: RepoCommitOrdering;
		fileViewType?: FileViewType;
		hideRemotes?: string[];
		includeCommitsMentionedByReflogs?: boolean;
		issueLinkingConfig?: IssueLinkingConfig;
		name?: string | null;
		onlyFollowFirstParent?: boolean;
		onRepoLoadShowCheckedOutBranch?: boolean;
		onRepoLoadShowSpecificBranches?: string[];
		pullRequestConfig?: PullRequestConfig;
		showRemoteBranches?: boolean;
		showStashes?: boolean;
		showTags?: boolean;
		exportedAt?: number;
	}

}

function readExternalConfigFile(repo: string) {
	return new Promise<Readonly<ExternalRepoConfig.File> | null>((resolve) => {
		fs.readFile(path.join(repo, '.vscode', 'vscode-git-graph.json'), (err, data) => {
			if (err) {
				resolve(null);
			} else {
				try {
					const contents = JSON.parse(data.toString());
					resolve(typeof contents === 'object' ? contents : null);
				} catch (_) {
					resolve(null);
				}
			}
		});
	});
}

function writeExternalConfigFile(repo: string, file: ExternalRepoConfig.File) {
	return new Promise<string>((resolve, reject) => {
		const vscodePath = path.join(repo, '.vscode');
		fs.mkdir(vscodePath, (err) => {
			if (!err || err.code === 'EEXIST') {
				const configPath = path.join(vscodePath, 'vscode-git-graph.json');
				fs.writeFile(configPath, JSON.stringify(file, null, 4), (err) => {
					if (err) {
						reject('Failed to write the Git Graph Repository Configuration File to "' + getPathFromStr(configPath) + '".');
					} else {
						resolve('Successfully exported the Git Graph Repository Configuration to "' + getPathFromStr(configPath) + '".');
					}
				});
			} else {
				reject('An unexpected error occurred while checking if the "' + getPathFromStr(vscodePath) + '" directory exists. This directory is used to store the Git Graph Repository Configuration file.');
			}
		});
	});
}

function generateExternalConfigFile(state: GitRepoState): Readonly<ExternalRepoConfig.File> {
	const file: ExternalRepoConfig.File = {};

	if (state.commitOrdering !== RepoCommitOrdering.Default) {
		file.commitOrdering = state.commitOrdering;
	}
	if (state.fileViewType !== FileViewType.Default) {
		switch (state.fileViewType) {
			case FileViewType.Tree:
				file.fileViewType = ExternalRepoConfig.FileViewType.Tree;
				break;
			case FileViewType.List:
				file.fileViewType = ExternalRepoConfig.FileViewType.List;
				break;
		}
	}
	if (state.hideRemotes.length > 0) {
		file.hideRemotes = state.hideRemotes;
	}
	if (state.includeCommitsMentionedByReflogs !== BooleanOverride.Default) {
		file.includeCommitsMentionedByReflogs = state.includeCommitsMentionedByReflogs === BooleanOverride.Enabled;
	}
	if (state.issueLinkingConfig !== null) {
		file.issueLinkingConfig = state.issueLinkingConfig;
	}
	if (state.name !== null) {
		file.name = state.name;
	}
	if (state.onlyFollowFirstParent !== BooleanOverride.Default) {
		file.onlyFollowFirstParent = state.onlyFollowFirstParent === BooleanOverride.Enabled;
	}
	if (state.onRepoLoadShowCheckedOutBranch !== BooleanOverride.Default) {
		file.onRepoLoadShowCheckedOutBranch = state.onRepoLoadShowCheckedOutBranch === BooleanOverride.Enabled;
	}
	if (state.onRepoLoadShowSpecificBranches !== null) {
		file.onRepoLoadShowSpecificBranches = state.onRepoLoadShowSpecificBranches;
	}
	if (state.pullRequestConfig !== null) {
		let provider: ExternalRepoConfig.PullRequestProvider;
		switch (state.pullRequestConfig.provider) {
			case PullRequestProvider.Bitbucket:
				provider = ExternalRepoConfig.PullRequestProvider.Bitbucket;
				break;
			case PullRequestProvider.Custom:
				provider = ExternalRepoConfig.PullRequestProvider.Custom;
				break;
			case PullRequestProvider.GitHub:
				provider = ExternalRepoConfig.PullRequestProvider.GitHub;
				break;
			case PullRequestProvider.GitLab:
				provider = ExternalRepoConfig.PullRequestProvider.GitLab;
				break;
		}
		file.pullRequestConfig = Object.assign({}, state.pullRequestConfig, { provider: provider });
	}
	if (state.showRemoteBranchesV2 !== BooleanOverride.Default) {
		file.showRemoteBranches = state.showRemoteBranchesV2 === BooleanOverride.Enabled;
	}
	if (state.showStashes !== BooleanOverride.Default) {
		file.showStashes = state.showStashes === BooleanOverride.Enabled;
	}
	if (state.showTags !== BooleanOverride.Default) {
		file.showTags = state.showTags === BooleanOverride.Enabled;
	}
	file.exportedAt = (new Date()).getTime();
	return file;
}

function validateExternalConfigFile(file: Readonly<ExternalRepoConfig.File>) {
	if (typeof file.commitOrdering !== 'undefined' && file.commitOrdering !== RepoCommitOrdering.Date && file.commitOrdering !== RepoCommitOrdering.AuthorDate && file.commitOrdering !== RepoCommitOrdering.Topological) {
		return 'commitOrdering';
	}
	if (typeof file.fileViewType !== 'undefined' && file.fileViewType !== ExternalRepoConfig.FileViewType.Tree && file.fileViewType !== ExternalRepoConfig.FileViewType.List) {
		return 'fileViewType';
	}
	if (typeof file.hideRemotes !== 'undefined' && (!Array.isArray(file.hideRemotes) || file.hideRemotes.some((remote) => typeof remote !== 'string'))) {
		return 'hideRemotes';
	}
	if (typeof file.includeCommitsMentionedByReflogs !== 'undefined' && typeof file.includeCommitsMentionedByReflogs !== 'boolean') {
		return 'includeCommitsMentionedByReflogs';
	}
	if (typeof file.issueLinkingConfig !== 'undefined' && (typeof file.issueLinkingConfig !== 'object' || file.issueLinkingConfig === null || typeof file.issueLinkingConfig.issue !== 'string' || typeof file.issueLinkingConfig.url !== 'string')) {
		return 'issueLinkingConfig';
	}
	if (typeof file.name !== 'undefined' && typeof file.name !== 'string') {
		return 'name';
	}
	if (typeof file.onlyFollowFirstParent !== 'undefined' && typeof file.onlyFollowFirstParent !== 'boolean') {
		return 'onlyFollowFirstParent';
	}
	if (typeof file.onRepoLoadShowCheckedOutBranch !== 'undefined' && typeof file.onRepoLoadShowCheckedOutBranch !== 'boolean') {
		return 'onRepoLoadShowCheckedOutBranch';
	}
	if (typeof file.onRepoLoadShowSpecificBranches !== 'undefined' && (!Array.isArray(file.onRepoLoadShowSpecificBranches) || file.onRepoLoadShowSpecificBranches.some((branch) => typeof branch !== 'string'))) {
		return 'onRepoLoadShowSpecificBranches';
	}
	if (typeof file.pullRequestConfig !== 'undefined' && (
		typeof file.pullRequestConfig !== 'object' ||
		file.pullRequestConfig === null ||
		(
			file.pullRequestConfig.provider !== ExternalRepoConfig.PullRequestProvider.Bitbucket &&
			(file.pullRequestConfig.provider !== ExternalRepoConfig.PullRequestProvider.Custom || typeof file.pullRequestConfig.custom !== 'object' || file.pullRequestConfig.custom === null || typeof file.pullRequestConfig.custom.name !== 'string' || typeof file.pullRequestConfig.custom.templateUrl !== 'string') &&
			file.pullRequestConfig.provider !== ExternalRepoConfig.PullRequestProvider.GitHub &&
			file.pullRequestConfig.provider !== ExternalRepoConfig.PullRequestProvider.GitLab
		) ||
		typeof file.pullRequestConfig.hostRootUrl !== 'string' ||
		typeof file.pullRequestConfig.sourceRemote !== 'string' ||
		typeof file.pullRequestConfig.sourceOwner !== 'string' ||
		typeof file.pullRequestConfig.sourceRepo !== 'string' ||
		(typeof file.pullRequestConfig.destRemote !== 'string' && file.pullRequestConfig.destRemote !== null) ||
		typeof file.pullRequestConfig.destOwner !== 'string' ||
		typeof file.pullRequestConfig.destRepo !== 'string' ||
		typeof file.pullRequestConfig.destProjectId !== 'string' ||
		typeof file.pullRequestConfig.destBranch !== 'string'
	)) {
		return 'pullRequestConfig';
	}
	if (typeof file.showRemoteBranches !== 'undefined' && typeof file.showRemoteBranches !== 'boolean') {
		return 'showRemoteBranches';
	}
	if (typeof file.showStashes !== 'undefined' && typeof file.showStashes !== 'boolean') {
		return 'showStashes';
	}
	if (typeof file.showTags !== 'undefined' && typeof file.showTags !== 'boolean') {
		return 'showTags';
	}
	return null;
}

function applyExternalConfigFile(file: Readonly<ExternalRepoConfig.File>, state: GitRepoState) {
	if (typeof file.commitOrdering !== 'undefined') {
		state.commitOrdering = file.commitOrdering;
	}
	if (typeof file.fileViewType !== 'undefined') {
		switch (file.fileViewType) {
			case ExternalRepoConfig.FileViewType.Tree:
				state.fileViewType = FileViewType.Tree;
				break;
			case ExternalRepoConfig.FileViewType.List:
				state.fileViewType = FileViewType.List;
				break;
		}
	}
	if (typeof file.hideRemotes !== 'undefined') {
		state.hideRemotes = file.hideRemotes;
	}
	if (typeof file.includeCommitsMentionedByReflogs !== 'undefined') {
		state.includeCommitsMentionedByReflogs = file.includeCommitsMentionedByReflogs ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
	if (typeof file.issueLinkingConfig !== 'undefined') {
		state.issueLinkingConfig = {
			issue: file.issueLinkingConfig.issue,
			url: file.issueLinkingConfig.url
		};
	}
	if (typeof file.name !== 'undefined') {
		state.name = file.name;
	}
	if (typeof file.onlyFollowFirstParent !== 'undefined') {
		state.onlyFollowFirstParent = file.onlyFollowFirstParent ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
	if (typeof file.onRepoLoadShowCheckedOutBranch !== 'undefined') {
		state.onRepoLoadShowCheckedOutBranch = file.onRepoLoadShowCheckedOutBranch ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
	if (typeof file.onRepoLoadShowSpecificBranches !== 'undefined') {
		state.onRepoLoadShowSpecificBranches = file.onRepoLoadShowSpecificBranches;
	}
	if (typeof file.pullRequestConfig !== 'undefined') {
		let provider: PullRequestProvider;
		switch (file.pullRequestConfig.provider) {
			case ExternalRepoConfig.PullRequestProvider.Bitbucket:
				provider = PullRequestProvider.Bitbucket;
				break;
			case ExternalRepoConfig.PullRequestProvider.Custom:
				provider = PullRequestProvider.Custom;
				break;
			case ExternalRepoConfig.PullRequestProvider.GitHub:
				provider = PullRequestProvider.GitHub;
				break;
			case ExternalRepoConfig.PullRequestProvider.GitLab:
				provider = PullRequestProvider.GitLab;
				break;
		}
		state.pullRequestConfig = <PullRequestConfig>{
			provider: provider,
			custom: provider === PullRequestProvider.Custom
				? {
					name: file.pullRequestConfig.custom!.name,
					templateUrl: file.pullRequestConfig.custom!.templateUrl
				}
				: null,
			hostRootUrl: file.pullRequestConfig.hostRootUrl,
			sourceRemote: file.pullRequestConfig.sourceRemote,
			sourceOwner: file.pullRequestConfig.sourceOwner,
			sourceRepo: file.pullRequestConfig.sourceRepo,
			destRemote: file.pullRequestConfig.destRemote,
			destOwner: file.pullRequestConfig.destOwner,
			destRepo: file.pullRequestConfig.destRepo,
			destProjectId: file.pullRequestConfig.destProjectId,
			destBranch: file.pullRequestConfig.destBranch
		};
	}
	if (typeof file.showRemoteBranches !== 'undefined') {
		state.showRemoteBranchesV2 = file.showRemoteBranches ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
	if (typeof file.showStashes !== 'undefined') {
		state.showStashes = file.showStashes ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
	if (typeof file.showTags !== 'undefined') {
		state.showTags = file.showTags ? BooleanOverride.Enabled : BooleanOverride.Disabled;
	}
}
