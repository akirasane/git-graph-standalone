/*---------------------------------------------------------------------------------------------
 *  Ported from src/askpass/askpassManager.ts (itself based on VSCode's Git Extension askpass
 *  implementation, see that file for the original attribution/license).
 *  The only VSCode dependency was a single `vscode.window.showInputBox` call, replaced here by
 *  a small modal BrowserWindow with a plain HTML form (see `promptForCredentials` below).
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { getNonce } from '../utils';
import { Disposable, toDisposable } from '../utils/disposable';

export interface AskpassEnvironment {
	GIT_ASKPASS: string;
	ELECTRON_RUN_AS_NODE?: string;
	VSCODE_GIT_GRAPH_ASKPASS_NODE?: string;
	VSCODE_GIT_GRAPH_ASKPASS_MAIN?: string;
	VSCODE_GIT_GRAPH_ASKPASS_HANDLE?: string;
}

export interface AskpassRequest {
	host: string;
	request: string;
}

export class AskpassManager extends Disposable {
	private ipcHandlePath: string;
	private server: http.Server;
	private enabled = true;

	constructor() {
		super();
		this.ipcHandlePath = getIPCHandlePath(getNonce());
		this.server = http.createServer((req, res) => this.onRequest(req, res));
		try {
			this.server.listen(this.ipcHandlePath);
			this.server.on('error', () => { });
		} catch (err) {
			this.enabled = false;
		}
		fs.chmod(path.join(__dirname, 'askpass.sh'), '755', () => { });
		fs.chmod(path.join(__dirname, 'askpass-empty.sh'), '755', () => { });

		this.registerDisposable(
			toDisposable(() => {
				try {
					this.server.close();
					if (process.platform !== 'win32') {
						fs.unlinkSync(this.ipcHandlePath);
					}
				} catch (e) { }
			})
		);
	}

	private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		let reqData = '';
		req.setEncoding('utf8');
		req.on('data', (d) => reqData += d);
		req.on('end', () => {
			let data = JSON.parse(reqData) as AskpassRequest;
			promptForCredentials(data.host, data.request).then(result => {
				res.writeHead(200);
				res.end(JSON.stringify(result || ''));
			}, () => {
				res.writeHead(500);
				res.end();
			});
		});
	}

	public getEnv(): AskpassEnvironment {
		return this.enabled
			? {
				ELECTRON_RUN_AS_NODE: '1',
				GIT_ASKPASS: path.join(__dirname, 'askpass.sh'),
				VSCODE_GIT_GRAPH_ASKPASS_NODE: process.execPath,
				VSCODE_GIT_GRAPH_ASKPASS_MAIN: path.join(__dirname, 'askpassMain.js'),
				VSCODE_GIT_GRAPH_ASKPASS_HANDLE: this.ipcHandlePath
			}
			: {
				GIT_ASKPASS: path.join(__dirname, 'askpass-empty.sh')
			};
	}
}

function getIPCHandlePath(nonce: string): string {
	if (process.platform === 'win32') {
		return '\\\\.\\pipe\\git-graph-askpass-' + nonce + '-sock';
	} else if (process.env['XDG_RUNTIME_DIR']) {
		return path.join(process.env['XDG_RUNTIME_DIR'] as string, 'git-graph-askpass-' + nonce + '.sock');
	} else {
		return path.join(os.tmpdir(), 'git-graph-askpass-' + nonce + '.sock');
	}
}

/**
 * Prompt the user for a credential (username/password) in a small modal window, replacing
 * `vscode.window.showInputBox`. Masks the input when `request` looks like a password prompt.
 */
function promptForCredentials(host: string, request: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const isPassword = /password/i.test(request);
		const channel = 'askpass-result-' + getNonce();

		const win = new BrowserWindow({
			width: 420,
			height: 180,
			resizable: false,
			minimizable: false,
			maximizable: false,
			modal: true,
			title: 'Git Graph: ' + host,
			webPreferences: { contextIsolation: true, nodeIntegration: false }
		});

		const html = `<!doctype html><html><head><meta charset="utf-8"><style>
			body{font-family:sans-serif;padding:16px;margin:0;}
			p{margin:0 0 12px;font-size:13px;}
			input{width:100%;box-sizing:border-box;padding:6px;font-size:13px;}
			.buttons{margin-top:14px;text-align:right;}
			button{padding:6px 14px;margin-left:8px;}
		</style></head><body>
			<p>${escapeHtml('Git Graph: ' + host)}</p>
			<input id="value" type="${isPassword ? 'password' : 'text'}" placeholder="${escapeHtml(request)}" autofocus>
			<div class="buttons">
				<button id="cancel">Cancel</button>
				<button id="ok">OK</button>
			</div>
			<script>
				const { ipcRenderer } = require('electron');
				const input = document.getElementById('value');
				function submit(value) { ipcRenderer.send('${channel}', value); }
				document.getElementById('ok').addEventListener('click', () => submit(input.value));
				document.getElementById('cancel').addEventListener('click', () => submit(undefined));
				input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(input.value); if (e.key === 'Escape') submit(undefined); });
			</script>
		</body></html>`;

		let resolved = false;
		const finish = (value: string | undefined) => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(channel, onResult);
			if (!win.isDestroyed()) win.close();
			resolve(value);
		};
		const onResult = (_event: Electron.IpcMainEvent, value: string | undefined) => finish(value);

		ipcMain.on(channel, onResult);
		win.on('closed', () => finish(undefined));
		win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
	});
}

function escapeHtml(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
