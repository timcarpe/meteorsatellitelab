/** Worker lifecycle and acknowledgements; bound in-flight buffers before transfer. */
import SignalWorker from '@meteor/decoder/decoder.worker?worker&inline';
import type { Mode, WorkerRequest, WorkerResponse } from '@meteor/decoder/protocol';
import { StationError } from '@meteor/core/errors';

export class WorkerSession {
  private readonly worker = new SignalWorker();
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: () => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readyResolve!: () => void;
  private readyReject!: (reason: Error) => void;
  private doneResolve?: (frames: ArrayBuffer) => void;
  private doneReject?: (reason: Error) => void;
  private readonly ready: Promise<void>;

  public constructor(private readonly onEvent: (event: WorkerResponse) => void) {
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') this.readyResolve();
      if (message.type === 'ack') {
        const item = this.pending.get(message.id);
        if (item) {
          clearTimeout(item.timer);
          item.resolve();
          this.pending.delete(message.id);
        }
      }
      if (message.type === 'done') this.doneResolve?.(message.frames);
      if (message.type === 'error') this.fail(new StationError(message.message));
      this.onEvent(message);
    };
    this.worker.onerror = (event) =>
      this.fail(
        new StationError(event.message || 'The decoder worker stopped unexpectedly.'),
      );
  }
  public async start(mode: Mode, sampleRate: number): Promise<void> {
    const timer = setTimeout(
      () =>
        this.fail(
          new StationError('The decoder took too long to start. Reload this page.'),
        ),
      20000,
    );
    this.post({ type: 'init', mode, sampleRate });
    try {
      await this.ready;
    } finally {
      clearTimeout(timer);
    }
  }
  public get queued(): number {
    return this.pending.size;
  }

  public send(data: ArrayBuffer): Promise<void> {
    if (this.closed)
      return Promise.reject(new StationError('This decoder session has closed.'));
    if (this.pending.size >= 4) {
      return Promise.reject(
        new StationError(
          'This computer cannot keep up with reception. Close other apps and try again; the partial image can still be saved.',
        ),
      );
    }
    const id = this.nextId++;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new StationError('The decoder stopped responding.'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.post({ type: 'samples', id, data }, [data]);
    return promise;
  }
  public channel(channel: number): void {
    this.post({ type: 'channel', channel });
  }
  public async finish(): Promise<ArrayBuffer> {
    if (this.closed) return new ArrayBuffer(0);
    const result = new Promise<ArrayBuffer>((resolve, reject) => {
      this.doneResolve = resolve;
      this.doneReject = reject;
    });
    const timer = setTimeout(
      () =>
        this.doneReject?.(new StationError('Could not finish saving this reception.')),
      12000,
    );
    this.post({ type: 'finish' });
    try {
      return await result;
    } finally {
      clearTimeout(timer);
      this.close();
    }
  }
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyReject(new StationError('Reception ended before decoder startup.'));
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new StationError('Reception ended.'));
    }
    this.pending.clear();
    this.worker.terminate();
  }
  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    if (this.closed) throw new StationError('This decoder session has closed.');
    this.worker.postMessage(message, transfer);
  }
  private fail(error: Error): void {
    this.readyReject(error);
    this.doneReject?.(error);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
}
