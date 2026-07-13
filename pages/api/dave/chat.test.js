import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: mockCreate } };
    }
  }
}));

vi.mock('./tools', async () => {
  const actual = await vi.importActual('./tools');
  return { ...actual, executeToolCall: vi.fn() };
});

import handler from './chat';
import { executeToolCall } from './tools';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function assistantMessage({ content = null, tool_calls } = {}) {
  return { choices: [{ message: { role: 'assistant', content, tool_calls } }] };
}

beforeEach(() => {
  mockCreate.mockReset();
  executeToolCall.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('dave chat handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('requires a messages array', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { messages: 'not an array' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Messages array is required' });
  });

  it('returns the assistant message directly when no tool call is made', async () => {
    mockCreate.mockResolvedValueOnce(assistantMessage({ content: 'Hi there!' }));
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hello' }] } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const [payload] = res.json.mock.calls[0];
    expect(payload.message.content).toBe('Hi there!');
    expect(payload.toolCalls).toEqual([]);
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('executes a tool call and returns the follow-up assistant message', async () => {
    mockCreate
      .mockResolvedValueOnce(assistantMessage({
        tool_calls: [{ id: 't1', function: { name: 'search_recipes', arguments: JSON.stringify({ query: 'egg' }) } }]
      }))
      .mockResolvedValueOnce(assistantMessage({ content: 'Found 1 recipe' }));
    executeToolCall.mockResolvedValueOnce({ success: true, recipes: [] });
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'find egg recipes' }] } }, res);

    expect(executeToolCall).toHaveBeenCalledWith('search_recipes', { query: 'egg' }, undefined, false);
    const [payload] = res.json.mock.calls[0];
    expect(payload.message.content).toBe('Found 1 recipe');
    expect(payload.toolCalls).toEqual([
      { name: 'search_recipes', arguments: { query: 'egg' }, result: { success: true, recipes: [] } }
    ]);
    expect(payload.debug.toolsUsed).toBe(1);
  });

  it('records a failed tool call but continues the conversation', async () => {
    mockCreate
      .mockResolvedValueOnce(assistantMessage({
        tool_calls: [{ id: 't1', function: { name: 'search_recipes', arguments: JSON.stringify({}) } }]
      }))
      .mockResolvedValueOnce(assistantMessage({ content: 'Something went wrong' }));
    executeToolCall.mockRejectedValueOnce(new Error('tool broke'));
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.toolCalls).toEqual([
      { name: 'search_recipes', arguments: {}, error: 'tool broke' }
    ]);
  });

  it('stops after the max iteration count and returns a fallback message', async () => {
    mockCreate.mockResolvedValue(assistantMessage({
      tool_calls: [{ id: 't1', function: { name: 'search_recipes', arguments: '{}' } }]
    }));
    executeToolCall.mockResolvedValue({ success: true });
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }, res);

    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(200);
    const [payload] = res.json.mock.calls[0];
    expect(payload.debug.maxIterationsReached).toBe(true);
    expect(payload.message.content).toMatch(/multiple attempts/);
  });

  it('returns 400 when OpenAI reports an insufficient quota error', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('quota exceeded'), { code: 'insufficient_quota' }));
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'OpenAI API quota exceeded. Please check your OpenAI account.' });
  });

  it('returns a generic 500 for any other error', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to process chat message' });
  });
});
