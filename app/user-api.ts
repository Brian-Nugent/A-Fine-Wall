import {
  isProfileId,
  normalizeUserName,
  type UserProfile,
} from "./user-profile";

export const PROFILES_ENDPOINT = "/api/profiles";

function parseProfile(profile: unknown): UserProfile | null {
  if (!profile || typeof profile !== "object") return null;

  const record = profile as Record<string, unknown>;
  const name = normalizeUserName(record.name);
  return isProfileId(record.id) && name ? { id: record.id, name } : null;
}

function parseProfilePayload(value: unknown): UserProfile | null {
  if (!value || typeof value !== "object" || !("profile" in value)) {
    return null;
  }

  return parseProfile((value as { profile?: unknown }).profile);
}

function parseProfilesPayload(value: unknown): UserProfile[] | null {
  if (!value || typeof value !== "object" || !("profiles" in value)) {
    return null;
  }

  const profiles = (value as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) return null;

  const parsed = profiles.map(parseProfile);
  return parsed.every((profile): profile is UserProfile => profile !== null)
    ? parsed
    : null;
}

async function profileError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error?: unknown }).error)
    : fallback;
}

export async function createUserProfile(name: string): Promise<UserProfile> {
  const response = await fetch(PROFILES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await profileError(response, "Your name could not be saved."));
  }

  const profile = parseProfilePayload(await response.json());
  if (!profile) throw new Error("Your name could not be saved.");
  return profile;
}

export async function loadUserProfile(
  id: string,
  signal?: AbortSignal,
): Promise<UserProfile | null> {
  const response = await fetch(
    `${PROFILES_ENDPOINT}/${encodeURIComponent(id)}`,
    { cache: "no-store", signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Your saved name could not be checked.");

  return parseProfilePayload(await response.json());
}

export async function loadUserProfiles(signal?: AbortSignal) {
  const response = await fetch(PROFILES_ENDPOINT, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("The user list could not be loaded.");

  const profiles = parseProfilesPayload(await response.json());
  if (!profiles) throw new Error("The user list could not be loaded.");
  return profiles;
}
