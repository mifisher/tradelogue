// ── /api/coach — agentic chat with your journal ─────────────────────────────
// POST body: { messages: { role: 'user' | 'assistant'; content: string }[] }
// Returns:   { reply: string }

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { CHAT_TOOLS, executeTool } from '@/lib/ai/chat-tools';
import { TRADING_TIMEZONE } from '@/lib/config';
import {
  type AiConfig,
  aiProviderLabel,
  getAiConfig,
  getAnthropicClient,
  invalidApiKeyMessage,
  isAiApiError,
  isAiAuthenticationError,
  isAiConfigured,
  isAiRateLimitError,
  missingApiKeyMessage,
  moonshotThinkingParam,
} from '@/lib/ai/provider';

// ── Static system prompt ────────────────────────────────────────────────────
// No dates, IDs, or volatile content here. Today's date is injected at the END
// of the latest user message in the request body instead.

const CHAT_SYSTEM =
  "You are a personal trading coach assistant with access to the trader's complete execution history, " +
  'journal entries, rule violations, and setup statistics via tools. ' +
  'Answer questions using ONLY data returned by tools — never invent trades, numbers, or dates. ' +
  'If the data is insufficient to answer, say so clearly. ' +
  'Always cite real numbers from tool results (P&L figures, trade counts, dates). ' +
  "Keep responses concise and focused. Today's date is given at the end of the user's latest message.";

const MAX_LOOP_ITERATIONS = 8;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface MoonshotToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

type MoonshotMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: MoonshotToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

// ── PT date helper ───────────────────────────────────────────────────────────

function todayPT(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TRADING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
}

function buildChatMessages(rawMessages: ChatMessage[]): ChatMessage[] {
  const today = todayPT();
  return rawMessages.map((m, i) => {
    const isLast = i === rawMessages.length - 1;
    const content =
      isLast && m.role === 'user'
        ? `${m.content}\n\n(Today is ${today}.)`
        : m.content;
    return { role: m.role, content };
  });
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toMoonshotMessages(messages: ChatMessage[]): MoonshotMessage[] {
  return [
    { role: 'system', content: CHAT_SYSTEM },
    ...messages.map((m) => ({ role: m.role, content: m.content }) satisfies MoonshotMessage),
  ];
}

function moonshotTools() {
  return CHAT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function parseToolArguments(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function createMoonshotChatCompletion(config: AiConfig, messages: MoonshotMessage[]) {
  if (!config.apiKey || !config.baseUrl) {
    throw new Error(missingApiKeyMessage(config));
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.models.chat,
      max_tokens: 8192,
      ...(moonshotThinkingParam(config.models.chat)
        ? { thinking: moonshotThinkingParam(config.models.chat) }
        : {}),
      messages,
      tools: moonshotTools(),
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(invalidApiKeyMessage(config));
  }
  if (response.status === 429) {
    throw new Error('Rate limit reached — please wait a moment and try again.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${aiProviderLabel(config)} API error (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as {
    choices?: {
      finish_reason?: string | null;
      message?: {
        content?: string | null;
        tool_calls?: MoonshotToolCall[];
      };
    }[];
  };
}

async function runAnthropicChat(config: AiConfig, rawMessages: ChatMessage[]): Promise<string> {
  const messages = toAnthropicMessages(buildChatMessages(rawMessages));
  let iterations = 0;
  let finalText = '';

  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations++;

    const response = await getAnthropicClient(config).messages.create({
      model: config.models.chat,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text' as const,
          text: CHAT_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: CHAT_TOOLS,
      messages,
    });

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: [] });
      iterations--;
      continue;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    for (const block of response.content) {
      if (block.type === 'text') {
        finalText += block.text;
      }
    }
    break;
  }

  return finalText || 'I was unable to generate a response. Please try again.';
}

async function runMoonshotChat(config: AiConfig, rawMessages: ChatMessage[]): Promise<string> {
  const messages = toMoonshotMessages(buildChatMessages(rawMessages));

  for (let iterations = 0; iterations < MAX_LOOP_ITERATIONS; iterations++) {
    const response = await createMoonshotChatCompletion(config, messages);
    const choice = response.choices?.[0];
    const message = choice?.message;

    if (!message) break;

    if (choice?.finish_reason === 'tool_calls' && message.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        const result = await executeTool(
          toolCall.function.name,
          parseToolArguments(toolCall.function.arguments),
        );
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      continue;
    }

    if (message.content) return message.content;
    break;
  }

  return 'I was unable to generate a response. Please try again.';
}

function validateMessages(rawMessages: unknown): ChatMessage[] | NextResponse {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: 'messages array is required and must be non-empty' }, { status: 400 });
  }

  const messages: ChatMessage[] = [];
  for (const m of rawMessages) {
    if (
      !m ||
      typeof m !== 'object' ||
      (m as { role?: unknown }).role !== 'user' &&
        (m as { role?: unknown }).role !== 'assistant'
    ) {
      return NextResponse.json(
        { error: `Invalid message role: ${(m as { role?: unknown })?.role}` },
        { status: 400 },
      );
    }
    messages.push({
      role: (m as { role: 'user' | 'assistant' }).role,
      content: String((m as { content?: unknown }).content ?? ''),
    });
  }
  return messages;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const config = getAiConfig();

  if (!isAiConfigured(config)) {
    return NextResponse.json(
      { error: `Chat is unavailable: ${missingApiKeyMessage(config)}` },
      { status: 400 },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = validateMessages(body.messages);
  if (messages instanceof NextResponse) return messages;

  try {
    const reply =
      config.provider === 'anthropic'
        ? await runAnthropicChat(config, messages)
        : await runMoonshotChat(config, messages);

    return NextResponse.json({ reply });
  } catch (err) {
    if (isAiAuthenticationError(err) || (err instanceof Error && err.message.includes('API key is invalid'))) {
      return NextResponse.json({ error: invalidApiKeyMessage(config) }, { status: 401 });
    }
    if (isAiRateLimitError(err) || (err instanceof Error && err.message.includes('Rate limit'))) {
      return NextResponse.json(
        { error: 'Rate limit reached — please wait a moment and try again.' },
        { status: 429 },
      );
    }
    if (isAiApiError(err)) {
      const msg = err instanceof Error ? err.message : 'Unknown API error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}
