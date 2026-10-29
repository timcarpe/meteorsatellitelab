/** Student receiver controller: one USB owner, bounded queue, explicit cleanup. */
import {
  RTL2832U_Provider,
  DirectSampling,
  type RtlDevice,
} from '@jtarrio/webrtlsdr/rtlsdr.js';
import { WorkerSession } from '@meteor/radio/worker-session';
import type { Mode, WorkerResponse } from '@meteor/decoder/protocol';
import { StationError, errorMessage } from '@meteor/core/errors';

export interface ReceiverInfo {
  readonly mode: Mode;
  readonly sampleRate: number;
  readonly frequency: number;
  readonly startedAt: string;
}
export type ReceiverEvent =
  | WorkerResponse
  | { readonly type: 'status'; readonly message: string }
  | { readonly type: 'started'; readonly info: ReceiverInfo }
  | { readonly type: 'tuned'; readonly info: ReceiverInfo }
  | { readonly type: 'stopped'; readonly frames: ArrayBuffer };

export class Receiver {
  private device: RtlDevice | null = null;
  private session: WorkerSession | null = null;
  private active = false;
  private starting = false;
  private stopping: Promise<void> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private audio: AudioContext | null = null;
  private audioGain: GainNode | null = null;
  private nextAudio = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private latestFrames = 0;
  private generation = 0;
  public info: ReceiverInfo | null = null;

  public constructor(private readonly onEvent: (event: ReceiverEvent) => void) {}
  public get running(): boolean {
    return this.active || this.starting || this.stopping !== null;
  }
  public static get supported(): boolean {
    return isSecureContext && 'usb' in navigator;
  }

  /** Called directly from a student click so the USB chooser has user activation. */
  public async startRadio(mode: 'meteor' | 'fm', frequency = 137900000): Promise<void> {
    if (this.running) throw new StationError('Stop the current reception first.');
    if (!Receiver.supported)
      throw new StationError(
        'Open this page in Chrome or Edge on your Mac or Windows computer to connect the V3.',
      );
    this.starting = true;
    const generation = ++this.generation;
    const chosen = new RTL2832U_Provider().get();
    try {
      if (mode === 'fm') {
        this.audio = new AudioContext();
        this.audioGain = this.audio.createGain();
        this.audioGain.gain.value = 0.35;
        this.audioGain.connect(this.audio.destination);
        void this.audio.resume();
      }
      this.status('Choose your RTL-SDR in the browser’s USB window.');
      const device = await chosen;
      if (generation !== this.generation) {
        await device.close();
        throw new StationError('Reception was cancelled.');
      }
      this.device = device;
      this.status('Preparing the receiver…');
      await this.device.setDirectSamplingMethod(DirectSampling.Off);
      await this.device.enableBiasTee(false);
      await this.device.setGain(mode === 'fm' ? 19.7 : 40.2);
      const rate = await this.device.setSampleRate(288000);
      const tuned = await this.device.setCenterFrequency(
        mode === 'fm' ? 96500000 : frequency,
      );
      this.ensureGeneration(generation);
      await this.openSession(mode, rate);
      this.ensureGeneration(generation);
      await this.device.resetBuffer();
      this.info = {
        mode,
        sampleRate: rate,
        frequency: tuned,
        startedAt: new Date().toISOString(),
      };
      this.active = true;
      this.starting = false;
      if ('wakeLock' in navigator) {
        try {
          this.wakeLock = await navigator.wakeLock.request('screen');
        } catch {
          this.status('Keep this tab visible and your computer awake while receiving.');
        }
      }
      this.ensureGeneration(generation);
      this.onEvent({ type: 'started', info: this.info });
      this.status(
        mode === 'fm'
          ? 'Listening to 96.5 FM. You should hear a local radio station.'
          : 'Listening for Meteor. An image appears when valid satellite data arrives.',
      );
      this.timeout = setTimeout(
        () => void this.stop().catch((error) => this.report(error)),
        mode === 'fm' ? 60000 : 20 * 60000,
      );
      void this.readLoop(mode, generation);
    } catch (error) {
      if (generation === this.generation) await this.cleanup();
      const message = errorMessage(error);
      if (error instanceof StationError) throw error;
      if (/cancel|No device selected/i.test(message))
        throw new StationError('No receiver selected. Connect the V3 and try again.');
      if (/claim|access|LIBUSB|interface/i.test(message))
        throw new StationError(
          'The receiver could not be opened. Close other SDR apps. On Windows, install WinUSB for the RTL2832U “Bulk-In, Interface 0” device, then reconnect.',
        );
      throw error;
    }
  }

  public async replay(
    data: Uint8Array,
    mode: 'replay' | 'iq-file' = 'replay',
    rate = 288000,
  ): Promise<void> {
    if (this.running) throw new StationError('Stop the current reception first.');
    if (mode === 'replay' && data.length % 1024)
      throw new StationError(
        'This CADU file is incomplete; its size must be a multiple of 1024 bytes.',
      );
    if (!data.length || data.length > 128 * 1024 * 1024)
      throw new StationError('Choose a nonempty recording smaller than 128 MB.');
    if (mode === 'iq-file' && data.length % 2)
      throw new StationError('The IQ file ends with an incomplete I/Q pair.');
    this.starting = true;
    const generation = ++this.generation;
    try {
      await this.openSession(mode, rate);
      this.ensureGeneration(generation);
      this.info = {
        mode,
        sampleRate: rate,
        frequency: 0,
        startedAt: new Date().toISOString(),
      };
      this.active = true;
      this.starting = false;
      this.onEvent({ type: 'started', info: this.info });
      this.status(
        mode === 'replay'
          ? 'Replaying recorded Meteor frames. This does not test the USB receiver.'
          : 'Decoding an IQ file in your browser.',
      );
      for (let offset = 0; offset < data.length && this.active; offset += 65536) {
        await this.session!.send(data.slice(offset, offset + 65536).buffer);
      }
      if (generation === this.generation) await this.stop();
    } catch (error) {
      if (generation === this.generation) await this.cleanup();
      throw error;
    }
  }

  public volume(value: number): void {
    if (this.audioGain) this.audioGain.gain.value = Math.max(0, Math.min(1, value));
  }
  public channel(value: number): void {
    this.session?.channel(value);
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.generation++;
    this.active = false;
    this.stopping = (async () => {
      let frames = new ArrayBuffer(0);
      try {
        const device = this.device;
        this.device = null;
        if (device) {
          try {
            await device.close();
          } catch (error) {
            console.error('Closing USB:', error);
          }
        }
        frames = this.session ? await this.session.finish() : new ArrayBuffer(0);
        this.session = null;
      } catch (error) {
        this.report(error);
      } finally {
        await this.cleanup();
        this.stopping = null;
        this.onEvent({ type: 'stopped', frames });
      }
    })();
    return this.stopping;
  }

  private async openSession(mode: Mode, rate: number): Promise<void> {
    this.latestFrames = 0;
    this.session = new WorkerSession((event) => {
      if (event.type === 'ack') this.latestFrames = event.frames;
      if (event.type === 'audio') this.playAudio(event.data);
      this.onEvent(event);
    });
    await this.session.start(mode, rate);
  }
  private async readLoop(mode: 'meteor' | 'fm', generation: number): Promise<void> {
    const inFlight = new Set<Promise<void>>();
    let failure: Error | null = null;
    let tunedAt = Date.now();
    try {
      while (this.active && this.device && this.session) {
        const device = this.device;
        const session = this.session;
        if (failure) throw failure;
        if (this.session.queued >= 4)
          throw new StationError(
            'Reception stopped because this computer fell behind. Close other apps and try again.',
          );
        const block = await device.readSamples(32768);
        if (!this.active || generation !== this.generation) break;
        if (block.data.byteLength !== 65536)
          throw new StationError(
            'The USB receiver returned an incomplete block. Reconnect the V3.',
          );
        const pending = session.send(block.data);
        inFlight.add(pending);
        void pending
          .catch((error) => {
            failure = error;
          })
          .finally(() => inFlight.delete(pending));
        if (
          mode === 'meteor' &&
          this.latestFrames === 0 &&
          Date.now() - tunedAt > 45000
        ) {
          await Promise.all(inFlight);
          if (!this.active || generation !== this.generation) break;
          session.close();
          const frequency =
            (this.info?.frequency ?? 137900000) > 137500000 ? 137100000 : 137900000;
          this.status(
            `Checking Meteor’s other channel: ${(frequency / 1e6).toFixed(3)} MHz…`,
          );
          const tuned = await device.setCenterFrequency(frequency);
          if (!this.active || generation !== this.generation) break;
          await this.openSession(mode, this.info!.sampleRate);
          if (!this.active || generation !== this.generation) break;
          await device.resetBuffer();
          if (!this.active || generation !== this.generation) break;
          this.info = { ...this.info!, frequency: tuned };
          this.onEvent({ type: 'tuned', info: this.info });
          tunedAt = Date.now();
        }
      }
    } catch (error) {
      if (this.active) {
        console.error('Receiver:', error);
        this.onEvent({ type: 'error', message: errorMessage(error) });
        try {
          await this.stop();
        } catch (stopError) {
          this.report(stopError);
        }
      }
    }
  }
  private playAudio(samples: Float32Array): void {
    if (!this.audio || !this.audioGain) return;
    const buffer = this.audio.createBuffer(1, samples.length, 48000);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioGain);
    const now = this.audio.currentTime;
    if (this.nextAudio < now || this.nextAudio > now + 0.6) this.nextAudio = now + 0.08;
    source.start(this.nextAudio);
    this.nextAudio += samples.length / 48000;
  }
  private async cleanup(): Promise<void> {
    this.active = false;
    this.starting = false;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.session?.close();
    this.session = null;
    const device = this.device;
    this.device = null;
    if (device) {
      try {
        await device.close();
      } catch (error) {
        console.error('USB cleanup:', error);
      }
    }
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    await this.audio?.close().catch(() => {});
    this.audio = null;
    this.audioGain = null;
    this.nextAudio = 0;
  }
  private status(message: string): void {
    this.onEvent({ type: 'status', message });
  }
  private ensureGeneration(generation: number): void {
    if (generation !== this.generation)
      throw new StationError('Reception was cancelled.');
  }
  private report(error: unknown): void {
    console.error('Receiver:', error);
    this.onEvent({ type: 'error', message: errorMessage(error) });
  }
}
