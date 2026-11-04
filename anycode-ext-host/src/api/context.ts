import * as fs from 'fs';
import * as path from 'path';
import { Disposable, EventEmitter, Uri } from './types';

export interface Memento {
  keys(): readonly string[];
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: any): Thenable<void>;
}

export class SimpleMemento implements Memento {
  private _storage: Record<string, any> = {};

  constructor(private _filePath?: string) {
    if (this._filePath && fs.existsSync(this._filePath)) {
      try {
        this._storage = JSON.parse(fs.readFileSync(this._filePath, 'utf-8'));
      } catch {}
    }
  }

  keys(): readonly string[] {
    return Object.keys(this._storage);
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this._storage[key] !== undefined ? this._storage[key] : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      delete this._storage[key];
    } else {
      this._storage[key] = value;
    }
    if (this._filePath) {
      try {
        fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
        fs.writeFileSync(this._filePath, JSON.stringify(this._storage, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to save memento:', err);
      }
    }
  }
}

export class SimpleSecretStorage {
  private _secrets = new Map<string, string>();
  private _onDidChangeEmitter = new EventEmitter<{ key: string }>();
  readonly onDidChange = this._onDidChangeEmitter.event;

  async get(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this._secrets.set(key, value);
    this._onDidChangeEmitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this._secrets.delete(key);
    this._onDidChangeEmitter.fire({ key });
  }
}

export interface Extension<T> {
  readonly id: string;
  readonly extensionUri: Uri;
  readonly extensionPath: string;
  readonly isActive: boolean;
  readonly packageJSON: any;
  readonly extensionKind: number;
  readonly exports: T;
  activate(): Thenable<T>;
}

export class ExtHostExtensionContext {
  readonly subscriptions: Disposable[] = [];
  readonly workspaceState: Memento;
  readonly globalState: Memento & { setKeysForSync(keys: readonly string[]): void };
  readonly secrets: SimpleSecretStorage;
  readonly extensionUri: Uri;
  readonly extensionPath: string;
  readonly storageUri: Uri;
  readonly globalStorageUri: Uri;
  readonly logUri: Uri;
  readonly storagePath: string;
  readonly globalStoragePath: string;
  readonly logPath: string;
  readonly extensionMode = 1; // 1 = Production, 2 = Development, 3 = Test
  readonly extension: Extension<any>;
  readonly environmentVariableCollection: any;

  constructor(
    readonly extensionId: string,
    extensionPath: string,
    storageDir: string
  ) {
    this.extensionPath = extensionPath;
    this.extensionUri = Uri.file(extensionPath);

    const extStoragePath = path.join(storageDir, extensionId);
    fs.mkdirSync(extStoragePath, { recursive: true });

    this.storageUri = Uri.file(extStoragePath);
    this.globalStorageUri = Uri.file(extStoragePath);
    this.storagePath = extStoragePath;
    this.globalStoragePath = extStoragePath;
    this.logPath = path.join(extStoragePath, 'logs');
    this.logUri = Uri.file(this.logPath);

    this.workspaceState = new SimpleMemento(path.join(extStoragePath, 'workspace-state.json'));
    const gm = new SimpleMemento(path.join(extStoragePath, 'global-state.json'));
    this.globalState = Object.assign(gm, {
      setKeysForSync: () => {},
    });
    this.secrets = new SimpleSecretStorage();

    let packageJSON: any = {};
    try {
      const pkgPath = path.join(extensionPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        packageJSON = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      }
    } catch {}

    this.extension = {
      id: extensionId,
      extensionUri: this.extensionUri,
      extensionPath: this.extensionPath,
      isActive: true,
      packageJSON,
      extensionKind: 1,
      exports: undefined,
      activate: () => Promise.resolve(undefined),
    };

    this.environmentVariableCollection = {
      persistent: true,
      description: '',
      replace: () => {},
      append: () => {},
      prepend: () => {},
      get: () => undefined,
      forEach: () => {},
      clear: () => {},
      delete: () => {},
      [Symbol.iterator]: function* () {},
    };
  }

  asAbsolutePath(relativePath: string): string {
    return path.join(this.extensionPath, relativePath);
  }
}
