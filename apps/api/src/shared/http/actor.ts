import { ForbiddenError, UnauthorizedError } from '../errors';
import { currentContext, type Actor } from '../request-context';

export function requireActor(): Actor {
  const actor = currentContext()?.actor;
  if (!actor || !actor.id) throw new UnauthorizedError();
  return actor;
}

export function requireCustomer(): string {
  const actor = currentContext()?.actor;
  if (!actor || actor.type !== 'customer' || !actor.id)
    throw new UnauthorizedError('Customer login required');
  return actor.id;
}

export function optionalCustomer(): string | null {
  const actor = currentContext()?.actor;
  return actor && actor.type === 'customer' ? actor.id : null;
}

export function requireTenant(): string {
  const tenantId = currentContext()?.tenantId;
  if (!tenantId) throw new ForbiddenError('Tenant context required');
  return tenantId;
}
