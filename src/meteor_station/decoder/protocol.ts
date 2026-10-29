/** Message contracts between the page and its isolated signal-processing worker. */
import type { ImageSnapshot } from '@meteor/decoder/image';
import type { RadioLevel } from '@meteor/radio/fm';

export type Mode = 'meteor' | 'fm' | 'replay' | 'iq-file';
export type WorkerRequest =
  | { readonly type: 'init'; readonly mode: Mode; readonly sampleRate: number }
  | { readonly type: 'samples'; readonly id: number; readonly data: ArrayBuffer }
  | { readonly type: 'finish' }
  | { readonly type: 'channel'; readonly channel: number };
export type WorkerResponse =
  | { readonly type: 'ready' }
  | {
      readonly type: 'ack';
      readonly id: number;
      readonly level: RadioLevel;
      readonly frames: number;
      readonly segments: number;
      readonly gaps: number;
      readonly carrierOffset: number;
      readonly processingMs: number;
    }
  | { readonly type: 'audio'; readonly data: Float32Array }
  | { readonly type: 'spectrum'; readonly data: Float32Array }
  | { readonly type: 'image'; readonly image: ImageSnapshot }
  | { readonly type: 'done'; readonly frames: ArrayBuffer }
  | { readonly type: 'error'; readonly message: string };
