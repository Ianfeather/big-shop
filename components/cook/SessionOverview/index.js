import { useEffect, useState } from 'react';
import useInterval from '@hooks/use-interval';
import styles from './SessionOverview.module.css';

// Returns a display string for a step's elapsed or countdown time.
// cook steps: "5 / 8 min" or "+2 min" (over time)
// passive steps: "14 min left"
function TimingDisplay({ step, isActive, startedAt, passiveTimer }) {
  const [now, setNow] = useState(Date.now());
  const isTimed = step.durationMinutes != null;

  useInterval(() => setNow(Date.now()), isActive && isTimed ? 1000 : null);

  if (!isTimed) return <span className={styles.duration}>—</span>;

  if (step.stepType === 'passive') {
    if (!passiveTimer) {
      return <span className={styles.duration}>~{step.durationMinutes} min</span>;
    }
    const elapsedMin = Math.floor((now - passiveTimer) / 60000);
    const remaining = step.durationMinutes - elapsedMin;
    if (remaining <= 0) return <span className={`${styles.duration} ${styles.durationOver}`}>Done</span>;
    return <span className={styles.duration}>{remaining} min left</span>;
  }

  if (step.stepType === 'cook') {
    if (!isActive || !startedAt) {
      return <span className={styles.duration}>~{step.durationMinutes} min</span>;
    }
    const elapsedMin = Math.floor((now - startedAt) / 60000);
    const over = elapsedMin - step.durationMinutes;
    if (over > 0) {
      return <span className={`${styles.duration} ${styles.durationOver}`}>+{over} min</span>;
    }
    return <span className={styles.duration}>{elapsedMin} / {step.durationMinutes} min</span>;
  }

  return null;
}

export default function SessionOverview({
  recipes,
  sequence,
  activeStepIndex,
  stepStartedAt,
  passiveTimers,
  isActive,
}) {
  // Determine which recipe is currently "active" (has the current step)
  const currentItem = sequence?.[activeStepIndex];
  const activeRecipeIds = new Set(
    (currentItem?.steps || []).map(s => s.recipeId)
  );

  // Build a set of completed step IDs from steps before activeStepIndex
  const completedStepIds = new Set(
    (sequence || [])
      .slice(0, activeStepIndex)
      .flatMap(item => item.steps.map(s => s.stepId))
  );

  return (
    <div className={styles.overview}>
      {recipes.map(recipe => {
        const isActiveRecipe = activeRecipeIds.has(recipe.id);
        const trackClass = `${styles.track} ${isActive && !isActiveRecipe ? styles.trackDimmed : ''}`;

        return (
          <div key={recipe.id} className={trackClass}>
            <div className={styles.recipeHeader}>
              <span className={styles.colourSwatch} style={{ background: recipe.colour }} />
              <span className={styles.recipeName}>{recipe.name}</span>
            </div>

            <div className={styles.stepList}>
              {(recipe.steps || []).map((step, stepIndex) => {
                const isCompleted = completedStepIds.has(step.id);
                const isCurrentStep = (currentItem?.steps || []).some(s => s.stepId === step.id);
                const isPassive = step.stepType === 'passive';
                const showTiming = step.stepType === 'cook' || step.stepType === 'passive';

                const dotClass = [
                  styles.dot,
                  isPassive ? styles.dotPassive : '',
                  isCurrentStep ? styles.dotActive : '',
                  isCompleted ? styles.dotCompleted : '',
                ].filter(Boolean).join(' ');

                return (
                  <div key={step.id} className={styles.stepRow}>
                    <div className={styles.dotColumn}>
                      {stepIndex > 0 && (
                        <div
                          className={`${styles.connector} ${isCompleted ? styles.connectorCompleted : ''}`}
                          style={{ borderColor: isCompleted ? recipe.colour : undefined }}
                        />
                      )}
                      <div
                        className={dotClass}
                        style={{
                          borderColor: recipe.colour,
                          background: isCompleted || (isCurrentStep && !isPassive) ? recipe.colour : undefined,
                        }}
                      />
                    </div>

                    <div className={`${styles.stepLabel} ${isCompleted ? styles.stepLabelCompleted : ''}`}>
                      <span className={styles.instruction}>{step.instruction}</span>
                      {showTiming && (
                        <TimingDisplay
                          step={step}
                          isActive={isCurrentStep && isActive}
                          startedAt={stepStartedAt?.[step.id]}
                          passiveTimer={passiveTimers?.[step.id]}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {(!recipe.steps || recipe.steps.length === 0) && (
                <div className={styles.noSteps}>No steps — add them via the recipe editor.</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
