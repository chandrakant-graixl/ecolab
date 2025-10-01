export type ToolInfo = { name: string; args?: Record<string, any> | null } | null;
export type Passage = { id?: string; text: string; score?: number; meta?: any };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  tool?: ToolInfo;
  passages?: Passage[];
};
