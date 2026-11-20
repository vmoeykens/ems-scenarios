// AEMT-scoped OpenEvidence prompt. Same template as learn_prompt() in tools/ems_scenario.py - keep identical.
import type { Scenario } from "./types.ts";

export const LEARN_PROMPT_MAX = 480;

export function learnPrompt(sc: Scenario): string {
  const lm = (sc.learn_more ?? {}) as { topic?: string; focus?: string; prompt?: string };
  if (lm.prompt) return lm.prompt;
  const topic = lm.topic || sc.title || "";
  const focus = lm.focus ? ` Focus: ${lm.focus}.` : "";
  return (
    `Vermont AEMT, post-training review: ${topic}. For an AEMT audience: pathophysiology, key field assessment and pitfalls, ` +
    `evidence-based prehospital care within AEMT scope, and EMS research from the last 5 years.${focus} Cite sources; under 400 words.`
  );
}

/** Length in Unicode code points (Python len()). */
export function pyLen(s: string): number {
  return [...s].length;
}
