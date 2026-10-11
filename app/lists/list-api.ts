import { isClimbList, type ClimbList } from "./climb-lists";

type ListsResponse = { lists: ClimbList[]; list?: ClimbList };

export async function requestLists(profileId: string, path = "", method = "GET", name?: string, signal?: AbortSignal): Promise<ListsResponse> {
  const response = await fetch(`/api/lists${path}?profileId=${encodeURIComponent(profileId)}`, {
    method, cache: "no-store", signal,
    ...(name === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  });
  const data = await response.json() as ListsResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "Your lists could not be saved.");
  if (!Array.isArray(data.lists) || !data.lists.every(isClimbList)) throw new Error("Your lists could not be loaded.");
  return data;
}

export async function loadClimbLists(profileId: string, signal?: AbortSignal) {
  return (await requestLists(profileId, "", "GET", undefined, signal)).lists;
}
