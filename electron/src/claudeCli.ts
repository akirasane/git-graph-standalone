import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getConfig } from './config';
import { DataSource } from './dataSource';

/**
 * Commit message generation through the user's own Claude Code CLI (`claude -p`). The CLI is run in
 * "safe mode" with every tool disabled, so it can only read the prompt we pipe in and answer with
 * text - it never touches the repository, and none of the user's hooks, CLAUDE.md files or skills
 * influence the message.
 */

const MAX_DIFF_CHARS = 60000;
const TIMEOUT_MS = 120000;

export const CLAUDE_NOT_FOUND_MSG = 'Claude Code CLI was not found. Install it (https://claude.com/claude-code), run `claude` once to sign in, then try again.';

/** Locate the `claude` executable: configured path, then PATH, then the usual install folders. */
export function findClaude(configured: string): string | null {
	const isWin = process.platform === 'win32';
	if (configured && fs.existsSync(configured)) return configured;

	const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
	const home = os.homedir();
	const dirs = (process.env.PATH || '').split(path.delimiter).filter((d) => d !== '');
	dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/usr/local/bin', '/opt/homebrew/bin');
	if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));

	for (const dir of dirs) {
		for (const ext of exts) {
			const candidate = path.join(dir, 'claude' + ext);
			try {
				if (fs.statSync(candidate).isFile()) return candidate;
			} catch (_) { /* keep looking */ }
		}
	}
	return null;
}

function buildPrompt(input: { stat: string, diff: string, recent: string[], truncated: boolean }) {
	return [
		'Write a git commit message for the staged changes below.',
		'',
		'Rules:',
		'- First line: imperative-mood summary, at most 72 characters, no trailing period.',
		'- If the change is non-trivial, add a blank line and then a short body explaining what changed and why (wrap at 72 columns). Omit the body for trivial changes.',
		'- Describe the intent of the change, not a file-by-file list.',
		'- Match the tone and style of the recent commit subjects.',
		'- Output ONLY the commit message. No code fences, no quotes, no commentary.',
		'',
		input.recent.length > 0 ? 'Recent commit subjects:\n' + input.recent.map((s) => '- ' + s).join('\n') + '\n' : '',
		'Summary of changes:',
		input.stat.trim(),
		'',
		'Diff' + (input.truncated ? ' (truncated - it was too large to include in full)' : '') + ':',
		input.diff
	].join('\n');
}

/** Split the model's reply into a commit summary and an optional description. */
export function parseCommitMessage(raw: string): { summary: string, description: string } {
	let text = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
	const lines = text.split(/\r?\n/);
	let summary = (lines.shift() || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^(commit message|summary)\s*:\s*/i, '');
	if (summary.length > 100) summary = summary.slice(0, 97).trimEnd() + '...';
	const description = lines.join('\n').trim();
	return { summary: summary, description: description };
}

const quote = (arg: string) => '"' + arg.replace(/"/g, '\\"') + '"';

function runClaude(claudePath: string, model: string, cwd: string, prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = ['-p', '--safe-mode', '--tools', '', '--no-session-persistence'];
		if (model) args.push('--model', model);

		// .cmd/.bat shims (npm installs on Windows) can only be started through a shell.
		const viaShell = /\.(cmd|bat)$/i.test(claudePath);
		const child = cp.spawn(viaShell ? quote(claudePath) : claudePath, viaShell ? args.map(quote) : args, { cwd: cwd, shell: viaShell, windowsHide: true });

		let stdout = '', stderr = '', settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject('Claude took too long to respond (over ' + TIMEOUT_MS / 1000 + 's).');
		}, TIMEOUT_MS);

		child.stdout.on('data', (d) => { stdout += d.toString(); });
		child.stderr.on('data', (d) => { stderr += d.toString(); });
		child.on('error', (e: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(e.code === 'ENOENT' ? CLAUDE_NOT_FOUND_MSG : 'Could not start Claude Code: ' + e.message);
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code === 0 && stdout.trim() !== '') resolve(stdout);
			else reject(((stderr || stdout).trim() || 'Claude Code exited with code ' + code + '.').slice(0, 400));
		});
		child.stdin.on('error', () => { /* process exited early; reported by 'close' */ });
		child.stdin.end(prompt);
	});
}

export type GenerateResult = { summary: string, description: string, error: null } | { summary: '', description: '', error: string };

/** Generate a commit message for the repository's staged changes. */
export async function generateCommitMessage(dataSource: DataSource, repo: string, amend: boolean): Promise<GenerateResult> {
	const fail = (error: string): GenerateResult => ({ summary: '', description: '', error: error });

	const claudePath = findClaude(getConfig().claudeCliPath);
	if (claudePath === null) return fail(CLAUDE_NOT_FOUND_MSG);

	let input;
	try {
		input = await dataSource.getStagedDiffForAi(repo, amend, MAX_DIFF_CHARS);
	} catch (e) {
		return fail('Could not read the staged changes: ' + String(e));
	}
	if (input.diff.trim() === '') return fail('There are no staged changes to describe. Stage some files first.');

	try {
		const reply = await runClaude(claudePath, getConfig().claudeCliModel, repo, buildPrompt(input));
		const parsed = parseCommitMessage(reply);
		if (parsed.summary === '') return fail('Claude returned an empty message. Try again.');
		return { summary: parsed.summary, description: parsed.description, error: null };
	} catch (e) {
		return fail(String(e));
	}
}
