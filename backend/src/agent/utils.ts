import { Passage } from "../types";

/**
 * Function to build a context string out of passages. All it does is joins the passages into a string with reference to the source.
 * @param passages 
 * @returns string message which could be added to the chat context
 */
export const buildContext = (passages: Passage[]) => {
  return passages
    .map((p, i) => `# Source ${i + 1}\n${p.text}`)
    .join("\n\n");
}
