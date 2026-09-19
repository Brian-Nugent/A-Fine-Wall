"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useActiveUser } from "../user-profile-provider";
import {
  climbActivityKey,
  type ClimbActivity,
  type ClimbLogbookEntry,
  type ClimbReference,
} from "./climb-activity";
import { loadClimbActivityDetail } from "./send-api";
import GradeBadge from "./climb-grade";

type ActivityState = {
  profileId: string | null;
  referenceKey: string | null;
  status: "loading" | "ready" | "error";
  activity: ClimbActivity | null;
  logbookEntries: ClimbLogbookEntry[];
};

const emptyState: ActivityState = {
  profileId: null,
  referenceKey: null,
  status: "loading",
  activity: null,
  logbookEntries: [],
};

const ClimbActivityContext = createContext({ ...emptyState, hasSent: false });

// The header and logbook share one request and the same reveal decision.
export function ClimbActivityProvider({
  reference,
  children,
}: {
  reference: ClimbReference;
  children: ReactNode;
}) {
  const { profile } = useActiveUser();
  const { climbKind, climbId } = reference;
  const referenceKey = climbActivityKey(reference);
  const [state, setState] = useState<ActivityState>(emptyState);

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    void loadClimbActivityDetail(
      { climbKind, climbId },
      profile.id,
      controller.signal,
    )
      .then(({ activity, logbookEntries }) => {
        if (!isActive) return;
        setState({
          profileId: profile.id,
          referenceKey,
          status: "ready",
          activity,
          logbookEntries,
        });
      })
      .catch(() => {
        if (!isActive) return;
        setState({
          ...emptyState,
          profileId: profile.id,
          referenceKey,
          status: "error",
        });
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, climbKind, profile, referenceKey]);

  // Gate synchronously, before effects run, when the user or climb changes.
  const currentState =
    profile &&
    state.profileId === profile.id &&
    state.referenceKey === referenceKey
      ? state
      : emptyState;
  const hasSent =
    currentState.status === "ready" && currentState.activity?.userRating != null;

  return (
    <ClimbActivityContext.Provider value={{ ...currentState, hasSent }}>
      {children}
    </ClimbActivityContext.Provider>
  );
}

export function useClimbActivity() {
  return useContext(ClimbActivityContext);
}

export function ClimbDetailGrade({
  grade,
  className,
}: {
  grade: string;
  className?: string;
}) {
  const { hasSent } = useClimbActivity();
  return <GradeBadge grade={grade} revealed={hasSent} className={className} />;
}
