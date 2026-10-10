import { describe, expect, it } from 'vitest';
import { requestHeaders } from '../components/api';

describe('web API request headers', () => {
  it('does not add JSON content type to body-less requests', () => {
    expect(requestHeaders({ method: 'POST' }).get('content-type')).toBeNull();
    expect(requestHeaders({ method: 'POST', headers: { Authorization: 'Bearer token' } }).get('authorization')).toBe('Bearer token');
  });

  it('adds JSON content type when a request body exists without overriding callers', () => {
    expect(requestHeaders({ method: 'POST', body: '{}' }).get('content-type')).toBe('application/json');
    expect(requestHeaders({ method: 'POST', body: '{}', headers: { 'Content-Type': 'application/problem+json' } }).get('content-type')).toBe('application/problem+json');
  });
});
