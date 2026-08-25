import {
  parseClimbActivitiesPayload,
  type ClimbActivity,
  type ClimbReference,
} from "./climb-activity";

export const SENDS_ENDPOINT = "/api/sends";

async function requestError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error?: unknown }).error)
    : fallback;
}

export async function loadClimbActivities(
  profileId: string,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({ profileId });
  const response = await fetch(`${SENDS_ENDPOINT}?${searchParams}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      await requestError(response, "Climb ratings could not be loaded."),
    );
  }

  const activities = parseClimbActivitiesPayload(await response.json());
  if (!activities) throw new Error("Climb ratings could not be loaded.");
  return activities;
}

export async function saveClimbSend(
  reference: ClimbReference,
  profileId: string,
  rating: number,
): Promise<ClimbActivity> {
  const response = await fetch(SENDS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...reference, profileId, rating }),
  });
  if (!response.ok) {
    throw new Error(
      await requestError(response, "Your send could not be saved."),
    );
  }

  const activities = parseClimbActivitiesPayload(await response.json());
  if (!activities || activities.length !== 1) {
    throw new Error("Your send could not be saved.");
  }
  return activities[0];
}
