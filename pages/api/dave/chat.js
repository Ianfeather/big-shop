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
- create_shopping_list: Add recipes to shopping list

IMPORTANT: You MUST use tools to perform actions. Never claim to have done something without calling the appropriate tool.
- When user asks to search/find recipes → ALWAYS call search_recipes
- When user asks to add recipes to shopping list → ALWAYS call create_shopping_list. You do not need to ask for confirmation first.
- When user asks for recipe details → ALWAYS call get_recipe_details

Always be helpful and try to understand what the user wants to accomplish with their meal planning.

When presenting recipe lists to users:
- Show clean, numbered lists: "1. Recipe Name - Description"
- Never show internal Recipe IDs to users
- When users refer to recipes by position ("add the first one", "the third recipe"), use the internal ID from that position
- Format lists with proper line breaks for readability`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, userId, authToken, useMockApi = false } = req.body;

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

    // Iterative tool calling - allow multiple rounds
    let toolMessages = [...openAIMessages];
    let allToolCalls = [];
    let totalToolsUsed = 0;
    const maxIterations = 5; // Prevent infinite loops
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: toolMessages,
        tools: availableTools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 1000,
      });

      const assistantMessage = completion.choices[0].message;

      // Add assistant message to conversation
      toolMessages.push(assistantMessage);

      if (!assistantMessage.tool_calls) {
        return res.status(200).json({
          message: {
            role: 'assistant',
            content: assistantMessage.content,
            timestamp: new Date().toISOString()
          },
          toolCalls: allToolCalls,
          debug: {
            toolsUsed: totalToolsUsed,
            iterations: iteration,
            conversationLength: openAIMessages.length
          }
        });
      }

      // Execute all tool calls for this iteration
      for (const toolCall of assistantMessage.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolCall(toolCall.function.name, args, authToken, useMockApi);

          // Add tool result to conversation
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });

          // Store tool call info for response
          allToolCalls.push({
            name: toolCall.function.name,
            arguments: args,
            result: result
          });

          totalToolsUsed++;
        } catch (error) {
          console.error(`Tool ${toolCall.function.name} failed:`, error.message);

          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: error.message
            })
          });

          allToolCalls.push({
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
            error: error.message
          });
        }
      }
    }

    // If we hit max iterations, return what we have
    console.warn('Max tool calling iterations reached');

    return res.status(200).json({
      message: {
        role: 'assistant',
        content: 'I apologize, but I encountered an issue completing your request after multiple attempts.',
        timestamp: new Date().toISOString()
      },
      toolCalls: allToolCalls,
      debug: {
        toolsUsed: totalToolsUsed,
        iterations: iteration,
        maxIterationsReached: true,
        conversationLength: openAIMessages.length
      }
    });

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
