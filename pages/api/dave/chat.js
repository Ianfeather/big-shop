import OpenAI from 'openai';
import { availableTools, executeToolCall } from './tools';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System prompt for Dave
const DAVE_SYSTEM_PROMPT = `You are Dave, a helpful and friendly meal planning assistant for the Big Shop recipe management app.

Your capabilities:
- Help users plan weekly meals
- Suggest recipes from their personal collection
- Generate shopping lists based on meal plans
- Provide cooking advice and tips
- Answer questions about food and nutrition

Your personality:
- Friendly and conversational, like a helpful friend
- Knowledgeable about food and cooking
- Encouraging and supportive
- Practical and solution-oriented

Available tools:
- search_recipes: Search the user's recipe collection
- get_recipe_details: Get full details for a specific recipe
- create_shopping_list: Generate a shopping list from selected recipes

Always be helpful and try to understand what the user wants to accomplish with their meal planning.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, userId, authToken } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Prepare messages for OpenAI
    const openAIMessages = [
      { role: 'system', content: DAVE_SYSTEM_PROMPT },
      ...messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    // Initial completion with tools
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: openAIMessages,
      tools: availableTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 500,
    });

    console.log({openAIMessages});

    console.log({completion})
    console.log({completion_choices: completion.choices})

    const assistantMessage = completion.choices[0].message;

    console.log('Assistant message:', JSON.stringify(assistantMessage.tool_calls));

    // Check if tools were called
    if (assistantMessage.tool_calls) {
      const toolMessages = [...openAIMessages, assistantMessage];

      // Execute tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolCall(toolCall.function.name, args, authToken);
          console.log({result});
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        } catch (error) {
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: error.message
            })
          });
        }
      }

      // Get final response with tool results
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: toolMessages,
        temperature: 0.7,
        max_tokens: 500,
      });

      const finalResponse = finalCompletion.choices[0].message.content;

      return res.status(200).json({
        message: {
          role: 'assistant',
          content: finalResponse,
          timestamp: new Date().toISOString()
        }
      });
    } else {
      // No tools called, return direct response
      return res.status(200).json({
        message: {
          role: 'assistant',
          content: assistantMessage.content,
          timestamp: new Date().toISOString()
        }
      });
    }

  } catch (error) {
    console.error('Dave chat error:', error);

    if (error.code === 'insufficient_quota') {
      return res.status(400).json({
        error: 'OpenAI API quota exceeded. Please check your OpenAI account.'
      });
    }

    return res.status(500).json({
      error: 'Failed to process chat message'
    });
  }
}
