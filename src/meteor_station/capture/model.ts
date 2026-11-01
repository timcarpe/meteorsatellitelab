/** Capture provenance and measured outcomes. Radio power is not satellite identity. */
export type CaptureOrigin = 'live' | 'imported' | 'sample';
export type CaptureState = 'recording' | 'complete' | 'error';
export interface CaptureInput {
  mode: 'meteor' | 'fm' | 'replay' | 'iq-file';
  sampleRate: number;
  frequency: number;
  startedAt: string;
}
export interface RawRun {
  index: number;
  frequencyHz: number;
  sampleRate: number;
  firstSampleAt: string;
  lastSampleAt: string;
  firstChunk: number;
  lastChunk: number;
  bytes: number;
}
export interface CaptureRecord {
  schemaVersion: 2;
  id: string;
  origin: CaptureOrigin;
  input: CaptureInput;
  inputName: string | null;
  context: unknown;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  state: CaptureState;
  stopReason: string | null;
  samplesReceived: number;
  samplesProcessed: number;
  rawBytes: number;
  rawChunks: number;
  frameBytes: number;
  frameChunks: number;
  framesDecoded: number;
  imageSegments: number;
  frameGaps: number;
  lastSampleAt: string | null;
  lastFrameAt: string | null;
  inputPowerDbfs: number | null;
  peakInputPowerDbfs: number | null;
  clippedSamples: number;
  rawRuns: RawRun[];
  image: { width: number; height: number; channel: number; channels: number[] } | null;
  imageStored: boolean;
  errors: string[];
  storageError: string | null;
  timeline: { at: string; event: string; detail: string }[];
}

export function createCapture(
  input: CaptureInput,
  origin: CaptureOrigin,
  context: unknown,
  inputName: string | null = null,
): CaptureRecord {
  const startedAt = input.startedAt || new Date().toISOString();
  return {
    schemaVersion: 2, id: crypto.randomUUID(), origin,
    input: { ...input }, inputName, context, startedAt, updatedAt: startedAt,
    endedAt: null, state: 'recording', stopReason: null,
    samplesReceived: 0, samplesProcessed: 0, rawBytes: 0, rawChunks: 0,
    frameBytes: 0, frameChunks: 0, framesDecoded: 0, imageSegments: 0,
    frameGaps: 0, lastSampleAt: null, lastFrameAt: null,
    inputPowerDbfs: null, peakInputPowerDbfs: null, clippedSamples: 0,
    rawRuns: [], image: null, imageStored: false, errors: [], storageError: null,
    timeline: [{ at: startedAt, event: 'started', detail: origin }],
  };
}

export function originLabel(origin: CaptureOrigin): string {
  return origin === 'live' ? 'Live antenna capture'
    : origin === 'sample' ? 'Sample replay — not your reception' : 'Imported recording';
}

/** A completed attempt can have useful raw data without any decoded frames. */
export function captureOutcome(record: CaptureRecord): string {
  if (record.image) return 'image-recovered';
  if (record.imageSegments > 0) return 'image-packets-without-preview';
  if (record.framesDecoded > 0) return 'frames-without-image';
  if (record.samplesReceived > 0 || record.samplesProcessed > 0)
    return 'samples-without-frames';
  return 'no-data';
}

export function captureDescription(record: CaptureRecord, live = false): {
  title: string; detail: string;
} {
  const outcome = captureOutcome(record);
  if (outcome === 'image-recovered') return {
    title: live ? 'Building your satellite image' : 'Image recovered',
    detail: 'Image strips were decoded automatically. Missing strips are not filled in. Export the session to keep the image and data.',
  };
  if (outcome === 'image-packets-without-preview') return {
    title: live ? 'Image packets decoded — reconstructing the preview' : 'Image packets recovered; no preview available',
    detail: 'Image segments were decoded, but no preview was rendered. Export the session to retain the recovered packets and error log.',
  };
  if (outcome === 'frames-without-image') return {
    title: live ? 'Meteor frames decoded — waiting for image packets' : 'Frames recovered, but no image',
    detail: 'The decoder recovered data frames, but no usable image segments. The session and recovered frames can still be exported.',
  };
  if (outcome === 'samples-without-frames') return {
    title: live ? 'Radio data arriving — no Meteor frames yet' : 'Radio data captured; no Meteor frames decoded',
    detail: 'The receiver supplied samples, but no usable Meteor data was decoded. Spectrum activity alone cannot identify the satellite or distinguish it from interference and noise.',
  };
  return {
    title: live ? 'Waiting for data from the receiver' : 'No radio samples or decoded frames received',
    detail: live ? 'The connection is open. Image decoding is automatic; there is no separate develop-image step.'
      : 'This session produced no samples or decoded frames. Check the connection and session log. This does not prove that the satellite transmitted nothing.',
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function rawFilename(run: RawRun): string {
  return `raw/tuning-${String(run.index + 1).padStart(2, '0')}-${Math.round(run.frequencyHz)}Hz-${Math.round(run.sampleRate)}sps.cu8`;
}
