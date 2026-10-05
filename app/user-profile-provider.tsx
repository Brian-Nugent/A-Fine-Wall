"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createUserProfile, loadUserProfile } from "./user-api";
import {
  MAX_USER_NAME_LENGTH,
  MAX_USER_LOGIN_LENGTH,
  USER_PROFILE_COOKIE_KEY,
  USER_PROFILE_KEY,
  parseUserLogin,
  refreshUserProfile,
  persistUserProfile,
  readUserProfile,
  removeUserProfile,
  resolveCachedUserProfile,
  serializeUserProfileCookie,
  type UserProfile,
} from "./user-profile";

type UserProfileContextValue = {
  profile: UserProfile | null;
  changeUser(): void;
};

const UserProfileContext = createContext<UserProfileContextValue | null>(null);
const USER_PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function syncUserProfileCookie(profile: UserProfile | null) {
  try {
    document.cookie = profile
      ? `${USER_PROFILE_COOKIE_KEY}=${serializeUserProfileCookie(profile)}; Path=/; Max-Age=${USER_PROFILE_COOKIE_MAX_AGE}; SameSite=Lax`
      : `${USER_PROFILE_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Profile state and local storage remain usable if cookies are blocked.
  }
}

export function useActiveUser() {
  const value = useContext(UserProfileContext);
  if (!value) throw new Error("An active user profile is required.");
  return value;
}

export default function UserProfileProvider({
  children,
  initialProfile,
}: {
  children: ReactNode;
  initialProfile: UserProfile | null;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  const [status, setStatus] = useState<"loading" | "ready">(
    initialProfile ? "ready" : "loading",
  );
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeProfile = useRef<UserProfile | null>(initialProfile);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    let savedProfile = initialProfile;

    try {
      savedProfile = resolveCachedUserProfile(
        readUserProfile(window.localStorage),
        initialProfile,
      );
    } catch {
      // The server-provided cookie remains a usable cache if storage is blocked.
    }

    syncUserProfileCookie(savedProfile);

    queueMicrotask(() => {
      if (!isActive) return;
      activeProfile.current = savedProfile;
      setProfile(savedProfile);
      setStatus("ready");
    });

    if (savedProfile) {
      const sessionProfile = savedProfile;
      loadUserProfile(sessionProfile.id, controller.signal)
        .then((currentProfile) => {
          // A same-user mode change is also a new login: ignore older refreshes.
          if (!isActive || activeProfile.current !== sessionProfile) return;
          if (!currentProfile) {
            try {
              removeUserProfile(window.localStorage);
            } catch {
              // The in-memory profile can still be replaced below.
            }
            syncUserProfileCookie(null);
            activeProfile.current = null;
            setProfile(null);
            return;
          }

          const refreshedProfile = refreshUserProfile(currentProfile, sessionProfile);
          activeProfile.current = refreshedProfile;
          setProfile((current) =>
            current?.id === refreshedProfile.id &&
            current.name === refreshedProfile.name &&
            current.softMode === refreshedProfile.softMode
              ? current
              : refreshedProfile,
          );
          try {
            persistUserProfile(window.localStorage, refreshedProfile);
          } catch {
            // The current session can continue without browser persistence.
          }
          syncUserProfileCookie(refreshedProfile);
        })
        .catch((loadError: unknown) => {
          if (loadError instanceof DOMException && loadError.name === "AbortError") {
            return;
          }
          // Keep the cached profile during a temporary connection problem.
        });
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== USER_PROFILE_KEY) return;
      let nextProfile: UserProfile | null = null;
      try {
        nextProfile = readUserProfile(window.localStorage);
      } catch {
        nextProfile = null;
      }
      syncUserProfileCookie(nextProfile);
      activeProfile.current = nextProfile;
      setProfile(nextProfile);
      setIsEditing(false);
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      isActive = false;
      controller.abort();
      window.removeEventListener("storage", handleStorage);
    };
  }, [initialProfile]);

  useEffect(() => {
    if (status !== "ready" || (profile && !isEditing)) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isEditing, profile, status]);

  function changeUser() {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setName(profile ? `${profile.softMode ? "soft " : ""}${profile.name}` : "");
    setError("");
    setIsEditing(true);
  }

  function restoreFocus() {
    const returnTarget = returnFocusRef.current;
    returnFocusRef.current = null;
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    });
  }

  function cancelChangeUser() {
    setError("");
    setIsEditing(false);
    restoreFocus();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parseUserLogin(name)) {
      setError(`Enter a name using ${MAX_USER_NAME_LENGTH} characters or fewer.`);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const nextProfile = await createUserProfile(name);
      activeProfile.current = nextProfile;
      try {
        persistUserProfile(window.localStorage, nextProfile);
      } catch {
        // Keep the selected profile for this session if storage is unavailable.
      }
      syncUserProfileCookie(nextProfile);
      setProfile(nextProfile);
      setIsEditing(false);
      restoreFocus();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your name could not be saved. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const gate =
    status === "ready" && (!profile || isEditing) ? (
      <main className="profile-gate">
        <section className="profile-card" aria-labelledby="profile-heading">
          <p className="profile-kicker">A Fine Wall</p>
          <h1 id="profile-heading">{profile ? "Change user" : "What's your name?"}</h1>
          <p>Your name will appear on the climbs you set.</p>

          <form className="profile-form" onSubmit={saveProfile}>
            <label htmlFor="user-name-input">Name</label>
            <input
              autoComplete="name"
              id="user-name-input"
              maxLength={MAX_USER_LOGIN_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              ref={inputRef}
              required
              type="text"
              value={name}
            />
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="profile-actions">
              {profile ? (
                <button
                  className="secondary-button"
                  disabled={isSaving}
                  onClick={cancelChangeUser}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
              <button className="primary-button" disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : profile ? "Save User" : "Enter"}
              </button>
            </div>
          </form>
        </section>
      </main>
    ) : null;
  const isGateOpen = status === "loading" || gate !== null;

  return (
    <UserProfileContext.Provider
      value={{ profile, changeUser }}
    >
      <div
        aria-hidden={isGateOpen ? "true" : undefined}
        className="profile-app"
        inert={isGateOpen ? true : undefined}
      >
        {children}
      </div>
      {gate}
    </UserProfileContext.Provider>
  );
}
