import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import Layout, { Grid, Sidebar, MainContent } from '@components/layout';
import useCookSession from '@hooks/use-cook-session';
import useRecipes from '@hooks/use-recipes';
import useFetch from 'use-http';
import SessionOverview from '@components/cook/SessionOverview';
import NextAction from '@components/cook/NextAction';
import StepEditor from '@components/cook/StepEditor';
import { scheduleCookingSession } from '@components/cook/batching';
import styles from './cook.module.css';

// Assign a colour from a fixed accessible palette per recipe index
const PALETTE = ['#e85d4a', '#2e86ab', '#f4a261', '#57a773', '#9b5de5', '#f15bb5', '#fee440'];
const assignColour = (index) => PALETTE[index % PALETTE.length];

export default function Cook() {
  const { isAuthenticated } = useAuth0();
  const [recipes] = useRecipes();
  const {
    session,
    hydrated,
    addRecipe,
    removeRecipe,
    setScheduledSequence,
    startCooking,
    advanceStep,
    recordStepStart,
    recordPassiveStart,
    clearSession,
  } = useCookSession();

  // Three views: 'select' | 'extract' | 'overview' | 'active'
  const [view, setView] = useState('select');

  const { get, post, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, { cachePolicy: 'no-cache' });
  const [sessionRecipes, setSessionRecipes] = useState([]);

  // Lazy extraction: track pending steps per recipe id (null = not yet edited)
  const [pendingSteps, setPendingSteps] = useState({});
  const [savingSteps, setSavingSteps] = useState({});
  const [saveErrors, setSaveErrors] = useState({});

  // When session recipe IDs change, fetch full recipe data (including steps)
  useEffect(() => {
    if (!hydrated || session.recipeIds.length === 0) {
      setSessionRecipes([]);
      return;
    }
    const fetchRecipes = async () => {
      const results = await Promise.all(
        session.recipeIds.map(id => get(`/recipe/${id}`))
      );
      if (response.ok) {
        setSessionRecipes(
          results
            .filter(Boolean)
            .map((r, i) => ({ ...r, colour: assignColour(i) }))
        );
      }
    };
    fetchRecipes();
  }, [hydrated, session.recipeIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build scheduled sequence whenever sessionRecipes change
  useEffect(() => {
    if (sessionRecipes.length === 0) return;
    const sequence = scheduleCookingSession(sessionRecipes);
    setScheduledSequence(sequence);
  }, [sessionRecipes]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecipeToggle = (e) => {
    const id = parseInt(e.target.id, 10);
    if (session.recipeIds.includes(id)) {
      removeRecipe(id);
    } else {
      addRecipe(id);
    }
  };

  // Recipes that have no steps and haven't had steps saved yet
  const steplessRecipes = sessionRecipes.filter(
    r => !r.steps || r.steps.length === 0
  );

  const handleStartPlanning = () => {
    if (steplessRecipes.length > 0) {
      setView('extract');
    } else {
      setView('overview');
    }
  };

  const handleStartCooking = () => {
    startCooking();
    setView('active');
  };
  const handleBackToOverview = () => setView('overview');

  const handleStepDone = (actualDuration) => {
    advanceStep(actualDuration);
  };

  const handleStepsChange = (recipeId, steps) => {
    setPendingSteps(prev => ({ ...prev, [recipeId]: steps }));
  };

  const handleSaveSteps = async (recipe) => {
    const steps = pendingSteps[recipe.id];
    if (!steps) return;

    setSavingSteps(prev => ({ ...prev, [recipe.id]: true }));
    setSaveErrors(prev => ({ ...prev, [recipe.id]: null }));

    const payload = steps.map((s, i) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes != null && s.durationMinutes !== '' ? Number(s.durationMinutes) : null,
      stepType: s.stepType || 'other',
      stepNumber: i + 1,
    }));

    await post(`/recipe/${recipe.id}/steps`, payload);
    if (response.ok) {
      // Update sessionRecipes with saved steps
      setSessionRecipes(prev =>
        prev.map(r => r.id === recipe.id ? { ...r, steps: payload } : r)
      );
    } else {
      setSaveErrors(prev => ({ ...prev, [recipe.id]: 'Failed to save steps. Try again.' }));
    }
    setSavingSteps(prev => ({ ...prev, [recipe.id]: false }));
  };

  const allSteplessSaved = steplessRecipes.every(
    r => r.steps && r.steps.length > 0
  );

  if (!isAuthenticated) return null;

  return (
    <Layout pageTitle="Cook | Big Shop">
      <Grid>
        <Sidebar>
          <div className={styles.sidebarContent}>
            <h2 className={styles.sidebarHeading}>Recipes to cook</h2>

            {session.recipeIds.length > 0 && (
              <ul className={styles.selectedList}>
                {sessionRecipes.map(recipe => (
                  <li key={recipe.id} className={styles.selectedItem}>
                    <span
                      className={styles.colourDot}
                      style={{ background: recipe.colour }}
                    />
                    <span className={styles.selectedName}>{recipe.name}</span>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeRecipe(recipe.id)}
                      aria-label={`Remove ${recipe.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <ul className={styles.recipeList}>
              {recipes
                .filter(r => !session.recipeIds.includes(r.id))
                .map(recipe => (
                  <li key={recipe.id} className={styles.recipeItem}>
                    <label className={styles.recipeLabel}>
                      <input
                        type="checkbox"
                        id={recipe.id}
                        checked={false}
                        onChange={handleRecipeToggle}
                        className={styles.recipeCheckbox}
                      />
                      {recipe.name}
                    </label>
                  </li>
                ))}
            </ul>

            {session.recipeIds.length > 0 && view === 'select' && (
              <button className={styles.planButton} onClick={handleStartPlanning}>
                Plan session →
              </button>
            )}

            {session.recipeIds.length > 0 && (
              <button className={styles.clearButton} onClick={clearSession}>
                Clear session
              </button>
            )}
          </div>
        </Sidebar>

        <MainContent>
          {view === 'select' && (
            <div className={styles.emptyState}>
              <h2>Select recipes to cook together</h2>
              <p>Choose recipes from the sidebar to see your cooking plan.</p>
            </div>
          )}

          {view === 'extract' && (
            <div className={styles.extractView}>
              <h2 className={styles.extractHeading}>Add cooking steps</h2>
              <p className={styles.extractSubtitle}>
                The following recipes need cooking steps before we can build your timeline.
              </p>

              {steplessRecipes.map(recipe => (
                <div key={recipe.id} className={styles.extractCard}>
                  <div className={styles.extractCardHeader}>
                    <span
                      className={styles.extractColourDot}
                      style={{ background: recipe.colour }}
                    />
                    <h3 className={styles.extractRecipeName}>{recipe.name}</h3>
                    {recipe.steps && recipe.steps.length > 0 && (
                      <span className={styles.stepsSavedBadge}>Saved</span>
                    )}
                  </div>

                  <StepEditor
                    steps={pendingSteps[recipe.id] || []}
                    onChange={(steps) => handleStepsChange(recipe.id, steps)}
                    recipeId={recipe.id}
                    remoteUrl={recipe.remoteUrl || recipe.remote_url}
                    method={recipe.method}
                  />

                  {saveErrors[recipe.id] && (
                    <p className={styles.saveError}>{saveErrors[recipe.id]}</p>
                  )}

                  <button
                    className={styles.saveStepsBtn}
                    onClick={() => handleSaveSteps(recipe)}
                    disabled={savingSteps[recipe.id] || !pendingSteps[recipe.id]?.length}
                  >
                    {savingSteps[recipe.id] ? 'Saving…' : 'Save steps'}
                  </button>
                </div>
              ))}

              <div className={styles.extractActions}>
                <button
                  className={styles.continueBtn}
                  onClick={() => setView('overview')}
                  disabled={!allSteplessSaved}
                >
                  Continue to overview →
                </button>
                <button className={styles.skipBtn} onClick={() => setView('overview')}>
                  Skip — proceed without steps
                </button>
              </div>
            </div>
          )}

          {(view === 'overview' || view === 'active') && sessionRecipes.length > 0 && (
            <>
              <SessionOverview
                recipes={sessionRecipes}
                sequence={session.scheduledSequence}
                activeStepIndex={session.activeStepIndex}
                stepStartedAt={session.stepStartedAt}
                passiveTimers={session.passiveTimers}
                isActive={view === 'active'}
              />

              {view === 'overview' && (
                <div className={styles.startBar}>
                  <button className={styles.startButton} onClick={handleStartCooking}>
                    Start Cooking
                  </button>
                </div>
              )}

              {view === 'active' && (
                <NextAction
                  sequence={session.scheduledSequence}
                  activeStepIndex={session.activeStepIndex}
                  stepStartedAt={session.stepStartedAt}
                  passiveTimers={session.passiveTimers}
                  onDone={handleStepDone}
                  onStepStart={recordStepStart}
                  onPassiveStart={recordPassiveStart}
                  onBackToOverview={handleBackToOverview}
                />
              )}
            </>
          )}
        </MainContent>
      </Grid>
    </Layout>
  );
}
