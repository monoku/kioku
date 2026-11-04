/**
 * The steps of a verb that waits on something outside the tool (§6.1): git reaching another machine, a git host, a
 * download, the host's own commands. The core names each step and says which way it goes; how a step is shown, a line
 * that moves, a plain line or nothing, is the command line's to decide.
 */

/** `down` brings something to this machine; `up` sends something away. The footer's drop goes the same ways (§1.2). */
export type Direction = "down" | "up";

export interface StepWords<T> {
  /** What the step does, in the present: `Pushing sam/brain`. */
  doing: string;
  /** What it did, in the past, from what it answered: `Pushed sam/brain`. */
  done: string | ((result: T) => string);
  direction: Direction;
  /** The step ended without doing its work, from what it answered rather than by throwing: it is shown as failed. */
  failed?: (result: T) => boolean;
}

export interface Steps {
  /** Runs `work` as one step; what it returns or throws is the step's own. */
  run<T>(words: StepWords<T>, work: () => T): T;
  /** The same, for work that answers later. */
  runAsync<T>(words: StepWords<T>, work: () => Promise<T>): Promise<T>;
}

/** Steps nobody sees: what a test, a hook or an agent gets. */
export const NO_STEPS: Steps = {
  run: (_words, work) => work(),
  runAsync: (_words, work) => work(),
};

let active: Steps = NO_STEPS;

/**
 * The steps of the verb running now: what the command line set for a person watching, else steps nobody sees. Each
 * place that waits (a clone, a fetch, a push, a download, embedding) asks for them here, so the verbs above it
 * need not carry them.
 */
export function currentSteps(): Steps {
  return active;
}

/** Make `steps` the current ones until the returned function puts the ones before back. */
export function useSteps(steps: Steps): () => void {
  const before = active;
  active = steps;
  return () => {
    active = before;
  };
}
