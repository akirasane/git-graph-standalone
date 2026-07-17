import * as fs from 'fs';
import * as path from 'path';
import { BooleanOverride, CodeReview, ErrorInfo, FileViewType, GitGraphViewGlobalState, GitGraphViewWorkspaceState, GitRepoSet, GitRepoState, RepoCommitOrdering } from './types';

/**
 * Ported from src/extensionState.ts. VSCode's `context.globalState`/`context.workspaceState`
 * (both key/value Mementos) are replaced by a single JSON file - there's no separate
 * global-vs-workspace scope in a standalone app, so the global/workspace split collapses
 * into one flat store.
 */

export interface Avatar {
	image: string;
	timestamp: number;
	identicon: boolean;
}
export type AvatarCache = { [email: string]: Avatar };

export interface CodeReviewData {
	lastActive: number;
	lastViewedFile: string | null;
	remainingFiles: string[];
}
export type CodeReviews = { [repo: string]: { [id: string]: CodeReviewData } };

const AVATAR_STORAGE_FOLDER = 'avatars';

const AVATAR_CACHE = 'avatarCache';
const CODE_REVIEWS = 'codeReviews';
const GLOBAL_VIEW_STATE = 'globalViewState';
const IGNORED_REPOS = 'ignoredRepos';
const LAST_ACTIVE_REPO = 'lastActiveRepo';
const LAST_KNOWN_GIT_PATH = 'lastKnownGitPath';
const REPO_STATES = 'repoStates';
const ROOT_FOLDERS = 'rootFolders';
const WORKSPACE_VIEW_STATE = 'workspaceViewState';

export const DEFAULT_REPO_STATE: GitRepoState = {
	cdvDivider: 0.5,
	cdvHeight: 250,
	columnWidths: null,
	commitOrdering: RepoCommitOrdering.Default,
	fileViewType: FileViewType.Default,
	hideRemotes: [],
	includeCommitsMentionedByReflogs: BooleanOverride.Default,
	issueLinkingConfig: null,
	lastImportAt: 0,
	name: null,
	onlyFollowFirstParent: BooleanOverride.Default,
	onRepoLoadShowCheckedOutBranch: BooleanOverride.Default,
	onRepoLoadShowSpecificBranches: null,
	pullRequestConfig: null,
	showRemoteBranches: true,
	showRemoteBranchesV2: BooleanOverride.Default,
	showStashes: BooleanOverride.Default,
	showTags: BooleanOverride.Default,
	workspaceFolderIndex: null
};

const DEFAULT_GIT_GRAPH_VIEW_GLOBAL_STATE: GitGraphViewGlobalState = {
	alwaysAcceptCheckoutCommit: false,
	issueLinkingConfig: null,
	pushTagSkipRemoteCheck: false
};

const DEFAULT_GIT_GRAPH_VIEW_WORKSPACE_STATE: GitGraphViewWorkspaceState = {
	findIsCaseSensitive: false,
	findIsRegex: false,
	findOpenCommitDetailsView: false
};

/**
 * Manages the Git Graph standalone app's persisted state (known repos, code reviews, avatar
 * cache, view state), backed by a single JSON file instead of VSCode's global/workspace Mementos.
 */
export class Store {
	private readonly filePath: string;
	private readonly userDataPath: string;
	private data: { [key: string]: any };
	private avatarStorageAvailable = false;

	/**
	 * @param userDataPath The app's user data directory (Electron's `app.getPath('userData')`).
	 */
	constructor(userDataPath: string) {
		this.userDataPath = userDataPath;
		this.filePath = path.join(userDataPath, 'state.json');
		this.data = this.load();

		const avatarStoragePath = this.getAvatarStoragePath();
		try {
			fs.mkdirSync(avatarStoragePath, { recursive: true });
			this.avatarStorageAvailable = true;
		} catch (_) {
			this.avatarStorageAvailable = false;
		}
	}

	private load(): { [key: string]: any } {
		try {
			return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
		} catch (_) {
			return {};
		}
	}

	private get<T>(key: string, defaultValue: T): T {
		return typeof this.data[key] === 'undefined' ? defaultValue : this.data[key];
	}

	private set(key: string, value: any): Promise<ErrorInfo> {
		this.data[key] = value;
		return new Promise((resolve) => {
			fs.mkdir(this.userDataPath, { recursive: true }, () => {
				fs.writeFile(this.filePath, JSON.stringify(this.data, null, '\t'), (err) => {
					resolve(err ? 'Unable to save the Git Graph application state.' : null);
				});
			});
		});
	}


	/* Known Repositories */

	public getRepos(): GitRepoSet {
		const repoSet = this.get<GitRepoSet>(REPO_STATES, {});
		const outputSet: GitRepoSet = {};
		Object.keys(repoSet).forEach((repo) => {
			outputSet[repo] = Object.assign({}, DEFAULT_REPO_STATE, repoSet[repo]);
		});
		return outputSet;
	}

	public saveRepos(gitRepoSet: GitRepoSet) {
		return this.set(REPO_STATES, gitRepoSet);
	}

	public transferRepo(oldRepo: string, newRepo: string) {
		if (this.getLastActiveRepo() === oldRepo) {
			this.setLastActiveRepo(newRepo);
		}

		let reviews = this.getCodeReviews();
		if (typeof reviews[oldRepo] !== 'undefined') {
			reviews[newRepo] = reviews[oldRepo];
			delete reviews[oldRepo];
			this.setCodeReviews(reviews);
		}
	}


	/* Global View State */

	public getGlobalViewState() {
		const globalViewState = this.get<GitGraphViewGlobalState>(GLOBAL_VIEW_STATE, DEFAULT_GIT_GRAPH_VIEW_GLOBAL_STATE);
		return Object.assign({}, DEFAULT_GIT_GRAPH_VIEW_GLOBAL_STATE, globalViewState);
	}

	public setGlobalViewState(state: GitGraphViewGlobalState) {
		return this.set(GLOBAL_VIEW_STATE, state);
	}


	/* Workspace View State */

	public getWorkspaceViewState() {
		const workspaceViewState = this.get<GitGraphViewWorkspaceState>(WORKSPACE_VIEW_STATE, DEFAULT_GIT_GRAPH_VIEW_WORKSPACE_STATE);
		return Object.assign({}, DEFAULT_GIT_GRAPH_VIEW_WORKSPACE_STATE, workspaceViewState);
	}

	public setWorkspaceViewState(state: GitGraphViewWorkspaceState) {
		return this.set(WORKSPACE_VIEW_STATE, state);
	}


	/* Ignored Repos */

	public getIgnoredRepos() {
		return this.get<string[]>(IGNORED_REPOS, []);
	}

	public setIgnoredRepos(ignoredRepos: string[]) {
		return this.set(IGNORED_REPOS, ignoredRepos);
	}


	/* Last Active Repo */

	public getLastActiveRepo() {
		return this.get<string | null>(LAST_ACTIVE_REPO, null);
	}

	public setLastActiveRepo(repo: string | null) {
		this.set(LAST_ACTIVE_REPO, repo);
	}


	/* Root Folders (standalone replacement for VSCode's workspace folders) */

	public getRootFolders(): string[] {
		return this.get<string[]>(ROOT_FOLDERS, []);
	}

	public setRootFolders(rootFolders: string[]) {
		return this.set(ROOT_FOLDERS, rootFolders);
	}


	/* Last Known Git Path */

	public getLastKnownGitPath() {
		return this.get<string | null>(LAST_KNOWN_GIT_PATH, null);
	}

	public setLastKnownGitPath(path: string) {
		this.set(LAST_KNOWN_GIT_PATH, path);
	}


	/* Avatars */

	public isAvatarStorageAvailable() {
		return this.avatarStorageAvailable;
	}

	public getAvatarStoragePath() {
		return path.join(this.userDataPath, AVATAR_STORAGE_FOLDER);
	}

	public getAvatarCache() {
		return this.get<AvatarCache>(AVATAR_CACHE, {});
	}

	public saveAvatar(email: string, avatar: Avatar) {
		let avatars = this.getAvatarCache();
		avatars[email] = avatar;
		this.set(AVATAR_CACHE, avatars);
	}

	public removeAvatarFromCache(email: string) {
		let avatars = this.getAvatarCache();
		delete avatars[email];
		this.set(AVATAR_CACHE, avatars);
	}

	public clearAvatarCache() {
		return this.set(AVATAR_CACHE, {}).then((errorInfo) => {
			if (errorInfo === null) {
				fs.readdir(this.getAvatarStoragePath(), (err, files) => {
					if (err) return;
					for (let i = 0; i < files.length; i++) {
						fs.unlink(path.join(this.getAvatarStoragePath(), files[i]), () => { });
					}
				});
			}
			return errorInfo;
		});
	}


	/* Code Review */

	// Note: id => the commit arguments to 'git diff' (either <commit hash> or <commit hash>-<commit hash>)

	public startCodeReview(repo: string, id: string, files: string[], lastViewedFile: string | null) {
		let reviews = this.getCodeReviews();
		if (typeof reviews[repo] === 'undefined') reviews[repo] = {};
		reviews[repo][id] = { lastActive: (new Date()).getTime(), lastViewedFile: lastViewedFile, remainingFiles: files };
		return this.setCodeReviews(reviews).then((err) => ({
			codeReview: <CodeReview>Object.assign({ id: id }, reviews[repo][id]),
			error: err
		}));
	}

	public endCodeReview(repo: string, id: string) {
		let reviews = this.getCodeReviews();
		removeCodeReview(reviews, repo, id);
		return this.setCodeReviews(reviews);
	}

	public getCodeReview(repo: string, id: string) {
		let reviews = this.getCodeReviews();
		if (typeof reviews[repo] !== 'undefined' && typeof reviews[repo][id] !== 'undefined') {
			reviews[repo][id].lastActive = (new Date()).getTime();
			this.setCodeReviews(reviews);
			return <CodeReview>Object.assign({ id: id }, reviews[repo][id]);
		} else {
			return null;
		}
	}

	public updateCodeReview(repo: string, id: string, remainingFiles: string[], lastViewedFile: string | null) {
		const reviews = this.getCodeReviews();

		if (typeof reviews[repo] === 'undefined' || typeof reviews[repo][id] === 'undefined') {
			return Promise.resolve('The Code Review could not be found.');
		}

		if (remainingFiles.length > 0) {
			reviews[repo][id].remainingFiles = remainingFiles;
			reviews[repo][id].lastActive = (new Date()).getTime();
			if (lastViewedFile !== null) {
				reviews[repo][id].lastViewedFile = lastViewedFile;
			}
		} else {
			removeCodeReview(reviews, repo, id);
		}

		return this.setCodeReviews(reviews);
	}

	public expireOldCodeReviews() {
		let reviews = this.getCodeReviews(), change = false, expireReviewsBefore = (new Date()).getTime() - 7776000000; // 90 days x 24 hours x 60 minutes x 60 seconds x 1000 milliseconds
		Object.keys(reviews).forEach((repo) => {
			Object.keys(reviews[repo]).forEach((id) => {
				if (reviews[repo][id].lastActive < expireReviewsBefore) {
					delete reviews[repo][id];
					change = true;
				}
			});
			removeCodeReviewRepoIfEmpty(reviews, repo);
		});
		if (change) this.setCodeReviews(reviews);
	}

	public endAllWorkspaceCodeReviews() {
		this.setCodeReviews({});
	}

	public getCodeReviews() {
		return this.get<CodeReviews>(CODE_REVIEWS, {});
	}

	private setCodeReviews(reviews: CodeReviews) {
		return this.set(CODE_REVIEWS, reviews);
	}
}


/* Helper Methods */

function removeCodeReview(reviews: CodeReviews, repo: string, id: string) {
	if (typeof reviews[repo] !== 'undefined' && typeof reviews[repo][id] !== 'undefined') {
		delete reviews[repo][id];
		removeCodeReviewRepoIfEmpty(reviews, repo);
	}
}

function removeCodeReviewRepoIfEmpty(reviews: CodeReviews, repo: string) {
	if (typeof reviews[repo] !== 'undefined' && Object.keys(reviews[repo]).length === 0) {
		delete reviews[repo];
	}
}
