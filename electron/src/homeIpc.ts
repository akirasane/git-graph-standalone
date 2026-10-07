import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from './dataSource';
import { HomeStore } from './homeStore';
import { RepoManager } from './repoManager';
import { getRepoName } from './utils';

type Result<T = {}> = ({ ok: true } & T) | { ok: false, error: string };

const toPosix = (p: string) => p.replace(/\\/g, '/');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', 'vendor', '$RECYCLE.BIN', 'System Volume Information']);

/**
 * IPC endpoints for the repository hub (home.html): list / summarise / open / add / clone / init /
 * scan / remove / pin / reveal. `openRepo` is supplied by main.ts, which owns window navigation.
 */
export function registerHomeIpc(
	win: BrowserWindow,
	dataSource: DataSource,
	repoManager: RepoManager,
	homeStore: HomeStore,
	hasGit: () => boolean,
	openRepo: (repo: string) => void
) {
	/** Re-registering is safe (e.g. macOS re-activation) - replaces any earlier handler. */
	const handle: typeof ipcMain.handle = (channel, listener) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, listener); };

	const noGit = (): { ok: false, error: string } => ({ ok: false, error: 'Git was not found on this computer. Install Git and restart the app.' });

	/** Register a repository root found at `folder`. */
	async function register(folder: string): Promise<Result<{ path: string, already: boolean }>> {
		const status = await repoManager.registerRepo(toPosix(folder), false);
		if (status.error === null && status.root !== null) return { ok: true, path: status.root, already: false };
		if (repoManager.isKnownRepo(toPosix(folder))) return { ok: true, path: toPosix(folder), already: true };
		return { ok: false, error: status.error || 'Not a Git repository.' };
	}

	/** Find repositories below `root` (depth-limited; does not descend into repositories). */
	async function findRepos(root: string, maxDepth: number, found: string[], budget: { n: number }) {
		if (budget.n-- <= 0) return;
		let entries: fs.Dirent[];
		try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch (_) { return; }
		if (entries.some((e) => e.name === '.git')) {
			found.push(root);
			return;
		}
		if (maxDepth <= 0) return;
		for (const e of entries) {
			if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) {
				await findRepos(path.join(root, e.name), maxDepth - 1, found, budget);
			}
		}
	}

	handle('home:list', () => {
		const repos = repoManager.getRepos();
		return Object.keys(repos).map((p) => ({
			path: p,
			name: repos[p].name || getRepoName(p),
			pinned: homeStore.isPinned(p),
			lastOpened: homeStore.getLastOpened(p)
		}));
	});

	handle('home:summary', (_e, repo: string) => dataSource.getRepoSummary(repo));

	handle('home:defaults', () => ({ cloneDir: homeStore.lastCloneDir, newRepoDir: homeStore.lastNewRepoDir }));

	handle('home:pick-folder', async (_e, title: string) => {
		const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
		return r.canceled || r.filePaths.length === 0 ? null : toPosix(r.filePaths[0]);
	});

	handle('home:open', async (_e, repo: string): Promise<Result> => {
		if (!repoManager.isKnownRepo(repo)) return { ok: false, error: 'This repository is no longer in the list.' };
		if (!fs.existsSync(repo)) return { ok: false, error: 'The folder no longer exists.' };
		openRepo(repo);
		return { ok: true };
	});

	/** Add an existing repository (from a path, or via the folder picker when `folder` is null). */
	handle('home:add', async (_e, folder: string | null): Promise<Result<{ path: string, already: boolean }> | { ok: false, cancelled: true }> => {
		if (!hasGit()) return noGit();
		let target = folder;
		if (target === null) {
			const r = await dialog.showOpenDialog(win, { title: 'Open a Git repository', properties: ['openDirectory'] });
			if (r.canceled || r.filePaths.length === 0) return { ok: false, cancelled: true };
			target = r.filePaths[0];
		}
		return register(target);
	});

	handle('home:scan', async (_e, folder: string | null): Promise<Result<{ added: number, known: number }> | { ok: false, cancelled: true }> => {
		if (!hasGit()) return noGit();
		let root = folder;
		if (root === null) {
			const r = await dialog.showOpenDialog(win, { title: 'Scan a folder for Git repositories', properties: ['openDirectory'] });
			if (r.canceled || r.filePaths.length === 0) return { ok: false, cancelled: true };
			root = r.filePaths[0];
		}
		const found: string[] = [];
		await findRepos(root, 3, found, { n: 4000 });
		let added = 0, known = 0;
		for (const repo of found) {
			const res = await register(repo);
			if (res.ok) { if (res.already) known++; else added++; }
		}
		if (found.length === 0) return { ok: false, error: 'No Git repositories were found in that folder.' };
		return { ok: true, added, known };
	});

	handle('home:clone', async (_e, opts: { url: string, parent: string, name: string }): Promise<Result<{ path: string }>> => {
		if (!hasGit()) return noGit();
		const url = (opts.url || '').trim();
		const name = (opts.name || '').trim() || DataSource.repoNameFromUrl(url);
		if (url === '') return { ok: false, error: 'Enter the repository URL.' };
		if (!opts.parent || !fs.existsSync(opts.parent)) return { ok: false, error: 'Choose a destination folder.' };
		if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: 'The folder name contains characters that are not allowed.' };
		if (fs.existsSync(path.join(opts.parent, name))) return { ok: false, error: 'A folder named "' + name + '" already exists there.' };
		const result = await dataSource.cloneRepo(url, opts.parent, name);
		if (result.error !== null || result.path === null) return { ok: false, error: String(result.error || 'Clone failed.') };
		homeStore.lastCloneDir = toPosix(opts.parent);
		const reg = await register(result.path);
		return reg.ok ? { ok: true, path: reg.path } : reg;
	});

	handle('home:init', async (_e, opts: { parent: string, name: string }): Promise<Result<{ path: string }>> => {
		if (!hasGit()) return noGit();
		const name = (opts.name || '').trim();
		if (!opts.parent || !fs.existsSync(opts.parent)) return { ok: false, error: 'Choose a location.' };
		if (name === '') return { ok: false, error: 'Enter a name for the repository.' };
		if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: 'The name contains characters that are not allowed.' };
		const target = path.join(opts.parent, name);
		if (fs.existsSync(target) && fs.readdirSync(target).length > 0) return { ok: false, error: 'The folder "' + name + '" already exists and is not empty.' };
		try { fs.mkdirSync(target, { recursive: true }); } catch (e) { return { ok: false, error: String(e) }; }
		const error = await dataSource.initRepo(target);
		if (error !== null) return { ok: false, error: String(error) };
		homeStore.lastNewRepoDir = toPosix(opts.parent);
		const reg = await register(target);
		return reg.ok ? { ok: true, path: reg.path } : reg;
	});

	handle('home:remove', (_e, repo: string) => {
		homeStore.forget(repo);
		return repoManager.ignoreRepo(repo);
	});

	handle('home:pin', (_e, repo: string) => homeStore.togglePin(repo));

	handle('home:reveal', (_e, repo: string) => {
		if (fs.existsSync(repo)) shell.showItemInFolder(path.resolve(repo));
	});

}
