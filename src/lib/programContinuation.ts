import { Program } from '../types';

export interface CreateProgramContinuationParams {
  sourceProgram: Program;
  newProgramId?: string;
  createdAt?: string;
}

/**
 * Pure helper to format a program continuation name without nesting cycle suffixes.
 * Removes any terminal ` — Cycle N` from the source name and appends the new cycle suffix.
 */
export function formatContinuationCycleName(sourceName: string, nextCycleIndex: number): string {
  if (!sourceName) return `Program — Cycle ${nextCycleIndex}`;
  const baseName = sourceName.replace(/\s*(?:—|-|–)\s*Cycle\s+\d+\s*$/i, '').trim();
  return `${baseName || 'Program'} — Cycle ${nextCycleIndex}`;
}

/**
 * Pure helper to calculate the algorithmPhaseOffset for the next cycle of a program.
 * For step loading ('hypertrophy_step'), the offset advances by the program duration (modulo 12).
 * For infinite duration ('∞') or other algorithms, the offset is 0.
 */
export function calculateNextAlgorithmPhaseOffset(
  algorithmId: Program['algorithmId'],
  currentOffset: number | undefined,
  duration: number | '∞'
): number {
  if (duration === '∞') {
    return 0;
  }
  if (algorithmId === 'hypertrophy_step') {
    const parsedDuration = typeof duration === 'number' && duration > 0 ? duration : 8;
    const baseOffset = (typeof currentOffset === 'number' && Number.isFinite(currentOffset)) ? currentOffset : 0;
    return (baseOffset + parsedDuration) % 12;
  }
  return 0;
}

/**
 * Pure helper to verify if a program is a linked continuation of another program.
 */
export function isProgramContinuation(program: Program | null | undefined): boolean {
  return Boolean(program?.parentProgramId);
}

/**
 * Pure helper to check if a program is a continuation cycle (by parentProgramId, cycleIndex > 1, or name suffix).
 */
export function isContinuationCycle(program: Program | null | undefined): boolean {
  if (!program) return false;
  return Boolean(
    program.parentProgramId ||
    (typeof program.cycleIndex === 'number' && program.cycleIndex > 1) ||
    /\s*(?:—|-|–)\s*Cycle\s+\d+\s*$/i.test(program.name || '')
  );
}

/**
 * Pure constructor to create a new linked continuation cycle from a source program.
 * Performs deep cloning, increments cycleIndex, links parentProgramId,
 * advances algorithmPhaseOffset if applicable, and preserves all exercise templates and configurations.
 * Does not perform any database or storage side effects.
 */
export function createProgramContinuation(
  sourceProgramOrParams: Program | CreateProgramContinuationParams
): Program {
  const params: CreateProgramContinuationParams =
    sourceProgramOrParams && 'id' in sourceProgramOrParams && !('sourceProgram' in sourceProgramOrParams)
      ? { sourceProgram: sourceProgramOrParams as Program }
      : (sourceProgramOrParams as CreateProgramContinuationParams);

  const { sourceProgram, newProgramId, createdAt } = params || {};

  if (!sourceProgram || !sourceProgram.id) {
    throw new Error('Valid source program with an id is required to create a continuation.');
  }

  const clonedExercisesByDay = JSON.parse(JSON.stringify(sourceProgram.exercisesByDay || {}));
  const clonedAssignedWeekdays = sourceProgram.assignedWeekdays
    ? JSON.parse(JSON.stringify(sourceProgram.assignedWeekdays))
    : undefined;

  const currentCycleIndex =
    Number.isInteger(sourceProgram.cycleIndex) &&
    Number(sourceProgram.cycleIndex) >= 1
      ? Number(sourceProgram.cycleIndex)
      : 1;

  const nextCycleIndex = currentCycleIndex + 1;

  const nextPhaseOffset = calculateNextAlgorithmPhaseOffset(
    sourceProgram.algorithmId,
    sourceProgram.algorithmPhaseOffset,
    sourceProgram.programDuration
  );

  const targetId = newProgramId || `prog-${Date.now()}`;
  const targetCreatedAt = createdAt || new Date().toISOString();
  const nextName = formatContinuationCycleName(sourceProgram.name, nextCycleIndex);

  const continuation: Program = {
    id: targetId,
    name: nextName,
    daysPerWeek: sourceProgram.daysPerWeek,
    programDuration: sourceProgram.programDuration,
    createdAt: targetCreatedAt,
    exercisesByDay: clonedExercisesByDay,
    assignedWeekdays: clonedAssignedWeekdays,
    objective: sourceProgram.objective,
    algorithmId: sourceProgram.algorithmId,
    parentProgramId: sourceProgram.id,
    cycleIndex: nextCycleIndex,
    algorithmPhaseOffset: nextPhaseOffset,
  };

  return continuation;
}

