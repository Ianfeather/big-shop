import { OpenAI } from 'openai';
import formidable from 'formidable';
import fs from 'fs/promises';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure API route to handle form data
export const config = {
  api: {
    bodyParser: false,
  },
};


// Helper function to parse form data
const parseForm = async (req) => {
  return new Promise((resolve, reject) => {
    const form = formidable();
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the form data
    const { files } = await parseForm(req);
    const [imageFile] = files.image;

    if (!imageFile) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Read the file and convert to base64
    const imageBuffer = await fs.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');

    // Clean up the temporary file
    await fs.unlink(imageFile.filepath);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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

                The instructions should be in markdown format and formatted to be as clear as possible. Each instruction should be a separate line. If an instruction is a list of items then it should be formatted as a list. For example, "1. Preheat the oven. 2. Mix the ingredients. 3. Bake for 30 minutes.".
                `,
            },
            {
              type: 'image_url',
              image_url: {
                "url": `data:image/jpeg;base64,${base64Image}`,
                "detail": "high"
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
    return res.status(500).json({ error: 'Failed to process recipe image' });
  }
}
