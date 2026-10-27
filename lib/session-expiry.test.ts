import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { isSessionExpiredError, reauthAttemptedRecently, recordReauthAttempt } from './session-expiry';

describe('isSessionExpiredError', () => {
  it.each(['invalid_grant', 'missing_refresh_token', 'login_required', 'consent_required'])(
    'treats the Auth0 %s error as an ended session',
    (code) => {
      expect(isSessionExpiredError(Object.assign(new Error('x'), { error: code }))).toBe(true);
    }
  );

  it('treats a 401 from the API as an ended session', () => {
    expect(isSessionExpiredError(new ApiError('GET /recipes failed with status 401', 401))).toBe(true);
  });

  it.each([
    ['a 403', new ApiError('nope', 403)],
    ['a 500', new ApiError('boom', 500)],
    ['a network failure', new TypeError('Failed to fetch')],
    ['an Auth0 timeout', Object.assign(new Error('Timeout'), { error: 'timeout' })],
    ['a non-error', 'oops'],
    ['null', null],
  ])('leaves %s alone', (_, error) => {
    expect(isSessionExpiredError(error)).toBe(false);
  });
});

describe('the re-login loop breaker', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('has nothing recorded to begin with', () => {
    expect(reauthAttemptedRecently()).toBe(false);
  });

  it('remembers an attempt for two minutes and then forgets it', () => {
    recordReauthAttempt(1_000_000);
    expect(reauthAttemptedRecently(1_000_000 + 119_000)).toBe(true);
    expect(reauthAttemptedRecently(1_000_000 + 121_000)).toBe(false);
  });
});
