import { STOPPED_INSTANCE_MIN_DAYS } from '../constants/stopped-instance.constant';

const STOPPED_AT_PATTERN = /\((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) GMT\)/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseStoppedAt(reason: string | undefined): string | null {
  const match = reason ? STOPPED_AT_PATTERN.exec(reason) : null;
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isLongStopped(instance: { state: string; stoppedAt: string | null }, now: Date): boolean {
  if (instance.state !== 'stopped' || !instance.stoppedAt) return false;
  return now.getTime() - Date.parse(instance.stoppedAt) >= STOPPED_INSTANCE_MIN_DAYS * DAY_MS;
}
