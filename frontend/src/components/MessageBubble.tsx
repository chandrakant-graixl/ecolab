import type { ToolInfo, Passage } from "../types";
import { ClipLoader } from "react-spinners";

type Props = {
  role: "user" | "assistant";
  content: string;
  passages?: Passage[];
  tool?: ToolInfo;
  loading?: boolean;
};

export default function MessageBubble({ role, content, passages, tool, loading }: Props) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "text-right" : "text-left"}>
      <div
        className={[
          "inline-block max-w-[90%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap align-middle",
          isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900",
        ].join(" ")}
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <ClipLoader size={16} />
            <span className="text-gray-600">Thinking…</span>
          </div>
        ) : (
          content
        )}
      </div>

      {/* Sources */}
      {!isUser && !loading && passages?.length ? (
        <div className="mt-2 text-xs text-gray-500">
          <div className="font-medium mb-1">Sources</div>
          <ul className="list-disc ml-5 space-y-1">
            {passages.map((p, idx) => (
              <li key={`${p.id ?? idx}-${idx}`}>
                <span className="font-mono">Source {idx + 1}</span>: {p.meta?.source ?? "unknown"}
                {typeof p.score === "number" && <> (score {p.score.toFixed(3)})</>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Tool call */}
      {!isUser && !loading && tool ? (
        <div className="mt-2 text-xs text-gray-500">
          <div className="font-medium">Tool called: {tool.name}</div>
          {tool.args ? (
            <pre className="bg-gray-50 p-2 rounded overflow-auto max-h-40">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
