/** One worker per session isolates DSP state and keeps every queue bounded. */
import { PacketAssembler } from '@meteor/decoder/packets';
import { MeteorImage } from '@meteor/decoder/image';
import { WasmDecoder } from '@meteor/decoder/wasm';
import { FmCheck, measureIq } from '@meteor/radio/fm';
import { iqSpectrum, SPECTRUM_BINS } from '@meteor/radio/spectrum';
import { errorMessage, StationError } from '@meteor/core/errors';
import type { Mode, WorkerRequest, WorkerResponse } from '@meteor/decoder/protocol';

const port = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};
let mode: Mode = 'replay';
let initialized = false;
let decoder: WasmDecoder | null = null;
let fm: FmCheck | null = null;
const packets = new PacketAssembler();
const image = new MeteorImage();
const archive: Uint8Array[] = [];
let lastImage = 0;
let lastSpectrum = -Infinity;
let selectedChannel: number | undefined;
let serial: Promise<void> = Promise.resolve();

function acceptFrames(frames: readonly Uint8Array[]): void {
  for (const frame of frames) {
    if (archive.length >= 16384)
      throw new StationError(
        'The 16 MB frame recording limit was reached. Save this reception.',
      );
    archive.push(frame);
    for (const packet of packets.push(frame)) image.push(packet);
  }
}

function publishImage(): void {
  const snapshot = image.snapshot(selectedChannel);
  if (snapshot)
    port.postMessage({ type: 'image', image: snapshot }, [snapshot.rgba.buffer]);
  lastImage = performance.now();
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'init') {
    if (initialized)
      throw new StationError('This decoder session has already started.');
    mode = message.mode;
    if (mode === 'meteor' || mode === 'iq-file')
      decoder = await WasmDecoder.create(message.sampleRate);
    if (mode === 'fm') fm = new FmCheck(message.sampleRate);
    initialized = true;
    port.postMessage({ type: 'ready' });
    return;
  }
  if (!initialized) throw new StationError('The decoder has not started.');
  if (message.type === 'channel') {
    selectedChannel = message.channel;
    publishImage();
    return;
  }
  if (message.type === 'finish') {
    if (decoder) acceptFrames(decoder.finish());
    publishImage();
    const result = new Uint8Array(archive.length * 1024);
    archive.forEach((frame, index) => result.set(frame, index * 1024));
    decoder?.close();
    decoder = null;
    port.postMessage({ type: 'done', frames: result.buffer }, [result.buffer]);
    return;
  }
  const started = performance.now();
  const bytes = new Uint8Array(message.data);
  if (bytes.length > 262144 || bytes.length === 0)
    throw new StationError('Invalid sample block size.');
  if (
    mode !== 'replay' &&
    bytes.length >= SPECTRUM_BINS * 2 &&
    performance.now() - lastSpectrum >= 100
  ) {
    const spectrum = iqSpectrum(bytes);
    port.postMessage({ type: 'spectrum', data: spectrum }, [spectrum.buffer]);
    lastSpectrum = performance.now();
  }
  if (mode === 'fm') {
    const audio = fm!.push(bytes);
    port.postMessage({ type: 'audio', data: audio }, [audio.buffer]);
  } else {
    let frames: Uint8Array[];
    if (mode === 'replay') {
      if (bytes.length % 1024)
        throw new StationError('The frame recording is truncated.');
      frames = Array.from({ length: bytes.length / 1024 }, (_, i) =>
        bytes.slice(i * 1024, (i + 1) * 1024),
      );
    } else frames = decoder!.push(bytes);
    acceptFrames(frames);
    if (performance.now() - lastImage > 1500) publishImage();
  }
  port.postMessage({
    type: 'ack',
    id: message.id,
    level:
      mode === 'replay' ? { rms: 0, clippedFraction: 0, samples: 0 } : measureIq(bytes),
    frames: packets.frames,
    segments: image.segments,
    gaps: packets.gaps,
    carrierOffset: decoder?.carrierOffset ?? 0,
    processingMs: performance.now() - started,
  });
}
port.onmessage = (event) => {
  serial = serial
    .then(() => handle(event.data))
    .catch((error) => {
      console.error('Decoder worker:', error);
      port.postMessage({ type: 'error', message: errorMessage(error) });
    });
};
