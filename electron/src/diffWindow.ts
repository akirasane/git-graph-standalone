import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from './dataSource';
import { ErrorInfo, GitFileStatus } from './types';
import { UNCOMMITTED, abbrevCommit, doesFileExist, getNonce } from './utils';

/**
 * Standalone diff viewer window (
 * fed by diffDocProvider.ts's `TextDocumentContentProvider`) with a Monaco diff editor embedded in
 * its own BrowserWindow. `dataSource.getCommitFile` (unchanged from the original) still supplies
 * historical file content; the working-tree side reads straight from disk.
 */

const MONACO_VS_PATH = pathToFileURL(path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs'));

function pathToFileURL(p: string) {
	return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');
}

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

function buildHtml(title: string, mode: 'diff' | 'single', originalContent: string, modifiedContent: string, language: string) {
	const nonce = getNonce();
	// If the diffed file's own content contains the literal text "</script>" (any real HTML
	// file has one), the browser's HTML parser closes this <script> tag right there - before
	// the JS parser ever sees it - dumping the rest of the JSON/file content as raw markup
	// instead of running the diff viewer. Escaping '<' as a unicode escape keeps the JSON
	// valid (JS string literals decode < back to '<') while being invisible to the HTML
	// tokenizer.
	const stateJson = JSON.stringify({ mode, original: originalContent, modified: modifiedContent, language }).replace(/</g, '\\u003c');
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>${escapeHtml(title)}</title>
	<style>html,body,#container{height:100%;margin:0;padding:0;} body{background:#1e1e1e;}</style>
</head>
<body>
	<div id="container"></div>
	<script nonce="${nonce}">var __state = ${stateJson};</script>
	<script nonce="${nonce}" src="${MONACO_VS_PATH}/loader.js"></script>
	<script nonce="${nonce}">
		require.config({ paths: { vs: '${MONACO_VS_PATH}' } });
		require(['vs/editor/editor.main'], function () {
			monaco.editor.setTheme('vs-dark');
			var originalModel = monaco.editor.createModel(__state.original, __state.language);
			var modifiedModel = monaco.editor.createModel(__state.modified, __state.language);
			if (__state.mode === 'diff') {
				var editor = monaco.editor.createDiffEditor(document.getElementById('container'), { readOnly: true, automaticLayout: true });
				editor.setModel({ original: originalModel, modified: modifiedModel });
			} else {
				monaco.editor.create(document.getElementById('container'), { model: modifiedModel, readOnly: true, automaticLayout: true });
			}
		});
	</script>
</body>
</html>`;
}

function escapeHtml(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showWindow(title: string, mode: 'diff' | 'single', originalContent: string, modifiedContent: string, language: string) {
	const html = buildHtml(title, mode, originalContent, modifiedContent, language);
	const tmpFile = path.join(os.tmpdir(), 'git-graph-diff-' + getNonce() + '.html');
	fs.writeFileSync(tmpFile, html);

	const win = new BrowserWindow({
		width: 1100,
		height: 800,
		title,
		webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
	});
	win.setMenuBarVisibility(false);
	win.loadFile(tmpFile);
	win.on('closed', () => {
		fs.unlink(tmpFile, () => { });
	});
}

export async function viewDiff(dataSource: DataSource, repo: string, fromHash: string, toHash: string, oldFilePath: string, newFilePath: string, type: GitFileStatus): Promise<ErrorInfo> {
	const abbrevFromHash = abbrevCommit(fromHash), abbrevToHash = toHash !== UNCOMMITTED ? abbrevCommit(toHash) : 'Present';
	const pathComponents = newFilePath.split('/');
	const desc = fromHash === toHash
		? fromHash === UNCOMMITTED
			? 'Uncommitted'
			: (type === GitFileStatus.Added ? 'Added in ' + abbrevToHash : type === GitFileStatus.Deleted ? 'Deleted in ' + abbrevToHash : abbrevFromHash + '^ ↔ ' + abbrevToHash)
		: (type === GitFileStatus.Added ? 'Added between ' + abbrevFromHash + ' & ' + abbrevToHash : type === GitFileStatus.Deleted ? 'Deleted between ' + abbrevFromHash + ' & ' + abbrevToHash : abbrevFromHash + ' ↔ ' + abbrevToHash);
	const title = pathComponents[pathComponents.length - 1] + ' (' + desc + ')';
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

	showWindow(title, 'diff', original, modified, getLanguageForFile(newFilePath));
	return null;
}

export async function viewFileAtRevision(dataSource: DataSource, repo: string, hash: string, filePath: string): Promise<ErrorInfo> {
	const pathComponents = filePath.split('/');
	const title = abbrevCommit(hash) + ': ' + pathComponents[pathComponents.length - 1];

	const content = await readCommitFile(dataSource, repo, hash, filePath);
	if (content === null) {
		return 'Unable to open ' + filePath + ' at commit ' + abbrevCommit(hash) + '.';
	}

	showWindow(title, 'single', '', content, getLanguageForFile(filePath));
	return null;
}
