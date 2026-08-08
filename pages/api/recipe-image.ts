import formidable, { File as FormidableFile } from 'formidable';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { getStore } from '@netlify/blobs';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { PageConfig } from 'next';
import { extractRecipe, extractMethod } from '../../lib/recipe-import/extract';
import { imageToInput } from '../../lib/recipe-import/photo';
import { requireEnv } from '../../lib/env';
import { fetchKnownNames } from '../../lib/recipe-import/known-names';
import { authenticateAccount } from '../../lib/authenticate';

// Configure API route to handle form data
export const config: PageConfig = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

// Helper function to parse form data with timeout
const parseForm = async (req: NextApiRequest): Promise<{ fields: import('formidable').Fields; files: import('formidable').Files }> => {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 5 * 1024 * 1024,
      keepExtensions: true,
    });

    const timeout = setTimeout(() => {
      reject(new Error('Form parsing timed out'));
    }, 10000);

    form.parse(req, (err, fields, files) => {
      clearTimeout(timeout);
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

// Helper function to validate image
function validateImage(file?: FormidableFile): asserts file is FormidableFile {
  if (!file) {
    throw new Error('No image file provided');
  }

  if (!file.mimetype?.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image size must be less than 5MB');
  }
};

// formidable always returns field values as arrays; a JSON-encoded array of

const processImage = async (base64Image: string, knownIngredients: string[], knownUnits: string[]) => {
  return extractRecipe({
    input: imageToInput(base64Image),
    knownIngredients,
    knownUnits,
  });
};

// Method Import from a photo (a `mode=method` upload): the same photograph of a
// cookbook page, read for its instructions alone. It shares this route rather
// than getting one of its own because everything around the extraction - the
// 5MB upload, the account check, the job in Netlify Blobs and the polling that
// reads it back - is identical, and it is the part with the teeth in it.
const processMethodImage = async (base64Image: string) => {
  return extractMethod({ input: imageToInput(base64Image) });
};

// Fails fast with a clear error if either var is unset (e.g. a preview
// deploy without Netlify Blobs configured), instead of the `!`-asserted
// undefined previously being handed straight to getStore() and failing
// unhelpfully deep inside it.
const getBlobStoreConfig = () => ({
  token: requireEnv(process.env.NETLIFY_BLOB_STORE_TOKEN, 'NETLIFY_BLOB_STORE_TOKEN'),
  siteID: requireEnv(process.env.NETLIFY_SITE_ID, 'NETLIFY_SITE_ID'),
});

// Helper function to update job status.
//
// This previously imported a `Blobs` class from '@netlify/blobs' that does
// not exist in the installed version (8.1.2) - the package only exports
// `Store`/`getStore`/`getDeployStore`. `new Blobs(...)` would have thrown
// `TypeError: Blobs is not a constructor` on every call, meaning Photo
// Import's job-status persistence was completely non-functional. Found and
// fixed here (see follow-ups.md) since it's not expressible as a type-only
// change - switched to the real getStore() API. The `{ ttl: 3600 }` option
// passed to .set() doesn't exist on this version's SetOptions either (no
// replacement attempted here - was already inert given the above).
//
// `accountId` is written on every update, not just the first: each call
// replaces the whole blob, so omitting it on the completed/failed write would
// drop the owner exactly when there is finally a result worth protecting.
const updateJobStatus = async (jobId: string, accountId: number, status: string, result: unknown = null, error: string | null = null) => {
  const store = getStore(getBlobStoreConfig());

  const job = {
    id: jobId,
    accountId,
    status,
    result,
    error,
    updatedAt: Date.now(),
  };

  await store.set(jobId, JSON.stringify(job));
  return job;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Handle job status check
    const auth = await authenticateAccount(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const jobId = req.query.jobId as string | undefined;
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }

    try {
      const store = getStore(getBlobStoreConfig());

      const jobData = await store.get(jobId);

      if (!jobData) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const job = JSON.parse(jobData);

      // A completed job holds the entire contents of somebody's photographed
      // recipe, in one shared blob store keyed by nothing but the job id, so
      // it is readable only by the Account that created it. 404 rather than
      // 403, matching how the Go API answers a Recipe belonging to another
      // Account - there is no reason to confirm that an id exists.
      //
      // A job written before jobs carried an accountId has no owner to match
      // and so fails this check. That can only affect an import already in
      // flight at deploy time, which the user retries.
      if (job.accountId !== auth.account.id) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.status(200).json(job);
    } catch (error) {
      console.error('Error fetching job:', error);
      return res.status(500).json({ error: 'Failed to fetch job status' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Before the form is parsed, so an unauthenticated caller never gets as far
  // as uploading 5MB, let alone as far as an OpenAI call on this account's
  // quota.
  const auth = await authenticateAccount(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    // Parse the form data
    const { fields, files } = await parseForm(req);
    const [imageFile] = files.image || [];

    // Validate the image
    validateImage(imageFile);

    // formidable returns every field as an array. Anything other than 'method'
    // - including the field being absent, which is every existing caller - is a
    // whole-recipe import.
    const [mode] = fields.mode || [];
    const methodOnly = mode === 'method';

    // Read from the database rather than taken from the form fields - see
    // lib/recipe-import/known-names.ts for why the client is no longer asked.
    // Awaited before the job is created so a lookup failure is logged against
    // the request that caused it, not against the background job. Skipped
    // entirely for a method-only import, which has no name to canonicalise.
    const { knownIngredients, knownUnits } = methodOnly
      ? { knownIngredients: [], knownUnits: [] }
      : await fetchKnownNames(req);

    // Read the file and convert to base64
    const imageBuffer = await fs.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');

    // Clean up the temporary file
    await fs.unlink(imageFile.filepath);

    // Create a new job
    const jobId = uuidv4();
    const initialJob = await updateJobStatus(jobId, auth.account.id, 'processing');

    // Start processing in the background
    const processing = methodOnly
      ? processMethodImage(base64Image)
      : processImage(base64Image, knownIngredients, knownUnits);

    processing
      .then(async (result) => {
        await updateJobStatus(jobId, auth.account.id, 'completed', result);
      })
      .catch(async (error) => {
        console.error('Error processing recipe:', error);
        await updateJobStatus(jobId, auth.account.id, 'failed', null, error instanceof Error ? error.message : String(error));
      });

    // Return the job ID immediately
    return res.status(202).json({ jobId });
  } catch (error) {
    console.error('Error processing recipe:', error);
    const message = error instanceof Error ? error.message : String(error);

    // Handle specific error cases
    if (message.includes('timed out')) {
      return res.status(504).json({
        error: 'The image processing took too long. Please try again with a smaller or clearer image.',
        details: 'The request timed out while processing the image.'
      });
    }

    if (message.includes('No image file provided')) {
      return res.status(400).json({
        error: 'No image was provided',
        details: 'Please select an image to process.'
      });
    }

    if (message.includes('File must be an image')) {
      return res.status(400).json({
        error: 'Invalid file type',
        details: 'Please upload an image file (JPEG, PNG, etc.).'
      });
    }

    if (message.includes('Image size must be less than 5MB')) {
      return res.status(400).json({
        error: 'Image too large',
        details: 'Please upload an image smaller than 5MB.'
      });
    }

    // Generic error
    return res.status(500).json({
      error: 'Failed to process recipe image',
      details: 'An unexpected error occurred. Please try again.'
    });
  }
}
