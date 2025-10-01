import React, { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";

type Props = {
  value: string;
  setValue: (s: string) => void;
  onSend: () => void;
  disabled?: boolean;
};

export default function Composer({ value, setValue, onSend, disabled }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Resize textarea to content (simple auto-grow)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled) onSend();
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      <div className="mx-auto max-w-3xl px-4 pb-4">
        <div className="rounded-2xl border border-gray-300 bg-white shadow-lg p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              className="flex-1 resize-none outline-none text-sm leading-6 max-h-40
                         placeholder:text-gray-400 p-2"
              placeholder="Ask about PM2.5, PM10, ozone, NO2… (Shift+Enter for newline)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
            />
            <button
              onClick={onSend}
              disabled={disabled || !value.trim()}
              aria-label="Send message"
              className={[
                "relative inline-flex items-center justify-center",
                "h-12 w-12 rounded-full shadow-md transition",
                disabled || !value.trim()
                  ? "bg-gray-300 text-white cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
              ].join(" ")}
            >
              <FontAwesomeIcon icon={faPaperPlane} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
