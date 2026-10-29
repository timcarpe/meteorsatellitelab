/** Student station entry point: plan, check the radio, receive, and save. */
import '@meteor/ui/style.css';
import '@meteor/ui/fonts.css';
import replayUrl from '@meteor/data/replay.cadu?url';
import notices from '../../THIRD_PARTY_NOTICES.txt?raw';
import { SUNRISE, type ReceptionWindow } from '@meteor/core/models';
import { errorMessage } from '@meteor/core/errors';
import {
  initialSnapshot,
  refreshSnapshot,
  snapshotOrbits,
  parseSnapshot,
} from '@meteor/orbit/catalog';
import { orbitAgeDays, positionAt, predictPasses } from '@meteor/orbit/propagation';
import { BELL_PERIODS, TIMETABLE_SOURCE } from '@meteor/timetable/school';
import {
  DEFAULT_MATCH,
  matchPasses,
  parseSchoolDates,
} from '@meteor/timetable/matching';
import { EarthMap } from '@meteor/map/earth';
import {
  Receiver,
  type ReceiverEvent,
  type ReceiverInfo,
} from '@meteor/radio/receiver';
import { saveObservation, exportCalendar } from '@meteor/exports/observation';
import { compass, dayText, timeText, downloadBlob } from '@meteor/ui/format';

const satIcon =
  '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7 6 5 5-6 6-5-5zm18 9 6 6-6 6-6-6zM14 9l9 9-8 8-9-9z" stroke="currentColor" stroke-width="1.6"/><path d="m20 5 7 7m-8-4 5 5M9 24l-5 5" stroke="currentColor" stroke-width="1.6"/></svg>';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#plan">${satIcon}<span>Meteor<span class="brand-sub">STUDENT GROUND STATION</span></span></a>
    <nav aria-label="Main navigation"><button class="nav-link active" data-page="plan">Plan a pass</button><button class="nav-link" data-page="receive">Receive an image</button></nav>
    <button class="help-button" id="help-open" aria-label="Open station guide">?</button>
  </header>
  <main>
    <section id="plan-page">
      <div class="page-heading"><div><p class="eyebrow">VAS SUNRISE · HO CHI MINH CITY</p><h1>A window to space.<br><span>In your school day.</span></h1></div><div class="heading-aside"><span class="live-dot"></span><span id="school-clock"></span><small>All times are school time · UTC+7</small></div></div>
      <div id="orbit-warning" class="notice" hidden role="status"></div>
      <div class="plan-grid">
        <article class="earth-card">
          <div class="map-header"><div><span class="live-dot"></span><strong id="map-mode">Orbit positions · now</strong></div><button id="map-now" class="map-button">Back to now ↗</button></div>
          <div id="earth-map"></div>
          <div class="map-footer"><span><i class="legend-line mint"></i>Meteor M2-3</span><span><i class="legend-line peach"></i>Meteor M2-4</span><span class="map-key">— past &nbsp; ··· next 95 min</span></div>
          <div class="orbit-readouts" id="orbit-readouts"></div>
        </article>
        <article class="window-card" id="recommended"></article>
      </div>
      <section class="week-section" aria-labelledby="week-title">
        <div class="section-heading"><div><p class="eyebrow">MAKE ROOM FOR DISCOVERY</p><h2 id="week-title">Your school windows</h2></div><button id="timetable-open" class="button secondary small">Adjust availability <span>↗</span></button></div>
        <p class="section-note">Breaks come first. Every window includes 5 minutes to set up and 3 minutes to pack away.</p>
        <div id="pass-list" class="pass-list"></div>
        <div class="school-strip"><span class="school-icon">◷</span><div><strong>Secondary timetable</strong><span>Morning break 09:45–10:00 &nbsp; · &nbsp; Lunch 11:30–13:00 &nbsp; · &nbsp; Afternoon break 14:30–15:00</span></div><a href="${TIMETABLE_SOURCE}" target="_blank" rel="noreferrer">View reference ↗</a></div>
        <p class="fine-print">Regular Monday–Friday bell times. Check school holidays and teacher approval before a session. Orbit predictions do not confirm a satellite’s transmitter is on.</p>
      </section>
    </section>
    <section id="receive-page" hidden>
      <div class="page-heading"><div><p class="eyebrow">YOUR ANTENNA. YOUR SATELLITE IMAGE.</p><h1>Connect. Listen.<br><span>See what comes down.</span></h1></div><div class="heading-aside"><span class="tag">RTL-SDR Blog V3</span><small>Everything is processed on this computer.</small></div></div>
      <div id="browser-notice" class="notice" hidden></div>
      <div class="receive-grid">
        <div class="receiver-stack">
          <article class="setup-card"><span class="step-number">01</span><div><h2>Set up outside</h2><p>Connect the antenna to your V3, then plug the V3 into your computer. Find a clear view of the sky.</p><p id="antenna-plan" class="antenna-plan">Choose a school window on the Plan tab.</p></div></article>
          <article class="setup-card"><span class="step-number">02</span><div><h2>Check your radio</h2><p>Listen to <strong>96.5 FM</strong> for a quick check. You should hear a local station.</p><button id="fm-start" class="button secondary">♫ &nbsp; Check 96.5 FM</button><div id="fm-controls" hidden><label class="volume-label">Volume <input id="volume" type="range" min="0" max="100" value="35" /></label><p class="fine-print">The check stops after 60 seconds. Hearing FM checks the receiver path; Meteor still needs a pass and a suitable antenna.</p></div></div></article>
          <article class="setup-card"><span class="step-number accent">03</span><div><h2>Receive Meteor</h2><p>Start a little before your planned pass. Keep this tab visible while the satellite crosses the sky.</p><button id="meteor-start" class="button primary">${satIcon} Start receiving</button><button id="stop" class="button stop" hidden>■ &nbsp; Stop reception</button><p class="fine-print">The receiver checks Meteor’s two channels automatically.</p></div></article>
          <div class="receiver-status" role="status" aria-live="polite"><span id="status-dot" class="status-dot"></span><div><strong id="status-title">Ready when you are</strong><p id="status-message">Connect a V3, or try the recorded pass below.</p></div></div>
          <div class="signal-detail"><span>Radio input</span><meter id="signal-meter" min="0" max="1" value="0" aria-label="Radio input level"></meter><span id="signal-label">No samples</span></div>
        </div>
        <article class="image-card">
          <div class="image-header"><div><p class="eyebrow">FROM SIGNAL TO PICTURE</p><h2>Your weather image</h2></div><span class="tag" id="image-source">Waiting for data</span></div>
          <div id="image-empty" class="image-empty"><div class="orbit-illustration">${satIcon}<span></span><span></span></div><h3>A different view of Earth.</h3><p>Received image strips will appear here.<br>No satellite pass right now? Try a recording.</p><button id="replay" class="button secondary">▷ &nbsp; Try recorded Meteor data</button><small>Real recorded frames · no receiver needed</small></div>
          <div id="canvas-wrap" hidden><canvas id="weather-image" aria-label="Decoded grayscale MSU-MR weather image"></canvas></div>
          <div class="image-stats"><div><strong id="frame-count">0</strong><span>valid frames</span></div><div><strong id="segment-count">0</strong><span>image segments</span></div><div><strong id="image-height">—</strong><span>image lines</span></div></div>
          <div class="image-actions"><label id="channel-label" hidden>Channel <select id="channel"></select></label><button id="save-image" class="button primary" disabled>↓ &nbsp; Save image + data</button></div>
          <p class="fine-print image-caption" id="image-caption">Your download includes a PNG, received frames, and a metadata record. Missing data is left blank.</p>
        </article>
      </div>
      <details class="advanced"><summary>Recording files and receiver help</summary><div class="advanced-content"><div><h3>Open a recording</h3><p>CADU files replay image packets. Raw unsigned 8-bit IQ files exercise the full decoder at 288,000 samples/second.</p><label class="file-label">File type <select id="recording-kind"><option value="replay">Meteor CADU frames</option><option value="iq-file">Raw IQ · CU8 · 288 kS/s</option></select></label><input id="recording-file" type="file" accept=".cadu,.cu8,.raw,.bin" /></div><div><h3>If the V3 will not connect</h3><p>Use Chrome or Edge. Close SatDump, SDR++, Gqrx, and any other app using the receiver.</p><p>On Windows, a one-time WinUSB driver setup may be needed for <strong>Bulk-In, Interface 0</strong>. Use the <a href="https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/" target="_blank" rel="noreferrer">official RTL-SDR guide ↗</a>.</p><p>Mac users normally do not need a separate driver. Live V3 hardware acceptance is still pending.</p></div></div></details>
    </section>
    <footer><span>${satIcon} One small antenna. A much bigger picture.</span><div><button id="help-footer">Station guide</button><button id="refresh-orbits">Refresh orbit data</button><button id="export-orbits">Export orbit data</button><a href="./meteor-station.html" download="meteor-station.html" id="download-app">Download this station ↙</a></div><small id="orbit-source"></small></footer>
  </main>
  <dialog id="timetable-dialog"><form method="dialog"><button class="dialog-close" aria-label="Close timetable settings">×</button></form><p class="eyebrow">YOUR SCHOOL DAY</p><h2>When are you available?</h2><p>Breaks are included automatically. Add a class period only when you are free or your teacher has approved it.</p><div id="lesson-options" class="lesson-options"></div><label class="field-label">Days to exclude (school holidays or trips)<input id="excluded-dates" type="text" placeholder="2026-11-02, 2026-11-03" /></label><p class="fine-print">Use YYYY-MM-DD, separated by commas. Saved only in this browser.</p><p id="availability-error" role="alert" hidden></p><button id="save-timetable" class="button primary">Update my windows</button></dialog>
  <dialog id="help-dialog"><form method="dialog"><button class="dialog-close" aria-label="Close station guide">×</button></form><p class="eyebrow">A SMALL FIELD GUIDE</p><h2>Your first satellite session</h2><ol class="guide-list"><li><strong>Choose a window.</strong> The planner uses VAS Sunrise and the linked Secondary bell times. A higher pass usually gives you a clearer view.</li><li><strong>Check 96.5 FM.</strong> Connect your V3 and listen for the local station. This checks the receiver path.</li><li><strong>Collect an image.</strong> Start before the pass. Move outside with a clear sky view, keep your antenna connected, and leave the computer awake.</li><li><strong>Save your observation.</strong> Stop reception and download the image, frames, and metadata together.</li></ol><details><summary>What has been validated?</summary><p id="validation-summary">Recorded Meteor image reconstruction and generated OQPSK decoding are tested. The V3 is not connected for live hardware testing. A successful replay does not prove antenna reception.</p></details><details><summary>Orbit data and offline use</summary><p>The hosted station refreshes a shared orbital catalogue. Downloaded copies retain the included elements and can import an updated orbit JSON file. Predictions older than seven days are flagged; after fourteen days they are disabled.</p><input id="orbit-file" type="file" accept="application/json,.json" /></details><p class="fine-print">Orbit data: CelesTrak. Propagation: satellite.js. Map: Natural Earth. Receiver: Web RTL-SDR. Decoder: MeteorDemod, libcorrect, jpeg-js. <a href="./THIRD_PARTY_NOTICES.txt" target="_blank">Licenses and sources ↗</a></p></dialog>
  <div id="toast" class="toast" role="status" hidden></div>`;

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
let snapshot = initialSnapshot();
let orbits = snapshotOrbits(snapshot);
let windows: ReceptionWindow[] = [];
let selected: ReceptionWindow | null = null;
let previewAt: number | null = null;
let lessons: string[] = [];
let excludedDates: string[] = [];
let captureInfo: ReceiverInfo | null = null;
let capturedFrames = new ArrayBuffer(0);
let capturePlan: ReceptionWindow | null = null;
let capturedChannels: readonly number[] = [];
let captureOrbits = snapshot;
let lastError = '';
let toastTimer: ReturnType<typeof setTimeout>;
try {
  const saved = JSON.parse(localStorage.getItem('meteor.availability.v1') ?? '{}');
  if (Array.isArray(saved.lessons))
    lessons = saved.lessons.filter((id: unknown) =>
      BELL_PERIODS.some((period) => period.id === id && period.kind === 'lesson'),
    );
  if (Array.isArray(saved.excludedDates))
    excludedDates = saved.excludedDates.filter(
      (day: unknown) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day),
    );
} catch {
  /* Defaults remain available when local storage is unavailable. */
}
const map = new EarthMap(element('earth-map'));

function toast(message: string): void {
  clearTimeout(toastTimer);
  const layer = document.querySelector('dialog[open]') ?? document.body;
  layer.append(element('toast'));
  element('toast').textContent = message;
  element('toast').hidden = false;
  toastTimer = setTimeout(() => {
    element('toast').hidden = true;
  }, 7000);
}
function showPage(page: string): void {
  element('plan-page').hidden = page !== 'plan';
  element('receive-page').hidden = page !== 'receive';
  document
    .querySelectorAll<HTMLButtonElement>('[data-page]')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.page === page),
    );
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document
  .querySelectorAll<HTMLButtonElement>('[data-page]')
  .forEach((button) => (button.onclick = () => showPage(button.dataset.page!)));
document.querySelector<HTMLAnchorElement>('.brand')!.onclick = (event) => {
  event.preventDefault();
  showPage('plan');
};

function updateMap(): void {
  const stale = orbits.some(
    (orbit) => orbitAgeDays(orbit) > 14 || orbitAgeDays(orbit) < -1,
  );
  const time = stale
    ? Math.max(...orbits.map((orbit) => orbit.epoch))
    : (previewAt ?? Date.now());
  map.render(orbits, SUNRISE, time, previewAt ? selected?.pass : undefined);
  element('map-mode').textContent = stale
    ? `Saved orbit model · ${dayText(time)}`
    : previewAt
      ? `Pass preview · ${dayText(time)}, ${timeText(time)}`
      : 'Orbit positions · now';
  element('map-now').hidden = previewAt === null;
  element('orbit-readouts').innerHTML = orbits
    .map((orbit) => {
      const p = positionAt(orbit, time, SUNRISE);
      return `<div><span>${orbit.name}</span><strong>${p.elevation > 0 ? `${Math.round(p.elevation)}° above Sunrise` : 'Below your horizon'}</strong><small>${Math.round(p.altitudeKm)} km altitude</small></div>`;
    })
    .join('');
}

function selectWindow(window: ReceptionWindow, preview = true): void {
  selected = window;
  previewAt = preview
    ? Math.max(window.receiveFrom, Math.min(window.pass.peak, window.receiveUntil))
    : null;
  const direction = `${compass(window.pass.startAzimuth)} → ${compass(window.pass.endAzimuth)}`;
  element('recommended').innerHTML =
    `<div class="recommend-top"><span class="eyebrow">YOUR RECOMMENDED WINDOW</span><span class="pill">${window.kind === 'break' ? 'During a break' : 'Approved period'}</span></div><p class="window-date">${dayText(window.receiveFrom)} · ${window.label}</p><h2 class="window-time">${timeText(window.receiveFrom)}<span>– ${timeText(window.receiveUntil)}</span></h2><div class="window-satellite">${satIcon}<strong>${window.pass.name}</strong><span>${Math.round(window.maxElevation)}° high</span></div><div class="window-facts"><div><strong>${Math.floor(window.usableMinutes)} min</strong><span>to receive data</span></div><div><strong>${direction}</strong><span>across your sky</span></div></div><ol class="session-times"><li><span class="timeline-dot"></span><span>Set up your antenna</span><strong>${timeText(window.setupAt)}</strong></li><li><span class="timeline-dot filled"></span><span>Receive the satellite</span><strong>${timeText(window.receiveFrom)}</strong></li><li><span class="timeline-dot"></span><span>Packed away by</span><strong>${timeText(window.packedBy)}</strong></li></ol><p class="window-note">${window.completePass ? 'The whole usable pass fits in this window.' : 'A useful part of the pass fits. Reception starts or ends during the pass.'}</p><button class="button primary full" id="prepare">Prepare for this pass <span>→</span></button><button class="text-button" id="calendar">＋ Add session to calendar</button>`;
  element('prepare').onclick = () => showPage('receive');
  element('calendar').onclick = () => exportCalendar(window);
  element('antenna-plan').textContent =
    `${dayText(window.receiveFrom)}: set up at ${timeText(window.setupAt)}. The satellite moves ${direction} and reaches ${Math.round(window.maxElevation)}°.`;
  document
    .querySelectorAll('[data-pass]')
    .forEach((row) =>
      row.classList.toggle(
        'selected',
        row.getAttribute('data-pass') === window.pass.id,
      ),
    );
  updateMap();
}

function rebuildPlan(): void {
  orbits = snapshotOrbits(snapshot);
  const now = Date.now();
  const age = Math.max(...orbits.map((orbit) => orbitAgeDays(orbit, now)));
  const warning = element('orbit-warning');
  warning.hidden = age <= 7 && age >= -1;
  warning.textContent =
    age > 14 || age < -1
      ? 'These orbital elements are too old or dated in the future. Refresh orbit data before planning a session.'
      : 'Orbit data is more than seven days old. Refresh before relying on these pass times.';
  const passes =
    age <= 14 && age >= -1
      ? orbits.flatMap((orbit) =>
          predictPasses(orbit, SUNRISE, now, now + 7 * 86400000),
        )
      : [];
  windows = matchPasses(passes, orbits, SUNRISE, {
    ...DEFAULT_MATCH,
    allowedLessons: lessons,
    excludedDates,
    notBefore: now,
  });
  element('pass-list').innerHTML = windows.length
    ? `<div class="pass-head"><span>Day</span><span>Reception</span><span>School window</span><span>Satellite</span><span>Height</span><span></span></div>` +
      windows
        .slice(0, 12)
        .map(
          (window, index) =>
            `<button class="pass-row" data-pass="${window.pass.id}" data-index="${index}" aria-label="Choose ${window.pass.name}, ${dayText(window.receiveFrom)}, ${timeText(window.receiveFrom)}"><span>${dayText(window.receiveFrom)}</span><strong>${timeText(window.receiveFrom)} – ${timeText(window.receiveUntil)}</strong><span><i class="window-dot ${window.kind}"></i>${window.label}</span><span>${window.pass.name}</span><span class="height-label">${Math.round(window.maxElevation)}°</span><span class="row-arrow">↗</span></button>`,
        )
        .join('')
    : '<div class="no-passes"><h3>No suitable break window in the next seven days.</h3><p>Try adding an approved free period, or refresh older orbit data. A satellite pass can also fall outside the school day.</p></div>';
  document
    .querySelectorAll<HTMLButtonElement>('[data-index]')
    .forEach(
      (button) =>
        (button.onclick = () => selectWindow(windows[Number(button.dataset.index)]!)),
    );
  const previous =
    selected && windows.find((window) => window.pass.id === selected!.pass.id);
  if (windows.length) selectWindow(previous || windows[0]!, false);
  else {
    selected = null;
    previewAt = null;
    element('recommended').innerHTML =
      '<p class="eyebrow">LOOKING AHEAD</p><h2>No school window yet.</h2><p>Satellite orbits do not follow the school timetable. Adjust your available periods or use the radio check while you wait.</p><button class="button primary" id="empty-radio">Try the radio check →</button>';
    element('empty-radio').onclick = () => showPage('receive');
    updateMap();
  }
  element('orbit-source').textContent =
    `CelesTrak elements: ${orbits.map((orbit) => `${orbit.name} ${dayText(orbit.epoch)}`).join(' · ')}. Campus position: 10.7385° N, 106.6975° E.`;
}

function receiverButtons(busy: boolean): void {
  for (const id of ['fm-start', 'meteor-start', 'replay'])
    element<HTMLButtonElement>(id).disabled = busy;
  element<HTMLButtonElement>('stop').hidden = !busy;
  element<HTMLInputElement>('recording-file').disabled = busy;
  element<HTMLButtonElement>('save-image').disabled = busy || !capturedChannels.length;
}

function onReceiverEvent(event: ReceiverEvent): void {
  if (event.type === 'status') element('status-message').textContent = event.message;
  if (event.type === 'started') {
    receiverButtons(true);
    lastError = '';
    element('status-title').textContent =
      event.info.mode === 'fm'
        ? '96.5 FM radio check'
        : event.info.mode === 'meteor'
          ? 'Receiving from your antenna'
          : 'Recorded data · browser decoding';
    element('status-dot').classList.add('on');
    element('fm-controls').hidden = event.info.mode !== 'fm';
    if (event.info.mode !== 'fm') {
      captureInfo = event.info;
      capturePlan = selected;
      captureOrbits = snapshot;
      capturedFrames = new ArrayBuffer(0);
      capturedChannels = [];
      element('image-source').textContent =
        event.info.mode === 'meteor'
          ? 'Live receiver'
          : event.info.mode === 'replay'
            ? 'Recorded frames'
            : 'IQ file';
      element('image-empty').hidden = false;
      element('canvas-wrap').hidden = true;
      element('frame-count').textContent = '0';
      element('segment-count').textContent = '0';
      element('image-height').textContent = '—';
    }
  }
  if (event.type === 'ack') {
    element<HTMLMeterElement>('signal-meter').value = event.level.rms;
    element('signal-label').textContent =
      receiver.info?.mode === 'replay'
        ? 'Recorded data'
        : event.level.clippedFraction > 0.02
          ? 'Input is clipping'
          : 'Samples arriving';
    if (receiver.info?.mode !== 'fm') {
      element('frame-count').textContent = event.frames.toLocaleString();
      element('segment-count').textContent = event.segments.toLocaleString();
    }
    if (event.frames && receiver.info?.mode === 'meteor')
      element('status-title').textContent = 'Meteor data received';
  }
  if (event.type === 'image') {
    const canvas = element<HTMLCanvasElement>('weather-image');
    canvas.width = event.image.width;
    canvas.height = event.image.height;
    canvas
      .getContext('2d')!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(event.image.rgba),
          event.image.width,
          event.image.height,
        ),
        0,
        0,
      );
    element('image-empty').hidden = true;
    element('canvas-wrap').hidden = false;
    element('image-height').textContent = `${event.image.height}`;
    element('segment-count').textContent = event.image.segments.toLocaleString();
    const select = element<HTMLSelectElement>('channel');
    if (capturedChannels.join(',') !== event.image.channels.join(',')) {
      const value = select.value;
      select.innerHTML = event.image.channels
        .map((channel) => `<option value="${channel}">${channel}</option>`)
        .join('');
      if (event.image.channels.includes(Number(value))) select.value = value;
      capturedChannels = event.image.channels;
    }
    element('channel-label').hidden = false;
  }
  if (event.type === 'error') {
    lastError = event.message;
    element('status-title').textContent = 'A little help needed';
    element('status-message').textContent = event.message;
    toast(event.message);
  }
  if (event.type === 'stopped') {
    if (receiver.info?.mode !== 'fm') {
      capturedFrames = event.frames;
      element('frame-count').textContent = (
        capturedFrames.byteLength / 1024
      ).toLocaleString();
      if (receiver.info) captureInfo = receiver.info;
    }
    receiverButtons(false);
    element('status-dot').classList.remove('on');
    element('fm-controls').hidden = true;
    if (!lastError) {
      element('status-title').textContent =
        receiver.info?.mode === 'fm'
          ? 'Radio check finished'
          : capturedChannels.length
            ? 'Your image is ready to save'
            : 'Reception stopped';
      element('status-message').textContent =
        receiver.info?.mode === 'fm'
          ? 'If you heard the station, the radio path is working. Choose a pass to test Meteor reception.'
          : capturedChannels.length
            ? 'Download your image and its observation record.'
            : 'No image data decoded in this session. Try during a pass with a clear sky view.';
    }
  }
}
const receiver = new Receiver(onReceiverEvent);
async function run(action: () => Promise<void>): Promise<void> {
  receiverButtons(true);
  lastError = '';
  try {
    await action();
  } catch (error) {
    console.error('Station:', error);
    onReceiverEvent({ type: 'error', message: errorMessage(error) });
    receiverButtons(false);
  }
}
element('fm-start').onclick = () => void run(() => receiver.startRadio('fm'));
element('meteor-start').onclick = () => void run(() => receiver.startRadio('meteor'));
element('stop').onclick = () =>
  void receiver.stop().catch((error) => toast(errorMessage(error)));
element<HTMLInputElement>('volume').oninput = (event) =>
  receiver.volume(Number((event.target as HTMLInputElement).value) / 100);
element<HTMLSelectElement>('channel').onchange = (event) => {
  const channel = Number((event.target as HTMLSelectElement).value);
  if (receiver.running) receiver.channel(channel);
  else
    void Promise.all([
      import('@meteor/decoder/packets'),
      import('@meteor/decoder/image'),
    ])
      .then(([{ PacketAssembler }, { MeteorImage }]) => {
        const packets = new PacketAssembler();
        const image = new MeteorImage();
        const frames = new Uint8Array(capturedFrames);
        for (let offset = 0; offset < frames.length; offset += 1024) {
          for (const packet of packets.push(frames.subarray(offset, offset + 1024)))
            image.push(packet);
        }
        const result = image.snapshot(channel);
        if (result) onReceiverEvent({ type: 'image', image: result });
      })
      .catch((error) => toast(errorMessage(error)));
};
element('replay').onclick = () =>
  void run(async () => {
    const data = new Uint8Array(await (await fetch(replayUrl)).arrayBuffer());
    await receiver.replay(data);
  });
element<HTMLInputElement>('recording-file').onchange = (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file && file.size > 128 * 1024 * 1024) {
    toast('Choose a recording smaller than 128 MB.');
    return;
  }
  if (file)
    void run(async () =>
      receiver.replay(
        new Uint8Array(await file.arrayBuffer()),
        element<HTMLSelectElement>('recording-kind').value as 'replay' | 'iq-file',
      ),
    );
};
element('save-image').onclick = () => {
  if (captureInfo)
    void saveObservation(
      element<HTMLCanvasElement>('weather-image'),
      capturedFrames,
      captureInfo,
      SUNRISE,
      captureOrbits,
      capturePlan,
      capturedChannels,
      Number(element<HTMLSelectElement>('channel').value),
    ).catch((error) => toast(errorMessage(error)));
};
element('map-now').onclick = () => {
  previewAt = null;
  updateMap();
};
element('help-open').onclick = () =>
  element<HTMLDialogElement>('help-dialog').showModal();
const licenseLink = document.querySelector<HTMLAnchorElement>(
  'a[href="./THIRD_PARTY_NOTICES.txt"]',
)!;
licenseLink.onclick = (event) => {
  event.preventDefault();
  downloadBlob(new Blob([notices], { type: 'text/plain' }), 'THIRD_PARTY_NOTICES.txt');
};
element('help-footer').onclick = () =>
  element<HTMLDialogElement>('help-dialog').showModal();
element('timetable-open').onclick = () => {
  element('availability-error').hidden = true;
  element('lesson-options').innerHTML = BELL_PERIODS.filter(
    (period) => period.kind === 'lesson',
  )
    .map(
      (period) =>
        `<label><input type="checkbox" value="${period.id}" ${lessons.includes(period.id) ? 'checked' : ''} /><span><strong>${period.label}</strong><small>${period.from}–${period.until}</small></span></label>`,
    )
    .join('');
  element<HTMLInputElement>('excluded-dates').value = excludedDates.join(', ');
  element<HTMLDialogElement>('timetable-dialog').showModal();
};
element('save-timetable').onclick = () => {
  let dates: string[];
  try {
    dates = parseSchoolDates(element<HTMLInputElement>('excluded-dates').value);
  } catch (error) {
    element('availability-error').textContent = errorMessage(error);
    element('availability-error').hidden = false;
    element<HTMLInputElement>('excluded-dates').focus();
    return;
  }
  lessons = [
    ...document.querySelectorAll<HTMLInputElement>('#lesson-options input:checked'),
  ].map((input) => input.value);
  excludedDates = dates;
  try {
    localStorage.setItem(
      'meteor.availability.v1',
      JSON.stringify({ lessons, excludedDates }),
    );
  } catch {
    toast('Your browser cannot save settings; they will last for this visit.');
  }
  element<HTMLDialogElement>('timetable-dialog').close();
  rebuildPlan();
};
element('refresh-orbits').onclick = () =>
  void refreshSnapshot()
    .then((value) => {
      snapshot = value;
      rebuildPlan();
      toast('Orbit catalogue loaded. Freshness is checked from the element epochs.');
    })
    .catch((error) => toast(errorMessage(error)));
element('export-orbits').onclick = () =>
  downloadBlob(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    'meteor-orbits.json',
  );
element<HTMLInputElement>('orbit-file').onchange = (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file)
    void file
      .text()
      .then((text) => {
        snapshot = parseSnapshot(JSON.parse(text));
        rebuildPlan();
        toast('Imported orbital elements.');
      })
      .catch((error) => toast(errorMessage(error)));
};
if (!Receiver.supported) {
  element('browser-notice').hidden = false;
  element('browser-notice').textContent =
    'For USB reception, open this station in Chrome or Edge on Mac or Windows. Planning and recorded-data replay work here.';
}
if (location.protocol === 'file:') element('download-app').hidden = true;
function clock(): void {
  element('school-clock').textContent =
    `${dayText(Date.now())} · ${timeText(Date.now())}`;
}
clock();
rebuildPlan();
setInterval(clock, 1000);
setInterval(() => {
  if (!receiver.running && !element('plan-page').hidden) rebuildPlan();
}, 60000);
setInterval(() => {
  if (!element('plan-page').hidden) updateMap();
}, 15000);
if (location.protocol !== 'file:')
  void refreshSnapshot()
    .then((value) => {
      snapshot = value;
      rebuildPlan();
    })
    .catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (
    document.hidden &&
    receiver.running &&
    ['meteor', 'fm'].includes(receiver.info?.mode ?? '')
  ) {
    toast(
      'Reception stopped because the tab was hidden. Keep it visible during a pass.',
    );
    void receiver
      .stop()
      .catch((error) => console.error('Stopping hidden receiver:', error));
  }
});
