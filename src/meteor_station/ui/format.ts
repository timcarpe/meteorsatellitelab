/** Consistent school-local time and accessible text formatting. */
import { SCHOOL_TIMEZONE } from '@meteor/core/models';

export const timeText = (at: number): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
export const dayText = (at: number): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at);
export function compass(angle: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(angle / 45) % 8]!;
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
