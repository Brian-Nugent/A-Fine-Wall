"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearSessionClimbNavigationSnapshot } from "../climbs/climb-navigation-snapshot";
import { requestLists } from "./list-api";
import type { ClimbList } from "./climb-lists";

export function useClimbLists(profileId?: string, enabled = true) {
  const [state, setState] = useState<{ profileId?: string; lists: ClimbList[]; error: string; ready: boolean }>({ lists: [], error: "", ready: false });
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const latestRequest = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    const requestId = ++latestRequest.current;
    if (!profileId || !enabled) return;
    const controller = new AbortController();
    void requestLists(profileId, "", "GET", undefined, controller.signal)
      .then(({ lists }) => {
        if (generation.current === current && latestRequest.current === requestId) setState({ profileId, lists, ready: true, error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && generation.current === current && latestRequest.current === requestId) {
          setState({ profileId, lists: [], ready: false, error: error instanceof Error ? error.message : "Your lists could not be loaded." });
        }
      });
    return () => { generation.current = current + 1; controller.abort(); };
  }, [profileId, enabled, revision]);

  const mutate = useCallback(async (path: string, method: string, name?: string) => {
    if (!profileId || pending.current) return null;
    const current = generation.current;
    ++latestRequest.current;
    pending.current = true;
    setBusy(true);
    try {
      const result = await requestLists(profileId, path, method, name);
      clearSessionClimbNavigationSnapshot(window);
      if (generation.current !== current) return null;
      setState({ profileId, lists: result.lists, ready: true, error: "" });
      return result;
    } catch (error) {
      if (generation.current === current) setState(value => ({ ...value, error: error instanceof Error ? error.message : "Your lists could not be saved." }));
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [profileId]);

  const current = state.profileId === profileId;
  return {
    lists: current ? state.lists : [],
    ready: current && state.ready,
    error: current ? state.error : "",
    busy,
    reload: () => setRevision(value => value + 1),
    create: (name: string) => mutate("", "POST", name),
    rename: (id: string, name: string) => mutate(`/${encodeURIComponent(id)}`, "PATCH", name),
    remove: (id: string) => mutate(`/${encodeURIComponent(id)}`, "DELETE"),
    setMembership: (listId: string, climbId: string, included: boolean) => mutate(`/${encodeURIComponent(listId)}/climbs/${encodeURIComponent(climbId)}`, included ? "PUT" : "DELETE"),
  };
}
