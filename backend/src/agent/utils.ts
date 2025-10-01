import { Passage } from "../types";

export const buildContext = (passages: Passage[]) => {
  return passages
    .map((p, i) => `# Source ${i + 1}\n${p.text}`)
    .join("\n\n");
}
