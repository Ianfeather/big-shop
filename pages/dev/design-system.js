import { useState } from 'react';
import Layout, { MainContent } from '@components/layout';
import Button from '@components/button';
import Message from '@components/message';
import SidebarHeading from '@components/sidebar-heading';
import SidebarInput from '@components/sidebar-input';
import SidebarTagFilter from '@components/sidebar-tag-filter';
import ListItem from '@components/sidebar-item';
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
      { name: '--purple', value: '#b870eb' },
      { name: '--pink', value: '#eb70a4' },
      { name: '--yellow', value: '#ebd270' },
      { name: '--green', value: '#a4eb70' },
      { name: '--dark-green', value: '#8bd455' },
      { name: '--darker-green', value: '#42c540' },
      { name: '--light-purple', value: '#f0ebf4' },
      { name: '--red', value: '#eb7070' },
      { name: '--blue', value: '#2897c1' },
      { name: '--purple-border', value: '#d7b1f3' },
      { name: '--purple-muted', value: '#cbb5dc' },
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
      { name: '--success', value: '#28c17b' },
      { name: '--success-muted', value: '#94c3ae' },
      { name: '--error-bg', value: '#f1c8c8' },
      { name: '--error-border', value: '#ed9797' },
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
  const [tagFilter, setTagFilter] = useState('');
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
                <span className={styles.fontSample}>Quicksand — headings, big numbers</span>
              </div>
              <div className={styles.typeRow}>
                <span className={styles.typeLabel}>--font-body</span>
                <span className={styles.bodySample}>Open Sans — body copy, buttons, inputs</span>
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
              <div className={styles.componentRow}>
                <Button style="blue" icon="tick">Blue</Button>
                <Button style="green" icon="tick">Green</Button>
                <Button style="red" icon="trash">Red</Button>
                <Button style="pink" icon="cross">Pink</Button>
              </div>
              <div className={styles.componentRow}>
                <Button style="blue" outline icon="back">Outline blue</Button>
                <Button style="red" outline icon="cross">Outline red</Button>
                <Button style="pink" outline>Outline pink</Button>
              </div>
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
            <div className={styles.card}>
              <SidebarHeading>All Recipes</SidebarHeading>
              <SidebarInput placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <SidebarTagFilter tags={['Batch Cook', 'Vegetarian']} value={tagFilter} onChange={setTagFilter} />
              <ul>
                <ListItem id="ds-item-1" name="Shepherd's Pie" checked={false} onClick={() => {}} />
                <ListItem id="ds-item-2" name="Veggie Chilli" checked={true} onClick={() => {}} />
              </ul>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Misc</h2>
            <div className={styles.componentGrid}>
              <div className={styles.card} style={{ background: 'var(--purple)' }}>
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
                <li>Native checkboxes and selects still use the browser default appearance beyond an accent-color tweak; a fully custom control hasn&apos;t been designed.</li>
                <li>There is no documented empty/loading/error state pattern beyond <code>Message</code> and the recipe-form spinner - features like Dave currently roll their own loading indicator (the typing dots above).</li>
              </ul>
            </div>
          </section>
        </div>
      </MainContent>
    </Layout>
  );
};

export default DesignSystem;
