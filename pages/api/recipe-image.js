import { OpenAI } from 'openai';
import formidable from 'formidable';
import fs from 'fs/promises';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
});

// Configure API route to handle form data
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb', // Increase response limit for larger images
  },
};

// Helper function to parse form data with timeout
const parseForm = async (req) => {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
      keepExtensions: true,
    });

    const timeout = setTimeout(() => {
      reject(new Error('Form parsing timed out'));
    }, 10000); // 10 second timeout for form parsing

    form.parse(req, (err, fields, files) => {
      clearTimeout(timeout);
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

// Helper function to validate image
const validateImage = (file) => {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the form data
    const { files } = await parseForm(req);
    const [imageFile] = files.image;

    // Validate the image
    validateImage(imageFile);

    // Read the file and convert to base64
    const imageBuffer = await fs.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');

    // Clean up the temporary file
    await fs.unlink(imageFile.filepath);

    // Process with OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
                This is an image of a recipe from a cookbook. Extract the recipe name, ingredients, and instructions. Format the response in a JSON object.

                The schema for the json object should be {name: string, ingredients: Ingredient[], instructions: string}. The Ingredient schema should be {name: string, quantity: string, unit: string}.

                The name of the recipe should be in title case.

                The units for the ingredients should be standardized to the following: bottle,clove,gram,kilogram,litre,millilitre,packet,pinch,slice,tablespoon,teaspoon,tin. You can translate abbreviations. eg. tsp should become teaspoon. If you can't translate the unit to one of these then you must leave the unit value as an empty string. If there is no unit specified then you should leave the unit value as an empty string.

                Ingredient names should be in lowercase and singular form. For example, "tomatoes" should be "tomato". The ingredient should not include adjectives or descriptive words such as large, peeled or chopped, but it CAN include the type of ingredient. For example, "chicken breast or "green beans". You should never remove the name of a flavour or key ingredient e.g 'chicken stock' should never be reduced just to 'stock'

                Ingredient quantities should be in string format and use decimals rather than fractions.

                You should omit any ingredients that would be considered pantry staples such as salt, pepper, oil, or water.

                The instructions should be in markdown format and formatted to be as clear as possible. Each instruction should be a separate line. If an instruction is a list of items then it should be formatted as a list. For example, "1. Preheat the oven. 2. Mix the ingredients. 3. Bake for 30 minutes.". The instruction must NOT use double quotes (") at any point. They should be replaced by a single quote if present or omitted.
                `,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: 'high'
              }
            }
          ],
        },
      ],
      max_tokens: 1000,
    });

    return res.status(200).json({
      result: response.choices[0].message.content,
    });
  } catch (error) {
    console.error('Error processing recipe:', error);

    // Handle specific error cases
    if (error.message.includes('timed out')) {
      return res.status(504).json({
        error: 'The image processing took too long. Please try again with a smaller or clearer image.',
        details: 'The request timed out while processing the image.'
      });
    }

    if (error.message.includes('No image file provided')) {
      return res.status(400).json({
        error: 'No image was provided',
        details: 'Please select an image to process.'
      });
    }

    if (error.message.includes('File must be an image')) {
      return res.status(400).json({
        error: 'Invalid file type',
        details: 'Please upload an image file (JPEG, PNG, etc.).'
      });
    }

    if (error.message.includes('Image size must be less than 5MB')) {
      return res.status(400).json({
        error: 'Image too large',
        details: 'Please upload an image smaller than 5MB.'
      });
    }

    // Handle OpenAI API errors
    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Too many requests',
        details: 'Please wait a moment and try again.'
      });
    }

    // Generic error
    return res.status(500).json({
      error: 'Failed to process recipe image',
      details: 'An unexpected error occurred. Please try again.'
    });
  }
}
