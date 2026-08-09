import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Button from '@components/button';
import Message from '@components/message';
import Spinner from '@components/recipe-form/spinner';
import PhotoIcon from '@components/svg/photo';
import useAuth from '@hooks/use-auth';
import { nextApiGet, nextApiPost, nextApiPostFormData } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';
import { resizeImage } from '../../lib/resize-image';
import styles from './index.module.css';

interface MethodImportProps {
  // What is in the Method box right now. Only used to decide whether an
  // extraction can be dropped straight in or has to be offered first.
  currentMethod: string;
  onMethod: (method: string) => void;
  // The cook arrived by clicking the pencil beside an empty Method, so they are
  // already here to fill it in - opening straight onto the link field saves them
  // saying so twice.
  defaultOpen?: boolean;
}

interface MethodJobStatus {
  status: 'completed' | 'failed' | 'processing';
  result?: { method?: string };
  error?: string;
}

type Source = 'url' | 'photo';

// Fills in a Recipe's Method on its own, from the page it came from or from a
// photograph of the cookbook it came out of.
//
// The gap this closes: a Recipe imported from a photo or a link often arrives
// with ingredients and no method, and until now the only way to fix that was to
// type the method out - even though the method was right there on the same page
// the ingredients were read from. The Method section on the Recipe page shows a
// pencil while it is empty; that pencil lands here.
//
// Whole-recipe import is not reused for this. It would return a name, a tag set
// and an ingredient list for a Recipe that already has all three, and the cook
// would have to be asked which of them to keep.
const MethodImport = ({ currentMethod, onMethod, defaultOpen = false }: MethodImportProps) => {
  const [source, setSource] = useState<Source | null>(defaultOpen ? 'url' : null);
  const [urlValue, setUrlValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // An extraction that arrived while there was already a method to lose. Held
  // here for the cook to accept or throw away rather than applied.
  const [offered, setOffered] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [job, setJob] = useState<{ jobId: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const { getAccessTokenSilently } = useAuth();

  // Read at the moment an extraction lands rather than closed over when it was
  // started. An import takes seconds, and the cook may have typed a method
  // themselves in the meantime - which is precisely when overwriting it without
  // asking would be worst.
  const currentMethodRef = useRef(currentMethod);
  useEffect(() => {
    currentMethodRef.current = currentMethod;
  }, [currentMethod]);

  const parseUrlMutation = useMutation({
    mutationFn: async (payload: { url: string }) => {
      const token = await getAccessTokenSilently();
      return nextApiPost<{ method: string }>('/api/parse-method-url', payload, token);
    }
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const token = await getAccessTokenSilently();
      return nextApiPostFormData<{ jobId: string }>('/api/recipe-image', formData, token);
    }
  });

  // Same shape as Add New Recipe's photo import: the upload hands back a job id
  // and the job is polled until it settles. refetchInterval stops itself on a
  // terminal status, and `enabled` stops it the moment the job is cleared.
  const jobStatusQuery = useQuery<MethodJobStatus>({
    queryKey: queryKeys.recipeImageJob(job?.jobId),
    enabled: !!job,
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return nextApiGet<MethodJobStatus>(`/api/recipe-image?jobId=${job!.jobId}`, token);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    }
  });

  // A method the cook has not asked to lose is never overwritten: it is offered
  // instead. An empty Method box - which is how nearly everyone gets here - is
  // filled in directly, because there is nothing to weigh it against.
  const deliver = (method: string) => {
    if (!method.trim()) {
      setError('That did not contain a method. Try another link or photo, or type it in below.');
      return;
    }
    if (currentMethodRef.current.trim()) {
      setOffered(method);
      return;
    }
    onMethod(method);
    setApplied(true);
    setSource(null);
  };

  // Drives the photo job to a terminal state. TanStack Query v5 has no
  // onSuccess/onError on useQuery, so mirroring polled data into state in an
  // effect is the supported shape - it runs at most once per import.
  // (follow-ups.md #32)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const settled = jobStatusQuery.data;
    if (!settled) return;

    if (settled.status === 'completed') {
      setJob(null);
      deliver(settled.result?.method || '');
    } else if (settled.status === 'failed') {
      setJob(null);
      setError(settled.error || 'Could not read a method from that photo. Try again, or type it in below.');
    }
  }, [jobStatusQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const fetchFromUrl = async (rawUrl: string) => {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      setError('That does not look like a link. Paste the full address, starting with https://');
      return;
    }

    setError(null);
    setApplied(false);
    setOffered(null);

    try {
      const { method } = await parseUrlMutation.mutateAsync({ url: parsedUrl.href });
      deliver(method || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read a method from that link.');
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setApplied(false);
    setOffered(null);

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, etc).');
      return;
    }

    try {
      const resized = await resizeImage(file);
      const formData = new FormData();
      formData.append('image', resized, file.name);
      // What makes this a Method Import rather than a whole-recipe one - the
      // route reads only the instructions off the page and the job's result
      // carries nothing else.
      formData.append('mode', 'method');

      const { jobId } = await uploadImageMutation.mutateAsync(formData);
      setJob({ jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that photo. Please try again.');
    }
  };

  const working = parseUrlMutation.isPending || uploadImageMutation.isPending || !!job;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>No method yet?</span>
        <span className={styles.hint}>Read it off the original page, or photograph the page of the book.</span>
      </div>

      <div className={styles.sources}>
        <button
          type="button"
          className={`${styles.sourceTab} ${source === 'url' ? styles.sourceTabActive : ''}`}
          onClick={() => { setSource('url'); setError(null); }}
        >
          From a link
        </button>
        <button
          type="button"
          className={`${styles.sourceTab} ${source === 'photo' ? styles.sourceTabActive : ''}`}
          onClick={() => { setSource('photo'); setError(null); }}
        >
          From a photo
        </button>
      </div>

      { source === 'url' && (
        <div className={styles.sourceSection}>
          <label htmlFor="method-import-url" className={styles.inputLabel}>Recipe link</label>
          <div className={styles.inputGroup}>
            <input
              id="method-import-url"
              className={styles.input}
              placeholder="https://"
              autoComplete="off"
              type="text"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchFromUrl(urlValue); } }}
            />
            <Button
              style="primary"
              disabled={working}
              onClick={(e) => { e.preventDefault(); fetchFromUrl(urlValue); }}
            >
              Fetch
              { parseUrlMutation.isPending && <Spinner /> }
            </Button>
          </div>
        </div>
      )}

      { source === 'photo' && (
        <div className={styles.sourceSection}>
          <input
            type="file"
            id="method-image-input"
            accept="image/*"
            capture="environment"
            ref={imageInput}
            className={styles.fileInput}
            onChange={handleImageChange}
          />
          <Button style="primary" disabled={working} onClick={(e) => { e.preventDefault(); imageInput.current?.click(); }}>
            <PhotoIcon className={styles.photoIcon} />
            Photograph the method
            { (uploadImageMutation.isPending || job) && <Spinner /> }
          </Button>
          <p className={styles.hint}>Fit the whole set of instructions in the frame - the ingredient list can be left out.</p>
        </div>
      )}

      { offered && (
        <div className={styles.offer}>
          <p className={styles.offerHint}>There is already a method here. This is what came back:</p>
          <pre className={styles.offerPreview}>{offered}</pre>
          <div className={styles.offerActions}>
            <Button style="primary" onClick={(e) => { e.preventDefault(); onMethod(offered); setOffered(null); setApplied(true); setSource(null); }}>
              Replace the method
            </Button>
            <Button onClick={(e) => { e.preventDefault(); setOffered(null); }}>Keep what I have</Button>
          </div>
        </div>
      )}

      { applied && <p className={styles.applied}>Method filled in below - read it over, then save the recipe.</p> }

      { error && <div className={styles.error}><Message message={error} status="error" /></div> }
    </div>
  );
};

export default MethodImport;
