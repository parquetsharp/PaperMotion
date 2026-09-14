export function fitSceneDistance(radius: number, verticalFov: number, aspect: number): number {
  const verticalHalfAngle = verticalFov * Math.PI / 360;
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * Math.max(0.1, aspect));
  return Math.max(2, radius * 1.25 / Math.sin(Math.min(verticalHalfAngle, horizontalHalfAngle)));
}