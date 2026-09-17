import assert from "node:assert/strict";
import test from "node:test";
import { findGraphData, graphTooltipPosition, type GraphDatum } from "../lib/graph-inspection";

const point: GraphDatum = { id: 0, series: "Series A", color: "#123456", horizontal: 50, vertical: 100, xValue: 0.123456789, yValue: -2.75 };

test("Point inspection uses rendered coordinates and preserves exact values", () => {
  assert.deepEqual(findGraphData([point], 52, 103), [point]);
  assert.deepEqual(findGraphData([point], 61, 100), []);
  assert.deepEqual(findGraphData([point], 66, 100, 18), [point]);
  assert.equal(findGraphData([point], 50, 100)[0].xValue, 0.123456789);
});

test("Nearby and coincident points are ordered by distance then drawing order", () => {
  const coincident = { ...point, id: 1, series: "Series B" };
  const closer = { ...point, id: 2, horizontal: 55 };
  assert.deepEqual(findGraphData([point, coincident, closer], 55, 100).map(item => item.id), [2, 1, 0]);
});

test("Bars can be inspected throughout their visible rectangle", () => {
  const bar = { ...point, xValue: "Category", bounds: { left: 30, top: 50, width: 40, height: 200 } };
  assert.deepEqual(findGraphData([bar], 40, 220), [bar]);
  assert.deepEqual(findGraphData([bar], 75, 220), []);
});

test("Tooltip placement flips and clamps at all plot edges without changing layout", () => {
  for (const viewport of [{ width: 320, height: 240 }, { width: 640, height: 500 }]) {
    const tooltip = { width: 280, height: 180 };
    for (const horizontal of [0, viewport.width / 2, viewport.width]) {
      for (const vertical of [0, viewport.height / 2, viewport.height]) {
        const position = graphTooltipPosition({ horizontal, vertical }, tooltip, viewport);
        assert.ok(position.left >= 8 && position.top >= 8);
        assert.ok(position.left + tooltip.width <= viewport.width - 8);
        assert.ok(position.top + tooltip.height <= viewport.height - 8);
      }
    }
  }
});