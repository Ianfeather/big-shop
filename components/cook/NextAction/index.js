import { useEffect, useState } from 'react';
import useInterval from '@hooks/use-interval';
import styles from './NextAction.module.css';

// Format milliseconds elapsed into a display string like "3 min 42 sec"
function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

// Timer display for a single cook step (elapsed vs expected)
function CookTimer({ step, startedAt }) {
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), startedAt ? 1000 : null);

  if (!startedAt) return null;

  const elapsedMs = now - startedAt;
  const elapsedMin = elapsedMs / 60000;
  const over = elapsedMin - (step.durationMinutes || 0);

  if (step.durationMinutes == null) {
    return <span className={styles.timer}>{formatElapsed(elapsedMs)}</span>;
  }

  const pct = Math.min(elapsedMin / step.durationMinutes, 1);
  const isOver = over > 0;

  return (
    <div className={styles.timerBlock}>
      <div className={styles.progressBar}>
        <div
          className={`${styles.progressFill} ${isOver ? styles.progressOver : ''}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className={`${styles.timer} ${isOver ? styles.timerOver : ''}`}>
        {isOver
          ? `+${Math.floor(over)}m ${Math.floor((over % 1) * 60)}s over`
          : `${formatElapsed(elapsedMs)} / ${step.durationMinutes} min`}
      </span>
    </div>
  );
}

// Countdown timer for a passive step
function PassiveCountdown({ step, passiveTimer }) {
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), passiveTimer ? 1000 : null);

  if (!passiveTimer || step.durationMinutes == null) {
    return step.durationMinutes != null
      ? <span className={styles.timer}>~{step.durationMinutes} min</span>
      : null;
  }

  const elapsedMin = (now - passiveTimer) / 60000;
  const remaining = step.durationMinutes - elapsedMin;
  const isOver = remaining <= 0;

  const pct = Math.min(elapsedMin / step.durationMinutes, 1);

  return (
    <div className={styles.timerBlock}>
      <div className={styles.progressBar}>
        <div
          className={`${styles.progressFill} ${isOver ? styles.progressOver : ''}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className={`${styles.timer} ${isOver ? styles.timerOver : ''}`}>
        {isOver ? 'Ready!' : `${Math.ceil(remaining)} min left`}
      </span>
    </div>
  );
}

export default function NextAction({
  sequence,
  activeStepIndex,
  stepStartedAt,
  passiveTimers,
  onDone,
  onStepStart,
  onPassiveStart,
  onBackToOverview,
}) {
  const currentItem = sequence?.[activeStepIndex];
  const isFinished = !currentItem;

  // When a new active step is reached, auto-record start time for cook steps
  useEffect(() => {
    if (!currentItem) return;
    currentItem.steps.forEach(s => {
      if (s.stepType === 'cook' && !stepStartedAt?.[s.stepId]) {
        onStepStart(s.stepId);
      }
      if (s.stepType === 'passive' && !passiveTimers?.[s.stepId]) {
        onPassiveStart(s.stepId);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepIndex]);

  if (isFinished) {
    return (
      <div className={styles.card}>
        <div className={styles.finishedState}>
          <span className={styles.finishedIcon}>✓</span>
          <h2 className={styles.finishedTitle}>All done!</h2>
          <p className={styles.finishedSub}>Your cooking session is complete.</p>
          <button className={styles.overviewBtn} onClick={onBackToOverview}>
            Back to overview
          </button>
        </div>
      </div>
    );
  }

  const { steps, type, durationMinutes } = currentItem;
  const isPassive = type === 'passive';
  const isCombined = steps.length > 1;

  // For the done handler — record actual duration for cook steps
  const handleDone = () => {
    if (!isPassive && steps[0]?.stepType === 'cook' && stepStartedAt?.[steps[0].stepId]) {
      const elapsed = (Date.now() - stepStartedAt[steps[0].stepId]) / 60000;
      onDone(Math.round(elapsed * 10) / 10);
    } else {
      onDone(null);
    }
  };

  return (
    <div className={`${styles.card} ${isPassive ? styles.cardPassive : ''}`}>
      <div className={styles.cardHeader}>
        <span className={styles.cardLabel}>
          {isPassive ? 'Waiting' : isCombined ? 'Combined action' : 'Next step'}
        </span>
        <button className={styles.overviewLink} onClick={onBackToOverview}>
          Overview
        </button>
      </div>

      <div className={styles.stepList}>
        {steps.map((s, i) => (
          <div key={s.stepId} className={styles.stepEntry}>
            {isCombined && (
              <span className={styles.recipeTag}>{s.recipeName}</span>
            )}
            <p className={styles.instruction}>{s.instruction}</p>

            {s.stepType === 'cook' && (
              <CookTimer step={s} startedAt={stepStartedAt?.[s.stepId]} />
            )}
            {s.stepType === 'passive' && (
              <PassiveCountdown step={s} passiveTimer={passiveTimers?.[s.stepId]} />
            )}
          </div>
        ))}
      </div>

      <div className={styles.cardFooter}>
        <button className={`${styles.doneBtn} ${isPassive ? styles.doneBtnPassive : ''}`} onClick={handleDone}>
          {isPassive ? 'Done waiting' : 'Done'}
        </button>
      </div>
    </div>
  );
}
