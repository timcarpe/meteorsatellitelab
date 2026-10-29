/** Student station entry point: plan, check the radio, receive, and save. */
import '@meteor/ui/style.css';
import '@meteor/ui/fonts.css';
import replayUrl from '@meteor/data/replay.cadu?url';
import notices from '../../THIRD_PARTY_NOTICES.txt?raw';
import { SUNRISE, SCHOOL_TIMEZONE, type ReceptionWindow } from '@meteor/core/models';
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
import { EarthMap, type MapView } from '@meteor/map/earth';
import {
  Receiver,
  type ReceiverEvent,
  type ReceiverInfo,
} from '@meteor/radio/receiver';
import { saveObservation, exportCalendar } from '@meteor/exports/observation';
import { SpectrumView } from '@meteor/radio/spectrum-view';
import { AudioView } from '@meteor/radio/audio-view';
import { compass, dayText, timeText, downloadBlob } from '@meteor/ui/format';

const satIcon =
  '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7 6 5 5-6 6-5-5zm18 9 6 6-6 6-6-6zM14 9l9 9-8 8-9-9z" stroke="currentColor" stroke-width="1.6"/><path d="m20 5 7 7m-8-4 5 5M9 24l-5 5" stroke="currentColor" stroke-width="1.6"/></svg>';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#plan">${satIcon}<span>Meteor</span></a>
    <span class="campus-name">VAS Sunrise</span>
    <nav aria-label="Main navigation">
      <button class="nav-link active" data-page="plan" aria-current="page">Plan</button>
      <button class="nav-link" data-page="receive">Receive</button>
    </nav>
    <button class="help-button" id="help-open" aria-label="Open station guide">Help</button>
  </header>
  <main>
    <section id="plan-page" aria-label="Pass planner">
      <h1 class="sr-only">Meteor pass planner</h1>
      <div class="plan-toolbar"><span id="school-clock"></span><span>School time · UTC+7</span></div>
      <div id="orbit-warning" class="notice" hidden role="status"></div>
      <div class="plan-grid">
        <article class="earth-card">
          <div class="map-header">
            <div class="map-views" role="group" aria-label="Map view">
              <button data-map-view="sunrise" aria-pressed="true">Sunrise</button>
              <button data-map-view="global" aria-pressed="false">Global</button>
            </div>
            <div class="map-time-controls" role="group" aria-label="Map time"><button id="map-now" aria-pressed="true">Live</button><button id="map-preview" aria-pressed="false">Pass preview</button><button id="map-refresh" aria-label="Refresh satellite positions and orbit data">↻ Refresh</button></div>
          </div>
          <div class="map-update"><span id="map-mode">Live position</span><span id="map-cadence">Updates every 15 s</span></div><div id="earth-map"></div>
          <div class="map-footer"><span><i class="legend-line satellite-one"></i>M2-3</span><span><i class="legend-line satellite-two"></i>M2-4</span><span class="map-key">Solid: past · Dashed: next 95 min</span></div>
          <div class="orbit-readouts" id="orbit-readouts"></div>
        </article>
        <article class="window-card" id="recommended" aria-label="Selected pass"></article>
      </div>
      <section class="week-section" aria-labelledby="week-title">
        <div class="section-heading"><h2 id="week-title">Passes this week</h2><button id="timetable-open" class="button secondary">Availability</button></div>
        <div id="pass-list" class="pass-list"></div>
      </section>
    </section>
    <section id="receive-page" aria-label="Receiver" hidden>
      <h1 class="sr-only">Receive Meteor</h1>
      <div id="browser-notice" class="notice" hidden></div>
      <div class="receiver-toolbar"><div class="mode-switch" role="group" aria-label="Receiver mode"><button data-receiver-mode="meteor" aria-pressed="true">Satellite</button><button data-receiver-mode="fm" aria-pressed="false">Radio</button></div><span id="mode-hint">Meteor weather images</span></div>
      <div class="receive-grid">
        <article class="receiver-card">
          <div class="tuner">
            <div class="tuner-heading"><span id="frequency-label">Center frequency</span><span id="signal-state">Idle</span></div>
            <div class="frequency-readout"><strong id="frequency-value">137.900</strong><span id="frequency-unit">MHz</span></div>
            <div class="tuner-specs"><span id="modulation">OQPSK · 72 ksym/s</span><span id="sample-rate">288 kS/s</span></div>
          </div>
          <div class="receiver-body">
            <p id="frequency-note">Automatically checks 137.9 and 137.1 MHz.</p>
            <p id="antenna-plan" class="antenna-plan">Select a pass in Plan.</p>
            <div class="receiver-actions"><button id="meteor-start" class="button primary">Start satellite reception</button><button id="fm-start" class="button primary" hidden>Listen to 96.5 FM</button><button id="stop" class="button stop" hidden>Stop</button></div>
            <p id="mode-note" class="fine-print">Connect your V3 and antenna. Keep this tab visible while receiving.</p>
          </div>
          <div class="signal-header"><h2>Signal</h2><span>Relative power · dBFS</span></div>
          <canvas id="signal-plot" aria-label="Measured radio spectrum and waterfall; empty until IQ samples arrive"></canvas>
          <div class="signal-detail"><span>Input level</span><meter id="signal-meter" min="0" max="1" value="0" aria-label="Radio input level"></meter><span id="signal-label">No samples</span></div>
          <div class="receiver-metrics"><div><span>Elapsed</span><strong id="elapsed-time">00:00</strong></div><div><span>Samples</span><strong id="sample-count">—</strong></div><div><span>Frame gaps</span><strong id="data-gaps">—</strong></div></div>
          <div class="receiver-status" role="status" aria-live="polite"><span id="status-dot" class="status-dot"></span><div><strong id="status-title">Ready</strong><p id="status-message">Connect a V3 to begin.</p></div></div>
        </article>
        <div class="output-stack">
          <article class="image-card" id="satellite-output">
            <div class="image-header"><h2>Weather image</h2><span id="image-source">No data</span></div>
            <div id="image-empty" class="image-empty"><p>Image strips appear here as they arrive.</p><button id="replay" class="button secondary">Try recorded data</button></div>
            <div id="canvas-wrap" hidden><canvas id="weather-image" aria-label="Decoded grayscale MSU-MR weather image"></canvas></div>
            <div class="image-stats"><span><strong id="frame-count">0</strong> frames</span><span><strong id="segment-count">0</strong> segments</span><span><strong id="image-height">—</strong> lines</span></div>
            <div class="image-actions"><label id="channel-label" hidden>Channel <select id="channel"></select></label><button id="save-image" class="button primary" disabled>Save image + data</button></div>
            <p class="fine-print image-caption" id="image-caption">PNG, received frames and observation details.</p>
          </article>
          <article class="radio-card" id="radio-output" hidden>
            <div class="image-header"><h2>Radio audio</h2><span>96.5 FM · Mono</span></div>
            <canvas id="audio-plot" aria-label="Waveform of received FM audio; empty until audio arrives"></canvas>
            <div class="radio-body"><div id="fm-controls"><label class="volume-label">Volume <input id="volume" type="range" min="0" max="100" value="35" /><output id="volume-value">35%</output></label></div><p><strong>Optional receiver check</strong></p><p>Listen for the local station to check your V3 and antenna connection. Satellite reception works without this step.</p><p class="fine-print">Stops after 60 seconds. FM reception does not confirm a Meteor signal.</p></div>
          </article>
        </div>
      </div>
      <details class="advanced"><summary>Recording files and USB help</summary><div class="advanced-content"><div><h3>Open a recording</h3><p>CADU image packets or raw unsigned 8-bit IQ at 288,000 samples/second.</p><label class="file-label">File type <select id="recording-kind"><option value="replay">Meteor CADU frames</option><option value="iq-file">Raw IQ · CU8 · 288 kS/s</option></select></label><input id="recording-file" type="file" accept=".cadu,.cu8,.raw,.bin" /></div><div><h3>USB connection</h3><p>Use Chrome or Edge. Close any other app using the receiver.</p><p>Windows may need WinUSB for <strong>Bulk-In, Interface 0</strong>. Follow the <a href="https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/" target="_blank" rel="noreferrer">RTL-SDR setup guide</a>.</p><p>Mac usually needs no separate driver. Live V3 testing is pending.</p></div></div></details>
    </section>
    <footer>
      <details class="orbit-info"><summary>Orbit data</summary><p id="orbit-source"></p><div class="data-actions"><button id="refresh-orbits" class="text-button">Refresh</button><button id="export-orbits" class="text-button">Export JSON</button></div></details>
      <a href="./meteor-station.html" download="meteor-station.html" id="download-app">Download HTML</a>
    </footer>
  </main>
  <dialog id="timetable-dialog" aria-labelledby="availability-title">
    <form method="dialog"><button class="dialog-close" aria-label="Close timetable settings">×</button></form>
    <h2 id="availability-title">When can you go outside?</h2>
    <p>Choose times you can use for a satellite session.</p>
    <div class="availability-body">
      <section aria-labelledby="included-title"><h3 id="included-title">Breaks are already included</h3><div class="included-breaks">${BELL_PERIODS.filter(
        (period) => period.kind === 'break',
      )
        .map(
          (period) =>
            `<div><strong>${period.label}</strong><span>${period.from}–${period.until}</span></div>`,
        )
        .join('')}</div></section>
      <section aria-labelledby="periods-title"><h3 id="periods-title">Add free periods</h3><p>Select only periods when you are free or have your teacher’s permission.</p><div id="lesson-options" class="lesson-options"></div></section>
      <section aria-labelledby="days-title"><h3 id="days-title">Days you cannot attend</h3><p>Add school holidays, trips or other days off.</p><div class="date-entry"><label class="field-label">Date<input id="excluded-date" type="date" /></label><button id="add-excluded-date" class="button secondary">Add day</button></div><div id="excluded-date-list" class="date-list" aria-live="polite"></div><p id="availability-error" role="alert" hidden></p></section>
      <details class="timetable-reference"><summary>How windows are matched</summary><p>Regular Monday–Friday timetable. Breaks come first, with 5 minutes to set up and 3 minutes to pack away.</p><a href="${TIMETABLE_SOURCE}" target="_blank" rel="noreferrer">View the Secondary timetable</a></details>
    </div>
    <div class="dialog-actions"><span>Saved on this device</span><button id="save-timetable" class="button primary">Save availability</button></div>
  </dialog>
  <dialog id="help-dialog" aria-labelledby="help-title">
    <form method="dialog"><button class="dialog-close" aria-label="Close station guide">×</button></form>
    <h2 id="help-title">Station guide</h2>
    <ol class="guide-list"><li>Select a pass. Use Sunrise for the regional path or Global for the full orbit.</li><li>Connect your V3 and antenna. Use Radio mode for an optional 96.5 FM check.</li><li>Start Meteor reception before the pass. Stay outside with a clear sky view and keep this tab visible.</li><li>Stop and save your image and data.</li></ol>
    <details><summary>Reception and testing</summary><p id="validation-summary">Recorded images and generated OQPSK decoding are tested. Live V3 reception is pending. Hearing FM confirms the radio path; Meteor also needs a suitable antenna and an active transmitter.</p></details>
    <details><summary>Orbit data and offline use</summary><p>The hosted station refreshes its orbit data. Downloaded copies can import an updated JSON file. Predictions are flagged after seven days and disabled after fourteen.</p><input id="orbit-file" type="file" accept="application/json,.json" /></details>
    <p class="fine-print">CelesTrak · satellite.js · Natural Earth · Web RTL-SDR · MeteorDemod · libcorrect · jpeg-js. <a href="./THIRD_PARTY_NOTICES.txt" target="_blank">Licenses and sources</a></p>
  </dialog>
  <div id="toast" class="toast" role="status" hidden></div>`;

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
let snapshot = initialSnapshot();
let orbits = snapshotOrbits(snapshot);
let windows: ReceptionWindow[] = [];
let selected: ReceptionWindow | null = null;
let previewAt: number | null = null;
let lessons: string[] = [];
let excludedDateDraft: string[] = [];
let sessionStarted: number | null = null;
let sampleCount = 0;
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
    excludedDates = saved.excludedDates.filter((day: unknown) => {
      try {
        return typeof day === 'string' && parseSchoolDates(day).length === 1;
      } catch {
        return false;
      }
    });
} catch {
  /* Defaults remain available when local storage is unavailable. */
}
const map = new EarthMap(element('earth-map'));
const spectrum = new SpectrumView(element<HTMLCanvasElement>('signal-plot'));
const audioView = new AudioView(element<HTMLCanvasElement>('audio-plot'));
const mapTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHOOL_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
document.querySelectorAll<HTMLButtonElement>('[data-map-view]').forEach((button) => {
  button.onclick = () => {
    map.setView(button.dataset.mapView as MapView);
    document
      .querySelectorAll('[data-map-view]')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    updateMap();
  };
});

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
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
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
      ? `Preview · ${dayText(time)}, ${timeText(time)}`
      : `Live position · ${mapTime.format(time)}`;
  element('map-cadence').textContent = stale
    ? 'Refresh orbit data'
    : previewAt
      ? 'Fixed pass time'
      : 'Updates every 15 s';
  element('map-now').setAttribute('aria-pressed', String(previewAt === null));
  element('map-preview').setAttribute('aria-pressed', String(previewAt !== null));
  element<HTMLButtonElement>('map-preview').disabled = selected === null || stale;
  element('orbit-readouts').innerHTML = orbits
    .map((orbit) => {
      const p = positionAt(orbit, time, SUNRISE);
      return `<div><span>${orbit.name}</span><strong>${p.elevation > 0 ? `${Math.round(p.elevation)}° above Sunrise` : 'Below horizon'}</strong><small>${Math.round(p.altitudeKm)} km altitude</small></div>`;
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
    `<div class="recommend-top"><h2>Selected pass</h2><span class="pill">${window.kind === 'break' ? 'Break' : 'Free period'}</span></div>
    <p class="window-date">${dayText(window.receiveFrom)} · ${window.label}</p>
    <p class="window-time">${timeText(window.receiveFrom)}–${timeText(window.receiveUntil)}</p>
    <p class="window-satellite">${window.pass.name} · ${Math.round(window.maxElevation)}° · ${Math.floor(window.usableMinutes)} min · ${direction}</p>
    <ol class="session-times"><li><span>Set up</span><strong>${timeText(window.setupAt)}</strong></li><li><span>Receive</span><strong>${timeText(window.receiveFrom)}</strong></li><li><span>Pack away by</span><strong>${timeText(window.packedBy)}</strong></li></ol>
    ${window.completePass ? '' : '<p class="window-note">Partial pass: reception is limited by your availability.</p>'}
    <button class="button primary full" id="prepare">Prepare receiver</button><button class="text-button" id="calendar">Add to calendar</button>`;
  element('prepare').onclick = () => {
    setReceiverMode('meteor');
    showPage('receive');
  };
  element('calendar').onclick = () => exportCalendar(window);
  element('antenna-plan').textContent =
    `${dayText(window.receiveFrom)} · Set up ${timeText(window.setupAt)} · Receive ${timeText(window.receiveFrom)}–${timeText(window.receiveUntil)} · ${direction}`;
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
            `<button class="pass-row" data-pass="${window.pass.id}" data-index="${index}" aria-label="Choose ${window.pass.name}, ${dayText(window.receiveFrom)}, ${timeText(window.receiveFrom)}"><span>${dayText(window.receiveFrom)}</span><strong>${timeText(window.receiveFrom)} – ${timeText(window.receiveUntil)}</strong><span><i class="window-dot ${window.kind}"></i>${window.label}</span><span>${window.pass.name}</span><span class="height-label">${Math.round(window.maxElevation)}°</span><span class="row-arrow" aria-hidden="true">›</span></button>`,
        )
        .join('')
    : '<div class="no-passes"><p>No matching passes in the next seven days. Add a free period or refresh orbit data.</p></div>';
  document
    .querySelectorAll<HTMLButtonElement>('[data-index]')
    .forEach(
      (button) =>
        (button.onclick = () => selectWindow(windows[Number(button.dataset.index)]!)),
    );
  const previous =
    selected && windows.find((window) => window.pass.id === selected!.pass.id);
  if (windows.length)
    selectWindow(previous || windows[0]!, previous ? previewAt !== null : false);
  else {
    selected = null;
    previewAt = null;
    element('recommended').innerHTML =
      '<h2>No matching pass</h2><p>Adjust your availability to include more school periods.</p><button class="button primary" id="empty-radio">Open receiver</button>';
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
  document
    .querySelectorAll<HTMLButtonElement>('[data-receiver-mode]')
    .forEach((button) => {
      button.disabled = busy;
    });
  element<HTMLInputElement>('recording-file').disabled = busy;
  element<HTMLButtonElement>('save-image').disabled = busy || !capturedChannels.length;
}

function onReceiverEvent(event: ReceiverEvent): void {
  if (event.type === 'spectrum') spectrum.update(event.data);
  if (event.type === 'audio') audioView.update(event.data);
  if (event.type === 'tuned') {
    updateInstrument(event.info);
    spectrum.reset('Waiting for samples on this channel');
  }
  if (event.type === 'status') element('status-message').textContent = event.message;
  if (event.type === 'started') {
    setReceiverMode(event.info.mode === 'fm' ? 'fm' : 'meteor', true);
    updateInstrument(event.info);
    spectrum.reset(
      event.info.mode === 'replay'
        ? 'Frame replay · no radio samples'
        : 'Waiting for radio samples',
    );
    audioView.reset();
    sampleCount = 0;
    element<HTMLMeterElement>('signal-meter').value = 0;
    element('signal-label').textContent = 'Waiting for samples';
    element('elapsed-time').textContent = '00:00';
    sessionStarted = Date.now();
    element('signal-state').textContent =
      event.info.mode === 'replay' || event.info.mode === 'iq-file'
        ? 'Recording'
        : 'Receiving';
    element('sample-count').textContent = '—';
    element('data-gaps').textContent = '—';
    receiverButtons(true);
    lastError = '';
    element('status-title').textContent =
      event.info.mode === 'fm'
        ? '96.5 FM radio check'
        : event.info.mode === 'meteor'
          ? 'Receiving from your antenna'
          : 'Recorded data · browser decoding';
    element('status-dot').classList.add('on');
    if (event.info.mode === 'fm')
      receiver.volume(Number(element<HTMLInputElement>('volume').value) / 100);
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
    sampleCount += event.level.samples;
    element('sample-count').textContent = sampleCount
      ? `${(sampleCount / 1e6).toFixed(2)} M`
      : '—';
    element('data-gaps').textContent =
      receiver.info?.mode === 'fm' ? '—' : event.gaps.toLocaleString();
    element<HTMLMeterElement>('signal-meter').value = event.level.rms;
    element('signal-label').textContent =
      receiver.info?.mode === 'replay'
        ? 'Recorded data'
        : event.level.clippedFraction > 0.02
          ? 'Input is clipping'
          : `${(20 * Math.log10(Math.max(1e-6, event.level.rms))).toFixed(1)} dBFS`;
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
    element('status-title').textContent = 'Receiver error';
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
    updateElapsed();
    sessionStarted = null;
    element('signal-state').textContent = 'Stopped';
    if (!lastError) {
      element('status-title').textContent =
        receiver.info?.mode === 'fm'
          ? 'Radio check finished'
          : capturedChannels.length
            ? 'Image ready'
            : 'Reception stopped';
      element('status-message').textContent =
        receiver.info?.mode === 'fm'
          ? 'Audio confirms the radio path. Meteor reception needs a satellite pass.'
          : capturedChannels.length
            ? 'Save the image and received data.'
            : 'No image data decoded in this session. Try during a pass with a clear sky view.';
    }
  }
}
const receiver = new Receiver(onReceiverEvent);
function updateElapsed(): void {
  if (sessionStarted === null) return;
  const seconds = Math.floor((Date.now() - sessionStarted) / 1000);
  element('elapsed-time').textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function updateInstrument(info: ReceiverInfo): void {
  const recorded = info.mode === 'replay' || info.mode === 'iq-file';
  element('frequency-value').textContent =
    info.frequency > 0 ? (info.frequency / 1e6).toFixed(3) : '—';
  element('frequency-unit').textContent = info.frequency > 0 ? 'MHz' : 'Unknown';
  element('sample-rate').textContent =
    info.mode === 'replay'
      ? 'CADU frames'
      : `${(info.sampleRate / 1000).toFixed(0)} kS/s`;
  element('antenna-plan').hidden = recorded || info.mode === 'fm';
  if (recorded) {
    element('frequency-note').textContent =
      info.mode === 'replay'
        ? 'Recorded image packets · no radio spectrum.'
        : 'Recorded IQ samples · center frequency was not supplied.';
    element('mode-note').textContent = 'Recording decoded on this computer.';
    if (info.mode === 'replay') element('modulation').textContent = 'Decoded packets';
  }
  spectrum.configure(info.frequency, info.sampleRate);
}
function setReceiverMode(mode: 'meteor' | 'fm', force = false): void {
  if (receiver.running && !force) return;
  const radio = mode === 'fm';
  document
    .querySelectorAll<HTMLButtonElement>('[data-receiver-mode]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.receiverMode === mode)),
    );
  element('satellite-output').hidden = radio;
  element('radio-output').hidden = !radio;
  element('meteor-start').hidden = radio;
  element('fm-start').hidden = !radio;
  element('antenna-plan').hidden = radio;
  element('mode-hint').textContent = radio
    ? 'Optional receiver check'
    : 'Meteor weather images';
  element('frequency-note').textContent = radio
    ? 'Local FM station · fixed at 96.5 MHz.'
    : 'Automatically checks 137.9 and 137.1 MHz.';
  element('mode-note').textContent = radio
    ? 'Optional check. Stops automatically after 60 seconds.'
    : 'Connect your V3 and antenna. Keep this tab visible while receiving.';
  element('modulation').textContent = radio ? 'Wide FM · Mono' : 'OQPSK · 72 ksym/s';
  if (!force) {
    updateInstrument({
      mode,
      frequency: radio ? 96500000 : 137900000,
      sampleRate: 288000,
      startedAt: '',
    });
    spectrum.reset('Start reception to view the signal');
    audioView.reset();
    element('signal-state').textContent = 'Idle';
    element('signal-label').textContent = 'No samples';
    element<HTMLMeterElement>('signal-meter').value = 0;
    element('sample-count').textContent = '—';
    element('data-gaps').textContent = '—';
    element('elapsed-time').textContent = '00:00';
    element('status-title').textContent = 'Ready';
    element('status-message').textContent = 'Connect a V3 to begin.';
  }
}
document
  .querySelectorAll<HTMLButtonElement>('[data-receiver-mode]')
  .forEach((button) => {
    button.onclick = () =>
      setReceiverMode(button.dataset.receiverMode as 'meteor' | 'fm');
  });

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
element<HTMLInputElement>('volume').oninput = (event) => {
  const volume = Number((event.target as HTMLInputElement).value);
  element('volume-value').textContent = `${volume}%`;
  receiver.volume(volume / 100);
};
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
element('map-preview').onclick = () => {
  if (selected) selectWindow(selected);
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
function renderExcludedDates(): void {
  element('excluded-date-list').replaceChildren();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  });
  for (const date of excludedDateDraft) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = formatter.format(new Date(`${date}T00:00:00+07:00`));
    const remove = document.createElement('button');
    remove.className = 'text-button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${label.textContent}`);
    remove.onclick = () => {
      excludedDateDraft = excludedDateDraft.filter((day) => day !== date);
      renderExcludedDates();
    };
    row.append(label, remove);
    element('excluded-date-list').append(row);
  }
  if (!excludedDateDraft.length)
    element('excluded-date-list').textContent = 'No days excluded.';
}
function addExcludedDate(required: boolean): boolean {
  const input = element<HTMLInputElement>('excluded-date');
  element('availability-error').hidden = true;
  if (!input.value && !required) return true;
  try {
    if (!input.value) throw new Error('Choose a date first.');
    const dates = parseSchoolDates(input.value);
    excludedDateDraft = [...new Set([...excludedDateDraft, ...dates])].sort();
    input.value = '';
    renderExcludedDates();
    return true;
  } catch (error) {
    element('availability-error').textContent = errorMessage(error);
    element('availability-error').hidden = false;
    input.focus();
    return false;
  }
}
element('add-excluded-date').onclick = () => {
  addExcludedDate(true);
};
element('timetable-open').onclick = () => {
  element('availability-error').hidden = true;
  element('lesson-options').innerHTML = BELL_PERIODS.filter(
    (period) => period.kind === 'lesson',
  )
    .map(
      (period) =>
        `<label><span><strong>${period.label}</strong><span>${period.from}–${period.until}</span></span><input type="checkbox" value="${period.id}" ${lessons.includes(period.id) ? 'checked' : ''} /></label>`,
    )
    .join('');
  excludedDateDraft = [...excludedDates];
  element<HTMLInputElement>('excluded-date').value = '';
  renderExcludedDates();
  element<HTMLDialogElement>('timetable-dialog').showModal();
};
element('save-timetable').onclick = () => {
  if (!addExcludedDate(false)) return;
  lessons = [
    ...document.querySelectorAll<HTMLInputElement>('#lesson-options input:checked'),
  ].map((input) => input.value);
  excludedDates = [...excludedDateDraft];
  try {
    localStorage.setItem(
      'meteor.availability.v1',
      JSON.stringify({ lessons, excludedDates }),
    );
  } catch {
    toast('Settings will last for this visit; this browser cannot save them.');
  }
  element<HTMLDialogElement>('timetable-dialog').close();
  rebuildPlan();
};
element('map-refresh').onclick = async () => {
  const button = element<HTMLButtonElement>('map-refresh');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  previewAt = null;
  updateMap();
  try {
    snapshot = await refreshSnapshot();
    rebuildPlan();
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = '↻ Refresh';
  }
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
  updateElapsed();
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
