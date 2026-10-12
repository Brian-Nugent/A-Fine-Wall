export function circuitNumberSizeScale(viewportScale: number) {
  const zoom = Number.isFinite(viewportScale) ? Math.max(1, viewportScale) : 1;
  // Counteract page magnification, then shrink the on-screen badge by up to
  // 25%. Keeping a minimum screen size prevents numbers from becoming illegible.
  const screenSize = Math.max(0.75, 1 / Math.sqrt(zoom));
  return screenSize / zoom;
}
