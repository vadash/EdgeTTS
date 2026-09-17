// Gates
// Promise-completion isolated behind a per-instance signal, replacing the
// promise-over-module-global review/resume protocols in LLMStore/ConversionStore.

import { signal, type Signal } from '@preact/signals';
import { CancellationError } from '@/errors';
import type { LLMCharacter, SpeakerAssignment, VoiceProfileFile } from '@/state/types';
import type { ResumeInfo } from './ConversionStore';
import { setCharacters, setLoadedProfile, setSpeakerAssignments, setVoiceMap } from './LLMStore';

// ============================================================================
// Gate Factory
// ============================================================================

/** Side effects deciding what open() settles with. */
export interface GateIo<P, T> {
  /** Called with the (possibly patched) draft when the user confirms. */
  settle: (draft: P) => T;
  /** Called when the user declines; may throw to reject open() instead. */
  decline: () => T;
}

export interface GateState<P> {
  open: boolean;
  draft: P | null;
}

export interface Gate<P, T> {
  /** Opens the gate with a draft payload. Rejects if already open. */
  open(payload: P): Promise<T>;
  /** Settles open() with io.settle(draft). */
  confirm(): void;
  /** Settles open() with io.decline(); a throw rejects open(), never escapes decline(). */
  decline(): void;
  /** Merges a partial into the open draft. */
  patch(partial: Partial<P>): void;
  state: Signal<GateState<P>>;
}

export function createGate<P, T>(io: GateIo<P, T>): Gate<P, T> {
  const state = signal<GateState<P>>({ open: false, draft: null });
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason: unknown) => void) | null = null;

  function open(payload: P): Promise<T> {
    if (state.value.open) {
      return Promise.reject(new Error('Gate is already open'));
    }
    state.value = { open: true, draft: payload };
    // Promise.withResolvers() needs a lib above the project's ES2021 target.
    return new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  }

  // Closes the gate first, then settles: a throwing settler still rejects
  // open() instead of escaping the confirm()/decline() call frame.
  function settle(settler: (draft: P) => T): void {
    const draft = state.value.draft;
    if (!state.value.open || draft === null) return;
    const res = resolve;
    const rej = reject;
    resolve = null;
    reject = null;
    state.value = { open: false, draft: null };
    if (!res || !rej) return;
    let value: T;
    try {
      value = settler(draft);
    } catch (err) {
      rej(err);
      return;
    }
    res(value);
  }

  return {
    open,
    confirm() {
      settle(io.settle);
    },
    decline() {
      settle(io.decline);
    },
    patch(partial) {
      const draft = state.value.draft;
      if (!state.value.open || draft === null) return;
      state.value = { open: true, draft: { ...draft, ...partial } };
    },
    state,
  };
}

// ============================================================================
// Review Gate
// ============================================================================

export interface ReviewDraft {
  characters: LLMCharacter[];
  voiceMap: Map<string, string>;
  assignments: SpeakerAssignment[];
  profile: VoiceProfileFile | null;
  lineCounts: Map<string, number>;
}

export interface ReviewOutcome {
  voiceMap: Map<string, string>;
  profile: VoiceProfileFile | null;
}

export const reviewGate = createGate<ReviewDraft, ReviewOutcome>({
  settle: (draft) => {
    setCharacters(draft.characters);
    setVoiceMap(draft.voiceMap);
    setSpeakerAssignments(draft.assignments);
    setLoadedProfile(draft.profile);
    return { voiceMap: draft.voiceMap, profile: draft.profile };
  },
  decline: () => {
    throw new CancellationError();
  },
});

// ============================================================================
// Resume Gate
// ============================================================================

export const resumeGate = createGate<ResumeInfo, boolean>({
  settle: () => true,
  decline: () => false,
});
