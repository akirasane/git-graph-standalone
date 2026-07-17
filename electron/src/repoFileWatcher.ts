import * as chokidar from 'chokidar';
import { getPathFromStr } from './utils';

const FILE_CHANGE_REGEX = /(^\.git\/(config|index|HEAD|refs\/stash|refs\/heads\/.*|refs\/remotes\/.*|refs\/tags\/.*)$)|(^(?!\.git).*$)|(^\.git[^\/]+$)/;

/**
 * Ported from src/repoFileWatcher.ts. `vscode.workspace.createFileSystemWatcher` is replaced
 * by `chokidar`, which (unlike VSCode's watcher) emits plain path strings directly instead of
 * `vscode.Uri` objects, and needs no `getPathFromUri` conversion step.
 */
export class RepoFileWatcher {
	private readonly repoChangeCallback: () => void;
	private repo: string | null = null;
	private watcher: chokidar.FSWatcher | null = null;
	private refreshTimeout: NodeJS.Timeout | null = null;
	private muted: boolean = false;
	private resumeAt: number = 0;

	constructor(repoChangeCallback: () => void) {
		this.repoChangeCallback = repoChangeCallback;
	}

	/**
	 * Start watching a repository for file events.
	 */
	public start(repo: string) {
		if (this.watcher !== null) {
			this.stop();
		}

		this.repo = repo;
		this.watcher = chokidar.watch(repo, { ignoreInitial: true, disableGlobbing: true });
		this.watcher.on('add', (path) => this.refresh(path));
		this.watcher.on('change', (path) => this.refresh(path));
		this.watcher.on('unlink', (path) => this.refresh(path));
		this.watcher.on('addDir', (path) => this.refresh(path));
		this.watcher.on('unlinkDir', (path) => this.refresh(path));
		console.log('Started watching repo: ' + repo);
	}

	/**
	 * Stop watching the repository for file events.
	 */
	public stop() {
		if (this.watcher !== null) {
			this.watcher.close();
			this.watcher = null;
			console.log('Stopped watching repo: ' + this.repo);
		}
		if (this.refreshTimeout !== null) {
			clearTimeout(this.refreshTimeout);
			this.refreshTimeout = null;
		}
	}

	public mute() {
		this.muted = true;
	}

	public unmute() {
		this.muted = false;
		this.resumeAt = (new Date()).getTime() + 1500;
	}

	private refresh(path: string) {
		if (this.muted) return;
		if (!getPathFromStr(path).replace(this.repo + '/', '').match(FILE_CHANGE_REGEX)) return;
		if ((new Date()).getTime() < this.resumeAt) return;

		if (this.refreshTimeout !== null) {
			clearTimeout(this.refreshTimeout);
		}
		this.refreshTimeout = setTimeout(() => {
			this.refreshTimeout = null;
			this.repoChangeCallback();
		}, 750);
	}
}
