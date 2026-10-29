/** Domain errors, surfaced with actionable context at the UI boundary. */
export class StationError extends Error {
  override readonly name = 'StationError';
}

export function requireFinite(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new StationError(`${label} must be a number between ${min} and ${max}.`);
  }
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
