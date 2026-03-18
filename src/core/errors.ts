import { TrackErrorKind, TrackStateReason } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class FetchError extends Error {
  status?: number;
  kind: TrackErrorKind;
  stateReason: TrackStateReason | null;

  constructor(
    message: string,
    options?: {
      status?: number;
      kind?: TrackErrorKind;
      stateReason?: TrackStateReason | null;
    }
  ) {
    super(message);
    this.name = 'FetchError';
    this.status = options?.status;
    this.kind = options?.kind ?? 'UNKNOWN_ERROR';
    this.stateReason = options?.stateReason ?? null;
  }
}
