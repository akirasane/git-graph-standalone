import * as chokidar from 'chokidar';
import { getPathFromStr } from './utils';

const FILE_CHANGE_REGEX = /(^\.git\/(config|index|HEAD|refs\/stash|refs\/heads\/.*|refs\/remotes\/.*|refs\/tags\/.*)$)|(^(?!\.git).*$)|(^\.git[^\/]+$)/;

/**
 * Watches the active repository with `chokidar`.
 */
export class RepoFileWatcher {
	private readonly repoChangeCallback: () => void;
	private repo: string | null = null;
	private watcher: chokidar.FSWatcher | null = null;
	private refreshTimeout: NodeJS.Timeout | null = null;
	// Nested mute counts: `write` (an action that changes the repository - its caller refreshes
	// the view itself) suppresses every event; `read` (a query such as `git status`, which may
	// rewrite .git/index to refresh stat info) only suppresses .git/index events, so external
	// edits made while the UI is polling are no longer lost.
	private writeMutes: number = 0;
	private readMutes: number = 0;
	private resumeAt: number = 0;
	private indexResumeAt: number = 0;

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
		this.watcher = chokidar.watch(repo, {
			ignoreInitial: true, disableGlobbing: true,
			// Without this, chokidar recursively watches every file in the repo up front,
			// including node_modules and .git's internal object/log storage - on a repo with
			// large dependency trees this made the initial watch setup (and everything queued
			// behind it) stall for several seconds on startup. None of these paths can ever
			// match FILE_CHANGE_REGEX above anyway, so excluding them changes no behaviour.
			ignored: ['**/node_modules/**', '**/.git/objects/**', '**/.git/logs/**', '**/.git/lfs/**']
		});
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

	public mute(readOnly: boolean = false) {
		if (readOnly) this.readMutes++; else this.writeMutes++;
	}

	public unmute(readOnly: boolean = false) {
		const resumeAt = (new Date()).getTime() + 1500;
		if (readOnly) {
			this.readMutes = Math.max(0, this.readMutes - 1);
			this.indexResumeAt = Math.max(this.indexResumeAt, resumeAt);
		} else {
			this.writeMutes = Math.max(0, this.writeMutes - 1);
			this.resumeAt = Math.max(this.resumeAt, resumeAt);
		}
	}

	private refresh(path: string) {
		if (this.writeMutes > 0) return;
		const relPath = getPathFromStr(path).replace(this.repo + '/', '');
		if (!relPath.match(FILE_CHANGE_REGEX)) return;
		const now = (new Date()).getTime();
		if (now < this.resumeAt) return;
		if (relPath === '.git/index' && (this.readMutes > 0 || now < this.indexResumeAt)) return;

		if (this.refreshTimeout !== null) {
			clearTimeout(this.refreshTimeout);
		}
		this.refreshTimeout = setTimeout(() => {
			this.refreshTimeout = null;
			this.repoChangeCallback();
		}, 750);
	}
}
