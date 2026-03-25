import type { Err, Ok, Result } from "./types";

export function ok<T>(data: T): Ok<T> {
  return { data, error: null };
}

export function err<E>(error: E): Err<E> {
  return { data: null, error };
}
