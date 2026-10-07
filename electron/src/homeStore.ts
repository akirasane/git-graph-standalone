import * as fs from 'fs';
import * as path from 'path';

interface HomeData {
	pinned: string[];
	lastOpened: { [repo: string]: number };
	lastCloneDir: string | null;
	lastNewRepoDir: string | null;
}

/**
 * Small persistent store for the repository hub: pinned repositories, when each repository was
 * last opened, and the folders last used for clone / new repository.
 */
export class HomeStore {
	private readonly filePath: string;
	private data: HomeData;

	constructor(userDataPath: string) {
		this.filePath = path.join(userDataPath, 'home.json');
		this.data = { pinned: [], lastOpened: {}, lastCloneDir: null, lastNewRepoDir: null };
		try {
			const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
			if (parsed && typeof parsed === 'object') {
				this.data = Object.assign(this.data, parsed);
			}
		} catch (_) { /* first run */ }
	}

	private save() {
		try {
			fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
		} catch (_) { /* non-fatal */ }
	}

	public isPinned(repo: string) { return this.data.pinned.includes(repo); }

	public togglePin(repo: string): boolean {
		const i = this.data.pinned.indexOf(repo);
		if (i === -1) this.data.pinned.push(repo); else this.data.pinned.splice(i, 1);
		this.save();
		return i === -1;
	}

	public getLastOpened(repo: string) { return this.data.lastOpened[repo] || 0; }

	public touch(repo: string) {
		this.data.lastOpened[repo] = Date.now();
		this.save();
	}

	public forget(repo: string) {
		delete this.data.lastOpened[repo];
		const i = this.data.pinned.indexOf(repo);
		if (i !== -1) this.data.pinned.splice(i, 1);
		this.save();
	}

	public get lastCloneDir() { return this.data.lastCloneDir; }
	public set lastCloneDir(dir: string | null) { this.data.lastCloneDir = dir; this.save(); }
	public get lastNewRepoDir() { return this.data.lastNewRepoDir; }
	public set lastNewRepoDir(dir: string | null) { this.data.lastNewRepoDir = dir; this.save(); }
}
