/** Bounded asynchronous recording. Never retain an entire pass in page memory. */
import { createCapture, type CaptureInput, type CaptureOrigin, type CaptureRecord } from './model';
import type { CaptureStore } from './storage';

export const MAX_CAPTURE_BYTES = 768 * 1024 * 1024;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class CaptureJournal {
  public readonly record: CaptureRecord;
  private pending = 0;
  private queue: Promise<void>;
  private sealed = false;
  private receivedBytes = 0;
  private rawIndex = 0;
  private frameIndex = 0;
  private telemetryAt = -Infinity;
  private finalizing: Promise<CaptureRecord> | null = null;

  public constructor(
    private readonly store: CaptureStore,
    input: CaptureInput,
    origin: CaptureOrigin,
    context: unknown,
    private readonly onStorageFailure: (message: string) => void,
    inputName: string | null = null,
  ) {
    this.record = createCapture(input, origin, context, inputName);
    this.queue = store.save(structuredClone(this.record)).catch((error: unknown) => this.fail(error));
  }

  public get finished(): boolean { return this.sealed; }
  public get queuedBytes(): number { return this.pending; }
  public ready(): Promise<void> { return this.queue; }

  public log(event: string, detail: string): void {
    const now = new Date().toISOString();
    this.record.updatedAt = now;
    // Twenty minutes of 1 Hz telemetry plus lifecycle events stays below this cap.
    if (this.record.timeline.length < 1500)
      this.record.timeline.push({ at: now, event, detail });
  }
  public error(message: string): void {
    if (!this.record.errors.includes(message)) this.record.errors.push(message);
    this.log('error', message);
  }
  private fail(error: unknown): void {
    if (this.record.storageError) return;
    const message = `Recording storage failed: ${messageOf(error)}. Reception has been stopped; only committed chunks are retained.`;
    this.record.storageError = message;
    this.error(message);
    this.onStorageFailure(message);
  }
  private enqueue(bytes: number, operation: () => Promise<void>): void {
    if (this.sealed) throw new Error('This recording has already ended.');
    if (this.record.storageError) throw new Error(this.record.storageError);
    if (this.pending + bytes > MAX_PENDING_BYTES) {
      const message = 'Recording storage cannot keep up. Reception stopped rather than silently dropping radio data.';
      this.fail(new Error(message));
      throw new Error(message);
    }
    this.pending += bytes;
    this.queue = this.queue.then(async () => {
      try {
        if (!this.record.storageError) await operation();
      } catch (error) { this.fail(error); }
      finally { this.pending -= bytes; }
    });
  }

  /** Called synchronously before the USB buffer is transferred to the decoder. */
  public raw(data: ArrayBuffer, input: CaptureInput): void {
    if (this.record.origin !== 'live') return;
    const length = data.byteLength;
    if (!length || length % 2) throw new Error('Incomplete raw I/Q sample block.');
    this.record.samplesReceived += length / 2;
    this.record.lastSampleAt = new Date().toISOString();
    if (this.receivedBytes + length > MAX_CAPTURE_BYTES) {
      const message = 'The 768 MiB raw recording limit was reached. The captured part is available to export.';
      this.error(message);
      throw new Error(message);
    }
    this.receivedBytes += length;
    // Own the bytes before WorkerSession.send() detaches the original ArrayBuffer.
    const owned = data.slice(0);
    const index = this.rawIndex++;
    const receivedAt = this.record.lastSampleAt!;
    const frequency = input.frequency;
    const rate = input.sampleRate;
    this.enqueue(length, async () => {
      const next = structuredClone(this.record);
      next.rawBytes += length;
      next.rawChunks = index + 1;
      let run = next.rawRuns.at(-1);
      if (!run || run.frequencyHz !== frequency || run.sampleRate !== rate) {
        run = { index: next.rawRuns.length, frequencyHz: frequency, sampleRate: rate,
          firstSampleAt: receivedAt, lastSampleAt: receivedAt,
          firstChunk: index, lastChunk: index, bytes: 0 };
        next.rawRuns.push(run);
      }
      run.bytes += length;
      run.lastChunk = index;
      run.lastSampleAt = receivedAt;
      await this.store.save(next, { sessionId: next.id, kind: 'raw', index, data: owned });
      this.record.rawBytes = next.rawBytes;
      this.record.rawChunks = next.rawChunks;
      this.record.rawRuns = next.rawRuns;
    });
  }

  public frames(data: ArrayBuffer): void {
    if (!data.byteLength) return;
    const owned = data.slice(0);
    const index = this.frameIndex++;
    this.enqueue(owned.byteLength, async () => {
      const next = structuredClone(this.record);
      next.frameBytes += owned.byteLength;
      next.frameChunks = index + 1;
      await this.store.save(next, { sessionId: next.id, kind: 'frames', index, data: owned });
      this.record.frameBytes = next.frameBytes;
      this.record.frameChunks = next.frameChunks;
    });
  }

  public metrics(values: {
    samples: number; frames: number; segments: number; gaps: number;
    rms: number; clippedFraction: number;
  }): void {
    if (this.sealed) return;
    this.record.samplesProcessed += values.samples;
    if (this.record.origin !== 'live' && values.samples > 0)
      this.record.lastSampleAt = new Date().toISOString();
    if (values.frames > this.record.framesDecoded)
      this.record.lastFrameAt = new Date().toISOString();
    this.record.framesDecoded = Math.max(this.record.framesDecoded, values.frames);
    this.record.imageSegments = Math.max(this.record.imageSegments, values.segments);
    this.record.frameGaps = Math.max(this.record.frameGaps, values.gaps);
    if (values.samples > 0) {
      const db = 20 * Math.log10(Math.max(1e-6, values.rms));
      this.record.inputPowerDbfs = db;
      this.record.peakInputPowerDbfs = Math.max(this.record.peakInputPowerDbfs ?? -Infinity, db);
      this.record.clippedSamples += values.samples * values.clippedFraction;
    }
    if (Date.now() - this.telemetryAt >= 1000) {
      this.telemetryAt = Date.now();
      this.log('measurement', `${this.record.samplesProcessed} processed samples; ${this.record.framesDecoded} decoded frames; ${this.record.imageSegments} image segments; ${this.record.inputPowerDbfs?.toFixed(1) ?? 'unavailable'} dBFS`);
    }
  }

  /** Finalize only after every queued write; even zero-byte sessions get a report. */
  public finish(reason: string, image?: ArrayBuffer): Promise<CaptureRecord> {
    if (this.finalizing) return this.finalizing;
    this.finalizing = this.finalize(reason, image);
    return this.finalizing;
  }
  private async finalize(reason: string, image?: ArrayBuffer): Promise<CaptureRecord> {
    this.sealed = true;
    this.record.endedAt = new Date().toISOString();
    this.record.stopReason = reason;
    this.log('stopped', reason);
    await this.queue;
    this.record.state = this.record.errors.length ? 'error' : 'complete';
    try {
      if (image) {
        const next = { ...this.record, imageStored: true };
        await this.store.save(next, { sessionId: next.id, kind: 'image', index: 0, data: image });
        this.record.imageStored = true;
      }
      await this.store.save(structuredClone(this.record));
    } catch (error) { this.fail(error); this.record.state = 'error'; }
    return this.record;
  }
}

/** Small decoded-frame archives may be loaded to reconstruct another image channel. */
export async function readCaptureFrames(store: CaptureStore, record: CaptureRecord): Promise<ArrayBuffer> {
  if (record.frameBytes > 16 * 1024 * 1024) throw new Error('Frame archive exceeds the supported 16 MiB limit.');
  const bytes = new Uint8Array(record.frameBytes);
  let offset = 0;
  for (let index = 0; index < record.frameChunks; index++) {
    const data = new Uint8Array(await store.chunk(record.id, 'frames', index));
    bytes.set(data, offset);
    offset += data.length;
  }
  if (offset !== bytes.length) throw new Error('The saved frame archive is incomplete.');
  return bytes.buffer;
}
