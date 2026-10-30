import { useStore } from 'zustand';
import { useSession } from '../../session/context';
import { TutorialController, type TutorialState } from './controller';

/** The session's tutorial controller (shared with the tutorial tools). */
export function useTutorialController(): TutorialController {
  return TutorialController.forSession(useSession());
}

export function useTutorialState<T>(selector: (state: TutorialState) => T): T {
  return useStore(useTutorialController().store, selector);
}
