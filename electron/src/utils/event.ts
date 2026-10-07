import { IDisposable } from './disposable';

/** Minimal typed event emitter. */

type EventListener<T> = (event: T) => void;

export type Event<T> = (listener: EventListener<T>) => IDisposable;

/**
 * Represents an EventEmitter, which is used to automate the delivery of events to subscribers. This applies the observer pattern.
 */
export class EventEmitter<T> implements IDisposable {
	private readonly event: Event<T>;
	private listeners: EventListener<T>[] = [];

	constructor() {
		this.event = (listener: EventListener<T>) => {
			this.listeners.push(listener);
			return {
				dispose: () => {
					const removeListener = this.listeners.indexOf(listener);
					if (removeListener > -1) {
						this.listeners.splice(removeListener, 1);
					}
				}
			};
		};
	}

	public dispose() {
		this.listeners = [];
	}

	public emit(event: T) {
		this.listeners.forEach((listener) => {
			try {
				listener(event);
			} catch (_) { }
		});
	}

	public hasSubscribers() {
		return this.listeners.length > 0;
	}

	get subscribe() {
		return this.event;
	}
}
