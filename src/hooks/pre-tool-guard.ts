/**
 * Deterministic pre-tool guard. Blocks destructive bash patterns and writes
 * to protected paths before they reach the model's tool-execution pipeline.
 *
 * All logic is pure and unit-testable. Registration into pi's event system
 * lives in hooks/index.ts.
 */

import { resolve, normalize } from "node:path";

export interface GuardResult {
	blocked: boolean;
	reason?: string;
}

const DESTRUCTIVE_BASH = [
	/\brm\s+-[a-z]*(rf|fr|Rf|fR|RF|rF)\b/i, // rm -rf / -fr (any case, any adjacent flags)
	/\bmkfs\./i,
	/:\(\)\s*\{\s*:\|:&\s*\};\s*:/, // classic fork bomb
	/\b(shutdown|reboot|halt|poweroff)\b/i,
	/>\s*\/dev\/sd[a-z]/i,
	/\bdd\s+.*\s+of=\/dev\//i,
];

const PROTECTED_PATH_PATTERNS = [
	/(^|\/)\.env(\.|$)/,
	/(^|\/)\.ssh\//,
	/(^|\/)\.aws\//,
	/(^|\/)id_rsa$/,
	/(^|\/)id_ed25519$/,
];

export function inspectBashCommand(command: string): GuardResult {
	for (const re of DESTRUCTIVE_BASH) {
		if (re.test(command)) {
			return {
				blocked: true,
				reason: `destructive bash pattern: ${re.source}`,
			};
		}
	}
	return { blocked: false };
}

/**
 * Check whether a write target is inside the project root and not in a
 * protected path. Paths outside projectRoot are blocked (no editing the
 * user's homedir by accident). Absolute .env files, .ssh, .aws, and SSH
 * keys are always blocked.
 */
export function inspectWritePath(
	targetPath: string,
	projectRoot: string,
): GuardResult {
	const absolute = resolve(projectRoot, targetPath);
	const normRoot = normalize(projectRoot) + "/";
	if (!(absolute + "/").startsWith(normRoot)) {
		return {
			blocked: true,
			reason: `write outside project root: ${absolute}`,
		};
	}
	for (const re of PROTECTED_PATH_PATTERNS) {
		if (re.test(absolute)) {
			return {
				blocked: true,
				reason: `write to protected path: ${absolute}`,
			};
		}
	}
	return { blocked: false };
}
