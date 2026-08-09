import Spinner from '@components/recipe-form/spinner';
import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import PageHeading from '@components/page-heading';
import styles from './index.module.css';
import { ChangeEvent, useState, useRef, useEffect } from 'react';
import Button from '@components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import PhotoIcon from '@components/svg/photo';
import { nextApiPost, nextApiPostFormData, nextApiGet } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';
import { resizeImage } from '../../lib/resize-image';
import useAuth from '@hooks/use-auth';
import type { Recipe as RecipeModel } from '../../types/models';

const SOURCE_TABS: { id: 'url' | 'camera' | 'manual'; label: string }[] = [
  { id: 'url', label: 'Recipe Link' },
  { id: 'camera', label: 'Import from Camera' },
  { id: 'manual', label: 'Enter Manually' },
];

interface ParsedIngredient {
  name?: string;
  quantity?: string;
  unit?: string;
  baseUnit?: string;
  displayUnit?: string;
  unitSizes?: Record<string, number>;
  pantryStaple?: boolean;
}

interface ParseUrlResult {
  name?: string;
  ingredients?: ParsedIngredient[];
  method?: string;
  tags?: string[];
  error?: string;
}

interface ImageJobStatus {
  status: 'completed' | 'failed' | 'processing';
  result?: { name?: string; ingredients?: ParsedIngredient[]; method?: string; tags?: string[] };
  error?: string;
}

// Extraction results (from either source) carry loosely-shaped ingredients -
// same normalization Form.tsx's appendIngredients already does for
// bulk-paste extraction, applied here for URL/photo extraction too.
// baseUnit/displayUnit/unitSizes are catalog metadata the extractor proposes for
// ingredients this app has not seen (CONTEXT.md's Unit Size). They must survive
// this hop: URL and Photo import reach the form through initialRecipe rather
// than appendIngredients, so anything dropped here never reaches the save
// payload and the ingredient is never classified. An earlier version of this
// function destructured only name/quantity/unit and silently lost them for two
// of the three Import Sources.
function normalizeParsedIngredients(ingredients?: ParsedIngredient[]): RecipeModel['ingredients'] {
  return (ingredients || []).map(({ name, quantity, unit, baseUnit, displayUnit, unitSizes, pantryStaple }) => ({
    name: name || '',
    quantity: quantity || '',
    unit: unit || '',
    ...(baseUnit ? { baseUnit } : {}),
    ...(displayUnit !== undefined && displayUnit !== null ? { displayUnit } : {}),
    ...(unitSizes ? { unitSizes } : {}),
    ...(pantryStaple ? { pantryStaple } : {}),
  }));
}

const NewRecipe = () => {
  const title = 'Add New Recipe';
  const [activeTab, setActiveTab] = useState<'url' | 'camera' | 'manual'>('url');
  const [APIError, setAPIError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [parsedRecipe, setParsedRecipe] = useState<Partial<RecipeModel> | null>(null);
  const [processingJob, setProcessingJob] = useState<{ jobId: string } | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const [urlFetched, setUrlFetched] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const { getAccessTokenSilently } = useAuth();

  // Both import routes read the canonical Ingredient/Unit names from the
  // database themselves, and /api/recipe-image additionally requires the token
  // to authenticate the caller (lib/authenticate.ts) - it runs an OpenAI
  // extraction and stores the result, neither of which is on offer to an
  // anonymous request. Both are extraction only - they write no Big Shop
  // state, so neither invalidates anything. The Ingredients and Units an
  // import introduces are created when the Recipe is saved, and it is
  // Form.tsx's save that invalidates for them.
  const uploadImageMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const token = await getAccessTokenSilently();
      return nextApiPostFormData<{ jobId: string }>('/api/recipe-image', formData, token);
    }
  });

  const parseUrlMutation = useMutation({
    mutationFn: async (payload: { url: string }) => {
      const token = await getAccessTokenSilently();
      return nextApiPost<ParseUrlResult>('/api/parse-recipe-url', payload, token);
    }
  });

  // Poll for job status - refetchInterval stops itself once the job settles
  // (completed/failed), and `enabled` (via queryKey) stops it the moment
  // processingJob is cleared below, so there's no manual setInterval/cleanup
  // to manage the way there was with use-http.
  const jobStatusQuery = useQuery<ImageJobStatus>({
    queryKey: queryKeys.recipeImageJob(processingJob?.jobId),
    enabled: !!processingJob,
    // Every poll carries the token: the route resolves it to an Account and
    // hands back only that Account's job.
    queryFn: async () => {
      const token = await getAccessTokenSilently();
      return nextApiGet<ImageJobStatus>(`/api/recipe-image?jobId=${processingJob!.jobId}`, token);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    }
  });

  // Drives the Photo Import job to a terminal state. TanStack Query v5 removed
  // useQuery's onSuccess/onError, so reacting to polled data in an effect is
  // the supported shape for this - there is no callback to move it into, and
  // the transition genuinely is "external system changed, mirror it into
  // state". Runs at most twice per import (completed or failed), not per poll.
  // (follow-ups.md #32)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const job = jobStatusQuery.data;
    if (!job) return;

    if (job.status === 'completed') {
      setProcessingJob(null);
      const { name, ingredients, method, tags } = job.result || {};
      setParsedRecipe({ name, ingredients: normalizeParsedIngredients(ingredients), method, tags });
    } else if (job.status === 'failed') {
      setProcessingJob(null);
      setAPIError('Processing failed');
      setErrorDetails(job.error || 'An error occurred while processing the image.');
    }
  }, [jobStatusQuery.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleImageClick = () => {
    imageInput.current?.click();
  }

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    // Reset error states
    setAPIError(null);
    setErrorDetails(null);
    setParsedRecipe(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setAPIError('Invalid file type');
      setErrorDetails('Please select an image file (JPEG, PNG, etc.).');
      return;
    }

    try {
      // Resize the image if it's too large
      const resizedBlob = await resizeImage(file);

      const formData = new FormData();
      formData.append('image', resizedBlob, file.name);

      const { jobId } = await uploadImageMutation.mutateAsync(formData);

      // Start polling for the job
      setProcessingJob({ jobId });
    } catch {
      setAPIError('Failed to process image');
      setErrorDetails('An unexpected error occurred. Please try again.');
    }
  };

  const fetchFromUrl = async (rawUrl: string) => {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed || trimmed === urlFetched) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      // Not a full URL yet - wait for more input rather than erroring on every keystroke.
      return;
    }

    setAPIError(null);
    setErrorDetails(null);

    try {
      const result = await parseUrlMutation.mutateAsync({ url: parsedUrl.href });
      setUrlFetched(trimmed);
      setParsedRecipe({
        name: result.name || '',
        ingredients: normalizeParsedIngredients(result.ingredients),
        method: result.method || '',
        remoteUrl: parsedUrl.href,
        tags: result.tags || []
      });
    } catch (err) {
      setAPIError('Failed to fetch recipe');
      setErrorDetails(err instanceof Error ? err.message : 'Could not extract a recipe from that link. Please check it and try again, or use Enter Manually.');
    }
  };

  return (
    <Layout pageTitle={title}>
      <MainContent>
        <PageHeading subheading="Paste a link, photograph a page, or type it in yourself.">
          {title}
        </PageHeading>

        <div className={styles.sourceTabs}>
          {
            SOURCE_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.sourceTab} ${activeTab === tab.id ? styles.sourceTabActive : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))
          }
        </div>

        { activeTab === 'url' && (
          <div className={styles.sourceSection}>
            <label htmlFor="recipe-url-input">Recipe URL</label>
            <div className={styles.sourceInputGroup}>
              <input
                id="recipe-url-input"
                placeholder="https://"
                autoComplete="off"
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onBlur={(e) => fetchFromUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchFromUrl(urlValue); } }}
              />
              <Button style="primary" disabled={parseUrlMutation.isPending} onClick={(e) => { e.preventDefault(); fetchFromUrl(urlValue); }}>
                Fetch
                { parseUrlMutation.isPending && <Spinner className={styles.loadingIngredients}>Fetching...</Spinner>}
              </Button>
            </div>
          </div>
        )}

        { activeTab === 'camera' && (
          <div className={styles.sourceSection}>
            <input
              type="file"
              id="imageInput"
              accept="image/*"
              capture="environment"
              ref={imageInput}
              className={styles.fileInput}
              onChange={handleImageChange}
            />
            <Button style="primary" disabled={uploadImageMutation.isPending || !!processingJob} onClick={handleImageClick}>
              <PhotoIcon className={styles.photoIcon} />
              Take or upload a photo
              { (uploadImageMutation.isPending || processingJob) && <Spinner className={styles.loadingIngredients}>Processing image...</Spinner>}
            </Button>
          </div>
        )}

        { APIError && (
          <div className={styles.errorContainer}>
            <p className={styles.error}>{APIError}</p>
            { errorDetails && <p className={styles.errorDetails}>{errorDetails}</p> }
          </div>
        )}

        { (activeTab === 'manual' || parsedRecipe) && (
          <Form initialRecipe={parsedRecipe || {}} mode="new"/>
        )}
      </MainContent>
    </Layout>
  )
}

export default NewRecipe
