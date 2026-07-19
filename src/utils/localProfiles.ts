export const LOCAL_PROFILES_CHANGED_EVENT = "aetherio-local-profiles-changed";

const PROFILES_STORAGE_KEY = "aetherio-local-profiles-v1";
const ACTIVE_PROFILE_ID_KEY = "aetherio-active-profile-id";

const SCOPED_STORAGE_KEYS = [
  "aetherio-api-keys",
  "aetherio-mdblist-settings-v1",
  "aetherio-playback-preferences",
  "aetherio-last-links",
  "aetherio-continue-watching-v1",
  "aetherio-continue-watching-audio-selection-v1",
  "aetherio-trakt-auth-v1",
  "aetherio-trakt-queue-v1",
  "aetherio-trakt-sync-v1",
];

export interface LocalProfile {
  id: string;
  name: string;
  pin?: string;
  avatarDataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalProfileInput {
  name: string;
  pin?: string;
  avatarDataUrl?: string;
}

export function getLocalProfiles(): LocalProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalProfile).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
}

export function getActiveProfile() {
  const activeId = getActiveProfileId();
  if (!activeId) return null;
  return getLocalProfiles().find(profile => profile.id === activeId) ?? null;
}

export function hasActiveLocalProfile() {
  return getActiveProfile() !== null;
}

export function getScopedStorageKey(baseKey: string) {
  const activeId = getActiveProfileId();
  return activeId ? `aetherio-profile:${activeId}:${baseKey}` : baseKey;
}

export async function createLocalProfile(input: LocalProfileInput, options?: { makeActive?: boolean; adoptCurrentData?: boolean }) {
  const profiles = getLocalProfiles();
  const now = Date.now();
  const profile: LocalProfile = {
    id: createProfileId(),
    name: normalizeName(input.name),
    pin: input.pin ? await hashPin(input.pin) : undefined,
    avatarDataUrl: normalizeAvatar(input.avatarDataUrl),
    createdAt: now,
    updatedAt: now,
  };

  if (options?.adoptCurrentData) {
    copyCurrentLocalDataToProfile(profile.id);
  }

  writeProfiles([...profiles, profile]);
  if (options?.makeActive) setActiveProfile(profile.id);
  return profile;
}

export async function updateLocalProfile(id: string, input: LocalProfileInput) {
  const profiles = getLocalProfiles();
  const updated = [];
  for (const profile of profiles) {
    if (profile.id !== id) {
      updated.push(profile);
      continue;
    }
    updated.push({
      ...profile,
      name: normalizeName(input.name),
      pin: input.pin ? await hashPin(input.pin) : profile.pin,
      avatarDataUrl: normalizeAvatar(input.avatarDataUrl),
      updatedAt: Date.now(),
    });
  }
  writeProfiles(updated);
  return updated.find(profile => profile.id === id) ?? null;
}

export function setActiveProfile(id: string) {
  const profile = getLocalProfiles().find(item => item.id === id);
  if (!profile) return false;
  localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
  dispatchProfilesChanged();
  return true;
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("No se pudo leer la imagen."));
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

export function getProfileInitial(profile: Pick<LocalProfile, "name"> | null | undefined) {
  return (profile?.name.trim().charAt(0) || "A").toUpperCase();
}

function writeProfiles(profiles: LocalProfile[]) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  dispatchProfilesChanged();
}

function dispatchProfilesChanged() {
  window.dispatchEvent(new CustomEvent(LOCAL_PROFILES_CHANGED_EVENT));
}

function copyCurrentLocalDataToProfile(profileId: string) {
  for (const key of SCOPED_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      localStorage.setItem(`aetherio-profile:${profileId}:${key}`, value);
    }
  }
}

function normalizeName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized || "Usuario";
}

const PIN_SALT = "aetherio-profile-v1";

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${PIN_SALT}:${pin}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const pinHash = await hashPin(pin);
  return pinHash === hash;
}

function normalizeAvatar(avatarDataUrl: string | undefined) {
  return avatarDataUrl && avatarDataUrl.startsWith("data:image/") ? avatarDataUrl : undefined;
}

function createProfileId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLocalProfile(value: unknown): value is LocalProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as LocalProfile;
  return (
    typeof profile.id === "string" &&
    typeof profile.name === "string" &&
    typeof profile.createdAt === "number" &&
    typeof profile.updatedAt === "number"
  );
}
