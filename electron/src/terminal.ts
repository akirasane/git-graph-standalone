import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Opens a native OS terminal at `cwd`.
 * Prepends the Git executable's directory to PATH (matching the original's behaviour) and,
 * if `command` is provided, runs `git <command>` in the new terminal.
 */
export function openGitTerminal(cwd: string, gitPath: string, command: string | null, name: string): void {
	let p = path.dirname(gitPath);
	const sep = process.platform === 'win32' ? ';' : ':';
	const existing = process.env['PATH'] || '';
	if (existing !== '') p += sep + existing;
	const env = Object.assign({}, process.env, { PATH: p });

	const gitCommand = command !== null ? 'git ' + command : null;

	try {
		if (process.platform === 'win32') {
			// Plain `spawn('cmd.exe', ..., {detached:true})` is unreliable here: on Windows,
			// `detached` only sets CREATE_NEW_PROCESS_GROUP, not CREATE_NEW_CONSOLE, and the
			// child can still be killed alongside the launching process if it belongs to a
			// Job Object without CREATE_BREAKAWAY_FROM_JOB (common when Electron itself was
			// started from a wrapped/dev terminal). `cmd /c start` asks the shell to launch a
			// genuinely independent, new-console process, which is the standard fix.
			const title = (name || 'Git Graph').replace(/[&<>^|]/g, '');
			const args = ['/c', 'start', '"' + title + '"', 'cmd.exe', '/k'];
			if (gitCommand !== null) args.push(gitCommand);
			spawn('cmd.exe', args, { cwd, env, windowsHide: false, shell: false });
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
