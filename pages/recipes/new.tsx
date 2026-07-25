import Spinner from '@components/recipe-form/spinner';
import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import styles from './index.module.css';
import { ChangeEvent, useState, useRef, useEffect } from 'react';
import Button from '@components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import PhotoIcon from '@components/svg/photo';
import useIngredientMetadata from '@hooks/use-ingredient-metadata';
import { localApiPost, localApiPostFormData, localApiGet } from '../../lib/api-client';
import type { Recipe as RecipeModel } from '../../types/models';

// Helper function to resize image
const resizeImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions while maintaining aspect ratio
        const MAX_WIDTH = 2000; // Maximum width
        const MAX_HEIGHT = 2000; // Maximum height
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB in bytes

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        if (height > MAX_HEIGHT) {
          width = Math.round((width * MAX_HEIGHT) / height);
          height = MAX_HEIGHT;
        }

        canvas.width = width;
        canvas.height = height;

        // A freshly created canvas's 2d context is never null in practice.
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        // Recursive function to create blob with quality adjustment
        const createBlob = (quality: number): Promise<Blob | null> => {
          return new Promise((resolveBlob) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                resolveBlob(null);
                return;
              }

              if (blob.size <= MAX_SIZE || quality <= 0.1) {
                resolveBlob(blob);
              } else {
                // Reduce quality and try again
                createBlob(quality - 0.1).then(resolveBlob);
              }
            }, 'image/jpeg', quality);
          });
        };

        // Start with 90% quality
        createBlob(0.9)
          .then((blob) => {
            if (!blob) {
              reject(new Error('Failed to create image blob'));
              return;
            }
            resolve(blob);
          })
          .catch(reject);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const SOURCE_TABS: { id: 'url' | 'camera' | 'manual'; label: string }[] = [
  { id: 'url', label: 'Recipe Link' },
  { id: 'camera', label: 'Import from Camera' },
  { id: 'manual', label: 'Enter Manually' },
];

interface ParsedIngredient {
  name?: string;
  quantity?: string;
  unit?: string;
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
function normalizeParsedIngredients(ingredients?: ParsedIngredient[]): RecipeModel['ingredients'] {
  return (ingredients || []).map(({ name, quantity, unit }) => ({
    name: name || '',
    quantity: quantity || '',
    unit: unit || ''
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
  const { ingredients: knownIngredients, units: knownUnits } = useIngredientMetadata();

  const uploadImageMutation = useMutation({
    mutationFn: (formData: FormData) =>
      localApiPostFormData<{ jobId: string }>(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image`, formData)
  });

  const parseUrlMutation = useMutation({
    mutationFn: (payload: { url: string; knownIngredients: string[]; knownUnits: string[] }) =>
      localApiPost<ParseUrlResult>(`${process.env.NEXT_PUBLIC_HOST}/api/parse-recipe-url`, payload)
  });

  // Poll for job status - refetchInterval stops itself once the job settles
  // (completed/failed), and `enabled` (via queryKey) stops it the moment
  // processingJob is cleared below, so there's no manual setInterval/cleanup
  // to manage the way there was with use-http.
  const jobStatusQuery = useQuery<ImageJobStatus>({
    queryKey: ['recipe-image-job', processingJob?.jobId],
    enabled: !!processingJob,
    queryFn: () => localApiGet<ImageJobStatus>(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image?jobId=${processingJob!.jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    }
  });

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
  }, [jobStatusQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

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
      formData.append('knownIngredients', JSON.stringify(knownIngredients));
      formData.append('knownUnits', JSON.stringify(knownUnits));

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
      const result = await parseUrlMutation.mutateAsync({ url: parsedUrl.href, knownIngredients, knownUnits });
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
        <div className={styles.headerContainer}>
          <h1 className={styles.title}>{title}</h1>
        </div>

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
              <Button style="primary" icon="tick" disabled={parseUrlMutation.isPending} onClick={(e) => { e.preventDefault(); fetchFromUrl(urlValue); }}>
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
