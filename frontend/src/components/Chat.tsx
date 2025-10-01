import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import Header from "./Header";
import MessageList from "./MessageList";
import Composer from "./Composer";
import type { ChatMessage } from "../types";

const API = import.meta.env.VITE_API_URL as string;

let COUNTER = 0;
const nextId = () => `${Date.now()}-${COUNTER++}`;

export default function Chat() {
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => [
    {
      id: nextId(),
      role: "assistant",
      content:
        "Hi! I’m your Air Quality Agent. Ask me about PM2.5, PM10, ozone, or NO₂ anywhere in the world. I’ll combine live OpenAQ data with trusted background sources.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const pendingAssistantIdRef = useRef<string | null>(null);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;

    setSending(true);

    const userId = nextId();
    const assistantPlaceholderId = nextId();
    pendingAssistantIdRef.current = assistantPlaceholderId;

    // 1) Push user message
    setMsgs((m) => [...m, { id: userId, role: "user", content }]);
    setInput("");

    // 2) Push assistant placeholder with spinner
    setMsgs((m) => [
      ...m,
      {
        id: assistantPlaceholderId,
        role: "assistant",
        content: "",
        loading: true,
      },
    ]);

    try {
      // Call backend
      const { data } = await axios.post(
        `${API}/chat`,
        { message: content },
        { timeout: 45000 }
      );

      // 3) Replace the placeholder bubble with the real answer
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === assistantPlaceholderId
            ? {
                ...msg,
                loading: false,
                content: data.answer,
                tool: data.tool,
                passages: data.passages,
              }
            : msg
        )
      );
    } catch (err: any) {
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === assistantPlaceholderId
            ? {
                ...msg,
                loading: false,
                content:
                  "Sorry — I couldn’t reach the server. Please try again." +
                  (err?.message ? `\n\n(${err.message})` : ""),
              }
            : msg
        )
      );
    } finally {
      pendingAssistantIdRef.current = null;
      setSending(false);
    }
  }, [input, sending]);

  // Reserve space so the fixed Composer doesn't cover the messages
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--composer-pad", "96px");
    return () => {
      root.style.removeProperty("--composer-pad");
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="pb-[var(--composer-pad)]">
        <MessageList msgs={msgs} />
      </main>
      <Composer value={input} setValue={setInput} onSend={send} disabled={sending} />
    </div>
  );
}
