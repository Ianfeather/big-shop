// Icon + colour per tag, so tags read as distinct categories rather than
// interchangeable pills. New tags don't need any CSS - just a line here -
// and fall back to a plain neutral tag glyph if they're missing one.
interface TagMeta {
  icon: string;
  color: string;
}

const TAG_META: Record<string, TagMeta> = {
  'Vegetarian': { icon: 'leaf', color: 'var(--color-success)' },
  'Batch Cook': { icon: 'batch', color: 'var(--color-primary)' },
};

const FALLBACK_TAG_META: TagMeta = { icon: 'tag', color: 'var(--gray-500)' };

export function getTagMeta(name?: string): TagMeta {
  return (name ? TAG_META[name] : undefined) || FALLBACK_TAG_META;
}
