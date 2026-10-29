import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Receiver, type ReceiverEvent } from '@meteor/radio/receiver';

const fake = vi.hoisted(() => ({
  choose: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
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

describe('Receiver lifecycle', () => {
  test('tunes the radio check to 96.5 MHz and stops audio after 60 seconds', async () => {
    // Arrange
    vi.useFakeTimers();
    const closeAudio = vi.fn().mockResolvedValue(undefined);
    const gain = { gain: { value: 0 }, connect: vi.fn() };
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        createGain = () => gain;
        resume = vi.fn();
        close = closeAudio;
      },
    );
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
    await expect(starting).rejects.toThrow('cancelled');
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(fake.device.setSampleRate).not.toHaveBeenCalled();
    expect(receiver.running).toBe(false);
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
});
