import type { UserProfile } from "./user-profile";

export const ADMIN_USER_NAME = "Admin";
export const ACTIVE_USER_PROFILE_HEADER = "X-A-Fine-Wall-Profile-Id";

function userNameKey(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
}

export function isSameUserName(left: unknown, right: unknown) {
  const leftKey = userNameKey(left);
  return Boolean(leftKey) && leftKey === userNameKey(right);
}

export function isAdminUserName(value: unknown) {
  return isSameUserName(value, ADMIN_USER_NAME);
}

export function isAdminUser(
  profile: Pick<UserProfile, "name"> | null | undefined,
) {
  return isAdminUserName(profile?.name);
}

export function canManageClimb(
  profile: Pick<UserProfile, "name"> | null | undefined,
  setter: unknown,
) {
  return Boolean(
    profile &&
      (isAdminUser(profile) || isSameUserName(profile.name, setter)),
  );
}
