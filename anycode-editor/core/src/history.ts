export default class History<T> {
    private index = 0;
    private items: T[] = [];
    private readonly maxItems: number;

    constructor(maxItems: number = 10000) {
        this.maxItems = maxItems;
    }

    private ensureValid(): void {
        if (!Array.isArray(this.items)) {
            this.items = [];
        }
        if (typeof this.index !== 'number' || isNaN(this.index) || this.index < 0) {
            this.index = 0;
        }
    }

    push(item: T): void {
        this.ensureValid();

        while (this.items.length > this.index) {
            this.items.pop();
        }

        if (this.items.length === this.maxItems) {
            this.items.shift();
            if (this.index > 0) this.index--;
        }

        this.items.push(item);
        this.index++;
    }

    undo(): T | undefined {
        this.ensureValid();
        if (this.index === 0) return undefined;
        this.index--;
        return this.items[this.index];
    }

    redo(): T | undefined {
        this.ensureValid();
        if (this.index >= this.items.length) return undefined;
        const item = this.items[this.index];
        this.index++;
        return item;
    }

    current(): T | undefined {
        this.ensureValid();
        return this.items[this.index - 1];
    }

    canUndo(): boolean {
        this.ensureValid();
        return this.index > 0;
    }

    canRedo(): boolean {
        this.ensureValid();
        return this.index < this.items.length;
    }

    size(): number {
        this.ensureValid();
        return this.items.length;
    }

    clear(): void {
        this.items = [];
        this.index = 0;
    }

    setRawHistory(items: T[], index: number): void {
        this.items = Array.isArray(items) ? items : [];
        this.index = typeof index === 'number' && !isNaN(index) && index >= 0 ? index : 0;
    }
}