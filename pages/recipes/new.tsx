import Spinner from '@components/recipe-form/spinner';
import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import styles from './index.module.css';
import { ChangeEvent, useState, useRef, useEffect } from 'react';
import Button from '@components/button';
import useFetch, { CachePolicies } from 'use-http'
import PhotoIcon from '@components/svg/photo';
import useIngredientMetadata from '@hooks/use-ingredient-metadata';
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

  // post (form upload -> {jobId}) and get (job status poll -> ImageJobStatus)
  // share this instance with different response shapes - same rationale as
  // Form.tsx's shared useFetch instance.
  const { post, get, response, loading, error } = useFetch(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image`, {
    cachePolicy: CachePolicies.NO_CACHE,
  });

  const { post: postUrl, response: urlResponse, loading: urlLoading } = useFetch<ParseUrlResult>(`${process.env.NEXT_PUBLIC_HOST}/api/parse-recipe-url`, {
    cachePolicy: CachePolicies.NO_CACHE,
  });

  // Poll for job status
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval>;

    if (processingJob) {
      pollInterval = setInterval(async () => {
        const { jobId } = processingJob;
        const job: ImageJobStatus = await get(`?jobId=${jobId}`);

        if (job.status === 'completed') {
          clearInterval(pollInterval);
          setProcessingJob(null);
          const { name, ingredients, method, tags } = job.result || {};
          setParsedRecipe({ name, ingredients: normalizeParsedIngredients(ingredients), method, tags });
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          setProcessingJob(null);
          setAPIError('Processing failed');
          setErrorDetails(job.error || 'An error occurred while processing the image.');
        }
        // If still processing, continue polling
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [processingJob, get]);

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

      const { jobId }: { jobId: string } = await post(formData);

      if (error) {
        setAPIError('Network error');
        setErrorDetails('Failed to connect to the server. Please check your internet connection and try again.');
        return;
      }

      if (!response.ok) {
        setAPIError('Failed to start processing');
        setErrorDetails('An unexpected error occurred. Please try again.');
        return;
      }

      // Start polling for the job
      setProcessingJob({ jobId });
    } catch (error) {
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
    const result = await postUrl({ url: parsedUrl.href, knownIngredients, knownUnits });

    if (!urlResponse.ok) {
      setAPIError('Failed to fetch recipe');
      setErrorDetails(result?.error || 'Could not extract a recipe from that link. Please check it and try again, or use Enter Manually.');
      return;
    }

    setUrlFetched(trimmed);
    setParsedRecipe({
      name: result.name || '',
      ingredients: normalizeParsedIngredients(result.ingredients),
      method: result.method || '',
      remoteUrl: parsedUrl.href,
      tags: result.tags || []
    });
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
              <Button style="blue" icon="tick" onClick={(e) => { e.preventDefault(); fetchFromUrl(urlValue); }}>
                Fetch
                { urlLoading && <Spinner className={styles.loadingIngredients}>Fetching...</Spinner>}
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
            <Button style="blue" onClick={handleImageClick}>
              <PhotoIcon className={styles.photoIcon} />
              Take or upload a photo
              { (loading || processingJob) && <Spinner className={styles.loadingIngredients}>Processing image...</Spinner>}
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
