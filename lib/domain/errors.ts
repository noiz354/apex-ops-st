export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const invalidTransition = (message: string, details?: unknown) =>
  new DomainError(409, 'WO_INVALID_TRANSITION', message, details);

export const staleState = (message: string, details?: unknown) =>
  new DomainError(409, 'WO_STALE_STATE', message, details);

export const notFound = (entity: string, id: string) =>
  new DomainError(404, `${entity}_NOT_FOUND`, `${entity.toLowerCase()} ${id} not found in this organization`);

export const forbiddenOp = (code: string, message: string) =>
  new DomainError(403, code, message);
