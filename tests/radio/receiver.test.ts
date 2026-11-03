import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Receiver, type ReceiverEvent } from '@meteor/radio/receiver';
import type { WorkerResponse } from '@meteor/decoder/protocol';

const fake = vi.hoisted(() => ({
  choose: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
  workers: [] as ((event: WorkerResponse) => void)[],
  device: {
    setDirectSamplingMethod: vi.fn(),
    enableBiasTee: vi.fn(),
    setGain: vi.fn(),
    setSampleRate: vi.fn(),
    setCenterFrequency: vi.fn(),
    resetBuffer: vi.fn(),
    readSamples: vi.fn(),
    close: vi.fn(),
  },
}));
vi.mock('@jtarrio/webrtlsdr/rtlsdr.js', () => ({
  DirectSampling: { Off: 0 },
  RTL2832U_Provider: class {
    get = fake.choose;
  },
}));
vi.mock('@meteor/radio/worker-session', () => ({
  WorkerSession: class {
    constructor(onEvent: (event: WorkerResponse) => void) {
      fake.workers.push(onEvent);
    }
    queued = 0;
    start = fake.start;
    send = fake.send;
    finish = fake.finish;
    close = fake.close;
    channel = vi.fn();
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  fake.workers.length = 0;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { usb: {} });
  fake.choose.mockResolvedValue(fake.device);
  fake.start.mockResolvedValue(undefined);
  fake.send.mockResolvedValue(undefined);
  fake.finish.mockResolvedValue(new ArrayBuffer(1024));
  fake.device.setSampleRate.mockResolvedValue(288000);
  fake.device.setCenterFrequency.mockImplementation(
    async (frequency: number) => frequency,
  );
  fake.device.readSamples.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockAudio() {
  const close = vi.fn().mockResolvedValue(undefined);
  const gain = { gain: { value: 0 }, connect: vi.fn() };
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = {};
      createGain = () => gain;
      resume = vi.fn();
      close = close;
    },
  );
  return { close, gain };
}

describe('Receiver lifecycle', () => {
  test('tunes the radio check to 96.5 MHz and stops audio after 60 seconds', async () => {
    // Arrange
    vi.useFakeTimers();
    const { close: closeAudio, gain } = mockAudio();
    const receiver = new Receiver(() => {});
    // Act
    await receiver.startRadio('fm');
    receiver.volume(0.7);
    await vi.advanceTimersByTimeAsync(60000);
    // Assert
    expect(fake.device.setCenterFrequency).toHaveBeenCalledWith(96500000);
    expect(gain.gain.value).toBe(0.7);
    expect(closeAudio).toHaveBeenCalledOnce();
    expect(receiver.running).toBe(false);
  });
  test('configures V3 reception and releases USB on repeated stop', async () => {
    // Arrange
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    // Act
    await receiver.startRadio('meteor');
    await Promise.all([receiver.stop(), receiver.stop()]);
    // Assert
    expect(fake.device.setSampleRate).toHaveBeenCalledWith(288000);
    expect(fake.device.setCenterFrequency).toHaveBeenCalledWith(137900000);
    expect(fake.device.enableBiasTee).toHaveBeenCalledWith(false);
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'stopped')).toHaveLength(1);
    expect(receiver.running).toBe(false);
  });
  test('closes a device selected after the session was cancelled', async () => {
    // Arrange
    let choose!: (device: typeof fake.device) => void;
    fake.choose.mockReturnValue(
      new Promise((resolve) => {
        choose = resolve;
      }),
    );
    const receiver = new Receiver(() => {});
    const starting = receiver.startRadio('meteor');
    // Act
    await receiver.stop();
    choose(fake.device);
    // Assert
    await expect(starting).resolves.toBeUndefined();
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(fake.device.setSampleRate).not.toHaveBeenCalled();
    expect(receiver.running).toBe(false);
  });
  test('stays stopped when a cancelled buffer reset completes, and can restart', async () => {
    const entered = deferred<void>();
    const reset = deferred<void>();
    fake.device.resetBuffer.mockImplementationOnce(() => {
      entered.resolve();
      return reset.promise;
    });
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    const starting = receiver.startRadio('meteor');
    await entered.promise;

    await receiver.stop();
    reset.resolve();
    await starting;

    expect(receiver.running).toBe(false);
    expect(events.some((event) => event.type === 'started')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    await receiver.startRadio('meteor');
    expect(receiver.running).toBe(true);
    await receiver.stop();
  });
  test('a cancelled FM setup cannot retune its replacement Meteor session', async () => {
    mockAudio();
    const entered = deferred<void>();
    const gain = deferred<void>();
    fake.device.setGain.mockImplementationOnce(() => {
      entered.resolve();
      return gain.promise;
    });
    const replacement = {
      ...fake.device,
      setGain: vi.fn().mockResolvedValue(undefined),
      setSampleRate: vi.fn().mockResolvedValue(288000),
      setCenterFrequency: vi.fn(async (frequency: number) => frequency),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fake.choose.mockResolvedValueOnce(fake.device).mockResolvedValueOnce(replacement);
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    const starting = receiver.startRadio('fm');
    await entered.promise;

    await receiver.stop();
    await receiver.startRadio('meteor');
    gain.resolve();
    await starting;

    expect(fake.device.setCenterFrequency).not.toHaveBeenCalled();
    expect(replacement.setCenterFrequency.mock.calls).toEqual([[137900000]]);
    expect(receiver.info).toMatchObject({ mode: 'meteor', frequency: 137900000 });
    expect(receiver.running).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    await receiver.stop();
  });
  test('releases a late wake lock without replacing the current session lock', async () => {
    const entered = deferred<void>();
    const oldLock = { release: vi.fn().mockResolvedValue(undefined) };
    const currentLock = { release: vi.fn().mockResolvedValue(undefined) };
    const request = deferred<typeof oldLock>();
    vi.stubGlobal('navigator', {
      usb: {},
      wakeLock: {
        request: vi
          .fn()
          .mockImplementationOnce(() => {
            entered.resolve();
            return request.promise;
          })
          .mockResolvedValue(currentLock),
      },
    });
    const receiver = new Receiver(() => {});
    const starting = receiver.startRadio('meteor');
    await entered.promise;

    await receiver.stop();
    await receiver.startRadio('meteor');
    request.resolve(oldLock);
    await starting;

    expect(oldLock.release).toHaveBeenCalledOnce();
    expect(currentLock.release).not.toHaveBeenCalled();
    expect(receiver.running).toBe(true);
    await receiver.stop();
    expect(currentLock.release).toHaveBeenCalledOnce();
  });
  test('ignores a late USB failure and worker messages from a stopped session', async () => {
    const read = deferred<{ data: ArrayBuffer }>();
    fake.device.readSamples.mockReturnValueOnce(read.promise);
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    await receiver.startRadio('meteor');
    const oldWorker = fake.workers[0]!;
    await receiver.stop();
    await receiver.startRadio('meteor');

    oldWorker({ type: 'error', message: 'Old worker failed' });
    read.reject(new Error('Old USB read failed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(receiver.running).toBe(true);
    await receiver.stop();
  });
  test('cleans up after setup failure and allows a new session', async () => {
    // Arrange
    fake.device.setGain.mockRejectedValueOnce(new Error('USB disconnected'));
    const receiver = new Receiver(() => {});
    // Act / Assert
    await expect(receiver.startRadio('meteor')).rejects.toThrow('USB disconnected');
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(receiver.running).toBe(false);
    await receiver.startRadio('meteor');
    await receiver.stop();
    expect(fake.device.close).toHaveBeenCalledTimes(2);
  });
  test('uses bounded blocks for file replay and rejects malformed files', async () => {
    // Arrange
    const receiver = new Receiver(() => {});
    // Act
    await receiver.replay(new Uint8Array(131072));
    // Assert
    expect(fake.send).toHaveBeenCalledTimes(2);
    expect(receiver.running).toBe(false);
    await expect(receiver.replay(new Uint8Array(13))).rejects.toThrow('incomplete');
    await expect(receiver.replay(new Uint8Array(0))).rejects.toThrow('nonempty');
    await expect(receiver.replay(new Uint8Array(13), 'iq-file')).rejects.toThrow('I/Q');
  });
  test('reports the actual tuning result when Meteor changes channel', async () => {
    // Arrange
    vi.useFakeTimers();
    let deliver!: (block: { data: ArrayBuffer }) => void;
    fake.device.readSamples.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    fake.device.setCenterFrequency.mockImplementation(
      async (frequency: number) => frequency + 25,
    );
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    // Act
    await receiver.startRadio('meteor');
    await vi.advanceTimersByTimeAsync(45001);
    deliver({ data: new ArrayBuffer(65536) });
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'tuned')).toBe(true),
    );
    await receiver.stop();
    // Assert
    expect(fake.device.setCenterFrequency).toHaveBeenLastCalledWith(137100000);
    expect(receiver.info?.frequency).toBe(137100025);
    expect(events.find((event) => event.type === 'tuned')).toMatchObject({
      type: 'tuned',
      info: { frequency: 137100025, mode: 'meteor' },
    });
  });
  test('stays on a Meteor channel that shows an LRPT-shaped signal', async () => {
    // Arrange: a spectrum with a +3 dB hump across the LRPT band.
    vi.useFakeTimers();
    let deliver!: (block: { data: ArrayBuffer }) => void;
    fake.device.readSamples.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const hump = () =>
      Float32Array.from({ length: 512 }, (_, i) =>
        Math.abs((i - 256) * 562.5) < 50000 ? -57 : -60,
      );
    const events: ReceiverEvent[] = [];
    const receiver = new Receiver((event) => events.push(event));
    // Act: the signal persists past the 45 s point where an empty channel is left.
    await receiver.startRadio('meteor');
    for (let second = 0; second < 50; second++) {
      fake.workers[0]!({ type: 'spectrum', data: hump() });
      await vi.advanceTimersByTimeAsync(1000);
    }
    deliver({ data: new ArrayBuffer(65536) });
    await vi.advanceTimersByTimeAsync(10);
    await receiver.stop();
    // Assert
    expect(events.some((event) => event.type === 'tuned')).toBe(false);
    expect(fake.device.setCenterFrequency).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) =>
          event.type === 'status' && /shaped like Meteor LRPT/.test(event.message),
      ),
    ).toBe(true);
  });
});
