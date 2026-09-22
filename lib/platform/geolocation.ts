import { has } from './capability';

export interface DeviceCoords {
  lat: number;
  lng: number;
  accuracyM: number;
  at: string;
}

export function getCurrentCoords(options: PositionOptions = {}): Promise<DeviceCoords | null> {
  if (!has.geolocation()) return Promise.resolve(null);
  const positionOptions: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 60000,
    ...options,
  };
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(accuracy) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            accuracy < 0 ||
            !Number.isFinite(position.timestamp)
          ) {
            resolve(null);
            return;
          }
          resolve({
            lat: latitude,
            lng: longitude,
            accuracyM: accuracy,
            at: new Date(position.timestamp).toISOString(),
          });
        },
        () => resolve(null),
        positionOptions,
      );
    } catch {
      resolve(null);
    }
  });
}

export type CoordsResult = { ok: true; coords: DeviceCoords } | { ok: false; reason: 'unsupported' | 'denied' | 'timeout' | 'unavailable' | 'invalid' };

export function getCurrentCoordsResult(options: PositionOptions = {}): Promise<CoordsResult> {
  if (!has.geolocation()) return Promise.resolve({ ok: false, reason: 'unsupported' });
  const positionOptions: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 60000,
    ...options,
  };
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(accuracy) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            accuracy < 0 ||
            !Number.isFinite(position.timestamp)
          ) {
            resolve({ ok: false, reason: 'invalid' });
            return;
          }
          resolve({
            ok: true,
            coords: {
              lat: latitude,
              lng: longitude,
              accuracyM: accuracy,
              at: new Date(position.timestamp).toISOString(),
            },
          });
        },
        (err: GeolocationPositionError) => {
          if (err.code === err.PERMISSION_DENIED) resolve({ ok: false, reason: 'denied' });
          else if (err.code === err.TIMEOUT) resolve({ ok: false, reason: 'timeout' });
          else resolve({ ok: false, reason: 'unavailable' });
        },
        positionOptions,
      );
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
    }
  });
}

export function formatCoords(coords: DeviceCoords): string {
  const latitude = `${Math.abs(coords.lat).toFixed(4)}°` + (coords.lat >= 0 ? 'N' : 'S');
  const longitude = `${Math.abs(coords.lng).toFixed(4)}°` + (coords.lng >= 0 ? 'E' : 'W');
  const accuracy = Math.round(coords.accuracyM);
  return `${latitude} ${longitude} ±${accuracy}m`;
}
