import { BrowserWindow, ipcMain } from 'electron';
import { getNonce } from './utils';

export interface PickerItem {
	label: string;
	description?: string;
	detail?: string;
}

/**
 * A small modal list-picker window, replacing VSCode's `vscode.window.showQuickPick`. Electron
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
