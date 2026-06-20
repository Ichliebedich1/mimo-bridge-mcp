export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail(error: string, details?: unknown): ApiResult<never> {
  return details === undefined ? { ok: false, error } : { ok: false, error, details };
}
