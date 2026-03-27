import type { TaskResolvedRunner, TaskRunnerPreference } from "./tasks";

interface ResolveTaskRunnerInput {
  prompt: string;
  runnerPreference: TaskRunnerPreference;
}

const claudeKeywords = ["explain", "compare", "inspect", "small", "typo"];
const openClawKeywords = [
  "implement",
  "end-to-end",
  "review pr",
  "fix",
  "refactor",
  "until tests pass",
];

export function resolveTaskRunner({
  prompt,
  runnerPreference,
}: ResolveTaskRunnerInput): TaskResolvedRunner {
  if (runnerPreference === "claude" || runnerPreference === "openclaw") {
    return runnerPreference;
  }

  const normalizedPrompt = prompt.toLowerCase();

  if (openClawKeywords.some((keyword) => normalizedPrompt.includes(keyword))) {
    return "openclaw";
  }

  if (claudeKeywords.some((keyword) => normalizedPrompt.includes(keyword))) {
    return "claude";
  }

  return "claude";
}
