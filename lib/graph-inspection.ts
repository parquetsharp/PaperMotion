export type GraphDatum = {
  id: number;
  series: string;
  color: string;
  horizontal: number;
  vertical: number;
  xValue: number | string;
  yValue: number;
  bounds?: { left: number; top: number; width: number; height: number };
};

export function findGraphData(data: GraphDatum[], horizontal: number, vertical: number, radius = 10): GraphDatum[] {
  return data.map(datum => {
    const bounds = datum.bounds;
    const distance = bounds
      ? Math.hypot(Math.max(bounds.left - horizontal, 0, horizontal - bounds.left - bounds.width), Math.max(bounds.top - vertical, 0, vertical - bounds.top - bounds.height))
      : Math.hypot(datum.horizontal - horizontal, datum.vertical - vertical);
    return { datum, distance };
  }).filter(item => item.distance <= (item.datum.bounds ? 3 : radius))
    .sort((left, right) => left.distance - right.distance || right.datum.id - left.datum.id)
    .map(item => item.datum);
}

export function graphTooltipPosition(anchor: { horizontal: number; vertical: number }, tooltip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 12;
  const margin = 8;
  const left = anchor.horizontal + gap + tooltip.width <= viewport.width - margin ? anchor.horizontal + gap : anchor.horizontal - gap - tooltip.width;
  const top = anchor.vertical + gap + tooltip.height <= viewport.height - margin ? anchor.vertical + gap : anchor.vertical - gap - tooltip.height;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - tooltip.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - tooltip.height - margin)),
  };
}