import { describe, it, expect } from 'vitest';
import { getTagMeta } from './tag-meta';

describe('getTagMeta', () => {
  it('returns the known meta for a recognised tag', () => {
    expect(getTagMeta('Vegetarian')).toEqual({ icon: 'leaf', color: 'var(--color-success)' });
  });

  it('falls back to the neutral tag glyph for an unrecognised tag', () => {
    expect(getTagMeta('Some New Tag')).toEqual({ icon: 'tag', color: 'var(--gray-500)' });
  });

  it('falls back for undefined/empty input', () => {
    expect(getTagMeta(undefined)).toEqual({ icon: 'tag', color: 'var(--gray-500)' });
  });
});
