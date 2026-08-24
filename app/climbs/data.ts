export type HoldRole = "start" | "hand" | "finish";

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

export const climbs: Climb[] = [
  {
    slug: "first-light",
    name: "First Light",
    grade: "V2",
    setter: "Ben",
    holds: [
      { x: 50, y: 89, size: 10, role: "start" },
      { x: 43, y: 78, size: 9, role: "hand" },
      { x: 33, y: 74, size: 8, role: "hand" },
      { x: 30, y: 64, size: 10, role: "hand" },
      { x: 44, y: 54, size: 10, role: "hand" },
      { x: 58, y: 49, size: 7, role: "hand" },
      { x: 57, y: 40, size: 9, role: "hand" },
      { x: 64, y: 33, size: 7, role: "hand" },
      { x: 66, y: 9, size: 9, role: "finish" },
    ],
  },
  {
    slug: "barn-door-protocol",
    name: "Barn Door Protocol",
    grade: "V5",
    setter: "Maya",
    holds: [
      { x: 70, y: 87, size: 7, role: "start" },
      { x: 82, y: 73, size: 11, role: "hand" },
      { x: 76, y: 68, size: 10, role: "hand" },
      { x: 70, y: 63, size: 8, role: "hand" },
      { x: 84, y: 59, size: 9, role: "hand" },
      { x: 79, y: 44, size: 7, role: "hand" },
      { x: 87, y: 39, size: 9, role: "hand" },
      { x: 76, y: 30, size: 12, role: "hand" },
      { x: 87, y: 22, size: 10, role: "hand" },
      { x: 90, y: 9, size: 7, role: "finish" },
    ],
  },
  {
    slug: "quiet-feet",
    name: "Quiet Feet",
    grade: "V3",
    setter: "Sam",
    holds: [
      { x: 27, y: 91, size: 6, role: "start" },
      { x: 25, y: 78, size: 6, role: "hand" },
      { x: 18, y: 73, size: 6, role: "hand" },
      { x: 21, y: 68, size: 10, role: "hand" },
      { x: 29, y: 60, size: 8, role: "hand" },
      { x: 30, y: 54, size: 9, role: "hand" },
      { x: 29, y: 43, size: 8, role: "hand" },
      { x: 19, y: 34, size: 7, role: "hand" },
      { x: 18, y: 16, size: 8, role: "hand" },
      { x: 9, y: 9, size: 7, role: "finish" },
    ],
  },
  {
    slug: "static-bloom",
    name: "Static Bloom",
    grade: "V4",
    setter: "Lena",
    holds: [
      { x: 64, y: 91, size: 6, role: "start" },
      { x: 58, y: 86, size: 7, role: "hand" },
      { x: 68, y: 82, size: 6, role: "hand" },
      { x: 63, y: 77, size: 7, role: "hand" },
      { x: 58, y: 69, size: 7, role: "hand" },
      { x: 50, y: 64, size: 6, role: "hand" },
      { x: 63, y: 58, size: 9, role: "hand" },
      { x: 67, y: 53, size: 8, role: "hand" },
      { x: 58, y: 40, size: 9, role: "hand" },
      { x: 49, y: 29, size: 7, role: "hand" },
      { x: 49, y: 16, size: 7, role: "finish" },
    ],
  },
  {
    slug: "redline",
    name: "Redline",
    grade: "V6",
    setter: "Jordan",
    holds: [
      { x: 64, y: 91, size: 6, role: "start" },
      { x: 70, y: 87, size: 7, role: "hand" },
      { x: 43, y: 78, size: 9, role: "hand" },
      { x: 63, y: 68, size: 7, role: "hand" },
      { x: 64, y: 59, size: 7, role: "hand" },
      { x: 79, y: 44, size: 7, role: "hand" },
      { x: 85, y: 28, size: 9, role: "hand" },
      { x: 89, y: 34, size: 7, role: "hand" },
      { x: 49, y: 16, size: 7, role: "hand" },
      { x: 66, y: 9, size: 9, role: "finish" },
    ],
  },
];

export function getClimb(slug: string) {
  return climbs.find((climb) => climb.slug === slug);
}
