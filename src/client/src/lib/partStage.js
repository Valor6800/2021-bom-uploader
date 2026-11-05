/**
 * Where a Part is in manufacturing, from its tracker status, in words an
 * assembly mentor can act on. Pure.
 *
 * The Part workflow, on the Parts board:
 *   Backlog → Ready to Fabricate → Manufacturing → Post Processing → Needs Mentor Approval
 *   → Mentor Approved → Powder Coat → Assembly → Assembled
 */

export const Stage = Object.freeze({
  NOT_STARTED: 'not-started',
  MAKING: 'making',
  FINISHING: 'finishing',
  READY: 'ready',
  ASSEMBLED: 'assembled',
  UNKNOWN: 'unknown',
});

/** Stages in workflow order, with their words. `blocking`: assembly has to wait for it. */
export const STAGES = Object.freeze([
  { id: Stage.NOT_STARTED, label: 'Not started', blocking: true },
  { id: Stage.MAKING, label: 'Being made', blocking: true },
  { id: Stage.FINISHING, label: 'Finishing', blocking: true },
  { id: Stage.READY, label: 'Ready to assemble', blocking: false },
  { id: Stage.ASSEMBLED, label: 'Assembled', blocking: false },
  { id: Stage.UNKNOWN, label: 'Status unknown', blocking: false },
]);

/** Tracker status name -> stage, and its order within the whole workflow. */
const STATUS = Object.freeze({
  Backlog: [Stage.NOT_STARTED, 1],
  'Ready to Fabricate': [Stage.MAKING, 2],
  Manufacturing: [Stage.MAKING, 3],
  'Post Processing': [Stage.FINISHING, 4],
  'Needs Mentor Approval': [Stage.FINISHING, 5],
  'Mentor Approved': [Stage.READY, 6],
  'Powder Coat': [Stage.FINISHING, 7],
  Assembly: [Stage.READY, 8],
  Assembled: [Stage.ASSEMBLED, 9],
});

/**
 * @param {string|null|undefined} status  The tracker status name
 * @returns {{ id: string, label: string, blocking: boolean, order: number, status: string|null }}
 */
export function stageOf(status) {
  const [id, order] = STATUS[status] ?? [Stage.UNKNOWN, 99];
  const stage = STAGES.find((s) => s.id === id);
  return { ...stage, order, status: status ?? null };
}

/**
 * How ready a Build is to put together.
 *
 * @param {{ status: string|null, quantity?: number }[]} parts  The Build's Parts
 * @returns {{ total: number, ready: number, counts: Record<string, number>, blockers: object[] }}
 *   `ready` counts Parts ready or already assembled; `blockers` are the rest that block, furthest behind first.
 */
export function readinessOf(parts) {
  const counts = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
  const blockers = [];
  let ready = 0;
  for (const part of parts) {
    const stage = stageOf(part.status);
    counts[stage.id] += 1;
    if (stage.id === Stage.READY || stage.id === Stage.ASSEMBLED) ready += 1;
    else if (stage.blocking) blockers.push({ part, stage });
  }
  blockers.sort((a, b) => a.stage.order - b.stage.order);
  return { total: parts.length, ready, counts, blockers };
}
