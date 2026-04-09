/**
 * Thin wrappers over `git worktree` for wave-parallel execution. Each plan
 * in a wave runs in its own isolated worktree so concurrent Edit/Write
 * operations never collide. Worktrees merge sequentially after the wave
 * completes; any conflict is a planning defect (pre-flight check in the
 * wave scheduler should prevent it).
 *
 * We shell out via execFile rather than a git library to stay dependency-
 * light and match pi's bash-heavy philosophy.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface WorktreeHandle {
	path: string;
	branch: string;
	baseRef: string;
}

async function git(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return pExecFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Create a worktree at `worktreePath` on a new branch derived from `baseRef`.
 * Safe to call with a path that doesn't yet exist — parent directory is
 * created as needed. Branch name is passed through as-is; caller owns
 * namespacing (e.g. `pi-gsd/wave-1-plan-01-01`).
 */
export async function createWorktree(
	projectRoot: string,
	worktreePath: string,
	branch: string,
	baseRef = "HEAD",
): Promise<WorktreeHandle> {
	const absPath = resolve(projectRoot, worktreePath);
	await mkdir(dirname(absPath), { recursive: true });
	await git(projectRoot, ["worktree", "add", "-b", branch, absPath, baseRef]);
	return { path: absPath, branch, baseRef };
}

/**
 * Remove a worktree and delete its branch. --force because the branch may
 * have new commits we're discarding on purpose (e.g. failed execution).
 */
export async function removeWorktree(
	projectRoot: string,
	handle: WorktreeHandle,
): Promise<void> {
	if (existsSync(handle.path)) {
		await git(projectRoot, ["worktree", "remove", "--force", handle.path]);
	}
	try {
		await git(projectRoot, ["branch", "-D", handle.branch]);
	} catch {
		// branch already gone — ignore
	}
}

/**
 * Fast-forward merge a worktree's branch back into the current branch on
 * the main working tree. Returns true on clean merge, false if ff is not
 * possible (caller should surface the conflict to the user).
 */
export async function mergeWorktree(
	projectRoot: string,
	handle: WorktreeHandle,
): Promise<boolean> {
	try {
		await git(projectRoot, ["merge", "--ff-only", handle.branch]);
		return true;
	} catch {
		return false;
	}
}

/**
 * List worktrees currently attached to the repo. Useful for /resume and
 * /status to detect leaked worktrees from a crashed execution.
 */
export async function listWorktrees(
	projectRoot: string,
): Promise<Array<{ path: string; branch: string }>> {
	const { stdout } = await git(projectRoot, [
		"worktree",
		"list",
		"--porcelain",
	]);
	const out: Array<{ path: string; branch: string }> = [];
	let cur: Partial<{ path: string; branch: string }> = {};
	for (const line of stdout.split(/\r?\n/)) {
		if (line.startsWith("worktree ")) {
			if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? "" });
			cur = { path: line.slice("worktree ".length).trim() };
		} else if (line.startsWith("branch ")) {
			cur.branch = line.slice("branch ".length).trim().replace("refs/heads/", "");
		}
	}
	if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? "" });
	return out;
}

/**
 * Nuke a worktree directory on disk even if git doesn't know about it.
 * Used in test cleanup and /resume's leaked-worktree recovery path.
 */
export async function forceRemoveDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}
