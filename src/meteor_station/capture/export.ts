/** Export a measured session even when decoding recovered no image or no frames. */
import { captureOutcome, rawFilename, type CaptureRecord } from './model';
import type { CaptureStore, ChunkKind } from './storage';
import { CaptureZip, singleChunk } from './zip';

export interface ArchiveSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export function captureMetadata(record: CaptureRecord, includeRaw: boolean): object {
  return {
    schemaVersion: 2,
    application: 'Meteor Station',
    source: record.origin === 'live' ? 'rtl-sdr-webusb'
      : record.origin === 'sample' ? 'bundled-sample-replay'
        : record.input.mode === 'replay' ? 'imported-cadu-file' : 'imported-iq-file',
    receivedAt: record.origin === 'live' ? record.startedAt : null,
    processedAt: record.startedAt,
    receiver: record.origin === 'live' ? record.input : null,
    outcome: captureOutcome(record),
    session: record,
    rawRecording: {
      included: includeRaw && record.rawBytes > 0,
      format: 'cu8: interleaved unsigned 8-bit I,Q; two bytes per complex sample',
      storedBytes: record.rawBytes,
      observedSampleBytes: record.samplesReceived * 2,
      files: includeRaw ? record.rawRuns.map((run) => ({
        path: rawFilename(run), frequencyHz: run.frequencyHz,
        sampleRate: run.sampleRate, bytes: run.bytes,
        firstSampleAt: run.firstSampleAt, lastSampleAt: run.lastSampleAt,
      })) : [],
      note: record.origin === 'live'
        ? 'Each tuning interval is a separate raw file; gaps between intervals must not be treated as continuous radio time.'
        : 'Imported source files and the bundled sample are not copied into raw browser storage.',
    },
    image: record.image ? { ...record.image, included: record.imageStored } : null,
    frames: { storedCount: record.frameBytes / 1024, decodedCount: record.framesDecoded },
    note: 'Spectrum power is not evidence of a Meteor signal. A planned satellite is not an identification of the transmitter. Browser storage is local to this site and browser; export to keep a separate copy.',
  };
}

async function* storedChunks(
  store: CaptureStore, id: string, kind: ChunkKind, first: number, last: number,
  expectedBytes: number,
): AsyncIterable<Uint8Array> {
  let total = 0;
  for (let index = first; index <= last; index++) {
    const bytes = new Uint8Array(await store.chunk(id, kind, index));
    total += bytes.length;
    yield bytes;
  }
  if (total !== expectedBytes) throw new Error(`The ${kind} recording is incomplete; export cancelled.`);
}

/** No archive-sized array: raw data is fetched one committed chunk at a time. */
export async function writeCaptureArchive(
  store: CaptureStore, record: CaptureRecord, includeRaw: boolean, sink: ArchiveSink,
  imageOverride?: ArrayBuffer,
): Promise<void> {
  if (imageOverride) record = { ...record, imageStored: true };
  const zip = new CaptureZip((data) => sink.write(data));
  const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value, null, 2));
  try {
    await zip.add('metadata.json', singleChunk(json(captureMetadata(record, includeRaw))));
    await zip.add('capture-log.json', singleChunk(json(record.timeline)));
    if (record.frameBytes > 0) await zip.add('received.cadu', storedChunks(
      store, record.id, 'frames', 0, record.frameChunks - 1, record.frameBytes,
    ));
    if (record.imageStored) await zip.add('weather-image.png', singleChunk(
      new Uint8Array(imageOverride ?? await store.chunk(record.id, 'image', 0)),
    ));
    if (includeRaw) for (const run of record.rawRuns) {
      await zip.add(rawFilename(run), storedChunks(
        store, record.id, 'raw', run.firstChunk, run.lastChunk, run.bytes,
      ));
    }
    await zip.finish();
    await sink.close();
  } catch (error) {
    await sink.abort().catch(() => {});
    throw error;
  }
}

/** Invoke on the click stack before awaiting storage so the picker has activation. */
export async function chooseArchiveSink(name: string, expectedBytes: number): Promise<ArchiveSink> {
  const host = globalThis as typeof globalThis & {
    showSaveFilePicker?: (options: unknown) => Promise<{
      createWritable(): Promise<{
        write(data: Uint8Array): Promise<void>;
        close(): Promise<void>;
        abort(): Promise<void>;
      }>;
    }>;
  };
  if (host.showSaveFilePicker) {
    const file = await host.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: 'Meteor session archive', accept: { 'application/zip': ['.zip'] } }],
    });
    return file.createWritable();
  }
  // Normal download fallback is bounded; never buffer a whole long pass in RAM.
  const limit = 128 * 1024 * 1024;
  if (expectedBytes > limit)
    throw new Error('This browser cannot stream a large export to disk. Open this same station in desktop Chrome or Edge before recording, or export the report without raw samples. Your existing recording remains in this browser.');
  let size = 0;
  const parts: BlobPart[] = [];
  return {
    async write(data) {
      size += data.byteLength;
      if (size > limit) throw new Error('Download exceeds this browser’s 128 MiB export limit. Export without raw samples.');
      parts.push(new Uint8Array(data));
    },
    async close() {
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      parts.length = 0;
    },
    async abort() { parts.length = 0; },
  };
}
