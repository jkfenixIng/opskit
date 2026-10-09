export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(permission: string) {
    super(`Permission denied: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string) {
    super(`${resource} was not found`);
    this.name = 'NotFoundError';
  }
}
