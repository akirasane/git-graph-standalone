import { Disposable } from './utils/disposable';

const DOUBLE_QUOTE_REGEXP = /"/g;

/**
 * Ported from src/logger.ts. VSCode's Output Channel is replaced by the main process console
 * (visible in the terminal that launched Electron, and in the DevTools console for renderer-side
 * inspection via `console.log`'s normal stdout piping).
 */
export class Logger extends Disposable {
	public log(message: string) {
		const date = new Date();
		const timestamp = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()) + '.' + pad3(date.getMilliseconds());
		console.log('[' + timestamp + '] ' + message);
	}

	public logCmd(cmd: string, args: string[]) {
		this.log('> ' + cmd + ' ' + args.map((arg) => arg === ''
			? '""'
			: arg.startsWith('--format=')
				? '--format=...'
				: arg.includes(' ')
					? '"' + arg.replace(DOUBLE_QUOTE_REGEXP, '\\"') + '"'
					: arg
		).join(' '));
	}

	public logError(message: string) {
		this.log('ERROR: ' + message);
	}
}

function pad2(n: number) {
	return (n > 9 ? '' : '0') + n;
}

function pad3(n: number) {
	return (n > 99 ? '' : n > 9 ? '0' : '00') + n;
}
