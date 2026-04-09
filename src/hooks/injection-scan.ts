/**
 * Prompt-injection scanner for writes that target .pi-gsd/.
 *
 * Fires on `tool_execution_start` for Write/Edit-family tools. Pattern set
 * is intentionally conservative: obvious jailbreak phrases, hidden system
 * tags, and zero-width / bidi-override characters. Runs only on the subset
 * of content being written into the workflow state directory, so legitimate
 * prose that *describes* prompt injection (this file, for example!) is not
 * flagged unless it's being written into a PLAN.md or CONTEXT.md.
 */

export interface InjectionScanResult {
	blocked: boolean;
	reason?: string;
	matchedPattern?: string;
}

const PATTERNS: Array<{ re: RegExp; label: string }> = [
	{ re: /\bignore (all )?previous instructions\b/i, label: "jailbreak-phrase" },
	{ re: /\bdisregard (the )?(above|previous)\b/i, label: "jailbreak-phrase" },
	{ re: /\bforget (your|all previous) instructions\b/i, label: "jailbreak-phrase" },
	{ re: /\bfrom now on you (are|will)\b/i, label: "jailbreak-phrase" },
	{ re: /\byou are now (a|an) [a-z]+\b/i, label: "role-hijack" },
	{ re: /<\s*system\s*>/i, label: "hidden-system-tag" },
	{ re: /<\s*assistant\s*>/i, label: "hidden-assistant-tag" },
	{ re: /\[INST\]/, label: "instruction-tag" },
	{ re: /[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/, label: "invisible-unicode" },
];

/**
 * Pure scan — no IO. Returns whether the content should be blocked and why.
 * The hook registration layer decides how to surface the block to the user.
 */
export function scanForInjection(
	content: string,
	targetPath: string,
): InjectionScanResult {
	if (!targetPath.includes(".pi-gsd/")) {
		return { blocked: false };
	}
	for (const { re, label } of PATTERNS) {
		if (re.test(content)) {
			return {
				blocked: true,
				reason: `possible prompt injection in write to ${targetPath}`,
				matchedPattern: label,
			};
		}
	}
	return { blocked: false };
}
