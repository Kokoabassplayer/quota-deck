import { createInterface } from "node:readline/promises";

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const terminal = createInterface({ input, output });
  return {
    async confirm(question, defaultValue = true) {
      const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
      const answer = (await terminal.question(`${question}${suffix}`)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return answer === "y" || answer === "yes" || answer === "ใช่";
    },
    async pause(message) {
      await terminal.question(`${message}\nPress Enter to continue… `);
    },
    close() { terminal.close(); },
  };
}
