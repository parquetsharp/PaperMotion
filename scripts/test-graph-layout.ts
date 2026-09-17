import assert from "node:assert/strict";
import test from "node:test";
import { barChartLayout, wrapGraphText } from "../lib/graph-layout";

const labels = ["NSW peak RAM", "HNSW peak RAM", "NSW accuracy", "HNSW accuracy", "NSW search speed", "HNSW search speed", "NSW construction speed", "HNSW construction speed"];
const values = [1, 2.5, 1, 1.15, 1, 10, 1, 4];
const measure = (text: string) => text.length * 6;

test("Bar labels occupy separate measured slots and leave room for the axis title", () => {
  for (const width of [750, 615, 390, 320]) {
    const layout = barChartLayout({ labels, values, width, height: 650, xLabel: "Metric and method", yLabel: "Relative to NSW baseline (x)" }, measure);
    assert.ok(layout.width >= width);
    for (let index = 0; index < labels.length; index++) {
      assert.equal(layout.labels[index].join(" "), labels[index]);
      for (const line of layout.labels[index]) assert.ok(measure(line) <= layout.slotWidth - 12);
      assert.ok(measure(String(values[index])) < layout.slotWidth);
      assert.ok(layout.labelY + layout.labels[index].length * layout.lineHeight < layout.xAxisY);
    }
    assert.ok(layout.xAxisY + layout.xAxisLines.length * layout.lineHeight <= layout.height - 8);
    assert.ok(layout.plotHeight >= 140);
  }
});

test("Long words and axis captions remain complete in a short narrow panel", () => {
  const longLabel = "VeryLongUnbrokenCategoryLabel".repeat(4);
  const layout = barChartLayout({ labels: [longLabel, "Second category"], values: [123456789, 4], width: 320, height: 180, xLabel: "A long horizontal axis caption ".repeat(4), yLabel: "A long vertical axis caption ".repeat(4) }, measure);
  assert.equal(layout.labels[0].join(""), longLabel);
  assert.ok(layout.labels[0].every(line => measure(line) <= layout.slotWidth - 12));
  assert.ok(layout.height > 180);
  assert.equal(layout.xAxisLines.join(" "), "A long horizontal axis caption ".repeat(4).trim());
  assert.equal(layout.yAxisLines.join(" "), "A long vertical axis caption ".repeat(4).trim());
  assert.ok(layout.yAxisLines.every(line => measure(line) <= layout.plotHeight));
  assert.ok(layout.yAxisLines.length * layout.lineHeight + 16 <= layout.left);
  assert.deepEqual(wrapGraphText("", 80, measure), [""]);
});