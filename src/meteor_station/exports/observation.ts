/** Download image, received frames, and explicit provenance in one archive. */
import { strToU8, zipSync } from 'fflate';
import type { Observer, ReceptionWindow } from '@meteor/core/models';
import type { ReceiverInfo } from '@meteor/radio/receiver';
import type { OrbitSnapshot } from '@meteor/orbit/catalog';
import { downloadBlob } from '@meteor/ui/format';
import { StationError } from '@meteor/core/errors';

export async function saveObservation(
  canvas: HTMLCanvasElement,
  frames: ArrayBuffer,
  info: ReceiverInfo,
  observer: Observer,
  orbits: OrbitSnapshot,
  plan: ReceptionWindow | null,
  channels: readonly number[],
  selectedChannel: number,
): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new StationError('Could not export the image.')),
      'image/png',
    ),
  );
  const png = new Uint8Array(await blob.arrayBuffer());
  const frameBytes = new Uint8Array(frames);
  const digest = async (data: Uint8Array): Promise<string> => {
    const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
    return [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };
  const source =
    info.mode === 'meteor'
      ? 'rtl-sdr-webusb'
      : info.mode === 'replay'
        ? 'recorded-cadu-replay'
        : 'imported-iq-file';
  const metadata = {
    schemaVersion: 1,
    application: 'Meteor Station',
    version: '0.1.0',
    processedAt: new Date().toISOString(),
    source,
    receivedAt: info.mode === 'meteor' ? info.startedAt : null,
    receiver:
      info.mode === 'meteor'
        ? {
            model: 'RTL-SDR Blog V3 (configured target; hardware model not attested)',
            sampleRate: info.sampleRate,
            frequencyHz: info.frequency || null,
          }
        : null,
    decoderSampleRate: info.mode === 'replay' ? null : info.sampleRate,
    observer: info.mode === 'meteor' ? observer : null,
    stationConfiguration: { observer, orbitalElements: orbits },
    plannedSatellite: info.mode === 'meteor' ? (plan?.pass.name ?? null) : null,
    plannedWindow: info.mode === 'meteor' ? plan : null,
    image: {
      width: canvas.width,
      height: canvas.height,
      channels,
      selectedChannel,
      processing: 'Unprojected MSU-MR grayscale; missing data is transparent or black',
      sha256: await digest(png),
    },
    frames: { count: frames.byteLength / 1024, sha256: await digest(frameBytes) },
    validationNote: 'A replay is not evidence of live USB or antenna reception.',
  };
  const zipped = zipSync({
    'weather-image.png': png,
    'received.cadu': frameBytes,
    'metadata.json': strToU8(JSON.stringify(metadata, null, 2)),
  });
  downloadBlob(
    new Blob([new Uint8Array(zipped)], { type: 'application/zip' }),
    `meteor-${source}-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}

export function exportCalendar(window: ReceptionWindow): void {
  const stamp = (time: number): string =>
    new Date(time).toISOString().replace(/[-:]/g, '').split('.')[0]! + 'Z';
  const event = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meteor Station//EN',
    'BEGIN:VEVENT',
    `UID:${window.pass.id}@meteor-station`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(window.setupAt)}`,
    `DTEND:${stamp(window.packedBy)}`,
    `SUMMARY:${window.pass.name} antenna session`,
    'LOCATION:VAS Sunrise',
    `DESCRIPTION:Setup begins at the start of this event. Reception ${stamp(window.receiveFrom)} to ${stamp(window.receiveUntil)}. Confirm school is open and the antenna location is available.`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  downloadBlob(new Blob([event], { type: 'text/calendar' }), 'meteor-session.ics');
}
