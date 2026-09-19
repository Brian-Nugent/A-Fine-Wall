export type GradeBand = "green" | "yellow" | "red";

export function getGradeBand(grade: string): GradeBand {
  const gradeNumber = Number(grade.slice(1));
  if (gradeNumber <= 4) return "green";
  if (gradeNumber <= 7) return "yellow";
  return "red";
}

const bandLabels: Record<GradeBand, string> = {
  green: "Green difficulty (V0–V4)",
  yellow: "Yellow difficulty (V5–V7)",
  red: "Red difficulty (V8 and up)",
};

export default function GradeBadge({
  grade,
  revealed,
  className = "",
}: {
  grade: string;
  revealed: boolean;
  className?: string;
}) {
  const band = getGradeBand(grade);

  return (
    <span
      aria-label={
        revealed
          ? `${grade}. ${bandLabels[band]}.`
          : `${bandLabels[band]}. Grade hidden until sent.`
      }
      className={`climb-grade climb-grade--${band}${className ? ` ${className}` : ""}`}
      role="img"
    >
      {revealed ? grade : null}
    </span>
  );
}
