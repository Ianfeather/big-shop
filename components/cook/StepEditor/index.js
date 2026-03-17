import { useState, useRef } from 'react';
import styles from './StepEditor.module.css';

const STEP_TYPES = ['prep', 'cook', 'passive', 'other'];

const emptyStep = () => ({
  instruction: '',
  durationMinutes: '',
  stepType: 'other',
  // temporary client-side id for keying list items before server assigns real ids
  _key: Math.random().toString(36).slice(2),
});

export default function StepEditor({ steps = [], onChange, recipeId, remoteUrl, method }) {
  const [items, setItems] = useState(() =>
    steps.length > 0
      ? steps.map(s => ({ ...s, _key: s.id?.toString() || Math.random().toString(36).slice(2) }))
      : []
  );
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [extractSource, setExtractSource] = useState(null);
  const dragIndex = useRef(null);

  const notify = (updated) => {
    setItems(updated);
    if (onChange) {
      onChange(updated.map(({ _key, ...rest }) => ({
        ...rest,
        durationMinutes: rest.durationMinutes === '' || rest.durationMinutes === null
          ? null
          : Number(rest.durationMinutes),
      })));
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    setExtractError(null);
    setExtractSource(null);
    try {
      const res = await fetch('/api/recipe-steps/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId, remoteUrl, method }),
      });
      if (!res.ok) throw new Error('Extraction failed');
      const data = await res.json();
      if (data.steps && data.steps.length > 0) {
        const extracted = data.steps.map(s => ({
          ...s,
          durationMinutes: s.durationMinutes ?? '',
          _key: Math.random().toString(36).slice(2),
        }));
        notify(extracted);
        setExtractSource(data.source);
      } else {
        setExtractError('No steps could be extracted. Add them manually below.');
      }
    } catch {
      setExtractError('Extraction failed. Add steps manually or try again.');
    } finally {
      setExtracting(false);
    }
  };

  const updateItem = (index, field, value) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    notify(updated);
  };

  const addStep = () => {
    notify([...items, emptyStep()]);
  };

  const removeStep = (index) => {
    notify(items.filter((_, i) => i !== index));
  };

  // Drag-to-reorder handlers
  const onDragStart = (e, index) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e, index) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const updated = [...items];
    const [moved] = updated.splice(dragIndex.current, 1);
    updated.splice(index, 0, moved);
    dragIndex.current = index;
    notify(updated);
  };

  const onDragEnd = () => {
    dragIndex.current = null;
  };

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <h3 className={styles.title}>Cooking Steps</h3>
        <button
          type="button"
          className={styles.extractButton}
          onClick={handleExtract}
          disabled={extracting}
        >
          {extracting ? 'Extracting…' : items.length > 0 ? 'Re-extract' : 'Extract with AI'}
        </button>
      </div>

      {extractSource && (
        <p className={styles.sourceNote}>
          {extractSource === 'scraper' ? 'Steps extracted from original source.' : 'Steps estimated by AI — please review durations.'}
        </p>
      )}

      {extractError && (
        <p className={styles.error}>{extractError}</p>
      )}

      {items.length === 0 && !extracting && (
        <p className={styles.empty}>No steps yet. Extract automatically or add them below.</p>
      )}

      <ol className={styles.list}>
        {items.map((item, index) => (
          <li
            key={item._key}
            className={styles.step}
            draggable
            onDragStart={e => onDragStart(e, index)}
            onDragOver={e => onDragOver(e, index)}
            onDragEnd={onDragEnd}
          >
            <span className={styles.dragHandle} title="Drag to reorder">⋮⋮</span>

            <div className={styles.stepFields}>
              <textarea
                className={styles.instruction}
                value={item.instruction}
                onChange={e => updateItem(index, 'instruction', e.target.value)}
                placeholder="Step instruction…"
                rows={2}
              />
              <div className={styles.meta}>
                <label className={styles.metaLabel}>
                  Duration (min)
                  <input
                    type="number"
                    className={styles.duration}
                    value={item.durationMinutes}
                    onChange={e => updateItem(index, 'durationMinutes', e.target.value)}
                    placeholder="—"
                    min={1}
                  />
                </label>
                <label className={styles.metaLabel}>
                  Type
                  <select
                    className={styles.stepType}
                    value={item.stepType}
                    onChange={e => updateItem(index, 'stepType', e.target.value)}
                  >
                    {STEP_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <button
              type="button"
              className={styles.removeButton}
              onClick={() => removeStep(index)}
              aria-label="Remove step"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <button type="button" className={styles.addButton} onClick={addStep}>
        + Add step
      </button>
    </div>
  );
}
