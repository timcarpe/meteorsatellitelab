/** Reception outcomes and local session history, independent of the live image. */
import type { Receiver, ReceiverEvent, ReceiverInfo } from '@meteor/radio/receiver';
import { CaptureJournal, readCaptureFrames } from './journal';
import { BrowserCaptureStore } from './storage';
import { captureDescription, formatBytes, originLabel, type CaptureOrigin, type CaptureRecord } from './model';
import { chooseArchiveSink, writeCaptureArchive } from './export';

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const localTime = (iso: string): string => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export interface CapturePanelOptions {
  receiver: Receiver;
  canvas: HTMLCanvasElement;
  context(): unknown;
  frames(data: ArrayBuffer): void;
  clear(): void;
  busy(value: boolean): void;
  toast(message: string): void;
  review(record: CaptureRecord, frames: ArrayBuffer): Promise<void>;
}

export class CapturePanel {
  private readonly store = new BrowserCaptureStore();
  private journal: CaptureJournal | null = null;
  private viewed: CaptureRecord | null = null;
  private origin: CaptureOrigin = 'imported';
  private inputName: string | null = null;
  private working = false;
  private controlsBusy = false;
  private saving = false;
  private records: CaptureRecord[] = [];
  private historyError = '';

  public constructor(private readonly options: CapturePanelOptions) {
    const summary = document.createElement('section');
    summary.className = 'capture-summary';
    summary.id = 'capture-summary';
    summary.setAttribute('aria-labelledby', 'capture-heading');
    summary.innerHTML = `
      <div class="capture-heading"><h2 id="capture-heading">Your reception</h2><span id="capture-source">Live antenna</span></div>
      <div class="capture-outcome" role="status" aria-live="polite"><strong id="capture-result">Ready to record</strong><p id="capture-explanation">Start live reception. Images are decoded automatically; you do not need to load a sample or generate them separately.</p></div>
      <div class="capture-steps" aria-label="Reception progress">
        <div><span>1 · Radio samples</span><strong id="capture-input">0</strong></div>
        <div><span>2 · Decoded frames</span><strong id="capture-frames">0</strong></div>
        <div><span>3 · Image segments</span><strong id="capture-segments">0</strong></div>
      </div>
      <p id="capture-times" class="capture-detail">A session is kept even when no image is recovered.</p>
      <p id="capture-storage" class="capture-detail">Live samples and recovered data are saved on this device, in this browser. Nothing is uploaded. Allow about 33 MiB per minute.</p>
      <p id="capture-error" class="capture-error" role="alert" hidden></p>
      <div class="capture-export"><button id="export-capture" class="button primary" disabled>Export session</button><label><input id="export-raw" type="checkbox" checked />Include raw radio data</label></div>
      <p id="capture-export-status" class="capture-detail" aria-live="polite">Export works with or without an image. Browser storage is not a backup.</p>`;
    byId('satellite-output').before(summary);
    const history = document.createElement('section');
    history.className = 'capture-history';
    history.setAttribute('aria-labelledby', 'capture-history-title');
    history.innerHTML = `<div class="section-heading"><div><h2 id="capture-history-title">Saved sessions on this device</h2><p>Stored in this browser for this site. Clearing site data removes them; export important sessions.</p></div><button id="refresh-captures" class="button outlined">Refresh sessions</button></div><div id="capture-history-list"></div>`;
    document.querySelector('.receive-grid')!.after(history);
    byId('export-capture').onclick = () => {
      if (this.viewed) void this.export(this.viewed, true);
    };
    byId('refresh-captures').onclick = () => void this.refreshHistory();
    setInterval(() => this.render(), 1000);
    void this.refreshHistory();
  }

  public get source(): CaptureOrigin | null { return this.viewed?.origin ?? null; }
  public get busy(): boolean { return this.working; }
  public configure(origin: CaptureOrigin, inputName: string | null = null): void {
    this.origin = origin;
    this.inputName = inputName;
  }
  public setControlsBusy(busy: boolean): void {
    this.controlsBusy = busy;
    byId<HTMLButtonElement>('export-capture').disabled = busy || this.working || !this.viewed;
    document.querySelectorAll<HTMLButtonElement>('#capture-history-list button').forEach((button) => {
      button.disabled = busy || this.working;
    });
  }
  private lock(value: boolean): void {
    this.working = value;
    this.options.busy(value);
    byId<HTMLButtonElement>('stop').hidden = !this.options.receiver.running;
  }
  public raw(data: ArrayBuffer, info: ReceiverInfo): void {
    if (!this.journal || this.journal.finished)
      throw new Error('Local recording was not initialized; reception stopped to avoid unrecorded data.');
    this.journal.raw(data, info);
  }

  public handle(event: ReceiverEvent): void {
    if (event.type === 'started') {
      if (event.info.mode === 'fm') { this.journal = null; return; }
      const origin = event.info.mode === 'meteor' ? 'live' : this.origin;
      const journal = new CaptureJournal(this.store, event.info, origin,
        this.options.context(), (message) => {
          this.options.toast(message);
          if (this.journal === journal && this.options.receiver.running)
            void this.options.receiver.stop('Local recording storage failed').catch((error) => this.options.toast(messageOf(error)));
          this.render();
        }, origin === 'live' ? null : this.inputName);
      this.journal = journal;
      this.viewed = journal.record;
      byId('capture-export-status').textContent = 'Recording locally. Stop to export this session.';
      this.render();
      return;
    }
    if (event.type === 'image' && this.viewed) {
      this.viewed.image = { width: event.image.width, height: event.image.height,
        channel: event.image.channel, channels: [...event.image.channels] };
      this.viewed.imageSegments = event.image.segments;
    }
    const journal = this.journal;
    if (!journal || journal.finished) return;
    try {
      if (event.type === 'status') journal.log('status', event.message);
      if (event.type === 'tuned') {
        journal.record.input = { ...event.info };
        journal.log('tuned', `${event.info.frequency} Hz at ${event.info.sampleRate} samples/second`);
      }
      if (event.type === 'ack') journal.metrics({
        samples: event.level.samples, frames: event.frames, segments: event.segments,
        gaps: event.gaps, rms: event.level.rms, clippedFraction: event.level.clippedFraction,
      });
      if (event.type === 'frames') {
        journal.frames(event.data);
        journal.metrics({ samples: 0, frames: event.count, segments: event.segments,
          gaps: event.gaps, rms: 0, clippedFraction: 0 });
      }
      if (event.type === 'error') journal.error(event.message);
      if (event.type === 'stopped') void this.finish(journal, event.reason ?? 'Reception stopped');
    } catch (error) {
      journal.error(messageOf(error));
      this.options.toast(messageOf(error));
      if (this.options.receiver.running)
        void this.options.receiver.stop('Recording error').catch((failure) => this.options.toast(messageOf(failure)));
    }
  }

  private async png(): Promise<ArrayBuffer | undefined> {
    if (!this.viewed?.image || !this.options.canvas.width || !this.options.canvas.height) return;
    const blob = await new Promise<Blob | null>((resolve) => this.options.canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image could not be encoded. Raw data and frames are still retained.');
    return blob.arrayBuffer();
  }
  private async finish(journal: CaptureJournal, reason: string): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.lock(true);
    this.render();
    let png: ArrayBuffer | undefined;
    try { png = await this.png(); }
    catch (error) { journal.error(messageOf(error)); }
    try {
      await journal.finish(reason, png);
      // Reopen the saved frames, not a possibly empty worker finish after an error.
      const frames = await readCaptureFrames(this.store, journal.record);
      this.options.frames(frames);
      byId('capture-export-status').textContent = journal.record.storageError
        ? 'Storage failed. Export this report now; do not rely on a complete saved local copy.'
        : 'Recording stopped. Export the session to choose a file location; the local copy remains below.';
    } catch (error) { this.options.toast(messageOf(error)); }
    finally {
      this.saving = false;
      this.lock(false);
      this.render();
      await this.refreshHistory();
    }
  }

  private render(): void {
    const record = this.viewed;
    if (!record) return;
    const live = this.journal?.record.id === record.id && !this.journal.finished && this.options.receiver.running;
    const description = captureDescription(record, live);
    byId('capture-source').textContent = originLabel(record.origin);
    byId('capture-summary').dataset.origin = record.origin;
    byId('capture-result').textContent = this.saving ? 'Finishing the local recording…' : description.title;
    byId('capture-explanation').textContent = description.detail;
    const samples = record.origin === 'live' ? record.samplesReceived : record.samplesProcessed;
    byId('capture-input').textContent = samples.toLocaleString();
    byId('capture-frames').textContent = record.framesDecoded.toLocaleString();
    byId('capture-segments').textContent = record.imageSegments.toLocaleString();
    const end = record.endedAt ? Date.parse(record.endedAt) : live ? Date.now() : Date.parse(record.updatedAt);
    const seconds = Math.max(0, Math.floor((end - Date.parse(record.startedAt)) / 1000));
    const elapsed = `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    byId('capture-times').textContent = `${localTime(record.startedAt)} · ${elapsed} · ${record.endedAt ? record.stopReason : live ? 'Recording' : 'Unfinished session — saved through ' + localTime(record.updatedAt)} · School time`;
    byId('capture-storage').textContent = record.storageError
      ? `Only ${formatBytes(record.rawBytes)} of raw data and ${formatBytes(record.frameBytes)} of frames were committed. The recording is incomplete.`
      : record.origin === 'live'
        ? `${formatBytes(record.rawBytes)} raw data + ${formatBytes(record.frameBytes)} decoded frames saved in this browser. ${live ? 'Keep this tab open. Stop, then export to choose a file location.' : 'Available below in Saved sessions. Export a separate copy to keep it.'}`
        : `${formatBytes(record.frameBytes)} decoded frames saved in this browser. ${record.origin === 'sample' ? 'This is the bundled test recording, not your antenna data.' : 'The imported source file has not been copied into raw storage.'}`;
    let warnings = record.errors.join(' ');
    if (live && record.origin === 'live') {
      const since = Date.now() - Date.parse(record.lastSampleAt ?? record.startedAt);
      if (since > 5000) warnings += ` No receiver samples have arrived for ${Math.floor(since / 1000)} seconds.`;
    }
    byId('capture-error').hidden = !warnings;
    byId('capture-error').textContent = warnings;
    byId<HTMLInputElement>('export-raw').disabled = record.rawBytes === 0 || live || this.working;
    byId<HTMLButtonElement>('export-capture').disabled = this.controlsBusy || this.working || live;
    byId('image-source').textContent = originLabel(record.origin);
    if (!record.image) byId('image-waiting').textContent = live
      ? 'Waiting for usable image packets. Decoding is automatic. Raw radio data is being retained even without an image.'
      : record.imageSegments > 0
        ? 'Image packets were decoded but no preview was rendered. Export the session to retain the recovered packets and error log.'
        : 'No image was recovered in this session. Export session includes a reception report and any saved radio data or decoded frames.';
    byId('image-caption').textContent = record.origin === 'sample'
      ? 'Sample replay only. This image is not evidence of reception at your antenna.'
      : 'Images appear automatically from decoded packets. Export session also keeps data when no image is recovered.';
    if (!live && !this.working && !this.options.receiver.running && byId('receiver-card').dataset.state !== 'error') {
      byId('status-title').textContent = description.title;
      byId('status-message').textContent = record.errors.length
        ? record.errors.join(' ') : 'Session retained on this device. Use Export session, with or without an image.';
    }
  }

  private async refreshHistory(): Promise<void> {
    try { this.records = await this.store.list(); this.historyError = ''; }
    catch (error) { this.historyError = messageOf(error); }
    const list = byId('capture-history-list');
    list.replaceChildren();
    if (this.historyError || !this.records.length) {
      const message = document.createElement('p');
      message.textContent = this.historyError || 'No saved sessions yet. Live recording is saved automatically, even when no image is decoded.';
      list.append(message);
      return;
    }
    for (const record of this.records) {
      const row = document.createElement('article');
      row.className = 'capture-history-row';
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${localTime(record.startedAt)} · ${originLabel(record.origin)}`;
      const detail = document.createElement('p');
      detail.textContent = `${record.endedAt ? captureDescription(record).title : 'Unfinished session / possibly active in another tab'} · ${formatBytes(record.rawBytes)} raw · ${record.framesDecoded} frames`;
      text.append(title, detail);
      const actions = document.createElement('div'); actions.className = 'capture-history-actions';
      const review = document.createElement('button'); review.className = 'button outlined'; review.textContent = 'Review';
      review.onclick = () => void this.review(record.id);
      const exportButton = document.createElement('button'); exportButton.className = 'button outlined'; exportButton.textContent = 'Export';
      exportButton.onclick = () => void this.export(record, false);
      const remove = document.createElement('button'); remove.className = 'button text'; remove.textContent = 'Delete';
      remove.onclick = () => {
        const warning = record.endedAt ? '' : 'This session did not finish. Close other station tabs before deleting it. ';
        if (confirm(`${warning}Delete the local session from ${localTime(record.startedAt)}? Download an export first to keep it.`))
          void this.store.remove(record.id).then(async () => {
            if (this.viewed?.id === record.id) {
              this.viewed = null;
              this.options.clear();
              byId('capture-result').textContent = 'Local session deleted';
              byId('capture-explanation').textContent = 'Start a new reception or review another saved session.';
            }
            await this.refreshHistory();
          }).catch((error) => this.options.toast(messageOf(error)));
      };
      actions.append(review, exportButton, remove); row.append(text, actions); list.append(row);
    }
    this.setControlsBusy(this.controlsBusy);
  }
  private async review(id: string): Promise<void> {
    if (this.working || this.options.receiver.running) return;
    this.lock(true);
    try {
      const record = await this.store.get(id);
      if (!record) throw new Error('This session is no longer available in this browser.');
      this.viewed = record;
      await this.options.review(record, await readCaptureFrames(this.store, record));
      byId('capture-export-status').textContent = 'Reviewing a saved session, not live reception.';
      byId('capture-summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { this.options.toast(messageOf(error)); }
    finally { this.lock(false); this.render(); }
  }
  private async export(record: CaptureRecord, useCanvas: boolean): Promise<void> {
    if (this.working || this.options.receiver.running) return;
    this.lock(true);
    const includeRaw = useCanvas ? byId<HTMLInputElement>('export-raw').checked : true;
    const safe = structuredClone(record);
    const name = `meteor-${safe.origin}-${safe.startedAt.replace(/[:.]/g, '-')}-${safe.id.slice(0, 8)}.zip`;
    let sink;
    // Snapshot pixels and channel together, before a pending channel change resolves.
    const pngPromise = useCanvas ? this.png() : Promise.resolve(undefined);
    void pngPromise.catch(() => {});
    try {
      // The picker is called before the first await; this retains click activation.
      sink = await chooseArchiveSink(name, (includeRaw ? safe.rawBytes : 0) + safe.frameBytes + (safe.image ? safe.image.width * safe.image.height * 4 : 0) + 1024 * 1024);
      const png = await pngPromise;
      await writeCaptureArchive(this.store, safe, includeRaw, sink, png);
      byId('capture-export-status').textContent = 'Session export created. Your browser controls the file location; the local copy remains in Saved sessions.';
    } catch (error) {
      if (sink) await sink.abort().catch(() => {});
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.options.toast(messageOf(error));
    } finally { this.lock(false); this.render(); }
  }
}
