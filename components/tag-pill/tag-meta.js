// Icon + colour per tag, so tags read as distinct categories rather than
// interchangeable pills. New tags don't need any CSS - just a line here -
// and fall back to a plain neutral tag glyph if they're missing one.
const TAG_META = {
  'Vegetarian': { icon: 'leaf', color: 'var(--color-success)' },
  'Batch Cook': { icon: 'batch', color: 'var(--color-primary)' },
};

const FALLBACK_TAG_META = { icon: 'tag', color: 'var(--gray-500)' };

export function getTagMeta(name) {
  return TAG_META[name] || FALLBACK_TAG_META;
}
