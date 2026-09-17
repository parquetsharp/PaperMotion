type MeasureText = (text: string) => number;

export function wrapGraphText(text: string, maxWidth: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (line && measure(`${line} ${word}`) > maxWidth) { lines.push(line); line = ""; }
    let part = "";
    for (const character of word) {
      if (part && measure(part + character) > maxWidth) { lines.push(part); part = ""; }
      part += character;
    }
    line = line ? `${line} ${part}` : part;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function barChartLayout(input: { labels: string[]; values: number[]; width: number; height: number; xLabel: string; yLabel: string }, measure: MeasureText) {
  const lineHeight = 14;
  const labelGap = 12;
  const yAxisRows = wrapGraphText(input.yLabel, 140, measure).length;
  const left = Math.max(50, yAxisRows * lineHeight + 16);
  const right = 20;
  const top = 24;
  const minimumSlot = Math.max(52, ...input.labels.flatMap(label => label.split(/\s+/).map(word => Math.min(140, measure(word)) + labelGap)), ...input.values.map(value => measure(String(value)) + labelGap));
  const width = Math.max(input.width, left + right + input.labels.length * minimumSlot);
  const plotWidth = width - left - right;
  const slotWidth = plotWidth / Math.max(1, input.labels.length);
  const labels = input.labels.map(label => wrapGraphText(label, slotWidth - labelGap, measure));
  const labelHeight = Math.max(1, ...labels.map(lines => lines.length)) * lineHeight;
  const xAxisLines = wrapGraphText(input.xLabel, plotWidth, measure);
  const bottom = 10 + labelHeight + 14 + xAxisLines.length * lineHeight + 8;
  const height = Math.max(input.height, top + bottom + 140);
  const plotHeight = height - top - bottom;
  const yAxisLines = wrapGraphText(input.yLabel, plotHeight, measure);
  return { width, height, left, right, top, bottom, plotWidth, plotHeight, slotWidth, labels, lineHeight, labelY: top + plotHeight + 10, xAxisY: top + plotHeight + 10 + labelHeight + 14, xAxisLines, yAxisLines };
}