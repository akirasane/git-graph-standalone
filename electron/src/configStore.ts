import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads & saves the standalone app's JSON configuration file, replacing
 * VSCode's `vscode.workspace.getConfiguration('git-graph')` in the ported Config class.
 * Keys are addressed with dot-paths (e.g. "commitDetailsView.autoCenter"),
 * mirroring the section names used by the original VSCode Extension Settings.
 */
export class ConfigStore {
	private readonly filePath: string;
	private data: { [key: string]: any };

	constructor(filePath: string) {
		this.filePath = filePath;
		this.data = this.load();
	}

	private load(): { [key: string]: any } {
		try {
			return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
		} catch (_) {
			return {};
		}
	}

	/**
	 * Reload the configuration from disk, discarding any in-memory changes.
	 * Call this after the file is edited externally (e.g. by a settings UI or file watcher).
	 */
	public reload() {
		this.data = this.load();
	}

	/**
	 * Get the value located by a dot-path (e.g. "dialog.addTag.type"), falling back to defaultValue.
	 */
	public get<T>(section: string, defaultValue: T): T {
		const parts = section.split('.');
		let cur: any = this.data;
		for (let i = 0; i < parts.length; i++) {
			if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) return defaultValue;
			cur = cur[parts[i]];
		}
		return typeof cur === 'undefined' ? defaultValue : cur;
	}

	/**
	 * Set the value located by a dot-path, creating intermediate objects as needed, and persist to disk.
	 */
	public set(section: string, value: any): void {
		const parts = section.split('.');
		let cur: any = this.data;
		for (let i = 0; i < parts.length - 1; i++) {
			if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
			cur = cur[parts[i]];
		}
		cur[parts[parts.length - 1]] = value;
		this.save();
	}

	private save() {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, '\t'));
	}
}

let instance: ConfigStore | null = null;

/**
 * Get the singleton ConfigStore, creating it (and its backing file) on first use.
 */
export function getConfigStore(filePath?: string): ConfigStore {
	if (instance === null) {
		if (typeof filePath === 'undefined') throw new Error('ConfigStore must be initialised with a file path before first use.');
		instance = new ConfigStore(filePath);
	}
	return instance;
}
