import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface InterfaceState {
  readonly legacy: boolean;
  readonly setLegacy: (legacy: boolean) => void;
}

export const useInterfaceStore = create<InterfaceState>()(persist(
  set => ({ legacy: false, setLegacy: legacy => set({ legacy }) }),
  { name: 'senvia-interface-v1', storage: createJSONStorage(() => localStorage) },
));
