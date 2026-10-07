import { ConfigStore, getConfigStore } from './configStore';
import {
	CommitDetailsViewConfig,
	CommitDetailsViewLocation,
	CommitOrdering,
	ContextMenuActionsVisibility,
	CustomBranchGlobPattern,
	CustomEmojiShortcodeMapping,
	CustomPullRequestProvider,
	DateFormat,
	DateFormatType,
	DateType,
	DefaultColumnVisibility,
	DialogDefaults,
	FileViewType,
	GitResetMode,
	GraphConfig,
	GraphStyle,
	GraphUncommittedChangesStyle,
	KeybindingConfig,
	MuteCommitsConfig,
	OnRepoLoadConfig,
	RefLabelAlignment,
	ReferenceLabelsConfig,
	RepoDropdownOrder,
	SquashMessageFormat,
	TabIconColourTheme,
	TagType
} from './types';

/**
 * Typed getters over the JSON ConfigStore (config.json in the app data folder).
 *  * history to migrate in a standalone app, so each getter just reads its current section name.
 */
export class Config {
	private readonly config: ConfigStore;

	private static readonly KEYBINDING_REGEXP = /^CTRL\/CMD \+ [A-Z]$/;

	constructor(config: ConfigStore) {
		this.config = config;
	}

	get commitDetailsView(): CommitDetailsViewConfig {
		return {
			autoCenter: !!this.config.get('commitDetailsView.autoCenter', true),
			fileTreeCompactFolders: !!this.config.get('commitDetailsView.fileView.fileTree.compactFolders', true),
			fileViewType: this.config.get<string>('commitDetailsView.fileView.type', 'File Tree') === 'File List'
				? FileViewType.List
				: FileViewType.Tree,
			location: this.config.get<string>('commitDetailsView.location', 'Docked to Bottom') === 'Docked to Bottom'
				? CommitDetailsViewLocation.DockedToBottom
				: CommitDetailsViewLocation.Inline
		};
	}

	get contextMenuActionsVisibility(): ContextMenuActionsVisibility {
		const userConfig = this.config.get('contextMenuActionsVisibility', {});
		const config: ContextMenuActionsVisibility = {
			branch: { checkout: true, rename: true, delete: true, merge: true, rebase: true, push: true, viewIssue: true, createPullRequest: true, createArchive: true, selectInBranchesDropdown: true, unselectInBranchesDropdown: true, copyName: true },
			commit: { addTag: true, createBranch: true, checkout: true, cherrypick: true, revert: true, drop: true, merge: true, rebase: true, reset: true, copyHash: true, copySubject: true },
			commitDetailsViewFile: { viewDiff: true, viewFileAtThisRevision: true, viewDiffWithWorkingFile: true, openFile: true, markAsReviewed: true, markAsNotReviewed: true, resetFileToThisRevision: true, copyAbsoluteFilePath: true, copyRelativeFilePath: true },
			remoteBranch: { checkout: true, delete: true, fetch: true, merge: true, pull: true, viewIssue: true, createPullRequest: true, createArchive: true, selectInBranchesDropdown: true, unselectInBranchesDropdown: true, copyName: true },
			stash: { apply: true, createBranch: true, pop: true, drop: true, copyName: true, copyHash: true },
			tag: { viewDetails: true, delete: true, push: true, createArchive: true, copyName: true },
			uncommittedChanges: { stash: true, reset: true, clean: true, openSourceControlView: true }
		};
		mergeConfigObjects(config, userConfig);
		return config;
	}

	get customBranchGlobPatterns(): CustomBranchGlobPattern[] {
		let inPatterns = this.config.get('customBranchGlobPatterns', <any[]>[]);
		let outPatterns: CustomBranchGlobPattern[] = [];
		for (let i = 0; i < inPatterns.length; i++) {
			if (typeof inPatterns[i].name === 'string' && typeof inPatterns[i].glob === 'string') {
				outPatterns.push({ name: inPatterns[i].name, glob: '--glob=' + inPatterns[i].glob });
			}
		}
		return outPatterns;
	}

	get customEmojiShortcodeMappings(): CustomEmojiShortcodeMapping[] {
		let inMappings = this.config.get('customEmojiShortcodeMappings', <any[]>[]);
		let outMappings: CustomEmojiShortcodeMapping[] = [];
		for (let i = 0; i < inMappings.length; i++) {
			if (typeof inMappings[i].shortcode === 'string' && typeof inMappings[i].emoji === 'string') {
				outMappings.push({ shortcode: inMappings[i].shortcode, emoji: inMappings[i].emoji });
			}
		}
		return outMappings;
	}

	get customPullRequestProviders(): CustomPullRequestProvider[] {
		let providers = this.config.get('customPullRequestProviders', <any[]>[]);
		return Array.isArray(providers)
			? providers
				.filter((provider) => typeof provider.name === 'string' && typeof provider.templateUrl === 'string')
				.map((provider) => ({ name: provider.name, templateUrl: provider.templateUrl }))
			: [];
	}

	get dateFormat(): DateFormat {
		let configValue = this.config.get<string>('date.format', 'Date & Time'), type = DateFormatType.DateAndTime, iso = false;
		if (configValue === 'Relative') {
			type = DateFormatType.Relative;
		} else {
			if (configValue.endsWith('Date Only')) type = DateFormatType.DateOnly;
			if (configValue.startsWith('ISO')) iso = true;
		}
		return { type: type, iso: iso };
	}

	get dateType() {
		return this.config.get<string>('date.type', 'Author Date') === 'Commit Date'
			? DateType.Commit
			: DateType.Author;
	}

	get defaultColumnVisibility(): DefaultColumnVisibility {
		let obj: any = this.config.get('defaultColumnVisibility', {});
		if (typeof obj === 'object' && obj !== null && typeof obj['Date'] === 'boolean' && typeof obj['Author'] === 'boolean' && typeof obj['Commit'] === 'boolean') {
			return { author: obj['Author'], commit: obj['Commit'], date: obj['Date'] };
		} else {
			return { author: true, commit: true, date: true };
		}
	}

	get dialogDefaults(): DialogDefaults {
		let resetCommitMode = this.config.get<string>('dialog.resetCurrentBranchToCommit.mode', 'Mixed');
		let resetUncommittedMode = this.config.get<string>('dialog.resetUncommittedChanges.mode', 'Mixed');
		let refInputSpaceSubstitution = this.config.get<string>('dialog.general.referenceInputSpaceSubstitution', 'None');

		return {
			addTag: {
				pushToRemote: !!this.config.get('dialog.addTag.pushToRemote', false),
				type: this.config.get<string>('dialog.addTag.type', 'Annotated') === 'Lightweight' ? TagType.Lightweight : TagType.Annotated
			},
			applyStash: {
				reinstateIndex: !!this.config.get('dialog.applyStash.reinstateIndex', false)
			},
			cherryPick: {
				noCommit: !!this.config.get('dialog.cherryPick.noCommit', false),
				recordOrigin: !!this.config.get('dialog.cherryPick.recordOrigin', false)
			},
			createBranch: {
				checkout: !!this.config.get('dialog.createBranch.checkOut', false)
			},
			deleteBranch: {
				forceDelete: !!this.config.get('dialog.deleteBranch.forceDelete', false)
			},
			fetchIntoLocalBranch: {
				forceFetch: !!this.config.get('dialog.fetchIntoLocalBranch.forceFetch', false)
			},
			fetchRemote: {
				prune: !!this.config.get('dialog.fetchRemote.prune', false),
				pruneTags: !!this.config.get('dialog.fetchRemote.pruneTags', false)
			},
			general: {
				referenceInputSpaceSubstitution: refInputSpaceSubstitution === 'Hyphen' ? '-' : refInputSpaceSubstitution === 'Underscore' ? '_' : null
			},
			merge: {
				noCommit: !!this.config.get('dialog.merge.noCommit', false),
				noFastForward: !!this.config.get('dialog.merge.noFastForward', true),
				squash: !!this.config.get('dialog.merge.squashCommits', false)
			},
			popStash: {
				reinstateIndex: !!this.config.get('dialog.popStash.reinstateIndex', false)
			},
			pullBranch: {
				noFastForward: !!this.config.get('dialog.pullBranch.noFastForward', false),
				squash: !!this.config.get('dialog.pullBranch.squashCommits', false)
			},
			rebase: {
				ignoreDate: !!this.config.get('dialog.rebase.ignoreDate', true),
				interactive: !!this.config.get('dialog.rebase.launchInteractiveRebase', false)
			},
			resetCommit: {
				mode: resetCommitMode === 'Soft' ? GitResetMode.Soft : (resetCommitMode === 'Hard' ? GitResetMode.Hard : GitResetMode.Mixed)
			},
			resetUncommitted: {
				mode: resetUncommittedMode === 'Hard' ? GitResetMode.Hard : GitResetMode.Mixed
			},
			stashUncommittedChanges: {
				includeUntracked: !!this.config.get('dialog.stashUncommittedChanges.includeUntracked', true)
			}
		};
	}

	get squashMergeMessageFormat() {
		return this.config.get<string>('dialog.merge.squashMessageFormat', 'Default') === 'Git SQUASH_MSG'
			? SquashMessageFormat.GitSquashMsg
			: SquashMessageFormat.Default;
	}

	get squashPullMessageFormat() {
		return this.config.get<string>('dialog.pullBranch.squashMessageFormat', 'Default') === 'Git SQUASH_MSG'
			? SquashMessageFormat.GitSquashMsg
			: SquashMessageFormat.Default;
	}

	get enhancedAccessibility() {
		return !!this.config.get('enhancedAccessibility', false);
	}

	get fileEncoding() {
		return this.config.get<string>('fileEncoding', 'utf8');
	}

	get graph(): GraphConfig {
		const colours = this.config.get<string[]>('graph.colours', []);
		return {
			colours: Array.isArray(colours) && colours.length > 0
				? colours.filter((v) => v.match(/^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb[a]?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/) !== null)
				: ['#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000', '#00d9cc', '#e138e8', '#85d900', '#dc5b23', '#6f24d6', '#ffcc00'],
			style: this.config.get<string>('graph.style', 'rounded') === 'angular'
				? GraphStyle.Angular
				: GraphStyle.Rounded,
			grid: { x: 16, y: 24, offsetX: 16, offsetY: 12, expandY: 250 },
			uncommittedChanges: this.config.get<string>('graph.uncommittedChanges', 'Open Circle at the Uncommitted Changes') === 'Open Circle at the Checked Out Commit'
				? GraphUncommittedChangesStyle.OpenCircleAtTheCheckedOutCommit
				: GraphUncommittedChangesStyle.OpenCircleAtTheUncommittedChanges
		};
	}

	get integratedTerminalShell() {
		return this.config.get('integratedTerminalShell', '');
	}

	get keybindings(): KeybindingConfig {
		return {
			find: this.getKeybinding('keyboardShortcut.find', 'f'),
			refresh: this.getKeybinding('keyboardShortcut.refresh', 'r'),
			scrollToHead: this.getKeybinding('keyboardShortcut.scrollToHead', 'h'),
			scrollToStash: this.getKeybinding('keyboardShortcut.scrollToStash', 's')
		};
	}

	/** Optional path to the Claude Code CLI (auto-detected when empty); used to generate commit messages. */
	get claudeCliPath(): string {
		return this.config.get('claudeCli.path', '');
	}

	/** Model alias/name passed to the Claude Code CLI for commit message generation. */
	get claudeCliModel(): string {
		return this.config.get('claudeCli.model', 'haiku');
	}

	get maxDepthOfRepoSearch() {
		return this.config.get('maxDepthOfRepoSearch', 0);
	}

	get markdown() {
		return !!this.config.get('markdown', true);
	}

	/** Editor-group placement hint for opened diffs (raw string, currently informational). */
	get openNewTabEditorGroup(): string {
		return this.config.get<string>('openNewTabEditorGroup', 'Active');
	}

	get openToTheRepoOfTheActiveTextEditorDocument() {
		return !!this.config.get('openToTheRepoOfTheActiveTextEditorDocument', false);
	}

	get referenceLabels(): ReferenceLabelsConfig {
		const alignmentConfigValue = this.config.get<string>('referenceLabels.alignment', 'Normal');
		const alignment = alignmentConfigValue === 'Branches (on the left) & Tags (on the right)'
			? RefLabelAlignment.BranchesOnLeftAndTagsOnRight
			: alignmentConfigValue === 'Branches (aligned to the graph) & Tags (on the right)'
				? RefLabelAlignment.BranchesAlignedToGraphAndTagsOnRight
				: RefLabelAlignment.Normal;
		return {
			branchLabelsAlignedToGraph: alignment === RefLabelAlignment.BranchesAlignedToGraphAndTagsOnRight,
			combineLocalAndRemoteBranchLabels: !!this.config.get('referenceLabels.combineLocalAndRemoteBranchLabels', true),
			tagLabelsOnRight: alignment !== RefLabelAlignment.Normal
		};
	}

	get fetchAvatars() {
		return !!this.config.get('repository.commits.fetchAvatars', false);
	}

	get initialLoadCommits() {
		return this.config.get('repository.commits.initialLoad', 300);
	}

	get loadMoreCommits() {
		return this.config.get('repository.commits.loadMore', 100);
	}

	get loadMoreCommitsAutomatically() {
		return !!this.config.get('repository.commits.loadMoreAutomatically', true);
	}

	get muteCommits(): MuteCommitsConfig {
		return {
			commitsNotAncestorsOfHead: !!this.config.get('repository.commits.mute.commitsThatAreNotAncestorsOfHead', false),
			mergeCommits: !!this.config.get('repository.commits.mute.mergeCommits', true)
		};
	}

	get commitOrder() {
		const ordering = this.config.get<string>('repository.commits.order', 'date');
		return ordering === 'author-date'
			? CommitOrdering.AuthorDate
			: ordering === 'topo'
				? CommitOrdering.Topological
				: CommitOrdering.Date;
	}

	get showSignatureStatus() {
		return !!this.config.get('repository.commits.showSignatureStatus', false);
	}

	get fetchAndPrune() {
		return !!this.config.get('repository.fetchAndPrune', false);
	}

	get fetchAndPruneTags() {
		return !!this.config.get('repository.fetchAndPruneTags', false);
	}

	get includeCommitsMentionedByReflogs() {
		return !!this.config.get('repository.includeCommitsMentionedByReflogs', false);
	}

	get onRepoLoad(): OnRepoLoadConfig {
		const branches = this.config.get('repository.onLoad.showSpecificBranches', []);
		return {
			scrollToHead: !!this.config.get('repository.onLoad.scrollToHead', false),
			showCheckedOutBranch: !!this.config.get('repository.onLoad.showCheckedOutBranch', false),
			showSpecificBranches: Array.isArray(branches)
				? branches.filter((branch) => typeof branch === 'string')
				: []
		};
	}

	get onlyFollowFirstParent() {
		return !!this.config.get('repository.onlyFollowFirstParent', false);
	}

	get showCommitsOnlyReferencedByTags() {
		return !!this.config.get('repository.showCommitsOnlyReferencedByTags', true);
	}

	get showRemoteBranches() {
		return !!this.config.get('repository.showRemoteBranches', true);
	}

	get showRemoteHeads() {
		return !!this.config.get('repository.showRemoteHeads', true);
	}

	get showStashes() {
		return !!this.config.get('repository.showStashes', true);
	}

	get showTags() {
		return !!this.config.get('repository.showTags', true);
	}

	get showUncommittedChanges() {
		return !!this.config.get('repository.showUncommittedChanges', true);
	}

	get showUntrackedFiles() {
		return !!this.config.get('repository.showUntrackedFiles', true);
	}

	get signCommits() {
		return !!this.config.get('repository.sign.commits', false);
	}

	get signTags() {
		return !!this.config.get('repository.sign.tags', false);
	}

	get useMailmap() {
		return !!this.config.get('repository.useMailmap', false);
	}

	get repoDropdownOrder(): RepoDropdownOrder {
		const order = this.config.get<string>('repositoryDropdownOrder', 'Workspace Full Path');
		return order === 'Full Path'
			? RepoDropdownOrder.FullPath
			: order === 'Name'
				? RepoDropdownOrder.Name
				: RepoDropdownOrder.WorkspaceFullPath;
	}

	get showStatusBarItem() {
		return !!this.config.get('showStatusBarItem', true);
	}

	get tabIconColourTheme() {
		return this.config.get<string>('tabIconColourTheme', 'colour') === 'grey'
			? TabIconColourTheme.Grey
			: TabIconColourTheme.Colour;
	}

	/** Optional pinned Git executable path(s), for when auto-detection finds the wrong Git. */
	get gitPaths(): string[] {
		const configValue = this.config.get<string | string[] | null>('git.path', null);
		if (configValue === null) {
			return [];
		} else if (typeof configValue === 'string') {
			return [configValue];
		} else if (Array.isArray(configValue)) {
			return configValue.filter((value) => typeof value === 'string');
		} else {
			return [];
		}
	}

	private getKeybinding(section: string, defaultValue: string) {
		const configValue = this.config.get<string | null>(section, null);
		if (typeof configValue === 'string') {
			if (configValue === 'UNASSIGNED') {
				return null;
			} else if (Config.KEYBINDING_REGEXP.test(configValue)) {
				return configValue.substring(11).toLowerCase();
			}
		}
		return defaultValue;
	}
}

/**
 * Recursively apply the values in a user specified object to an object containing default values.
 */
function mergeConfigObjects(base: { [key: string]: any }, user: { [key: string]: any }) {
	if (typeof base !== typeof user) return;

	let keys = Object.keys(base);
	for (let i = 0; i < keys.length; i++) {
		if (typeof base[keys[i]] === 'object') {
			if (typeof user[keys[i]] === 'object') {
				mergeConfigObjects(base[keys[i]], user[keys[i]]);
			}
		} else if (typeof user[keys[i]] === typeof base[keys[i]]) {
			base[keys[i]] = user[keys[i]];
		}
	}
}

/**
 * Get a Config instance for retrieving the user's configuration.
 * Matches the original `getConfig(repo?: string)` call shape used throughout the ported
 * dataSource.ts/repoManager.ts, but `repo` is unused: there's no per-workspace-folder scoped
 * configuration in a standalone app (per-repo overrides are handled separately by
 * repoManager.ts's External Repo Config File mechanism). Always reads from the singleton
 * ConfigStore, which main.ts must initialise first via `getConfigStore(path)`.
 */
export function getConfig(_repo?: string) {
	return new Config(getConfigStore());
}

/**
 * Get a Config instance backed by an explicit ConfigStore (used once at startup).
 */
export function createConfig(store: ConfigStore) {
	return new Config(store);
}
