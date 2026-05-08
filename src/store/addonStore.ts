import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getScopedStorageKey } from "../utils/localProfiles";

export interface InstalledAddon {
  id: string; name: string; description?: string; logo?: string;
  url: string; manifest: any; enabled: boolean;
  installedAt: number; version: string;
}
interface AddonStore {
  addons: InstalledAddon[];
  isInstalling: boolean;
  installError: string | null;
  addAddon: (a: InstalledAddon) => void;
  removeAddon: (id: string) => void;
  enableAddon: (id: string) => void;
  disableAddon: (id: string) => void;
  setInstalling: (v: boolean) => void;
  setInstallError: (e: string | null) => void;
  getEnabledAddons: () => InstalledAddon[];
}
export const useAddonStore = create<AddonStore>()(
  persist(
    (set, get) => ({
      addons: [], isInstalling: false, installError: null,
      addAddon: (a) => set(s => ({ addons: [...s.addons.filter(x => x.id !== a.id), a] })),
      removeAddon: (id) => set(s => ({ addons: s.addons.filter(a => a.id !== id) })),
      enableAddon: (id) => set(s => ({ addons: s.addons.map(a => a.id === id ? { ...a, enabled: true } : a) })),
      disableAddon: (id) => set(s => ({ addons: s.addons.map(a => a.id === id ? { ...a, enabled: false } : a) })),
      setInstalling: (v) => set({ isInstalling: v }),
      setInstallError: (e) => set({ installError: e }),
      getEnabledAddons: () => get().addons.filter(a => a.enabled),
    }),
    { name: getScopedStorageKey("aetherio-addons") }
  )
);
