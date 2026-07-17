/** Ported from src/utils/disposable.ts, with `vscode.Disposable` replaced by a local plain interface. */
export interface IDisposable {
	dispose(): void;
}

export class Disposable implements IDisposable {
	private disposables: IDisposable[] = [];
	private disposed: boolean = false;

	/**
	 * Disposes the resources used by the subclass.
	 */
	public dispose() {
		this.disposed = true;
		this.disposables.forEach((disposable) => {
			try {
				disposable.dispose();
			} catch (_) { }
		});
		this.disposables = [];
	}

	/**
	 * Register a single disposable.
	 */
	protected registerDisposable(disposable: IDisposable) {
		this.disposables.push(disposable);
	}

	/**
	 * Register multiple disposables.
	 */
	protected registerDisposables(...disposables: IDisposable[]) {
		this.disposables.push(...disposables);
	}

	/**
	 * Is the Disposable disposed.
	 * @returns `TRUE` => Disposable has been disposed, `FALSE` => Disposable hasn't been disposed.
	 */
	protected isDisposed() {
		return this.disposed;
	}
}

export function toDisposable(fn: () => void): IDisposable {
	return {
		dispose: fn
	};
}
