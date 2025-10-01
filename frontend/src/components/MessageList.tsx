import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import type { ChatMessage } from "../types";

type Props = { msgs: ChatMessage[] };

export default function MessageList({ msgs }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      {msgs.map((m) => (
        <MessageBubble
          key={m.id}
          role={m.role}
          content={m.content}
          passages={m.passages}
          tool={m.tool}
          loading={m.loading}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
