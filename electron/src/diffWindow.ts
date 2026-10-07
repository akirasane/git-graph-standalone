import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from './dataSource';
import { ErrorInfo, GitFileStatus } from './types';
import { openUiWindow } from './uiWindow';
import { UNCOMMITTED, abbrevCommit, doesFileExist } from './utils';

/**
 * Standalone diff viewer: a themed window (uiWindow.ts, ui/diff.html) hosting Monaco's diff editor
 * with the Nocturne colour theme. `dataSource.getCommitFile` supplies historical file content; the
 * working-tree side reads straight from disk.
 */

function getLanguageForFile(filePath: string): string {
	const ext = filePath.substring(filePath.lastIndexOf('.') + 1).toLowerCase();
	const map: { [ext: string]: string } = {
		js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
		json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
		md: 'markdown', py: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
		cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sh: 'shell', bash: 'shell',
		yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', ps1: 'powershell'
	};
	return map[ext] || 'plaintext';
}

async function readWorkingFile(repo: string, filePath: string): Promise<string | null> {
	const absPath = path.join(repo, filePath);
	if (!(await doesFileExist(absPath))) return null;
	try {
		return fs.readFileSync(absPath, 'utf8');
	} catch (_) {
		return null;
	}
}

async function readCommitFile(dataSource: DataSource, repo: string, hash: string, filePath: string): Promise<string | null> {
	try {
		return await dataSource.getCommitFile(repo, hash, filePath);
	} catch (_) {
		return null;
	}
}

function showWindow(filePath: string, description: string, mode: 'diff' | 'single', original: string, modified: string) {
	const slash = filePath.lastIndexOf('/');
	const fileName = filePath.substring(slash + 1);
	openUiWindow<null>({
		view: 'diff',
		chrome: 'window',
		parent: null,
		title: fileName + ' (' + description + ')',
		width: 1100,
		height: 760,
		minWidth: 560,
		minHeight: 320,
		resizable: true,
		data: { mode, fileName, filePath, dir: slash > 0 ? filePath.substring(0, slash) : '', description, original, modified, language: getLanguageForFile(filePath) }
	});
}

export async function viewDiff(dataSource: DataSource, repo: string, fromHash: string, toHash: string, oldFilePath: string, newFilePath: string, type: GitFileStatus): Promise<ErrorInfo> {
	const abbrevFromHash = abbrevCommit(fromHash), abbrevToHash = toHash !== UNCOMMITTED ? abbrevCommit(toHash) : 'Present';
	const desc = fromHash === toHash
		? fromHash === UNCOMMITTED
			? 'Uncommitted'
			: (type === GitFileStatus.Added ? 'Added in ' + abbrevToHash : type === GitFileStatus.Deleted ? 'Deleted in ' + abbrevToHash : abbrevFromHash + '^ ↔ ' + abbrevToHash)
		: (type === GitFileStatus.Added ? 'Added between ' + abbrevFromHash + ' & ' + abbrevToHash : type === GitFileStatus.Deleted ? 'Deleted between ' + abbrevFromHash + ' & ' + abbrevToHash : abbrevFromHash + ' ↔ ' + abbrevToHash);
	const effectiveFromHash = fromHash === UNCOMMITTED ? 'HEAD' : (fromHash === toHash ? fromHash + '^' : fromHash);

	const [original, modified] = await Promise.all([
		type === GitFileStatus.Added ? Promise.resolve('') : readCommitFile(dataSource, repo, effectiveFromHash, oldFilePath),
		type === GitFileStatus.Deleted
			? Promise.resolve('')
			: toHash === UNCOMMITTED
				? readWorkingFile(repo, newFilePath)
				: readCommitFile(dataSource, repo, toHash, newFilePath)
	]);

	if (original === null || modified === null) {
		return 'Unable to load the diff editor for ' + newFilePath + '.';
	}

	showWindow(newFilePath, desc, 'diff', original, modified);
	return null;
}

export async function viewFileAtRevision(dataSource: DataSource, repo: string, hash: string, filePath: string): Promise<ErrorInfo> {
	const content = await readCommitFile(dataSource, repo, hash, filePath);
	if (content === null) {
		return 'Unable to open ' + filePath + ' at commit ' + abbrevCommit(hash) + '.';
	}

	showWindow(filePath, 'at ' + abbrevCommit(hash), 'single', '', content);
	return null;
}
