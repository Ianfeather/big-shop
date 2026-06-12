import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'cookSession';

const defaultSession = () => ({
  recipeIds: [],
  scheduledSequence: [],
  activeStepIndex: 0,
  stepStartedAt: {},
  passiveTimers: {},
  actualDurations: {},
  startedAt: null,
});

const useCookSession = () => {
  const [session, setSessionState] = useState(defaultSession);
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSessionState({ ...defaultSession(), ...parsed });
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
  }, []);

  const setSession = useCallback((updater) => {
    setSessionState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors (private browsing quota etc.)
      }
      return next;
    });
  }, []);

  const addRecipe = useCallback((recipeId) => {
    setSession(prev => {
      if (prev.recipeIds.includes(recipeId)) return prev;
      return { ...prev, recipeIds: [...prev.recipeIds, recipeId] };
    });
  }, [setSession]);

  const removeRecipe = useCallback((recipeId) => {
    setSession(prev => ({
      ...prev,
      recipeIds: prev.recipeIds.filter(id => id !== recipeId),
    }));
  }, [setSession]);

  const setScheduledSequence = useCallback((sequence) => {
    setSession(prev => ({ ...prev, scheduledSequence: sequence, activeStepIndex: 0 }));
  }, [setSession]);

  const startCooking = useCallback(() => {
    setSession(prev => ({ ...prev, startedAt: Date.now() }));
  }, [setSession]);

  const advanceStep = useCallback((actualDurationMinutes = null) => {
    setSession(prev => {
      const current = prev.scheduledSequence[prev.activeStepIndex];
      const updates = { activeStepIndex: prev.activeStepIndex + 1 };
      if (current && actualDurationMinutes !== null) {
        const stepIds = current.steps.map(s => s.stepId).join('_');
        updates.actualDurations = { ...prev.actualDurations, [stepIds]: actualDurationMinutes };
      }
      return { ...prev, ...updates };
    });
  }, [setSession]);

  const recordStepStart = useCallback((stepId) => {
    setSession(prev => ({
      ...prev,
      stepStartedAt: { ...prev.stepStartedAt, [stepId]: Date.now() },
    }));
  }, [setSession]);

  const recordPassiveStart = useCallback((stepId) => {
    setSession(prev => ({
      ...prev,
      passiveTimers: { ...prev.passiveTimers, [stepId]: Date.now() },
    }));
  }, [setSession]);

  const clearSession = useCallback(() => {
    const fresh = defaultSession();
    localStorage.removeItem(STORAGE_KEY);
    setSessionState(fresh);
  }, []);

  return {
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
  };
};

export default useCookSession;
