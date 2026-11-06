'use client';

import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

// Model replies are GFM markdown (tables, headings, bold). react-markdown builds
// React elements and ignores raw HTML, so a reply cannot inject markup.
const MD: Components = {
  h1: ({ children }) => <h3 className="text-base font-semibold mt-4 first:mt-0 mb-2">{children}</h3>,
  h2: ({ children }) => <h3 className="text-base font-semibold mt-4 first:mt-0 mb-2">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold mt-3 first:mt-0 mb-1.5">{children}</h4>,
  h4: ({ children }) => <h4 className="font-semibold mt-3 first:mt-0 mb-1.5">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>
  ),
  code: ({ children }) => <code className="rounded bg-elevated px-1 py-0.5 text-[0.92em]">{children}</code>,
  hr: () => <hr className="my-3 border-hairline" />,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-hairline pl-3 text-mute">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-hairline px-3 py-1.5 font-semibold whitespace-nowrap first:pl-0">{children}</th>,
  td: ({ children }) => <td className="border-b border-hairline px-3 py-1.5 whitespace-nowrap first:pl-0">{children}</td>,
};

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
                <div className="bg-deep rounded-[20px] rounded-bl-[4px] px-5 py-3 max-w-[85%] min-w-0 text-sm text-ondark">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
                    {m.content}
                  </ReactMarkdown>
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
