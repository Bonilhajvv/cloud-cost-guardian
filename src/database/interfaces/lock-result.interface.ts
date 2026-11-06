export type LockResult<T> = { acquired: true; value: T } | { acquired: false };
