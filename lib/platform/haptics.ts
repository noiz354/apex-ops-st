import { has } from './capability';

function isValidPattern(pattern: number | number[]): boolean {
  const durations = Array.isArray(pattern) ? pattern : [pattern];
  return durations.length <= 20 && durations.every((duration) => Number.isInteger(duration) && duration >= 0 && duration <= 1000);
}

export function vibrate(pattern: number | number[]): boolean {
  if (!has.vibration()) return false;
  if (!isValidPattern(pattern)) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export const haptic = {
  pass: () => vibrate(50),
  fail: () => vibrate([80, 40, 80]),
  info: () => vibrate(20),
};
