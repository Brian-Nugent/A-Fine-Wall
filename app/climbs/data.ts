export type HoldRole = "start" | "hand" | "foot" | "finish";

export type HoldMarker = {
  x: number;
  y: number;
  size: number;
  role: HoldRole;
};

export type Climb = {
  slug: string;
  name: string;
  grade: string;
  setter: string;
  holds: HoldMarker[];
};

// Every visible climb now comes from the shared database.
export const climbs: Climb[] = [];

export function getClimb(slug: string) {
  return climbs.find((climb) => climb.slug === slug);
}
