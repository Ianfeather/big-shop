import { useState } from 'react';
import Layout, { MainContent } from '@components/layout';
import Button from '@components/button';
import Message from '@components/message';
import SidebarHeading from '@components/sidebar-heading';
import SidebarInput from '@components/sidebar-input';
import SidebarTagFilter from '@components/sidebar-tag-filter';
import ListItem from '@components/sidebar-item';
import TagPill from '@components/tag-pill';
import Spinner from '@components/recipe-form/spinner';
import DaveChat from '@components/dave-chat';
import icons from '@components/svg';
import styles from './design-system.module.css';

// This page only exists in development (see getServerSideProps below) - it's
// a living reference for the tokens defined in pages/styles.css and the
// shared components in components/, so changes to either stay visible in
// one place instead of drifting silently across features.
export async function getServerSideProps() {
  if (process.env.NODE_ENV === 'production') {
    return { notFound: true };
  }
  return { props: {} };
}

const colorGroups = [
  {
    title: 'Brand',
    colors: [
      { name: '--color-primary', value: '#b870eb', note: 'the one forward action per screen' },
      { name: '--color-primary-soft', value: '#f0ebf4', note: 'tinted backgrounds' },
      { name: '--color-primary-border', value: '#d7b1f3', note: 'default borders/dividers' },
      { name: '--color-primary-muted', value: '#cbb5dc', note: 'hover state, muted text' },
      { name: '--color-accent', value: '#eb70a4', note: 'decorative hover/highlight only' },
      { name: '--color-danger', value: '#eb7070', note: 'destructive actions, errors, required' },
      { name: '--color-info', value: '#2897c1', note: "Dave's own palette only - not used elsewhere" },
    ],
  },
  {
    title: 'Neutral',
    colors: [
      { name: '--gray-100', value: '#f5f5f5' },
      { name: '--gray-200', value: '#e7eaea' },
      { name: '--gray-300', value: '#d2d0d0' },
      { name: '--gray-400', value: '#aaaaaa' },
      { name: '--gray-500', value: '#666666' },
      { name: '--gray-700', value: '#525050' },
    ],
  },
  {
    title: 'Semantic',
    colors: [
      { name: '--color-success', value: '#28c17b', note: 'confirmation state, e.g. "Stored!"' },
      { name: '--color-success-soft', value: '#94c3ae', note: 'pending/loading row background' },
      { name: '--color-danger-soft', value: '#f1c8c8' },
      { name: '--color-danger-border', value: '#ed9797' },
    ],
  },
];

const textScale = [
  ['--text-xs', '12px'],
  ['--text-sm', '14px'],
  ['--text-base', '16px'],
  ['--text-md', '18px'],
  ['--text-lg', '24px'],
  ['--text-xl', '30px'],
  ['--text-2xl', '36px'],
  ['--text-display', '40px'],
];

const spaceScale = [
  ['--space-1', '5px'],
  ['--space-2', '10px'],
  ['--space-3', '15px'],
  ['--space-4', '20px'],
  ['--space-5', '30px'],
  ['--space-6', '40px'],
  ['--space-7', '50px'],
];

const radiusScale = [
  ['--radius-sm', '4px'],
  ['--radius-md', '8px'],
  ['--radius-lg', '20px'],
  ['--radius-round', '50%'],
];

const daveMessages = [
  { id: 1, role: 'assistant', content: "Hi! I'm Dave. Want help planning meals for the week?", timestamp: '2026-01-01T12:00:00Z' },
  { id: 2, role: 'user', content: 'Something with the chilli I already have please.', timestamp: '2026-01-01T12:01:00Z' },
];

const DesignSystem = () => {
  const [tagFilter, setTagFilter] = useState([]);
  const toggleTagFilter = (tag) => {
    if (tag === '') {
      setTagFilter([]);
      return;
    }
    setTagFilter(current => (
      current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]
    ));
  };
  const [search, setSearch] = useState('');

  return (
    <Layout pageTitle="Design System">
      <MainContent fullHeight={false}>
        <div className={styles.page}>
          <h1>Design System</h1>
          <p className={styles.intro}>
            Dev-only reference for Big Shop&apos;s tokens and shared components
            (see <code>pages/styles.css</code> for the token source of truth).
            This page is excluded from production builds.
          </p>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Colour</h2>
            {colorGroups.map((group) => (
              <div key={group.title} style={{ marginBottom: '20px' }}>
                <h3 className={styles.cardTitle}>{group.title}</h3>
                <div className={styles.swatchGrid}>
                  {group.colors.map((c) => (
                    <div className={styles.swatch} key={c.name}>
                      <div className={styles.swatchColor} style={{ background: `var(${c.name})` }} />
                      <div className={styles.swatchLabel}>
                        <span className={styles.swatchName}>{c.name}</span>
                        <span className={styles.swatchValue}>{c.value}</span>
                        { c.note && <span className={styles.swatchNote}>{c.note}</span> }
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Typography</h2>
            <div className={styles.card} style={{ marginBottom: '20px' }}>
              <div className={styles.typeRow}>
                <span className={styles.typeLabel}>--font-heading</span>
                <span className={styles.fontSample}>Fraunces — headings, the wordmark</span>
              </div>
              <div className={styles.typeRow}>
                <span className={styles.typeLabel}>--font-body</span>
                <span className={styles.bodySample}>Plus Jakarta Sans — body copy, buttons, inputs</span>
              </div>
            </div>
            <div className={styles.card}>
              {textScale.map(([name, px]) => (
                <div className={styles.typeRow} key={name}>
                  <span className={styles.typeLabel}>{name} ({px})</span>
                  <span style={{ fontSize: `var(${name})` }}>The quick brown fox</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Spacing</h2>
            <div className={styles.card}>
              {spaceScale.map(([name, px]) => (
                <div className={styles.scaleRow} key={name}>
                  <span className={styles.scaleLabel}>{name} ({px})</span>
                  <div className={styles.scaleBar} style={{ width: `var(${name})` }} />
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Radius</h2>
            <div className={styles.componentGrid}>
              {radiusScale.map(([name, px]) => (
                <div key={name} style={{ textAlign: 'center' }}>
                  <div className={styles.radiusBox} style={{ borderRadius: `var(${name})` }} />
                  <span className={styles.iconSample}>{name} ({px})</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Icons</h2>
            <div className={styles.iconGrid}>
              {Object.entries(icons).map(([name, Icon]) => (
                <div className={styles.iconSample} key={name}>
                  <Icon />
                  {name}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Buttons</h2>
            <div className={styles.card}>
              <p className={styles.intro} style={{ marginBottom: '12px' }}>
                Two roles only: <code>primary</code> is the one forward action on a
                screen, <code>danger</code> is destructive. Add <code>outline</code>{' '}
                for the lower-emphasis &quot;secondary&quot; pattern (Edit, Cancel, inline
                utilities) - same role colour, less visual weight.
              </p>
              <div className={styles.componentRow}>
                <Button style="primary" icon="tick">Primary</Button>
                <Button style="danger" icon="trash">Danger</Button>
              </div>
              <div className={styles.componentRow}>
                <Button style="primary" outline icon="back">Outline primary</Button>
                <Button style="danger" outline icon="cross">Outline danger</Button>
                <Button style="primary" outline iconOnly icon="pencil" aria-label="Edit" />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Checkboxes</h2>
            <div className={styles.card}>
              <div className={styles.componentRow} style={{ alignItems: 'center', gap: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" defaultChecked={false} /> Unchecked
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" defaultChecked={true} readOnly /> Checked
                </label>
              </div>
              <p className={styles.intro} style={{ marginTop: '12px', marginBottom: 0 }}>
                Real <code>&lt;input type=&quot;checkbox&quot;&gt;</code> elements with a custom
                appearance (see <code>input[type=&apos;checkbox&apos;]</code> in{' '}
                <code>pages/styles.css</code>) - keeps native keyboard, screen reader and
                mobile tap behaviour instead of a div pretending to be a checkbox.
              </p>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Tags</h2>
            <div className={styles.card}>
              <div className={styles.componentRow}>
                <TagPill tag="Vegetarian" />
                <TagPill tag="Batch Cook" />
                <TagPill tag="Gluten Free" />
              </div>
              <p className={styles.intro} style={{ marginTop: '12px', marginBottom: 0 }}>
                Icon + colour come from a lookup in <code>components/tag-pill/tag-meta.js</code>,
                keyed by tag name. &quot;Gluten Free&quot; above has no entry, so it falls
                back to a neutral tag glyph - new tags need one line in that file, no
                new CSS.
              </p>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Messages</h2>
            <div className={styles.card}>
              <Message status="error" message="Something went wrong saving your recipe." />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Sidebar controls</h2>
            <p className={styles.intro} style={{ marginBottom: '12px' }}>
              Two <code>ListItem</code> variants: <code>panel</code> (default) for a
              browsable list inside a white panel, <code>chip</code> for items already
              committed to something - paired with <code>&lt;SidebarHeading tone=&quot;tinted&quot;&gt;</code>
              inside a <code>--color-primary-tint</code> panel.
            </p>
            <div className={styles.componentGrid}>
              <div className={styles.card} style={{ maxWidth: '280px' }}>
                <SidebarHeading>All Recipes</SidebarHeading>
                <SidebarInput icon={icons.search} placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
                <SidebarTagFilter tags={['Batch Cook', 'Vegetarian']} value={tagFilter} onChange={toggleTagFilter} />
                <ul>
                  <ListItem id="ds-item-1" name="Shepherd's Pie" tags={['Batch Cook']} checked={false} onClick={() => {}} />
                  <ListItem id="ds-item-2" name="Veggie Chilli" tags={['Vegetarian', 'Batch Cook']} checked={true} onClick={() => {}} />
                </ul>
              </div>
              <div className={styles.card} style={{ maxWidth: '280px', background: 'var(--color-primary-tint)' }}>
                <SidebarHeading tone="tinted">Selected Recipes</SidebarHeading>
                <ul>
                  <ListItem id="ds-item-3" name="Shepherd's Pie" tags={['Batch Cook']} checked={true} variant="chip" onClick={() => {}} />
                  <ListItem id="ds-item-4" name="Veggie Chilli" tags={['Vegetarian', 'Batch Cook']} checked={true} variant="chip" onClick={() => {}} />
                </ul>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Misc</h2>
            <div className={styles.componentGrid}>
              <div className={styles.card} style={{ background: 'var(--color-primary)' }}>
                <div className={styles.cardTitle} style={{ color: 'white' }}>Spinner</div>
                <Spinner />
              </div>
              <div className={`${styles.card} ${styles.chatDemo}`}>
                <div className={styles.cardTitle}>Dave chat</div>
                <DaveChat messages={daveMessages} onSendMessage={() => {}} isLoading={false} />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Known gaps</h2>
            <div className={styles.gapCallout}>
              <ul>
                <li>Spacing/radius/font-size tokens are now defined and applied to the app&apos;s core components and the Dave feature, but not every legacy CSS module has been swept — new code should use the tokens above rather than one-off pixel values.</li>
                <li>Only two tags have an icon/colour mapping (Vegetarian, Batch Cook) - everything else falls back to a neutral tag glyph until someone extends <code>tag-pill/tag-meta.js</code>.</li>
                <li>There is no documented empty/loading/error state pattern beyond <code>Message</code> and the recipe-form spinner - features like Dave currently roll their own loading indicator (the typing dots above).</li>
                <li>Recipes have no stored image - the AI photo-extraction flow discards the photo after parsing it. Cards and the detail page are text-only as a result; the schema has no <code>image_url</code> column yet.</li>
              </ul>
            </div>
          </section>
        </div>
      </MainContent>
    </Layout>
  );
};

export default DesignSystem;
