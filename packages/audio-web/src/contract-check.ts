/**
 * Compile-time guard: engine-core's `AudioGraphChange` mirror must stay mutually
 * assignable with the frozen contract type (engine-core cannot import
 * @studio/audio-contracts until its manifest lists it). Any drift fails `typecheck`.
 */
import type { AudioGraphChange as ContractChange } from '@studio/audio-contracts';
import type { AudioGraphChange as CoreChange } from '@studio/engine-core';

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type ChangeTypesAgree = Assert<MutuallyAssignable<ContractChange, CoreChange>>;
