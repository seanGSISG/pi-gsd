/**
 * Wave scheduler. Given a set of PlanFrontmatter-like records (plan id,
 * dependencies, files modified), computes:
 *
 *   1. Topological order — fails on cycles with a clear message.
 *   2. Waves — maximal sets of plans whose dependencies are all satisfied
 *      by prior waves. A plan's wave number is 1 + max(dep wave).
 *   3. File-overlap conflicts within a wave — two plans in the same wave
 *      that modify the same file are a planning defect; we expose them so
 *      the executor can force them sequential (or reject and ask the
 *      planner to re-split).
 *
 * Pure function, no IO, fully unit-testable.
 */

export interface PlanRef {
	plan: string;
	depends_on?: string[];
	files_modified?: string[];
}

export interface Wave {
	index: number; // 1-based
	plans: string[]; // plan ids in deterministic order
	conflicts: Array<{ a: string; b: string; files: string[] }>;
}

export interface ScheduleResult {
	waves: Wave[];
	order: string[]; // full topological order, for sequential fallback
}

export class ScheduleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ScheduleError";
	}
}

export function schedulePlans(plans: PlanRef[]): ScheduleResult {
	const byId = new Map<string, PlanRef>();
	for (const p of plans) {
		if (byId.has(p.plan)) {
			throw new ScheduleError(`duplicate plan id: ${p.plan}`);
		}
		byId.set(p.plan, p);
	}

	// Validate dependency references before running any algorithm.
	for (const p of plans) {
		for (const dep of p.depends_on ?? []) {
			if (!byId.has(dep)) {
				throw new ScheduleError(
					`plan ${p.plan} depends on unknown plan: ${dep}`,
				);
			}
		}
	}

	// Kahn's algorithm — topological sort. Detects cycles.
	const inDegree = new Map<string, number>();
	const forward = new Map<string, string[]>();
	for (const p of plans) {
		inDegree.set(p.plan, (p.depends_on ?? []).length);
		forward.set(p.plan, []);
	}
	for (const p of plans) {
		for (const dep of p.depends_on ?? []) {
			forward.get(dep)!.push(p.plan);
		}
	}

	const ready: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) ready.push(id);
	}
	ready.sort();

	const order: string[] = [];
	while (ready.length > 0) {
		const id = ready.shift()!;
		order.push(id);
		for (const next of forward.get(id) ?? []) {
			inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
			if (inDegree.get(next) === 0) {
				// Keep ready-queue sorted for deterministic output.
				const pos = ready.findIndex((x) => x > next);
				if (pos < 0) ready.push(next);
				else ready.splice(pos, 0, next);
			}
		}
	}

	if (order.length !== plans.length) {
		const remaining = plans
			.map((p) => p.plan)
			.filter((id) => !order.includes(id));
		throw new ScheduleError(
			`dependency cycle detected among plans: ${remaining.join(", ")}`,
		);
	}

	// Assign wave numbers: wave(p) = 1 + max(wave(dep)).
	const waveOf = new Map<string, number>();
	for (const id of order) {
		const p = byId.get(id)!;
		const deps = p.depends_on ?? [];
		const w =
			deps.length === 0
				? 1
				: 1 + Math.max(...deps.map((d) => waveOf.get(d) ?? 0));
		waveOf.set(id, w);
	}

	const waveMap = new Map<number, string[]>();
	for (const id of order) {
		const w = waveOf.get(id)!;
		const list = waveMap.get(w) ?? [];
		list.push(id);
		waveMap.set(w, list);
	}

	const waves: Wave[] = [...waveMap.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([index, planIds]) => {
			const conflicts: Wave["conflicts"] = [];
			const sorted = planIds.slice().sort();
			for (let i = 0; i < sorted.length; i++) {
				for (let j = i + 1; j < sorted.length; j++) {
					const a = byId.get(sorted[i]!)!;
					const b = byId.get(sorted[j]!)!;
					const overlap = intersect(
						a.files_modified ?? [],
						b.files_modified ?? [],
					);
					if (overlap.length > 0) {
						conflicts.push({ a: a.plan, b: b.plan, files: overlap });
					}
				}
			}
			return { index, plans: sorted, conflicts };
		});

	return { waves, order };
}

function intersect<T>(a: T[], b: T[]): T[] {
	const set = new Set(a);
	return b.filter((x) => set.has(x));
}
