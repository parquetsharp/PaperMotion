import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expect } from "playwright/test";

export async function checkGraphLabels({ context, origin, docId, dataDirectory, output, getModelCalls }) {
  const labels = ["NSW peak RAM", "HNSW peak RAM", "NSW accuracy", "HNSW accuracy", "NSW search speed", "HNSW search speed", "NSW construction speed", "HNSW construction speed"];
  const values = [1, 2.5, 1, 1.15, 1, 10, 1, 4];
  const spec = { type: "graph", title: "HNSW vs. NSW: Performance Tradeoffs", caption: "Relative performance comparison.", chart_type: "bars", x_label: "Metric and method", y_label: "Relative to NSW baseline (x)", data_json: JSON.stringify({ bars: labels.map((label, index) => ({ label, value: values[index] })) }) };
  const points = { ...spec, title: "Resize points", chart_type: "points", x_label: "x", y_label: "y", data_json: '{"points":[[0,0],[1,2],[2,4]]}' };
  const lineSeries = Array.from({ length: 28 }, (_, index) => ({ name: index === 27 ? "LongUnbrokenSeriesName".repeat(12) : `OPT-${index < 14 ? "13B" : "175B"} ShareGPT workload ${index + 1} - ${["FasterTransformer", "Orca-1", "Orca-2", "vLLM"][index % 4]}`, color: ["#9ca3af", "#f59e0b", "#ef4444", "#5b66f1"][index % 4], points: [[0.5, 0.1 + index * 0.01], [1, 0.2 + index * 0.025], [1.5, 0.4 + index * 0.045], [2, 0.7 + index * 0.08]] }));
  lineSeries.at(-1).points = [[1.75, 3.4]];
  lineSeries[1].points[0] = [...lineSeries[0].points[0]];
  const lines = { ...spec, title: "Latency-Throughput Curves by Model and Workload", chart_type: "lines", x_label: "Request rate (requests/s)", y_label: "Normalized latency (s/token)", data_json: JSON.stringify({ series: lineSeries }) };
  const tag = { id: "graph-labels", page: 0, endX: 120, endY: 130, fontHeight: 12, type: "graph", label: spec.title, ready: true, generating: false, spec, revision: 0, versionId: "bars", versions: [{ id: "points", at: 1, spec: points }, { id: "lines", at: 2, spec: lines }], concept: { type: "graph", label: spec.title, context: "Performance tradeoffs", anchor: "Momentum" } };
  await writeFile(path.join(dataDirectory, "docs", docId, "tags.json"), JSON.stringify({ v: 1, docId, savedAt: Date.now(), activeTagId: tag.id, pagesAnalyzed: [0], tags: [tag] }));
  const viewer = await context.newPage();
  await viewer.addInitScript(() => {
    const originalText = CanvasRenderingContext2D.prototype.fillText;
    const originalRect = CanvasRenderingContext2D.prototype.fillRect;
    const originalArc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.fillRect = function (horizontal, vertical, width, height) {
      if (this.canvas.dataset.testid === "graph-canvas" && horizontal === 0 && vertical === 0) {
        this.canvas.graphText = [];
        this.canvas.graphMarkers = [];
        this.canvas.graphBars = [];
        this.canvas.graphDrawCount = (this.canvas.graphDrawCount ?? 0) + 1;
        this.canvas.graphViewportWidth = this.canvas.parentElement.clientWidth;
        this.canvas.graphViewportHeight = this.canvas.parentElement.clientHeight;
      } else if (this.canvas.dataset.testid === "graph-canvas") {
        (this.canvas.graphBars ??= []).push({ horizontal, vertical, width, height });
      }
      return originalRect.call(this, horizontal, vertical, width, height);
    };
    CanvasRenderingContext2D.prototype.arc = function (horizontal, vertical, radius, ...args) {
      if (this.canvas.dataset.testid === "graph-canvas") {
        const transform = this.getTransform();
        const center = transform.transformPoint({ x: horizontal, y: vertical });
        (this.canvas.graphMarkers ??= []).push({ horizontal, vertical, radius, pixelX: center.x, pixelY: center.y, pixelRadius: radius * transform.a, color: this.fillStyle, outline: this.strokeStyle });
      }
      return originalArc.call(this, horizontal, vertical, radius, ...args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (text, horizontal, vertical, ...args) {
      if (this.canvas.dataset.testid === "graph-canvas") {
        const metrics = this.measureText(text);
        const transform = this.getTransform();
        const corners = [[horizontal - metrics.actualBoundingBoxLeft, vertical - metrics.actualBoundingBoxAscent], [horizontal + metrics.actualBoundingBoxRight, vertical - metrics.actualBoundingBoxAscent], [horizontal - metrics.actualBoundingBoxLeft, vertical + metrics.actualBoundingBoxDescent], [horizontal + metrics.actualBoundingBoxRight, vertical + metrics.actualBoundingBoxDescent]].map(([left, top]) => transform.transformPoint({ x: left, y: top }));
        (this.canvas.graphText ??= []).push({ text, left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)), top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)) });
      }
      return originalText.call(this, text, horizontal, vertical, ...args);
    };
  });
  await viewer.setViewportSize({ width: 1800, height: 1000 });
  await viewer.goto(`${origin}/viewer/${docId}`);
  const canvas = viewer.getByTestId("graph-canvas");
  const scroller = viewer.getByRole("region", { name: "Graph scroll area", exact: true });
  async function checkStableFrames() {
    const samples = await canvas.evaluate(element => new Promise(resolve => {
      const frames = [];
      const sample = () => {
        const area = element.parentElement;
        frames.push({ width: area.clientWidth, height: area.clientHeight, canvasWidth: element.style.width, canvasHeight: element.style.height, draws: element.graphDrawCount, scrollLeft: area.scrollLeft, scrollTop: area.scrollTop, selected: element.getAttribute("aria-describedby") });
        if (frames.length < 48) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    }));
    const settled = samples.slice(8);
    assert.equal(new Set(settled.map(frame => JSON.stringify({ width: frame.width, height: frame.height, canvasWidth: frame.canvasWidth, canvasHeight: frame.canvasHeight }))).size, 1, "Graph dimensions stop changing once the viewport is fixed");
    assert.ok(settled.at(-1).draws - settled[0].draws <= 1, "An idle graph does not continuously redraw");
    return samples;
  }
  async function checkLineMarkers(dark = false) {
    const state = await canvas.evaluate(element => {
      const markers = element.graphMarkers;
      const last = markers.at(-1);
      const context = element.getContext("2d");
      return { markers, width: parseFloat(element.style.width), height: parseFloat(element.style.height), pixelWidth: element.width, pixelHeight: element.height, centerColor: [...context.getImageData(Math.floor(last.pixelX), Math.floor(last.pixelY), 1, 1).data].slice(0, 3), sideColor: [...context.getImageData(Math.floor(last.pixelX), Math.floor(last.pixelY - 1.5 * last.pixelRadius / last.radius), 1, 1).data].slice(0, 3) };
    });
    const expected = lineSeries.flatMap(series => series.points.map(point => ({ point, color: series.color })));
    assert.equal(state.markers.length, expected.length, "Every saved line point, including a single-point series, has a dot");
    const minimumX = Math.min(...expected.map(item => item.point[0]));
    const maximumX = Math.max(...expected.map(item => item.point[0]));
    const minimumY = Math.min(...expected.map(item => item.point[1]));
    const maximumY = Math.max(...expected.map(item => item.point[1]));
    const paddingY = (maximumY - minimumY) * 0.07;
    for (const [index, marker] of state.markers.entries()) {
      const item = expected[index];
      assert.equal(marker.color, item.color);
      assert.equal(marker.outline, dark ? "#1a1a1f" : "#ffffff");
      assert.equal(marker.radius, 3);
      assert.ok(Math.abs(marker.horizontal - (50 + (item.point[0] - minimumX) / (maximumX - minimumX) * (state.width - 70))) < 0.01);
      assert.ok(Math.abs(marker.vertical - (20 + (state.height - 60) * (1 - (item.point[1] - minimumY + paddingY) / (maximumY - minimumY + 2 * paddingY)))) < 0.01);
      assert.ok(marker.pixelX - marker.pixelRadius >= 0 && marker.pixelX + marker.pixelRadius <= state.pixelWidth && marker.pixelY - marker.pixelRadius >= 0 && marker.pixelY + marker.pixelRadius <= state.pixelHeight, "Endpoint markers are not clipped");
    }
    assert.deepEqual(state.centerColor, [91, 102, 241], "The isolated data point is painted in its series color");
    assert.deepEqual(state.sideColor, [91, 102, 241], "The marker has visible area beyond a line-sized stroke");
  }
  async function markerLocation(index = -1) {
    return canvas.evaluate((element, index) => {
      const marker = element.graphMarkers.at(index);
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left + marker.horizontal * bounds.width / parseFloat(element.style.width), y: bounds.top + marker.vertical * bounds.height / parseFloat(element.style.height) };
    }, index);
  }
  async function checkTooltipBounds(tooltip) {
    const bounds = await tooltip.boundingBox();
    const plot = await scroller.boundingBox();
    assert.ok(bounds.x >= plot.x && bounds.y >= plot.y && bounds.x + bounds.width <= plot.x + plot.width + 1 && bounds.y + bounds.height <= plot.y + plot.height + 1, "Point details stay inside the plot viewport");
    assert.equal(await tooltip.evaluate(element => element.scrollWidth <= element.clientWidth), true, "Long series names and values do not overflow the tooltip");
  }
  async function checkPointHover() {
    const location = await markerLocation();
    const before = await canvas.evaluate(element => element.graphDrawCount);
    await viewer.mouse.move(location.x, location.y);
    const tooltip = viewer.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByTestId("graph-point-series")).toHaveText(lineSeries.at(-1).name);
    await expect(tooltip.getByTestId("graph-point-x")).toHaveText("1.75");
    await expect(tooltip.getByTestId("graph-point-y")).toHaveText("3.4");
    await expect(tooltip).toContainText("Request rate (requests/s)");
    await expect(tooltip).toContainText("Normalized latency (s/token)");
    await checkTooltipBounds(tooltip);
    await viewer.screenshot({ path: path.join(output, `graph-point-hover-${viewer.viewportSize().width}.png`) });
    const tooltipBounds = await tooltip.boundingBox();
    await viewer.mouse.move(tooltipBounds.x + 12, tooltipBounds.y + 12);
    await expect(tooltip).toBeVisible();
    await viewer.mouse.move(location.x, location.y);
    await viewer.mouse.click(location.x, location.y);
    const details = viewer.getByRole("dialog", { name: "Data point details", exact: true });
    await expect(details).toBeVisible();
    await viewer.mouse.move(0, 0);
    await expect(details).toBeVisible();
    await checkTooltipBounds(details);
    await checkStableFrames();
    assert.equal(await canvas.evaluate(element => element.graphDrawCount), before, "Inspecting or pinning values does not repaint the chart");
    await details.getByRole("button", { name: "Close data point", exact: true }).click();
    await expect(details).toHaveCount(0);
    await viewer.mouse.move(location.x, location.y);
    await expect(tooltip).toBeVisible();
    await canvas.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await viewer.mouse.move(0, 0);
    await viewer.mouse.move(location.x, location.y);
    await expect(tooltip).toBeVisible();
    await viewer.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);
  }
  await expect(canvas).toBeVisible();
  const calls = getModelCalls();
  for (const width of [1800, 1440, 768, 390]) {
    await viewer.setViewportSize({ width, height: 1000 });
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate(element => element.graphViewportWidth === element.parentElement.clientWidth && element.graphViewportHeight === element.parentElement.clientHeight)).toBe(true);
    await expect.poll(() => canvas.evaluate(element => Math.abs(parseFloat(element.style.height) - element.parentElement.clientHeight) < 2)).toBe(true);
    await checkStableFrames();
    assert.equal(await canvas.evaluate(element => element.graphMarkers.length), 0, "Bar charts do not gain point markers");
    const state = await canvas.evaluate(element => ({ width: element.width, height: element.height, draws: element.graphText }));
    assert.ok(state.draws.length > labels.length * 2, "Labels are wrapped into readable lines");
    assert.equal(state.draws.filter(item => item.text === "construction").length, 2);
    assert.ok(state.draws.some(item => item.text === "Metric and method"));
    for (const [index, text] of state.draws.entries()) {
      assert.ok(text.left >= -1 && text.top >= -1 && text.right <= state.width + 1 && text.bottom <= state.height + 1, `Text stays inside the canvas: ${text.text}`);
      for (const other of state.draws.slice(index + 1)) {
        const overlaps = text.left < other.right - 1 && text.right > other.left + 1 && text.top < other.bottom - 1 && text.bottom > other.top + 1;
        assert.equal(overlaps, false, `Canvas text overlaps: ${text.text} / ${other.text}`);
      }
    }
    const pixels = await sharp(await scroller.screenshot()).stats();
    assert.ok(pixels.channels.some(channel => channel.stdev > 10), "Chart contains visible bars");
    await viewer.screenshot({ path: path.join(output, `graph-labels-${width}.png`) });
    assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) {
      const scroll = await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; return { left: element.scrollLeft, max: element.scrollWidth - element.clientWidth }; });
      assert.ok(scroll.left > 0 && Math.abs(scroll.left - scroll.max) <= 1, "The final category can be reached through local scrolling");
      await viewer.screenshot({ path: path.join(output, "graph-labels-mobile-end.png") });
      const bar = await canvas.evaluate(element => {
        const last = element.graphBars.at(-1);
        const bounds = element.getBoundingClientRect();
        return { x: bounds.left + last.horizontal + last.width / 2, y: bounds.top + last.vertical + Math.min(10, last.height / 2) };
      });
      await viewer.mouse.move(bar.x, bar.y);
      await expect(viewer.getByRole("tooltip").getByTestId("graph-point-x")).toHaveText("HNSW construction speed");
      await expect(viewer.getByRole("tooltip").getByTestId("graph-point-y")).toHaveText("4");
      await checkTooltipBounds(viewer.getByRole("tooltip"));
      await viewer.mouse.click(bar.x, bar.y);
      await expect(viewer.getByRole("dialog", { name: "Data point details" })).toBeVisible();
      await scroller.evaluate(element => { element.scrollLeft = 0; });
      await expect(viewer.getByRole("dialog", { name: "Data point details" })).toHaveCount(0);
      await viewer.mouse.move(0, 0);
      await canvas.focus();
      await canvas.press("End");
      await expect(viewer.getByRole("dialog", { name: "Data point details" }).getByTestId("graph-point-x")).toHaveText("HNSW construction speed");
      const keyboardFrames = await checkStableFrames();
      assert.equal(await viewer.getByRole("dialog", { name: "Data point details" }).isVisible(), true, `Keyboard inspection must stay open: ${JSON.stringify(keyboardFrames.filter((frame, index) => index === 0 || JSON.stringify(frame) !== JSON.stringify(keyboardFrames[index - 1])))}`);
      await canvas.press("Home");
      await expect(viewer.getByRole("dialog", { name: "Data point details" }).getByTestId("graph-point-x")).toHaveText("NSW peak RAM");
      await canvas.press("Escape");
    }
  }
  await viewer.getByRole("combobox", { name: "Saved visualization version", exact: true }).selectOption("points");
  await expect(canvas).toHaveAttribute("aria-label", "Resize points chart");
  for (const width of [1440, 390]) {
    await viewer.setViewportSize({ width, height: 901 });
    await expect.poll(() => canvas.evaluate(element => Math.abs(parseFloat(element.style.width) - element.parentElement.clientWidth) < 2)).toBe(true);
    await expect.poll(() => canvas.evaluate(element => Math.abs(parseFloat(element.style.height) - element.parentElement.clientHeight) < 2)).toBe(true);
    assert.equal(await canvas.evaluate(element => element.graphMarkers.length), 3, "Scatter points retain their existing dots");
    const scatter = await markerLocation(1);
    await viewer.mouse.move(scatter.x, scatter.y);
    await expect(viewer.getByRole("tooltip").getByTestId("graph-point-x")).toHaveText("1");
    await expect(viewer.getByRole("tooltip").getByTestId("graph-point-y")).toHaveText("2");
    await viewer.mouse.move(0, 0);
    const pixels = await sharp(await scroller.screenshot()).stats();
    assert.ok(pixels.channels.some(channel => channel.stdev > 1), "Point chart remains nonblank after resize");
  }
  const versions = viewer.getByRole("combobox", { name: "Saved visualization version", exact: true });
  await versions.selectOption("lines");
  const legend = viewer.getByRole("region", { name: "Graph legend", exact: true });
  await expect(legend).toBeVisible();
  await expect(legend.getByRole("listitem")).toHaveCount(lineSeries.length);
  for (const width of [1800, 1440, 768, 390]) {
    await viewer.setViewportSize({ width, height: 901 });
    await expect.poll(() => canvas.evaluate(element => element.graphViewportWidth === element.parentElement.clientWidth && element.graphViewportHeight === element.parentElement.clientHeight)).toBe(true);
    await checkStableFrames();
    await checkLineMarkers();
    await checkPointHover();
    await legend.evaluate(element => { element.scrollTop = 0; });
    const geometry = await legend.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const plot = element.nextElementSibling.getBoundingClientRect();
      const parent = element.parentElement.getBoundingClientRect();
      return { noOverflow: element.scrollWidth <= element.clientWidth, separated: bounds.bottom <= plot.top + 1, bounded: bounds.height <= parent.height * 0.32 + 1, plotHeight: plot.height, entries: [...element.querySelectorAll("li")].map(item => {
        const text = item.lastElementChild;
        const range = document.createRange();
        range.selectNodeContents(text);
        const itemBounds = item.getBoundingClientRect();
        const textBounds = text.getBoundingClientRect();
        const swatch = item.firstElementChild.getBoundingClientRect();
        return { name: text.textContent, color: getComputedStyle(item.firstElementChild).backgroundColor, contained: [...range.getClientRects()].every(rect => rect.left >= textBounds.left - 1 && rect.right <= textBounds.right + 1 && rect.top >= itemBounds.top - 1 && rect.bottom <= itemBounds.bottom + 1), separated: swatch.right <= textBounds.left, left: itemBounds.left, right: itemBounds.right, top: itemBounds.top, bottom: itemBounds.bottom };
      }) };
    });
    assert.ok(geometry.noOverflow && geometry.separated && geometry.bounded);
    assert.ok(geometry.plotHeight >= 200, "The legend leaves usable space for the plot");
    assert.deepEqual(geometry.entries.map(entry => entry.name), lineSeries.map(series => series.name));
    for (const [index, entry] of geometry.entries.entries()) {
      assert.ok(entry.contained && entry.separated, `Full legend label fits beside its swatch: ${index}`);
      assert.equal(entry.color, ["rgb(156, 163, 175)", "rgb(245, 158, 11)", "rgb(239, 68, 68)", "rgb(91, 102, 241)"][index % 4]);
      for (const other of geometry.entries.slice(index + 1)) assert.equal(entry.left < other.right - 1 && entry.right > other.left + 1 && entry.top < other.bottom - 1 && entry.bottom > other.top + 1, false, "Legend entries never overlap");
    }
    const draws = await canvas.evaluate(element => element.graphText);
    assert.ok(!draws.some(draw => lineSeries.some(series => series.name === draw.text)), "Legend labels are not drawn over the plot");
    const dimensions = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
    for (const draw of draws) assert.ok(draw.left >= -1 && draw.top >= -1 && draw.right <= dimensions.width + 1 && draw.bottom <= dimensions.height + 1, `Line-chart text is not clipped: ${draw.text}`);
    const pixels = await sharp(await scroller.screenshot()).stats();
    assert.ok(pixels.channels.some(channel => channel.stdev > 5), "Line chart remains nonblank below the legend");
    assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await viewer.screenshot({ path: path.join(output, `graph-legend-${width}.png`) });
    await legend.focus();
    await legend.press("Control+End");
    await expect.poll(() => legend.evaluate(element => element.scrollTop > 0 && Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2)).toBe(true);
    await expect(legend.getByRole("listitem").last()).toBeInViewport();
  }
  await viewer.screenshot({ path: path.join(output, "graph-legend-mobile-end.png") });
  await viewer.evaluate(() => document.documentElement.classList.add("dark"));
  await expect.poll(() => canvas.evaluate(element => [...element.getContext("2d").getImageData(0, 0, 1, 1).data].slice(0, 3).join(","))).toBe("26,26,31");
  await expect(legend).toBeVisible();
  await checkLineMarkers(true);
  await checkPointHover();
  await viewer.screenshot({ path: path.join(output, "graph-legend-mobile-dark.png") });
  await viewer.evaluate(() => document.documentElement.classList.remove("dark"));
  await versions.selectOption("bars");
  await expect(legend).toHaveCount(0);
  await versions.selectOption("lines");
  await expect(legend.getByRole("listitem")).toHaveCount(lineSeries.length);
  await viewer.reload();
  await expect(legend.getByRole("listitem")).toHaveCount(lineSeries.length);
  await checkStableFrames();
  await checkLineMarkers();
  await viewer.getByRole("tab", { name: "Document", exact: true }).click();
  await viewer.getByRole("tab", { name: "Study", exact: true }).click();
  await expect(canvas).toBeVisible();
  await checkStableFrames();
  const overlap = await markerLocation(0);
  await viewer.mouse.click(overlap.x, overlap.y);
  const details = viewer.getByRole("dialog", { name: "Data point details", exact: true });
  await expect(details.getByTestId("graph-point-series")).toHaveText(lineSeries[1].name);
  await details.getByRole("combobox", { name: "Nearby data point", exact: true }).selectOption("0");
  await expect(details.getByTestId("graph-point-series")).toHaveText(lineSeries[0].name);
  await expect(details.getByTestId("graph-point-x")).toHaveText("0.5");
  await expect(details.getByTestId("graph-point-y")).toHaveText("0.1");
  await legend.click({ position: { x: 6, y: 6 } });
  await expect(details).toHaveCount(0);
  await canvas.focus();
  await canvas.press("Home");
  await expect(details.getByTestId("graph-point-x")).toHaveText("0.5");
  await canvas.press("ArrowRight");
  await expect(details.getByTestId("graph-point-x")).toHaveText("1");
  await canvas.press("End");
  await expect(details.getByTestId("graph-point-x")).toHaveText("1.75");
  await canvas.press("Escape");
  await expect(details).toHaveCount(0);
  await canvas.press("Enter");
  await expect(details).toBeVisible();
  await viewer.setViewportSize({ width: 768, height: 902 });
  await expect(details).toHaveCount(0);
  await canvas.focus();
  await canvas.press("Enter");
  await versions.selectOption("points");
  await expect(details).toHaveCount(0);
  await versions.selectOption("lines");

  const touchContext = await context.browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  try {
    const touchViewer = await touchContext.newPage();
    await touchViewer.goto(`${origin}/viewer/${docId}`);
    const touchCanvas = touchViewer.getByTestId("graph-canvas");
    await expect(touchCanvas).toBeVisible();
    await expect.poll(() => touchCanvas.evaluate(element => parseFloat(element.style.width) > 0)).toBe(true);
    const location = await touchCanvas.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const width = parseFloat(element.style.width);
      const height = parseFloat(element.style.height);
      const padding = (3.4 - 0.1) * 0.07;
      return { x: bounds.left + (50 + (1.75 - 0.5) / 1.5 * (width - 70)) * bounds.width / width, y: bounds.top + (20 + (height - 60) * padding / (3.4 - 0.1 + 2 * padding)) * bounds.height / height };
    });
    await touchViewer.touchscreen.tap(location.x, location.y);
    const touchDetails = touchViewer.getByRole("dialog", { name: "Data point details", exact: true });
    await expect(touchDetails.getByTestId("graph-point-x")).toHaveText("1.75");
    await expect(touchDetails.getByTestId("graph-point-y")).toHaveText("3.4");
    assert.equal(await touchViewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await touchViewer.screenshot({ path: path.join(output, "graph-point-touch.png") });
    await touchDetails.getByRole("button", { name: "Close data point", exact: true }).tap();
    await expect(touchDetails).toHaveCount(0);
  } finally { await touchContext.close(); }
  assert.equal(getModelCalls(), calls, "Graph resizing and saved-version switching need no AI calls");
  await viewer.close();
  console.log("Graph inspection: exact hover values, click/tap pinning, overlap selection, keyboard navigation, bounded tooltips, no extra redraws/model calls, and existing marker/layout/stability regressions passed.");
}