/* Constants */
const HOST_API = acquireHostApi();

/**
 * Icons: Phosphor (regular), provided by electron/ui/icons.js (window.GG.icon), which the host page loads before this
 * script. Each getter returns an SVG string sized 16x16 by default (CSS sizes it per surface), or an empty string
 * if the icon set is unavailable.
 */
function phosphorIcon(name: string) {
	const iconSet = (<any>window).GG;
	const svg: string = iconSet && typeof iconSet.icon === 'function' ? iconSet.icon(name) : '';
	return svg !== '' ? svg.replace('<svg ', '<svg width="16" height="16" ') : FALLBACK_ICONS[name] || '';
}

/* Icons without a Phosphor equivalent in the bundled set */
const FALLBACK_ICONS: { [name: string]: string } = {
	'tree-view': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="32" y="40" width="72" height="48" rx="8"/><path d="M68 88v96a8 8 0 0 0 8 8h76M68 136h84"/><rect x="152" y="112" width="72" height="48" rx="8"/><rect x="152" y="168" width="72" height="48" rx="8"/></svg>'
};

const SVG_ICONS = {
	get alert() { return phosphorIcon('warning'); },
	get arrowDown() { return phosphorIcon('arrow-down'); },
	get arrowUp() { return phosphorIcon('arrow-up'); },
	get branch() { return phosphorIcon('git-branch'); },
	get cdv() { return phosphorIcon('sidebar-simple'); },
	get check() { return phosphorIcon('check'); },
	get close() { return phosphorIcon('x'); },
	get closedFolder() { return phosphorIcon('folder-simple'); },
	get commit() { return phosphorIcon('git-commit'); },
	get copy() { return phosphorIcon('copy'); },
	get download() { return phosphorIcon('cloud-arrow-down'); },
	get eyeClosed() { return phosphorIcon('eye-slash'); },
	get eyeOpen() { return phosphorIcon('eye'); },
	get failed() { return phosphorIcon('x-circle'); },
	get fileList() { return phosphorIcon('list'); },
	get fileTree() { return phosphorIcon('tree-view'); },
	get gear() { return phosphorIcon('gear-six'); },
	get inconclusive() { return phosphorIcon('warning-circle'); },
	get info() { return phosphorIcon('info'); },
	get linkExternal() { return phosphorIcon('arrow-square-out'); },
	get loading() { return phosphorIcon('circle-notch'); },
	get openFile() { return phosphorIcon('file-text'); },
	get openFolder() { return phosphorIcon('folder-open'); },
	get package() { return phosphorIcon('download-simple'); },
	get passed() { return phosphorIcon('check-circle'); },
	get pencil() { return phosphorIcon('pencil-simple'); },
	get plus() { return phosphorIcon('plus'); },
	get refresh() { return phosphorIcon('arrows-clockwise'); },
	get review() { return phosphorIcon('eye'); },
	get search() { return phosphorIcon('magnifying-glass'); },
	get stash() { return phosphorIcon('stack'); },
	get tag() { return phosphorIcon('tag'); },
	get terminal() { return phosphorIcon('terminal-window'); }
};

const GIT_FILE_CHANGE_TYPES = { 'A': 'Added', 'M': 'Modified', 'D': 'Deleted', 'R': 'Renamed', 'U': 'Untracked', 'C': 'Conflicted' };
const GIT_SIGNATURE_STATUS_DESCRIPTIONS = {
	'G': 'Valid Signature',
	'U': 'Good Signature with Unknown Validity',
	'X': 'Good Signature that has Expired',
	'Y': 'Good Signature made by an Expired Key',
	'R': 'Good Signature made by a Revoked Key',
	'E': 'Signature could not be checked',
	'B': 'Bad Signature'
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REF_INVALID_REGEX = /^[-\/].*|[\\" ><~^:?*[]|\.\.|\/\/|\/\.|@{|[.\/]$|\.lock$|^@$/g;

const HTML_ESCAPES: { [key: string]: string } = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#x27;', '/': '&#x2F;' };
const HTML_UNESCAPES: { [key: string]: string } = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': '\'', '&#x2F;': '/' };
const HTML_ESCAPER_REGEX = /[&<>"'\/]/g;
const HTML_UNESCAPER_REGEX = /&lt;|&gt;|&amp;|&quot;|&#x27;|&#x2F;/g;

const ELLIPSIS = '&#8230;';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const UNCOMMITTED = '*';
const SHOW_ALL_BRANCHES = '';

const COLUMN_HIDDEN = -100;
const COLUMN_AUTO = -101;

const COLUMN_MIN_WIDTH = 40;
const COLUMN_LEFT_RIGHT_PADDING = 24;

const CLASS_ACTIVE = 'active';
const CLASS_BRANCH_LABELS_ALIGNED_TO_GRAPH = 'branchLabelsAlignedToGraph';
const CLASS_COMMIT_DETAILS_OPEN = 'commitDetailsOpen';
const CLASS_DISABLED = 'disabled';
const CLASS_ENABLED = 'enabled';
const CLASS_FETCH_SUPPORTED = 'fetchSupported';
const CLASS_FOCUSSED = 'focussed';
const CLASS_LOADING = 'loading';
const CLASS_PENDING_REVIEW = 'pendingReview';
const CLASS_REFRESHING = 'refreshing';
const CLASS_REF_HEAD = 'head';
const CLASS_REF_REMOTE = 'remote';
const CLASS_REF_STASH = 'stash';
const CLASS_REF_TAG = 'tag';
const CLASS_SELECTED = 'selected';
const CLASS_TAG_LABELS_RIGHT_ALIGNED = 'tagLabelsRightAligned';
const CLASS_TRANSITION = 'transition';

const ID_EVENT_CAPTURE_ELEM = 'eventCaptureElem';

const CSS_PROP_LIMIT_GRAPH_WIDTH = '--limitGraphWidth';

const ATTR_ERROR = 'data-error';


/* General Helpers */

/**
 * Are two arrays equal, such that corresponding elements at each index are equal according to the `equalElements` method.
 * @param a An array.
 * @param b An array.
 * @param equalElements A function used to determine if two elements, each at the same index of `a` & `b`, are equal.
 * @returns TRUE => The arrays are equal, FALSE => The arrays are not equal
 */
function arraysEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, equalElements: (a: T, b: T) => boolean) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!equalElements(a[i], b[i])) return false;
	}
	return true;
}

/**
 * Are two arrays equal, such that corresponding elements at each index are strictly equal.
 * @param a An array.
 * @param b An array.
 * @returns TRUE => The arrays are equal, FALSE => The arrays are not equal
 */
function arraysStrictlyEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Are two arrays equal, such that corresponding elements of each array are in strictly equal to an element in the other array (i.e. the order of elements doesn't matter).
 * @param a An array.
 * @param b An array.
 * @returns TRUE => The arrays are equal, FALSE => The arrays are not equal
 */
function arraysStrictlyEqualIgnoringOrder<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (b.indexOf(a[i]) === -1) return false;
	}
	return true;
}

/**
 * Pad a number with a leading zero, so it contains at least two digits.
 * @param i The number to pad.
 * @returns The padded number.
 */
function pad2(i: number) {
	return i > 9 ? i : '0' + i;
}

/**
 * Get a short name for a repository.
 * @param path The path of the repository.
 * @returns The short name.
 */
function getRepoName(path: string) {
	const firstSep = path.indexOf('/');
	if (firstSep === path.length - 1 || firstSep === -1) {
		return path; // Path has no slashes, or a single trailing slash ==> use the path
	} else {
		const p = path.endsWith('/') ? path.substring(0, path.length - 1) : path; // Remove trailing slash if it exists
		return p.substring(p.lastIndexOf('/') + 1);
	}
}

/**
 * Get a sorted list of repository paths from a given GitRepoSet.
 * @param repos The set of repositories.
 * @param order The order to sort the repositories.
 * @returns An array of ordered repository paths.
 */
function getSortedRepositoryPaths(repos: GG.GitRepoSet, order: GG.RepoDropdownOrder): ReadonlyArray<string> {
	const repoPaths = Object.keys(repos);
	if (order === GG.RepoDropdownOrder.WorkspaceFullPath) {
		return repoPaths.sort((a, b) => repos[a].workspaceFolderIndex === repos[b].workspaceFolderIndex
			? a.localeCompare(b)
			: repos[a].workspaceFolderIndex === null
				? 1
				: repos[b].workspaceFolderIndex === null
					? -1
					: repos[a].workspaceFolderIndex! - repos[b].workspaceFolderIndex!
		);
	} else if (order === GG.RepoDropdownOrder.FullPath) {
		return repoPaths.sort((a, b) => a.localeCompare(b));
	} else {
		return repoPaths.map((path) => ({ name: repos[path].name || getRepoName(path), path: path }))
			.sort((a, b) => a.name !== b.name ? a.name.localeCompare(b.name) : a.path.localeCompare(b.path))
			.map((x) => x.path);
	}
}


/* HTML Escape / Unescape */

/**
 * Escape HTML in the specified string.
 * @param str The string to escape.
 * @returns The escaped string.
 */
function escapeHtml(str: string) {
	return str.replace(HTML_ESCAPER_REGEX, (match) => HTML_ESCAPES[match]);
}

/**
 * Unescape HTML in the specified string.
 * @param str The string to unescape.
 * @returns The unescaped string.
 */
function unescapeHtml(str: string) {
	return str.replace(HTML_UNESCAPER_REGEX, (match) => HTML_UNESCAPES[match]);
}


/* Formatters */

/**
 * Format an array of strings as a comma separated list.
 * @param items The array of strings.
 * @returns A formatted comma separated string (e.g. "A, B & C").
 */
function formatCommaSeparatedList(items: string[]) {
	let str = '';
	for (let i = 0; i < items.length; i++) {
		str += (i > 0 ? (i < items.length - 1 ? ', ' : ' & ') : '') + items[i];
	}
	return str;
}

/**
 * Format a date (short).
 * @param unixTimestamp The unix timestamp of the date to format.
 * @returns The formatted date.
 */
function formatShortDate(unixTimestamp: number) {
	const date = new Date(unixTimestamp * 1000), format = initialState.config.dateFormat;
	let dateStr = format.iso
		? date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
		: date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
	let hourMinsStr = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
	let formatted;

	if (format.type === GG.DateFormatType.DateAndTime) {
		formatted = dateStr + ' ' + hourMinsStr;
	} else if (format.type === GG.DateFormatType.DateOnly) {
		formatted = dateStr;
	} else {
		let diff = Math.round((new Date()).getTime() / 1000) - unixTimestamp, unit;
		if (diff < 60) {
			unit = 'second';
		} else if (diff < 3600) {
			unit = 'minute';
			diff /= 60;
		} else if (diff < 86400) {
			unit = 'hour';
			diff /= 3600;
		} else if (diff < 604800) {
			unit = 'day';
			diff /= 86400;
		} else if (diff < 2629800) {
			unit = 'week';
			diff /= 604800;
		} else if (diff < 31557600) {
			unit = 'month';
			diff /= 2629800;
		} else {
			unit = 'year';
			diff /= 31557600;
		}
		diff = Math.round(diff);
		formatted = diff + ' ' + unit + (diff !== 1 ? 's' : '') + ' ago';
	}
	return {
		title: dateStr + ' ' + hourMinsStr + ':' + pad2(date.getSeconds()),
		formatted: formatted
	};
}

/**
 * Format a date (long).
 * @param unixTimestamp The unix timestamp of the date to format.
 * @returns The formatted date.
 */
function formatLongDate(unixTimestamp: number) {
	const date = new Date(unixTimestamp * 1000);
	if (initialState.config.dateFormat.iso) {
		let timezoneOffset = date.getTimezoneOffset();
		let absoluteTimezoneOffset = Math.abs(timezoneOffset);
		let timezone = timezoneOffset === 0 ? 'Z' : ' ' + (timezoneOffset < 0 ? '+' : '-') + pad2(Math.floor(absoluteTimezoneOffset / 60)) + pad2(absoluteTimezoneOffset % 60);
		return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()) + timezone;
	} else {
		return date.toString();
	}
}


/* DOM Helpers */

/**
 * Add an event listener to all elements with a class name.
 * @param className The class name used to identify the elements to add the event listener to.
 * @param event The event to listen for on each element.
 * @param eventListener The event listener to be called when the event occurs.
 */
function addListenerToClass(className: string, event: string, eventListener: EventListener) {
	addListenerToCollectionElems(document.getElementsByClassName(className), event, eventListener);
}

/**
 * Add an event listener to all elements in a collection of elements.
 * @param elems The collection of elements to add the event listener to.
 * @param event The event to listen for on each element.
 * @param eventListener The event listener to be called when the event occurs.
 */
function addListenerToCollectionElems(elems: HTMLCollectionOf<Element>, event: string, eventListener: EventListener) {
	for (let i = 0; i < elems.length; i++) {
		elems[i].addEventListener(event, eventListener);
	}
}

/**
 * Insert an HTML Element directly after a reference HTML Element (as a sibling).
 * @param newNode The HTML Element to insert.
 * @param referenceNode The reference HTML element that `newNode` should be inserted after.
 */
function insertAfter(newNode: HTMLElement, referenceNode: HTMLElement) {
	referenceNode.parentNode!.insertBefore(newNode, referenceNode.nextSibling);
}

/**
 * Insert an HTML Element directly before the first child element with a specified class name.
 * @param newChild The HTML Element to insert.
 * @param parent The parent element that the `newChild` should be inserted into as a child.
 * @param className The class name identifying the child that `newChild` should be inserted before.
 */
function insertBeforeFirstChildWithClass(newChild: HTMLElement, parent: HTMLElement, className: string) {
	let referenceNode: Node | null = null;
	for (let i = 0; i < parent.children.length; i++) {
		if (parent.children[i].classList.contains(className)) {
			referenceNode = parent.children[i];
			break;
		}
	}
	parent.insertBefore(newChild, referenceNode);
}

/**
 * Alter an HTML Element such that it contains, or doesn't contain the specified class name.
 * @param elem The HTML Element to alter.
 * @param className The class name.
 * @param state TRUE => Ensure the HTML Element has the class name, FALSE => Ensure the HTML Element doesn't have the class name
 * @returns TRUE => The HTML Element was altered, FALSE => No change was required.
 */
function alterClass(elem: HTMLElement, className: string, state: boolean) {
	if (elem.classList.contains(className) !== state) {
		if (state) {
			elem.classList.add(className);
		} else {
			elem.classList.remove(className);
		}
		return true;
	}
	return false;
}

/**
 * Alter each HTML Element in a collection of HTML Elements, such that it contains, or doesn't contain the specified class name.
 * @param elems The collection of HTML Elements.
 * @param className The class name.
 * @param state TRUE => Ensure all HTML Elements have the class name, FALSE => Ensure no HTML Elements have the class name
 */
function alterClassOfCollection(elems: HTMLCollectionOf<HTMLElement>, className: string, state: boolean) {
	const lockedElems = [];
	for (let i = 0; i < elems.length; i++) {
		lockedElems.push(elems[i]);
	}
	for (let i = 0; i < lockedElems.length; i++) {
		alterClass(lockedElems[i], className, state);
	}
}

/**
 * Recursively get all of the child nodes of a node that have text content.
 * @param elem The node to recursively traverse.
 * @returns An array of all child nodes that have text content.
 */
function getChildNodesWithTextContent(elem: Node) {
	let textChildren: Node[] = [];
	for (let i = 0; i < elem.childNodes.length; i++) {
		if (elem.childNodes[i].childNodes.length > 0) {
			textChildren.push(...getChildNodesWithTextContent(elem.childNodes[i]));
		} else if (elem.childNodes[i].textContent !== null && elem.childNodes[i].textContent !== '') {
			textChildren.push(elem.childNodes[i]);
		}
	}
	return textChildren;
}

/**
 * Recursively get all of the child elements of an element that have the specified class name.
 * @param elem The element to recursively traverse.
 * @param className The class name to find.
 * @returns An array of all child elements that have the specified class name.
 */
function getChildrenWithClassName(elem: Element, className: string) {
	let children: Element[] = [];
	for (let i = 0; i < elem.children.length; i++) {
		if (elem.children[i].children.length > 0) {
			children.push(...getChildrenWithClassName(elem.children[i], className));
		} else if (elem.children[i].className === className) {
			children.push(elem.children[i]);
		}
	}
	return children;
}

/**
 * Get the first child of an HTML Element that is a \<ul\>.
 * @param elem The parent HTML Element.
 * @returns The HTML Element, or NULL if no child is a \<ul\>.
 */
function getChildUl(elem: HTMLElement) {
	for (let i = 0; i < elem.children.length; i++) {
		if (elem.children[i].tagName === 'UL') {
			return <HTMLUListElement>elem.children[i];
		}
	}
	return null;
}

/**
 * Initialise scrollTop, and observe scroll events for an HTML Element. Invoke callbacks when the element has been scrolled, and when scrollTop should be saved.
 * @param id The ID identifying the HTML Element.
 * @param initialScrollTop The value used to initialise scrollTop.
 * @param onScroll A callback to be invoked when the element has been scrolled.
 * @param onScrolled A callback to be invoked when scrollTop should be saved.
 */
function observeElemScroll(id: string, initialScrollTop: number, onScroll: (scrollTop: number) => void, onScrolled: () => void) {
	const elem = document.getElementById(id);
	if (elem === null) return;

	let timeout: NodeJS.Timer | null = null;
	elem.scroll(0, initialScrollTop);
	elem.addEventListener('scroll', () => {
		const elem = document.getElementById(id);
		if (elem === null) return;

		onScroll(elem.scrollTop);

		if (timeout !== null) clearTimeout(timeout);
		timeout = setTimeout(() => {
			onScrolled();
			timeout = null;
		}, 250);
	});
}

/**
 * Get all of the rendered commit HTML Elements.
 * @returns A collection of all commit HTML Elements.
 */
function getCommitElems() {
	return <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName('commit');
}

/**
 * Register that an event has been handled, to prevent the default behaviour from occurring, and any further handling of the event.
 * @param event The event.
 */
function handledEvent(event: Event) {
	event.preventDefault();
	event.stopPropagation();
}


/* State Helpers */

/**
 * Update a key-value pair in the Global View State.
 * @param key The key identifying the value to update.
 * @param value The new value.
 */
function updateGlobalViewState<K extends keyof GG.GitGraphViewGlobalState>(key: K, value: GG.GitGraphViewGlobalState[K]) {
	(<GG.DeepWriteable<GG.GitGraphViewGlobalState>>globalState)[key] = value;
	sendMessage({ command: 'setGlobalViewState', state: globalState });
}

/**
 * Update a key-value pair in the Workspace View State.
 * @param key The key identifying the value to update.
 * @param value The new value.
 */
function updateWorkspaceViewState<K extends keyof GG.GitGraphViewWorkspaceState>(key: K, value: GG.GitGraphViewWorkspaceState[K]) {
	(<GG.DeepWriteable<GG.GitGraphViewWorkspaceState>>workspaceState)[key] = value;
	sendMessage({ command: 'setWorkspaceViewState', state: workspaceState });
}


/* Host Helpers */

/**
 * Send a message to the app's main process (typically to request data, or perform an action).
 * @param msg The message to send.
 */
function sendMessage(msg: GG.RequestMessage) {
	HOST_API.postMessage(msg);
}

/**
 * Show a Error Message.
 * @param message The message to display.
 */
function showErrorMessage(message: string) {
	sendMessage({ command: 'showErrorMessage', message: message });
}


/**
 * Resizes images for the view (e.g. commit author avatars).
 */
class ImageResizer {
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;

	/**
	 * Resize an image to have an effective resolution of 18px x 18px. The actual resolution varies depending of the user's screen pixel ratio.
	 * @param dataUri The data URI containing the image data.
	 * @param callback A callback to be invoked once the image has been resized, with the resized image.
	 */
	public resize(dataUri: string, callback: (dataUri: string) => void) {
		if (this.canvas === null) this.canvas = document.createElement('canvas');
		if (this.context === null) this.context = this.canvas.getContext('2d');
		if (this.context === null) {
			callback(dataUri);
			return;
		}

		let image = new Image();
		image.onload = () => {
			let outputDataUri = '';
			if (this.canvas === null || this.context === null) {
				outputDataUri = dataUri;
			} else {
				let size = Math.ceil(18 * window.devicePixelRatio);
				if (this.canvas.width !== size) this.canvas.width = size;
				if (this.canvas.height !== size) this.canvas.height = size;
				this.context.clearRect(0, 0, size, size);
				this.context.drawImage(image, 0, 0, size, size);
				outputDataUri = this.canvas.toDataURL();
			}
			callback(outputDataUri);
		};
		image.src = dataUri;
	}
}


/**
 * Implements an Event Overlay, which is used for blocking and/or capturing mouse events in the view.
 */
class EventOverlay {
	private move: EventListener | null = null;
	private stop: EventListener | null = null;

	/**
	 * Create an event overlay.
	 * @param className The class name to be used for the event overlay.
	 * @param move A callback to be invoked if the user moves the mouse over the event overlay.
	 * @param stop A callback to be invoked if the user moves the mouse off the event overlay.
	 */
	public create(className: string, move: EventListener | null, stop: EventListener | null) {
		if (document.getElementById(ID_EVENT_CAPTURE_ELEM) !== null) this.remove();

		const eventOverlayElem = document.createElement('div');
		eventOverlayElem.id = ID_EVENT_CAPTURE_ELEM;
		eventOverlayElem.className = className;

		this.move = move;
		this.stop = stop;
		if (this.move !== null) {
			eventOverlayElem.addEventListener('mousemove', this.move);
		}
		if (this.stop !== null) {
			eventOverlayElem.addEventListener('mouseup', this.stop);
			eventOverlayElem.addEventListener('mouseleave', this.stop);
		}

		if (contextMenu.isOpen()) {
			contextMenu.close();
		}

		document.body.appendChild(eventOverlayElem);
	}

	/**
	 * Remove the event overlay that is currently active in the view.
	 */
	public remove() {
		let eventOverlayElem = document.getElementById(ID_EVENT_CAPTURE_ELEM);
		if (eventOverlayElem === null) return;

		if (this.move !== null) {
			eventOverlayElem.removeEventListener('mousemove', this.move);
			this.move = null;
		}
		if (this.stop !== null) {
			eventOverlayElem.removeEventListener('mouseup', this.stop);
			eventOverlayElem.removeEventListener('mouseleave', this.stop);
			this.stop = null;
		}

		document.body.removeChild(eventOverlayElem);
	}
}
