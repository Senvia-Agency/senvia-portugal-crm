import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface InterfaceState {
  readonly legacy: boolean;
  readonly setLegacy: (legacy: boolean) => void;
}

export const useInterfaceStore = create<InterfaceState>()(persist(
  set => ({ legacy: false, setLegacy: legacy => set({ legacy }) }),
  {
    name: 'senvia-interface-v1', storage: createJSONStorage(() => localStorage),
    // v1: the "Versão antiga" switch was hidden (Thiago, 20/11/2026). Whoever was still on the old
    // interface moves to the new one once, since there is no longer a button to come back.
    version: 1, migrate: () => ({ legacy: false }),
  },
));
