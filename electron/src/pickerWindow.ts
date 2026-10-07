import { BrowserWindow, ipcMain } from 'electron';
import { getNonce } from './utils';

export interface PickerItem {
	label: string;
	description?: string;
	detail?: string;
}

/**
 * A small modal list-picker window. Electron
 * has no native equivalent (unlike showOpenDialog/showSaveDialog/showMessageBox, which map
 * directly to `dialog.*`), so this is a minimal bespoke window - same pattern as
 * `askpassManager.ts`'s credential prompt. Resolves with the selected item's index, or `null` if
 * the user cancelled.
 */
export function showPicker(title: string, placeholder: string, items: PickerItem[]): Promise<number | null> {
	return new Promise((resolve) => {
		if (items.length === 0) {
			resolve(null);
			return;
		}

		const channel = 'picker-result-' + getNonce();
		const win = new BrowserWindow({
			width: 480,
			height: Math.min(500, 120 + items.length * 56),
			resizable: true,
			modal: true,
			title,
			webPreferences: { contextIsolation: true, nodeIntegration: false }
		});
		win.setMenuBarVisibility(false);

		const itemsHtml = items.map((item, i) => `
			<div class="item" data-index="${i}">
				<div class="label">${escapeHtml(item.label)}</div>
				${item.description ? `<div class="description">${escapeHtml(item.description)}</div>` : ''}
				${item.detail ? `<div class="detail">${escapeHtml(item.detail)}</div>` : ''}
			</div>`).join('');

		const html = `<!doctype html><html><head><meta charset="utf-8"><style>
			body{font-family:sans-serif;margin:0;padding:0;background:#1e1e1e;color:#ccc;}
			p{margin:0;padding:10px 14px;font-size:12px;color:#999;border-bottom:1px solid #333;}
			.item{padding:8px 14px;cursor:pointer;border-bottom:1px solid #2a2a2a;}
			.item:hover, .item.selected{background:#04395e;}
			.label{font-size:13px;}
			.description{font-size:11px;color:#999;}
			.detail{font-size:11px;color:#777;}
		</style></head><body>
			<p>${escapeHtml(placeholder)}</p>
			<div id="list">${itemsHtml}</div>
			<script>
				const { ipcRenderer } = require('electron');
				function submit(index) { ipcRenderer.send('${channel}', index); }
				document.querySelectorAll('.item').forEach((el) => {
					el.addEventListener('click', () => submit(parseInt(el.getAttribute('data-index'), 10)));
				});
				document.addEventListener('keydown', (e) => { if (e.key === 'Escape') submit(null); });
			</script>
		</body></html>`;

		let resolved = false;
		const finish = (index: number | null) => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(channel, onResult);
			if (!win.isDestroyed()) win.close();
			resolve(index);
		};
		const onResult = (_event: Electron.IpcMainEvent, index: number | null) => finish(index);

		ipcMain.on(channel, onResult);
		win.on('closed', () => finish(null));
		win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
	});
}

function escapeHtml(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A small modal single-line text prompt (Electron has no native equivalent of
 * input box). Resolves with the entered text, or `null` if cancelled.
 */
export function showInput(title: string, prompt: string, placeholder: string = ''): Promise<string | null> {
	return new Promise((resolve) => {
		const channel = 'input-result-' + getNonce();
		const win = new BrowserWindow({
			width: 520, height: 160, resizable: false, modal: true, title,
			webPreferences: { contextIsolation: true, nodeIntegration: false }
		});
		win.setMenuBarVisibility(false);

		const html = `<!doctype html><html><head><meta charset="utf-8"><style>
			body{font-family:sans-serif;margin:0;padding:14px;background:#1e1e1e;color:#ccc;}
			p{margin:0 0 8px;font-size:12px;color:#999;}
			input{width:100%;box-sizing:border-box;padding:6px;background:#3c3c3c;color:#ccc;border:1px solid #555;font-size:13px;}
			.row{margin-top:12px;text-align:right;}
			button{padding:5px 14px;margin-left:6px;background:#0e639c;color:#fff;border:0;cursor:pointer;}
			button.cancel{background:#3a3d41;}
		</style></head><body>
			<p>${escapeHtml(prompt)}</p>
			<input id="v" type="text" placeholder="${escapeHtml(placeholder)}" autofocus>
			<div class="row"><button class="cancel" id="c">Cancel</button><button id="ok">OK</button></div>
			<script>
				const { ipcRenderer } = require('electron');
				const v = document.getElementById('v');
				const ok = () => ipcRenderer.send('${channel}', v.value);
				document.getElementById('ok').onclick = ok;
				document.getElementById('c').onclick = () => ipcRenderer.send('${channel}', null);
				document.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') ok();
					if (e.key === 'Escape') ipcRenderer.send('${channel}', null);
				});
			</script>
		</body></html>`;

		let resolved = false;
		const finish = (value: string | null) => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(channel, onResult);
			if (!win.isDestroyed()) win.close();
			resolve(value !== null && value.trim() !== '' ? value.trim() : null);
		};
		const onResult = (_event: Electron.IpcMainEvent, value: string | null) => finish(value);

		ipcMain.on(channel, onResult);
		win.on('closed', () => finish(null));
		win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
	});
}
