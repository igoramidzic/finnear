import { UserButton } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function Chat() {
  const { results: messages, status, loadMore } = useUIMessages(
    api.chat.listMessages,
    {},
    { initialNumItems: 50, stream: true },
  );

  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setPrompt("");
    try {
      await sendMessage({ prompt: trimmed });
    } catch (err) {
      setPrompt(trimmed);
      console.error(err);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b border-border shrink-0">
        <div className="container max-w-3xl flex items-center justify-between py-4">
          <h1 className="font-semibold">Finnear</h1>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="container max-w-3xl py-6 flex flex-col gap-4">
          {status === "CanLoadMore" && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => loadMore(50)}>
                Load earlier messages
              </Button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground py-20">
              Start a conversation below.
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.key} message={m} />)
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border shrink-0 bg-background">
        <form
          className="container max-w-3xl py-4 flex gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Send a message…"
            rows={1}
            className="resize-none max-h-48"
            disabled={sending}
            autoFocus
          />
          <Button type="submit" disabled={!prompt.trim() || sending}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join("");
  const [visibleText] = useSmoothText(text, {
    startStreaming: message.status === "streaming",
  });

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-2xl px-4 py-2 max-w-[80%] whitespace-pre-wrap text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          message.status === "failed" &&
            "bg-destructive/10 text-destructive border border-destructive/30",
        )}
      >
        {visibleText || (message.status === "streaming" ? "…" : "")}
      </div>
    </div>
  );
}
