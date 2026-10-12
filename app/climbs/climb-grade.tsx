export type GradeBand = "green" | "yellow" | "red";
export type ClimbColor = GradeBand | "gray";

export function getGradeBand(grade: string): GradeBand {
  const gradeNumber = Number(grade.slice(1));
  if (gradeNumber <= 4) return "green";
  if (gradeNumber <= 7) return "yellow";
  return "red";
}

export function getClimbColor(grade: string, hasSends: boolean): ClimbColor {
  return hasSends ? getGradeBand(grade) : "gray";
}

const bandLabels: Record<GradeBand, string> = {
  green: "Green difficulty (V0–V4)",
  yellow: "Yellow difficulty (V5–V7)",
  red: "Red difficulty (V8 and up)",
};

export default function GradeBadge({
  grade,
  hasSends,
  revealed,
  className = "",
}: {
  grade: string;
  hasSends: boolean;
  revealed: boolean;
  className?: string;
}) {
  const band = getGradeBand(grade);
  const color = getClimbColor(grade, hasSends);
  const label = hasSends ? bandLabels[band] : "No logged sends";

  return (
    <span
      aria-label={
        revealed
          ? `${grade}. ${label}.`
          : `${label}. Grade hidden until sent.`
      }
      className={`climb-grade climb-grade--${color}${className ? ` ${className}` : ""}`}
      role="img"
    >
      {revealed ? grade : null}
    </span>
  );
}
