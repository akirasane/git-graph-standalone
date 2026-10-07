import { openUiWindow } from './uiWindow';

export interface PickerItem {
	label: string;
	description?: string;
	detail?: string;
}

/**
 * A themed modal list picker (Electron has no native quick-pick). Type to filter, arrow keys to move,
 * Enter to choose, Esc to cancel. Resolves with the selected item's index, or null if cancelled.
 */
export async function showPicker(title: string, placeholder: string, items: PickerItem[]): Promise<number | null> {
	if (items.length === 0) return null;
	const rowHeight = items.some((i) => i.detail) ? 52 : 40;
	const index = await openUiWindow<number>({
		view: 'picker',
		title,
		width: 520,
		height: Math.min(520, 128 + items.length * rowHeight),
		minWidth: 380,
		minHeight: 220,
		resizable: true,
		data: { placeholder, items }
	}).result;
	return typeof index === 'number' && index >= 0 && index < items.length ? index : null;
}

/**
 * A themed modal single-line text prompt. Resolves with the entered (trimmed) text, or null if
 * cancelled or left empty.
 */
export async function showInput(title: string, prompt: string, placeholder: string = ''): Promise<string | null> {
	const value = await openUiWindow<string>({
		view: 'input',
		title,
		width: 460,
		height: 190,
		fitContent: true,
		data: { prompt, placeholder }
	}).result;
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
