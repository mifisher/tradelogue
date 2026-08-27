'use client';

import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const STARTERS = [
  'How do I perform on Uncertain days?',
  'Which rule costs me the most?',
  'Compare my setups',
  'What happened on my worst day?',
];

export function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    const nextMessages: Message[] = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    setPending(true);

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply as string },
        ]);
      }
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Message list */}
      {messages.length > 0 ? (
        <div className="flex flex-col gap-4">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="bg-elevated rounded-[20px] rounded-br-[4px] px-5 py-3 max-w-[80%] ml-auto text-sm text-ondark whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="bg-deep rounded-[20px] rounded-bl-[4px] px-5 py-3 max-w-[85%] text-sm text-ondark whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ),
          )}

          {/* Thinking indicator */}
          {pending && (
            <div className="flex justify-start">
              <div className="bg-deep rounded-[20px] rounded-bl-[4px] px-5 py-3">
                <span className="animate-pulse text-stone text-sm">Thinking…</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-loss text-sm px-1">{error}</p>
          )}

          <div ref={bottomRef} />
        </div>
      ) : (
        /* Empty state — starter chips */
        <div className="flex flex-col gap-4">
          <p className="text-stone text-sm">
            Ask me anything about your trading history — P&amp;L, rule violations, setups, or specific sessions.
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={pending}
                className="rounded-full bg-elevated text-mute hover:text-ondark hover:bg-elevated/80 px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-loss text-sm px-1">{error}</p>
          )}
        </div>
      )}

      {/* Input row */}
      <form onSubmit={handleSubmit} className="flex gap-3 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          placeholder="Ask about your trades, rules, or setups…"
          rows={1}
          className="flex-1 bg-deep border border-hairline rounded-full px-5 h-11 text-sm text-ondark placeholder:text-stone resize-none disabled:opacity-50 focus:outline-none focus:border-stone/50 leading-[44px] overflow-hidden"
          style={{ lineHeight: '44px' }}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="shrink-0 rounded-full bg-ondark text-canvas px-5 h-11 text-sm font-semibold transition-colors hover:bg-ondark/90 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
