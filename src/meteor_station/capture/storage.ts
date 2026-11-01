/** On-device capture storage. Each chunk and its byte counters commit atomically. */
import type { CaptureRecord } from './model';

export type ChunkKind = 'raw' | 'frames' | 'image';
export interface CaptureChunk {
  sessionId: string;
  kind: ChunkKind;
  index: number;
  data: ArrayBuffer;
}
export interface CaptureStore {
  save(record: CaptureRecord, chunk?: CaptureChunk): Promise<void>;
  list(): Promise<CaptureRecord[]>;
  get(id: string): Promise<CaptureRecord | undefined>;
  chunk(id: string, kind: ChunkKind, index: number): Promise<ArrayBuffer>;
  remove(id: string): Promise<void>;
}

export class BrowserCaptureStore implements CaptureStore {
  private connection: Promise<IDBDatabase> | null = null;
  public constructor(private readonly name = 'meteor.captures.v1') {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Local recording storage is unavailable. Use the hosted station in Chrome or Edge.'));
        return;
      }
      const request = indexedDB.open(this.name, 1);
      let abandoned = false;
      const timeout = setTimeout(() => {
        abandoned = true;
        reject(new Error('Local recording storage did not open. Close other station tabs and try again.'));
      }, 10000);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        const chunks = db.createObjectStore('chunks', { keyPath: ['sessionId', 'kind', 'index'] });
        chunks.createIndex('sessionId', 'sessionId');
      };
      request.onerror = () => { clearTimeout(timeout); reject(request.error); };
      request.onsuccess = () => {
        clearTimeout(timeout);
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.connection = null; };
        resolve(db);
      };
    }).catch((error: unknown) => { this.connection = null; throw error; });
    return this.connection;
  }

  public async save(record: CaptureRecord, chunk?: CaptureChunk): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Could not save the recording.'));
      tx.onerror = () => { /* onabort carries the transaction outcome. */ };
      tx.objectStore('sessions').put(record);
      if (chunk) tx.objectStore('chunks').put(chunk);
    });
  }

  private async read<T>(store: string, key?: IDBValidKey): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const table = tx.objectStore(store);
      const request = key === undefined ? table.getAll() : table.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as T);
    });
  }
  public async list(): Promise<CaptureRecord[]> {
    const records = await this.read<CaptureRecord[]>('sessions');
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  public get(id: string): Promise<CaptureRecord | undefined> {
    return this.read<CaptureRecord | undefined>('sessions', id);
  }
  public async chunk(id: string, kind: ChunkKind, index: number): Promise<ArrayBuffer> {
    const result = await this.read<CaptureChunk | undefined>('chunks', [id, kind, index]);
    if (!result) throw new Error(`Recording chunk ${kind}/${index} is missing. The export was not completed.`);
    return result.data;
  }
  public async remove(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Could not remove the recording.'));
      tx.objectStore('sessions').delete(id);
      const cursor = tx.objectStore('chunks').index('sessionId').openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        const value = cursor.result;
        if (value) { value.delete(); value.continue(); }
      };
    });
  }
}
