import { BrowserWindow } from 'electron';
import { AvatarManager } from './avatarManager';
import { DataSource, GitCommitDetailsData, GitConfigKey } from './dataSource';
import { RepoFileWatcher } from './repoFileWatcher';
import { RepoManager } from './repoManager';
import { Store } from './store';
import { ErrorInfo, GitConfigLocation, GitPushBranchMode, RequestMessage, ResponseMessage } from './types';
import {
	UNCOMMITTED, archive, copyFilePathToClipboard, copyToClipboard,
	createPullRequest, openExtensionSettings, openExternalUrl, openFile, showErrorMessage,
	viewDiff, viewDiffWithWorkingFile, viewFileAtRevision, viewScm
} from './utils';

/**
 * 's `respondToMessage` (the ~60-command switch) and
 * `respondLoadRepos`. The HTML-rendering half of gitGraphView.ts (`getHtmlForWebview`) stays out
 * of this file - main.ts/index.html own that,
 * HTML into here; the renderer is a normal Electron BrowserWindow loaded once.
 *
 * Message commands that need native UI (viewDiff, openFile, openTerminal, viewScm,
 * clipboard, external URLs, extension settings) call into utils.ts's ported equivalents - some
 * are real Electron implementations already (clipboard, shell.openExternal/openPath), others are
 * still Phase 5/6 stubs that return a "not yet implemented" ErrorInfo instead of throwing.
 */
export class GitGraphIpcHandler {
	private readonly win: BrowserWindow;
	private readonly dataSource: DataSource;
	private readonly avatarManager: AvatarManager;
	private readonly store: Store;
	private readonly repoManager: RepoManager;
	private readonly repoFileWatcher: RepoFileWatcher;

	private currentRepo: string | null = null;
	private loadRepoInfoRefreshId: number = 0;
	private loadCommitsRefreshId: number = 0;

	constructor(win: BrowserWindow, dataSource: DataSource, avatarManager: AvatarManager, store: Store, repoManager: RepoManager) {
		this.win = win;
		this.dataSource = dataSource;
		this.avatarManager = avatarManager;
		this.store = store;
		this.repoManager = repoManager;

		this.repoFileWatcher = new RepoFileWatcher(() => {
			this.sendMessage({ command: 'refresh' });
		});

		avatarManager.onAvatar((event) => {
			this.sendMessage({
				command: 'fetchAvatar',
				email: event.email,
				image: event.image
			});
		});

		repoManager.onDidChangeRepos((event) => {
			const loadViewTo = event.loadRepo !== null ? { repo: event.loadRepo } : null;
			this.sendMessage({
				command: 'loadRepos',
				repos: event.repos,
				lastActiveRepo: this.store.getLastActiveRepo(),
				loadViewTo: loadViewTo
			});
		});
	}

	/** Re-send the current repo list to the renderer (used after a page load, in case an earlier send was missed). */
	public resendRepos() {
		this.sendMessage({
			command: 'loadRepos',
			repos: this.repoManager.getRepos(),
			lastActiveRepo: this.store.getLastActiveRepo(),
			loadViewTo: null
		});
	}

	/** The refreshId of the most recent `loadRepoInfo` request - used by main.ts when rebuilding the initial page state. */
	get lastLoadRepoInfoRefreshId() {
		return this.loadRepoInfoRefreshId;
	}

	/** The refreshId of the most recent `loadCommits` request - used by main.ts when rebuilding the initial page state. */
	get lastLoadCommitsRefreshId() {
		return this.loadCommitsRefreshId;
	}

	/** The repo currently displayed in the Git Graph View, if any - used by menu.ts's "Fetch from Remote(s)" action. */
	public getCurrentRepo() {
		return this.currentRepo;
	}

	/**
	 * Handle a single request message from the renderer (registered by main.ts against
	 * `ipcMain.on('git-graph-message', ...)`).
	 */
	public async handleMessage(msg: RequestMessage) {
		this.repoFileWatcher.mute();
		let errorInfos: ErrorInfo[];

		switch (msg.command) {
			case 'addRemote':
				this.sendMessage({
					command: 'addRemote',
					error: await this.dataSource.addRemote(msg.repo, msg.name, msg.url, msg.pushUrl, msg.fetch)
				});
				break;
			case 'addTag':
				errorInfos = [await this.dataSource.addTag(msg.repo, msg.tagName, msg.commitHash, msg.type, msg.message, msg.force)];
				if (errorInfos[0] === null && msg.pushToRemote !== null) {
					errorInfos.push(...await this.dataSource.pushTag(msg.repo, msg.tagName, [msg.pushToRemote], msg.commitHash, msg.pushSkipRemoteCheck));
				}
				this.sendMessage({
					command: 'addTag',
					repo: msg.repo,
					tagName: msg.tagName,
					pushToRemote: msg.pushToRemote,
					commitHash: msg.commitHash,
					errors: errorInfos
				});
				break;
			case 'applyStash':
				this.sendMessage({
					command: 'applyStash',
					error: await this.dataSource.applyStash(msg.repo, msg.selector, msg.reinstateIndex)
				});
				break;
			case 'branchFromStash':
				this.sendMessage({
					command: 'branchFromStash',
					error: await this.dataSource.branchFromStash(msg.repo, msg.selector, msg.branchName)
				});
				break;
			case 'checkoutBranch':
				errorInfos = [await this.dataSource.checkoutBranch(msg.repo, msg.branchName, msg.remoteBranch)];
				if (errorInfos[0] === null && msg.pullAfterwards !== null) {
					errorInfos.push(await this.dataSource.pullBranch(msg.repo, msg.pullAfterwards.branchName, msg.pullAfterwards.remote, msg.pullAfterwards.createNewCommit, msg.pullAfterwards.squash));
				}
				this.sendMessage({
					command: 'checkoutBranch',
					pullAfterwards: msg.pullAfterwards,
					errors: errorInfos
				});
				break;
			case 'commitChanges': {
				const errors: ErrorInfo[] = [await this.dataSource.commitChanges(msg.repo, msg.summary, msg.description, msg.amend === true)];
				let pushSkippedReason: string | null = null;
				if (errors[0] === null && msg.push) {
					const info = await this.dataSource.getRepoInfo(msg.repo, false, false, []);
					if (info.head === null) {
						pushSkippedReason = 'The current branch could not be determined (e.g. a detached HEAD), so it was not pushed.';
					} else {
						const cfg = await this.dataSource.getConfig(msg.repo, info.remotes);
						const branchConfig = cfg.config !== null ? cfg.config.branches[info.head] : undefined;
						const remote = branchConfig ? (branchConfig.pushRemote || branchConfig.remote) : null;
						if (!remote) {
							pushSkippedReason = 'The current branch "' + info.head + '" has no upstream remote configured, so it was not pushed.';
						} else {
							errors.push(await this.dataSource.pushBranch(msg.repo, info.head, remote, false, GitPushBranchMode.Normal));
						}
					}
				}
				this.sendMessage({
					command: 'commitChanges',
					errors: errors,
					pushSkippedReason: pushSkippedReason
				});
				break;
			}
			case 'getStagedChanges': {
				const staged = await this.dataSource.getStagedChanges(msg.repo);
				this.sendMessage({ command: 'getStagedChanges', files: staged.files, error: staged.error });
				break;
			}
			case 'getUnstagedChanges': {
				const unstaged = await this.dataSource.getUnstagedChanges(msg.repo);
				this.sendMessage({ command: 'getUnstagedChanges', files: unstaged.files, error: unstaged.error });
				break;
			}
			case 'getConflicts': {
				const r = await this.dataSource.getConflicts(msg.repo);
				this.sendMessage({ command: 'getConflicts', operation: r.operation, files: r.files, error: r.error });
				break;
			}
			case 'getConflictFile': {
				const r = this.dataSource.getConflictFile(msg.repo, msg.filePath);
				this.sendMessage({ command: 'getConflictFile', filePath: msg.filePath, content: r.content, error: r.error });
				break;
			}
			case 'saveConflictFile':
				this.sendMessage({ command: 'saveConflictFile', filePath: msg.filePath, error: await this.dataSource.saveConflictFile(msg.repo, msg.filePath, msg.content) });
				break;
			case 'resolveConflictSide':
				this.sendMessage({ command: 'resolveConflictSide', filePath: msg.filePath, error: await this.dataSource.resolveConflictSide(msg.repo, msg.filePath, msg.side) });
				break;
			case 'conflictOperation':
				this.sendMessage({ command: 'conflictOperation', action: msg.action, error: await this.dataSource.conflictOperation(msg.repo, msg.operation, msg.action) });
				break;
			case 'discardFile':
				this.sendMessage({
					command: 'discardFile',
					error: await this.dataSource.discardFile(msg.repo, msg.filePath)
				});
				break;
			case 'discardAll':
				this.sendMessage({
					command: 'discardAll',
					error: await this.dataSource.discardAllChanges(msg.repo)
				});
				break;
			case 'stageAll':
				this.sendMessage({
					command: 'stageAll',
					error: await this.dataSource.stageAllChanges(msg.repo)
				});
				break;
			case 'stageFile':
				this.sendMessage({
					command: 'stageFile',
					error: await this.dataSource.stageFile(msg.repo, msg.filePath)
				});
				break;
			case 'unstageAll':
				this.sendMessage({
					command: 'unstageAll',
					error: await this.dataSource.unstageAllChanges(msg.repo)
				});
				break;
			case 'unstageFile':
				this.sendMessage({
					command: 'unstageFile',
					error: await this.dataSource.unstageFile(msg.repo, msg.filePath, msg.oldFilePath)
				});
				break;
			case 'checkoutCommit':
				this.sendMessage({
					command: 'checkoutCommit',
					error: await this.dataSource.checkoutCommit(msg.repo, msg.commitHash)
				});
				break;
			case 'cherrypickCommit':
				errorInfos = [await this.dataSource.cherrypickCommit(msg.repo, msg.commitHash, msg.parentIndex, msg.recordOrigin, msg.noCommit)];
				if (errorInfos[0] === null && msg.noCommit) {
					errorInfos.push(await viewScm());
				}
				this.sendMessage({ command: 'cherrypickCommit', errors: errorInfos });
				break;
			case 'cleanUntrackedFiles':
				this.sendMessage({
					command: 'cleanUntrackedFiles',
					error: await this.dataSource.cleanUntrackedFiles(msg.repo, msg.directories)
				});
				break;
			case 'commitDetails':
				let data: [GitCommitDetailsData, string | null] = await Promise.all([
					msg.commitHash === UNCOMMITTED
						? this.dataSource.getUncommittedDetails(msg.repo)
						: msg.stash === null
							? this.dataSource.getCommitDetails(msg.repo, msg.commitHash, msg.hasParents)
							: this.dataSource.getStashDetails(msg.repo, msg.commitHash, msg.stash),
					msg.avatarEmail !== null ? this.avatarManager.getAvatarImage(msg.avatarEmail) : Promise.resolve(null)
				]);
				this.sendMessage({
					command: 'commitDetails',
					...data[0],
					avatar: data[1],
					codeReview: msg.commitHash !== UNCOMMITTED ? this.store.getCodeReview(msg.repo, msg.commitHash) : null,
					refresh: msg.refresh
				});
				break;
			case 'compareCommits':
				this.sendMessage({
					command: 'compareCommits',
					commitHash: msg.commitHash,
					compareWithHash: msg.compareWithHash,
					...await this.dataSource.getCommitComparison(msg.repo, msg.fromHash, msg.toHash),
					codeReview: msg.toHash !== UNCOMMITTED ? this.store.getCodeReview(msg.repo, msg.fromHash + '-' + msg.toHash) : null,
					refresh: msg.refresh
				});
				break;
			case 'copyFilePath':
				this.sendMessage({
					command: 'copyFilePath',
					error: await copyFilePathToClipboard(msg.repo, msg.filePath, msg.absolute)
				});
				break;
			case 'copyToClipboard':
				this.sendMessage({
					command: 'copyToClipboard',
					type: msg.type,
					error: await copyToClipboard(msg.data)
				});
				break;
			case 'createArchive':
				this.sendMessage({
					command: 'createArchive',
					error: await archive(msg.repo, msg.ref, this.dataSource)
				});
				break;
			case 'createBranch':
				this.sendMessage({
					command: 'createBranch',
					errors: await this.dataSource.createBranch(msg.repo, msg.branchName, msg.commitHash, msg.checkout, msg.force)
				});
				break;
			case 'createPullRequest':
				errorInfos = [msg.push ? await this.dataSource.pushBranch(msg.repo, msg.sourceBranch, msg.sourceRemote, true, GitPushBranchMode.Normal) : null];
				if (errorInfos[0] === null) {
					errorInfos.push(await createPullRequest(msg.config, msg.sourceOwner, msg.sourceRepo, msg.sourceBranch));
				}
				this.sendMessage({
					command: 'createPullRequest',
					push: msg.push,
					errors: errorInfos
				});
				break;
			case 'deleteBranch':
				errorInfos = [await this.dataSource.deleteBranch(msg.repo, msg.branchName, msg.forceDelete)];
				if (errorInfos[0] === null) {
					for (let i = 0; i < msg.deleteOnRemotes.length; i++) {
						errorInfos.push(await this.dataSource.deleteRemoteBranch(msg.repo, msg.branchName, msg.deleteOnRemotes[i]));
					}
				}
				this.sendMessage({
					command: 'deleteBranch',
					repo: msg.repo,
					branchName: msg.branchName,
					deleteOnRemotes: msg.deleteOnRemotes,
					errors: errorInfos
				});
				break;
			case 'deleteRemote':
				this.sendMessage({
					command: 'deleteRemote',
					error: await this.dataSource.deleteRemote(msg.repo, msg.name)
				});
				break;
			case 'deleteRemoteBranch':
				this.sendMessage({
					command: 'deleteRemoteBranch',
					error: await this.dataSource.deleteRemoteBranch(msg.repo, msg.branchName, msg.remote)
				});
				break;
			case 'deleteTag':
				this.sendMessage({
					command: 'deleteTag',
					error: await this.dataSource.deleteTag(msg.repo, msg.tagName, msg.deleteOnRemote)
				});
				break;
			case 'deleteUserDetails':
				errorInfos = [];
				if (msg.name) {
					errorInfos.push(await this.dataSource.unsetConfigValue(msg.repo, GitConfigKey.UserName, msg.location));
				}
				if (msg.email) {
					errorInfos.push(await this.dataSource.unsetConfigValue(msg.repo, GitConfigKey.UserEmail, msg.location));
				}
				this.sendMessage({
					command: 'deleteUserDetails',
					errors: errorInfos
				});
				break;
			case 'dropCommit':
				this.sendMessage({
					command: 'dropCommit',
					error: await this.dataSource.dropCommit(msg.repo, msg.commitHash)
				});
				break;
			case 'dropStash':
				this.sendMessage({
					command: 'dropStash',
					error: await this.dataSource.dropStash(msg.repo, msg.selector)
				});
				break;
			case 'editRemote':
				this.sendMessage({
					command: 'editRemote',
					error: await this.dataSource.editRemote(msg.repo, msg.nameOld, msg.nameNew, msg.urlOld, msg.urlNew, msg.pushUrlOld, msg.pushUrlNew)
				});
				break;
			case 'editUserDetails':
				errorInfos = [
					await this.dataSource.setConfigValue(msg.repo, GitConfigKey.UserName, msg.name, msg.location),
					await this.dataSource.setConfigValue(msg.repo, GitConfigKey.UserEmail, msg.email, msg.location)
				];
				if (errorInfos[0] === null && errorInfos[1] === null) {
					if (msg.deleteLocalName) {
						errorInfos.push(await this.dataSource.unsetConfigValue(msg.repo, GitConfigKey.UserName, GitConfigLocation.Local));
					}
					if (msg.deleteLocalEmail) {
						errorInfos.push(await this.dataSource.unsetConfigValue(msg.repo, GitConfigKey.UserEmail, GitConfigLocation.Local));
					}
				}
				this.sendMessage({
					command: 'editUserDetails',
					errors: errorInfos
				});
				break;
			case 'endCodeReview':
				this.store.endCodeReview(msg.repo, msg.id);
				break;
			case 'exportRepoConfig':
				this.sendMessage({
					command: 'exportRepoConfig',
					error: await this.repoManager.exportRepoConfig(msg.repo)
				});
				break;
			case 'fetch':
				this.sendMessage({
					command: 'fetch',
					error: await this.dataSource.fetch(msg.repo, msg.name, msg.prune, msg.pruneTags)
				});
				break;
			case 'fetchAvatar':
				this.avatarManager.fetchAvatarImage(msg.email, msg.repo, msg.remote, msg.commits);
				break;
			case 'fetchIntoLocalBranch':
				this.sendMessage({
					command: 'fetchIntoLocalBranch',
					error: await this.dataSource.fetchIntoLocalBranch(msg.repo, msg.remote, msg.remoteBranch, msg.localBranch, msg.force)
				});
				break;
			case 'loadCommits':
				this.loadCommitsRefreshId = msg.refreshId;
				this.sendMessage({
					command: 'loadCommits',
					refreshId: msg.refreshId,
					onlyFollowFirstParent: msg.onlyFollowFirstParent,
					...await this.dataSource.getCommits(msg.repo, msg.branches, msg.maxCommits, msg.showTags, msg.showRemoteBranches, msg.includeCommitsMentionedByReflogs, msg.onlyFollowFirstParent, msg.commitOrdering, msg.remotes, msg.hideRemotes, msg.stashes)
				});
				break;
			case 'loadConfig':
				this.sendMessage({
					command: 'loadConfig',
					repo: msg.repo,
					...await this.dataSource.getConfig(msg.repo, msg.remotes)
				});
				break;
			case 'loadRepoInfo':
				this.loadRepoInfoRefreshId = msg.refreshId;
				let repoInfo = await this.dataSource.getRepoInfo(msg.repo, msg.showRemoteBranches, msg.showStashes, msg.hideRemotes), isRepo = true;
				if (repoInfo.error) {
					isRepo = (await this.dataSource.repoRoot(msg.repo)) !== null;
					if (!isRepo) repoInfo.error = null;
				}
				this.sendMessage({
					command: 'loadRepoInfo',
					refreshId: msg.refreshId,
					...repoInfo,
					isRepo: isRepo
				});
				if (msg.repo !== this.currentRepo) {
					this.currentRepo = msg.repo;
					this.store.setLastActiveRepo(msg.repo);
					this.repoFileWatcher.start(msg.repo);
				}
				break;
			case 'loadRepos':
				if (!msg.check || !await this.repoManager.checkReposExist()) {
					this.sendMessage({
						command: 'loadRepos',
						repos: this.repoManager.getRepos(),
						lastActiveRepo: this.store.getLastActiveRepo(),
						loadViewTo: null
					});
				}
				break;
			case 'merge':
				this.sendMessage({
					command: 'merge',
					actionOn: msg.actionOn,
					error: await this.dataSource.merge(msg.repo, msg.obj, msg.actionOn, msg.createNewCommit, msg.squash, msg.noCommit)
				});
				break;
			case 'openExtensionSettings':
				this.sendMessage({
					command: 'openExtensionSettings',
					error: await openExtensionSettings()
				});
				break;
			case 'openExternalDirDiff':
				this.sendMessage({
					command: 'openExternalDirDiff',
					error: await this.dataSource.openExternalDirDiff(msg.repo, msg.fromHash, msg.toHash, msg.isGui)
				});
				break;
			case 'openExternalUrl':
				this.sendMessage({
					command: 'openExternalUrl',
					error: await openExternalUrl(msg.url)
				});
				break;
			case 'openFile':
				this.sendMessage({
					command: 'openFile',
					error: await openFile(msg.repo, msg.filePath, msg.hash, this.dataSource)
				});
				break;
			case 'openTerminal':
				this.sendMessage({
					command: 'openTerminal',
					error: await this.dataSource.openGitTerminal(msg.repo, null, msg.name)
				});
				break;
			case 'popStash':
				this.sendMessage({
					command: 'popStash',
					error: await this.dataSource.popStash(msg.repo, msg.selector, msg.reinstateIndex)
				});
				break;
			case 'pruneRemote':
				this.sendMessage({
					command: 'pruneRemote',
					error: await this.dataSource.pruneRemote(msg.repo, msg.name)
				});
				break;
			case 'pullBranch':
				this.sendMessage({
					command: 'pullBranch',
					error: await this.dataSource.pullBranch(msg.repo, msg.branchName, msg.remote, msg.createNewCommit, msg.squash)
				});
				break;
			case 'pushBranch':
				this.sendMessage({
					command: 'pushBranch',
					willUpdateBranchConfig: msg.willUpdateBranchConfig,
					errors: await this.dataSource.pushBranchToMultipleRemotes(msg.repo, msg.branchName, msg.remotes, msg.setUpstream, msg.mode)
				});
				break;
			case 'pushStash':
				this.sendMessage({
					command: 'pushStash',
					error: await this.dataSource.pushStash(msg.repo, msg.message, msg.includeUntracked)
				});
				break;
			case 'pushTag':
				this.sendMessage({
					command: 'pushTag',
					repo: msg.repo,
					tagName: msg.tagName,
					remotes: msg.remotes,
					commitHash: msg.commitHash,
					errors: await this.dataSource.pushTag(msg.repo, msg.tagName, msg.remotes, msg.commitHash, msg.skipRemoteCheck)
				});
				break;
			case 'rebase':
				this.sendMessage({
					command: 'rebase',
					actionOn: msg.actionOn,
					interactive: msg.interactive,
					error: await this.dataSource.rebase(msg.repo, msg.obj, msg.actionOn, msg.ignoreDate, msg.interactive)
				});
				break;
			case 'renameBranch':
				this.sendMessage({
					command: 'renameBranch',
					error: await this.dataSource.renameBranch(msg.repo, msg.oldName, msg.newName)
				});
				break;
			case 'rescanForRepos':
				if (!(await this.repoManager.searchWorkspaceForRepos())) {
					showErrorMessage('No Git repositories were found in the known root folders.');
				}
				break;
			case 'resetFileToRevision':
				this.sendMessage({
					command: 'resetFileToRevision',
					error: await this.dataSource.resetFileToRevision(msg.repo, msg.commitHash, msg.filePath)
				});
				break;
			case 'resetToCommit':
				this.sendMessage({
					command: 'resetToCommit',
					error: await this.dataSource.resetToCommit(msg.repo, msg.commit, msg.resetMode)
				});
				break;
			case 'revertCommit':
				this.sendMessage({
					command: 'revertCommit',
					error: await this.dataSource.revertCommit(msg.repo, msg.commitHash, msg.parentIndex)
				});
				break;
			case 'setGlobalViewState':
				this.sendMessage({
					command: 'setGlobalViewState',
					error: await this.store.setGlobalViewState(msg.state)
				});
				break;
			case 'setRepoState':
				this.repoManager.setRepoState(msg.repo, msg.state);
				break;
			case 'setWorkspaceViewState':
				this.sendMessage({
					command: 'setWorkspaceViewState',
					error: await this.store.setWorkspaceViewState(msg.state)
				});
				break;
			case 'showErrorMessage':
				showErrorMessage(msg.message);
				break;
			case 'startCodeReview':
				this.sendMessage({
					command: 'startCodeReview',
					commitHash: msg.commitHash,
					compareWithHash: msg.compareWithHash,
					...await this.store.startCodeReview(msg.repo, msg.id, msg.files, msg.lastViewedFile)
				});
				break;
			case 'tagDetails':
				this.sendMessage({
					command: 'tagDetails',
					tagName: msg.tagName,
					commitHash: msg.commitHash,
					...await this.dataSource.getTagDetails(msg.repo, msg.tagName)
				});
				break;
			case 'updateCodeReview':
				this.sendMessage({
					command: 'updateCodeReview',
					error: await this.store.updateCodeReview(msg.repo, msg.id, msg.remainingFiles, msg.lastViewedFile)
				});
				break;
			case 'viewDiff':
				this.sendMessage({
					command: 'viewDiff',
					error: await viewDiff(msg.repo, msg.fromHash, msg.toHash, msg.oldFilePath, msg.newFilePath, msg.type, this.dataSource)
				});
				break;
			case 'viewDiffWithWorkingFile':
				this.sendMessage({
					command: 'viewDiffWithWorkingFile',
					error: await viewDiffWithWorkingFile(msg.repo, msg.hash, msg.filePath, this.dataSource)
				});
				break;
			case 'viewFileAtRevision':
				this.sendMessage({
					command: 'viewFileAtRevision',
					error: await viewFileAtRevision(msg.repo, msg.hash, msg.filePath, this.dataSource)
				});
				break;
			case 'viewScm':
				this.sendMessage({
					command: 'viewScm',
					error: await viewScm()
				});
				break;
		}

		this.repoFileWatcher.unmute();
	}

	private sendMessage(msg: ResponseMessage) {
		this.win.webContents.send('git-graph-message', msg);
	}
}
