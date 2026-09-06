import { describe, it, expect } from 'vitest';
import { formatPostDate } from './blog-format';

describe('formatPostDate', () => {
  it('formats an ISO date for display', () => {
    expect(formatPostDate('2026-09-06')).toBe('6 September 2026');
  });

  it('does not roll the date back a day for a reader west of Greenwich', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatPostDate('2026-09-06')).toBe('6 September 2026');
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});
