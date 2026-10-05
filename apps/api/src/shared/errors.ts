import type { ErrorCode } from '@cip/contracts';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly errors?: Array<Record<string, unknown>>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', 404, id ? `${entity} ${id} was not found` : `${entity} was not found`);
  }
}

export class ValidationFailedError extends DomainError {
  constructor(message: string, errors?: Array<Record<string, unknown>>) {
    super('VALIDATION_FAILED', 400, message, errors);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, errors?: Array<Record<string, unknown>>) {
    super('CONFLICT', 409, message, errors);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required', code: ErrorCode = 'UNAUTHORIZED') {
    super(code, 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have access to this resource') {
    super('FORBIDDEN', 403, message);
  }
}

export class RateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 429, 'Too many requests', undefined, { 'Retry-After': String(retryAfterSeconds) });
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message: string, errors?: Array<Record<string, unknown>>) {
    super('PRECONDITION_FAILED', 412, message, errors);
  }
}

export class PreconditionRequiredError extends DomainError {
  constructor(message = 'If-Match header is required') {
    super('PRECONDITION_REQUIRED', 428, message);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message: string) {
    super('SERVICE_UNAVAILABLE', 503, message);
  }
}
