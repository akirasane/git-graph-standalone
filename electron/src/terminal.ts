import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Opens a native OS terminal at `cwd`, replacing VSCode's `vscode.window.createTerminal`.
 * Prepends the Git executable's directory to PATH (matching the original's behaviour) and,
 * if `command` is provided, runs `git <command>` in the new terminal.
 */
export function openGitTerminal(cwd: string, gitPath: string, command: string | null, _name: string): void {
	let p = process.env['PATH'] || '';
	const sep = process.platform === 'win32' ? ';' : ':';
	if (p !== '' && !p.endsWith(sep)) p += sep;
	p += path.dirname(gitPath);
	const env = Object.assign({}, process.env, { PATH: p });

	const gitCommand = command !== null ? 'git ' + command : null;

	try {
		if (process.platform === 'win32') {
			const args = gitCommand !== null ? ['/k', gitCommand] : ['/k'];
			spawn('cmd.exe', args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: false }).unref();
		} else if (process.platform === 'darwin') {
			const script = gitCommand !== null
				? 'cd ' + shellQuote(cwd) + ' && ' + gitCommand + '; exec $SHELL'
				: 'cd ' + shellQuote(cwd) + '; exec $SHELL';
			spawn('osascript', ['-e', 'tell application "Terminal" to do script "' + script.replace(/"/g, '\\"') + '"'], { detached: true, stdio: 'ignore' }).unref();
		} else {
			const shellCmd = gitCommand !== null
				? 'cd ' + shellQuote(cwd) + ' && ' + gitCommand + '; exec $SHELL'
				: '$SHELL';
			const emulator = process.env['TERMINAL'] || 'x-terminal-emulator';
			spawn(emulator, ['-e', 'bash -c ' + shellQuote(shellCmd)], { cwd, env, detached: true, stdio: 'ignore' }).unref();
		}
	} catch (err) {
		console.error('[error] Unable to open a terminal:', err);
	}
}

function shellQuote(s: string) {
	return '"' + s.replace(/(["$`\\])/g, '\\$1') + '"';
}
