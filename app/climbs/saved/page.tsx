import SavedClimbDetail from "./saved-climb-detail";

export default async function SavedClimbPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  return <SavedClimbDetail climbId={typeof id === "string" ? id : ""} />;
}
