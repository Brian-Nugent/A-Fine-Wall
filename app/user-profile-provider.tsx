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
  USER_PROFILE_KEY,
  normalizeUserName,
  persistUserProfile,
  readUserProfile,
  removeUserProfile,
  type UserProfile,
} from "./user-profile";

type UserProfileContextValue = {
  profile: UserProfile | null;
  changeUser(): void;
};

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

export function useActiveUser() {
  const value = useContext(UserProfileContext);
  if (!value) throw new Error("An active user profile is required.");
  return value;
}

export default function UserProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeProfileId = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    let savedProfile: UserProfile | null = null;

    try {
      savedProfile = readUserProfile(window.localStorage);
    } catch {
      savedProfile = null;
    }

    queueMicrotask(() => {
      if (!isActive) return;
      activeProfileId.current = savedProfile?.id ?? null;
      setProfile(savedProfile);
      setStatus("ready");
    });

    if (savedProfile) {
      loadUserProfile(savedProfile.id, controller.signal)
        .then((currentProfile) => {
          if (!isActive || activeProfileId.current !== savedProfile?.id) return;
          if (!currentProfile) {
            try {
              removeUserProfile(window.localStorage);
            } catch {
              // The in-memory profile can still be replaced below.
            }
            activeProfileId.current = null;
            setProfile(null);
            return;
          }

          setProfile((current) =>
            current?.id === currentProfile.id &&
            current.name === currentProfile.name
              ? current
              : currentProfile,
          );
          try {
            persistUserProfile(window.localStorage, currentProfile);
          } catch {
            // The current session can continue without browser persistence.
          }
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
      activeProfileId.current = nextProfile?.id ?? null;
      setProfile(nextProfile);
      setIsEditing(false);
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      isActive = false;
      controller.abort();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || (profile && !isEditing)) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isEditing, profile, status]);

  function changeUser() {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setName(profile?.name ?? "");
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
    const normalizedName = normalizeUserName(name);
    if (!normalizedName) {
      setError(`Enter a name using ${MAX_USER_NAME_LENGTH} characters or fewer.`);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const nextProfile = await createUserProfile(normalizedName);
      activeProfileId.current = nextProfile.id;
      try {
        persistUserProfile(window.localStorage, nextProfile);
      } catch {
        // Keep the selected profile for this session if storage is unavailable.
      }
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
    status === "loading" ? (
      <main className="profile-gate profile-gate--loading">
        <h1>A Fine Wall</h1>
        <p>Opening the wall&hellip;</p>
      </main>
    ) : !profile || isEditing ? (
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
              maxLength={MAX_USER_NAME_LENGTH}
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
  const isGateOpen = gate !== null;

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
