import {
  getExperienceStorageKeys,
  writeExperienceBatchToProfile,
} from "../domain/experienceStorage";

export const LOCAL_PROFILES_CHANGED_EVENT = "aetherio-local-profiles-changed";
export const EXPERIENCE_SCOPE_CHANGED_EVENT = "aetherio-experience-scope-changed";

const PROFILES_STORAGE_KEY = "aetherio-local-profiles-v1";
const ACTIVE_PROFILE_ID_KEY = "aetherio-active-profile-id";
const PROFILE_SPACE_PREFIX = "aetherio-profile-space-v2";
const PROFILE_SPACE_MIGRATION_KEY = `${PROFILE_SPACE_PREFIX}:legacy-owner`;
const ACCOUNT_USER_KEY = "aetherio-account-user-v1";
const LOCAL_MODE_KEY = "aetherio-local-mode-v1";
const ACCOUNT_CONTEXT_CHANGED_EVENT = "aetherio-auth-changed";

const SCOPED_STORAGE_KEYS = [
  "aetherio-api-keys",
  "aetherio-mdblist-settings-v1",
  "aetherio-playback-preferences",
  "aetherio-last-links",
  "aetherio-continue-watching-v1",
  "aetherio-continue-watching-audio-selection-v1",
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

export interface ExperienceStorageScope {
  /** Stable account namespace or "local"; never contains an auth token. */
  accountScope: string;
  profileId: string | null;
  generation: number;
}

type ExperienceScopeListener = (scope: ExperienceStorageScope) => void;
let experienceScopeGeneration = 0;
let experienceScopeSignature: string | null = null;
let scopeListenerWindow: Window | null = null;
const experienceScopeListeners = new Set<ExperienceScopeListener>();

export function getLocalProfiles(): LocalProfile[] {
  try {
    const raw = localStorage.getItem(profileStorageKeys().profiles);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalProfile).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function getActiveProfileId() {
  return localStorage.getItem(profileStorageKeys().active);
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
  return getScopedStorageKeyForScope(baseKey, {
    profileId: activeId,
    accountScope: currentProfileScope(),
  });
}

/** Captures the account/profile context for work that may finish asynchronously. */
export function captureExperienceScope(): ExperienceStorageScope {
  ensureExperienceScopeListeners();
  const current = readExperienceScopeIdentity();
  const signature = scopeSignature(current.accountScope, current.profileId);
  if (experienceScopeSignature === null) experienceScopeSignature = signature;
  else if (experienceScopeSignature !== signature) {
    experienceScopeGeneration += 1;
    experienceScopeSignature = signature;
    notifyExperienceScopeListeners(current);
  }
  return { ...current, generation: experienceScopeGeneration };
}

/** Keeps existing profile keys; scopes registered data keys for signed-in accounts with no profile selected. */
export function getScopedStorageKeyForScope(
  baseKey: string,
  scope: Pick<ExperienceStorageScope, "accountScope" | "profileId">,
) {
  if (scope.profileId) return `aetherio-profile:${scope.profileId}:${baseKey}`;
  if (scope.accountScope.startsWith("account:") && getExperienceStorageKeys().includes(baseKey)) {
    return `aetherio-experience:${encodeURIComponent(scope.accountScope)}:${baseKey}`;
  }
  return baseKey;
}

export function isExperienceScopeCurrent(scope: ExperienceStorageScope): boolean {
  const current = captureExperienceScope();
  return current.accountScope === scope.accountScope
    && current.profileId === scope.profileId
    && current.generation === scope.generation;
}

export function subscribeExperienceScope(listener: ExperienceScopeListener): () => void {
  ensureExperienceScopeListeners();
  experienceScopeListeners.add(listener);
  return () => experienceScopeListeners.delete(listener);
}

export async function createLocalProfile(input: LocalProfileInput, options?: { makeActive?: boolean; adoptCurrentData?: boolean }) {
  const profiles = getLocalProfiles();
  const now = Date.now();
  const profile: LocalProfile = {
    id: createProfileId(),
    name: normalizeName(input.name),
    pin: isValidPin(input.pin) ? await hashPin(input.pin) : undefined,
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
      pin: isValidPin(input.pin) ? await hashPin(input.pin) : profile.pin,
      avatarDataUrl: normalizeAvatar(input.avatarDataUrl),
      updatedAt: Date.now(),
    });
  }
  writeProfiles(updated);
  return updated.find(profile => profile.id === id) ?? null;
}

export function removeLocalProfilePin(id: string) {
  const profiles = getLocalProfiles();
  const updated = profiles.map(profile => (
    profile.id === id
      ? { ...profile, pin: undefined, updatedAt: Date.now() }
      : profile
  ));
  if (!updated.some(profile => profile.id === id)) return false;
  writeProfiles(updated);
  return true;
}

export function setActiveProfile(id: string) {
  const profile = getLocalProfiles().find(item => item.id === id);
  if (!profile) return false;
  localStorage.setItem(profileStorageKeys().active, id);
  dispatchProfilesChanged();
  return true;
}

function clearScopedData(profileId: string) {
  for (const key of profileDataKeys()) {
    localStorage.removeItem(`aetherio-profile:${profileId}:${key}`);
  }
}

export function deleteLocalProfile(id: string) {
  const profiles = getLocalProfiles();
  const filtered = profiles.filter(p => p.id !== id);
  if (filtered.length === profiles.length) return false;
  writeProfiles(filtered);
  clearScopedData(id);
  const activeId = getActiveProfileId();
  if (activeId === id) {
    localStorage.removeItem(profileStorageKeys().active);
    dispatchProfilesChanged();
  }
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
  return (profile?.name.trim() || "A")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

function writeProfiles(profiles: LocalProfile[]) {
  localStorage.setItem(profileStorageKeys().profiles, JSON.stringify(profiles));
  dispatchProfilesChanged();
}

/** Solo para tests: siembra la lista de perfiles sin pasar por la UI. */
export function writeLocalProfilesForTest(profiles: LocalProfile[]) {
  writeProfiles(profiles);
}

function profileStorageKeys() {
  const scope = currentProfileScope();
  const profiles = `${PROFILE_SPACE_PREFIX}:${scope}:profiles`;
  const active = `${PROFILE_SPACE_PREFIX}:${scope}:active`;
  const migrated = `${PROFILE_SPACE_PREFIX}:${scope}:migrated`;

  if (localStorage.getItem(migrated) !== "1") {
    let legacyOwner = localStorage.getItem(PROFILE_SPACE_MIGRATION_KEY);
    if (!legacyOwner) {
      legacyOwner = scope;
      localStorage.setItem(PROFILE_SPACE_MIGRATION_KEY, scope);
    }
    if (legacyOwner === scope) {
      const legacyProfiles = localStorage.getItem(PROFILES_STORAGE_KEY);
      const legacyActive = localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
      if (legacyProfiles !== null && localStorage.getItem(profiles) === null) {
        localStorage.setItem(profiles, legacyProfiles);
      }
      if (legacyActive !== null && localStorage.getItem(active) === null) {
        localStorage.setItem(active, legacyActive);
      }
    }
    if (localStorage.getItem(profiles) === null) localStorage.setItem(profiles, "[]");
    localStorage.setItem(migrated, "1");
  }

  return { profiles, active };
}

function currentProfileScope() {
  if (localStorage.getItem(LOCAL_MODE_KEY) === "1") return "local";
  try {
    const raw = localStorage.getItem(ACCOUNT_USER_KEY);
    const user = raw ? JSON.parse(raw) as { id?: unknown } : null;
    if (typeof user?.id === "string" && user.id.trim()) {
      return `account:${encodeURIComponent(user.id.trim())}`;
    }
  } catch {
    // Invalid cached account data falls back to the isolated local profile space.
  }
  return "local";
}

function dispatchProfilesChanged() {
  window.dispatchEvent(new CustomEvent(LOCAL_PROFILES_CHANGED_EVENT));
}

function copyCurrentLocalDataToProfile(profileId: string) {
  const sourceScope = captureExperienceScope();
  const registeredKeys = new Set(getExperienceStorageKeys());
  for (const key of SCOPED_STORAGE_KEYS) {
    if (registeredKeys.has(key)) continue;
    const sourceKey = getScopedStorageKeyForScope(key, { accountScope: sourceScope.accountScope, profileId: null });
    const value = localStorage.getItem(sourceKey);
    if (value !== null) {
      localStorage.setItem(`aetherio-profile:${profileId}:${key}`, value);
    }
  }

  const registeredData = [];
  for (const key of registeredKeys) {
    const sourceKey = getScopedStorageKeyForScope(key, { accountScope: sourceScope.accountScope, profileId: null });
    const value = localStorage.getItem(sourceKey);
    if (value !== null) registeredData.push({ key, value });
  }
  if (registeredData.length) writeExperienceBatchToProfile(sourceScope, profileId, registeredData);
}

function profileDataKeys() {
  return Array.from(new Set([...SCOPED_STORAGE_KEYS, ...getExperienceStorageKeys()]));
}

function readExperienceScopeIdentity(): Omit<ExperienceStorageScope, "generation"> {
  const accountScope = currentProfileScope();
  const profileId = getActiveProfileId()?.trim() || null;
  return { accountScope, profileId };
}

function scopeSignature(accountScope: string, profileId: string | null) {
  return JSON.stringify([accountScope, profileId]);
}

function ensureExperienceScopeListeners() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || scopeListenerWindow === window) return;
  scopeListenerWindow = window;
  window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, handleExperienceScopeChange);
  window.addEventListener(ACCOUNT_CONTEXT_CHANGED_EVENT, handleExperienceScopeChange);
  window.addEventListener("storage", handleExperienceStorageChange);
}

function handleExperienceScopeChange() {
  const current = readExperienceScopeIdentity();
  experienceScopeSignature = scopeSignature(current.accountScope, current.profileId);
  experienceScopeGeneration += 1;
  notifyExperienceScopeListeners(current);
}

function handleExperienceStorageChange(event: Event) {
  const key = (event as StorageEvent).key;
  if (key === undefined) return;
  if (key !== null
    && key !== ACCOUNT_USER_KEY
    && key !== LOCAL_MODE_KEY
    && key !== PROFILES_STORAGE_KEY
    && key !== ACTIVE_PROFILE_ID_KEY
    && !key.startsWith(`${PROFILE_SPACE_PREFIX}:`)) return;
  handleExperienceScopeChange();
}

function notifyExperienceScopeListeners(current: Omit<ExperienceStorageScope, "generation">) {
  const scope = { ...current, generation: experienceScopeGeneration };
  for (const listener of experienceScopeListeners) {
    try { listener(scope); } catch { /* One subscriber cannot block scope invalidation for others. */ }
  }
  try {
    window.dispatchEvent(new CustomEvent(EXPERIENCE_SCOPE_CHANGED_EVENT, { detail: scope }));
  } catch {
    // Scope invalidation remains effective even when a host has no DOM event implementation.
  }
}

function normalizeName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized || "Usuario";
}

const PIN_SALT = "aetherio-profile-v1";

/** El PIN de Aetherio son exactamente 4 dígitos. */
export const PIN_LENGTH = 4;

/**
 * Un PIN solo existe si tiene 4 dígitos: el teclado de acceso pide 4, así que
 * guardar 1-3 dejaría el perfil sin forma de abrirlo. La UI avisa antes de
 * guardar y esta capa es la red de seguridad.
 */
export function isValidPin(value: string | undefined | null): value is string {
  return typeof value === "string" && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(value);
}

/** Mensaje para la UI; null cuando el PIN es válido o está vacío. */
export function pinLengthError(value: string): string | null {
  if (!value || isValidPin(value)) return null;
  return `El PIN debe tener ${PIN_LENGTH} dígitos.`;
}

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

/* -------------------------------------------------------------------------- */
/* Migración de PINs                                                          */
/* -------------------------------------------------------------------------- */

/**
 * El PIN pasó de "hasta 8 dígitos" a "exactamente 4" (el teclado de acceso pide
 * 4). Como el PIN se guarda hasheado no se puede leer su largo, así que la
 * única forma fiable de saber si un PIN guardado sigue siendo válido es
 * comprobarlo contra los 10.000 combinaciones de 4 dígitos: si ninguna coincide
 * es un PIN legacy (5-8 dígitos) y se quita, dejando el perfil accesible.
 *
 * Todo local: 10.000 SHA-256 sobre la maquina del usuario, sin red. Se hace una
 * sola vez (marca en localStorage) y en segundo plano, sin bloquear el arranque.
 */

const PIN_MIGRATION_KEY = "aetherio-pin-length-v1-migrated";
export const PIN_MIGRATION_EVENT = "aetherio-pin-migration-done";

/** 4 dígitos = 10.000 combinaciones: el tope del espacio de PIN. */
export const PIN_SPACE = 10 ** PIN_LENGTH;

export function needsPinLengthMigration(): boolean {
  try {
    if (localStorage.getItem(PIN_MIGRATION_KEY)) return false;
    return getLocalProfiles().some(profile => Boolean(profile.pin));
  } catch {
    return false;
  }
}

/** Hashes de los 10.000 PIN de 4 dígitos, calculados en paralelo por lotes. */
async function hashAllFourDigitPins(): Promise<Set<string>> {
  const hashes = new Set<string>();
  const BATCH = 250;
  for (let start = 0; start < PIN_SPACE; start += BATCH) {
    const batch: Promise<void>[] = [];
    for (let value = start; value < Math.min(start + BATCH, PIN_SPACE); value++) {
      const pin = String(value).padStart(PIN_LENGTH, "0");
      batch.push(hashPin(pin).then(hash => { hashes.add(hash); }));
    }
    await Promise.all(batch);
  }
  return hashes;
}

/**
 * Quita los PINs que ya no son de 4 dígitos. Devuelve los nombres de los
 * perfiles liberados. Es idempotente y no hace nada si ya se migró.
 */
export async function migratePinsToFourDigits(): Promise<string[]> {
  try {
    if (!needsPinLengthMigration()) {
      markPinMigrationDone();
      return [];
    }
    const profiles = getLocalProfiles();
    const pinned = profiles.filter(profile => profile.pin);
    if (pinned.length === 0) {
      markPinMigrationDone();
      return [];
    }
    const validHashes = await hashAllFourDigitPins();
    const released: string[] = [];
    const updated = profiles.map(profile => {
      if (!profile.pin || validHashes.has(profile.pin)) return profile;
      released.push(profile.name);
      return { ...profile, pin: undefined, updatedAt: Date.now() };
    });
    if (released.length > 0) writeProfiles(updated);
    markPinMigrationDone();
    if (released.length > 0) {
      window.dispatchEvent(new CustomEvent(PIN_MIGRATION_EVENT, { detail: { released } }));
    }
    return released;
  } catch {
    // Migracion best-effort: si algo falla, el perfil sigue protegido por su PIN.
    return [];
  }
}

function markPinMigrationDone() {
  try {
    localStorage.setItem(PIN_MIGRATION_KEY, String(Date.now()));
  } catch {
    // Sin localStorage no hay nada que migrar.
  }
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
