export const USER_PROFILE_KEY = "a-fine-wall:user-profile:v1";
export const USER_PROFILE_COOKIE_KEY = "a-fine-wall-user-profile-v1";
export const MAX_USER_NAME_LENGTH = 50;

const profileIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type UserProfile = {
  id: string;
  name: string;
};

type StorageReader = {
  getItem(key: string): string | null;
};

type StorageWriter = StorageReader & {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function normalizeUserName(value: unknown): string | null {
  if (typeof value !== "string" || hasUnsafeNameCharacter(value)) return null;

  const name = value.trim().replace(/\s+/g, " ");
  return name &&
    name.toLocaleLowerCase("en-US") !== "you" &&
    name.length <= MAX_USER_NAME_LENGTH
    ? name
    : null;
}

function hasUnsafeNameCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    );
  });
}

export function isProfileId(value: unknown): value is string {
  return typeof value === "string" && profileIdPattern.test(value);
}

export function parseUserProfile(raw: string | null): UserProfile | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;

    const profile = value as Record<string, unknown>;
    const name = normalizeUserName(profile.name);
    if (!isProfileId(profile.id) || !name) return null;

    return { id: profile.id, name };
  } catch {
    return null;
  }
}

export function serializeUserProfileCookie(profile: UserProfile) {
  return encodeURIComponent(JSON.stringify(profile));
}

export function parseUserProfileCookie(
  cookieHeader: string | null,
): UserProfile | null {
  if (!cookieHeader) return null;

  const encodedProfile = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${USER_PROFILE_COOKIE_KEY}=`))
    ?.slice(USER_PROFILE_COOKIE_KEY.length + 1);
  if (!encodedProfile) return null;

  try {
    return parseUserProfile(decodeURIComponent(encodedProfile));
  } catch {
    return null;
  }
}

export function resolveCachedUserProfile(
  browserProfile: UserProfile | null,
  serverProfile: UserProfile | null,
) {
  return browserProfile ?? serverProfile;
}

export function readUserProfile(storage: StorageReader): UserProfile | null {
  return parseUserProfile(storage.getItem(USER_PROFILE_KEY));
}

export function persistUserProfile(
  storage: StorageWriter,
  profile: UserProfile,
) {
  storage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
}

export function removeUserProfile(storage: StorageWriter) {
  storage.removeItem(USER_PROFILE_KEY);
}
