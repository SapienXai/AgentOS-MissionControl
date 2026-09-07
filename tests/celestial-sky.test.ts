import assert from "node:assert/strict";
import { test } from "node:test";

import { getCelestialSkyAtMinute } from "@/lib/agentos/celestial-sky";

test("celestial sky follows the local day without abrupt palette jumps", () => {
  const before = getCelestialSkyAtMinute(329.9);
  const after = getCelestialSkyAtMinute(330.1);

  assert.equal(before.label, "First light");
  assert.equal(after.label, "First light");
  assert.match(after.top, /^rgb\(/);
  assert.ok(Math.abs(after.sunX - before.sunX) < 0.1);
});

test("celestial bodies travel across separate daylight and night arcs", () => {
  const sunrise = getCelestialSkyAtMinute(360);
  const noon = getCelestialSkyAtMinute(750);
  const midnight = getCelestialSkyAtMinute(0);

  assert.ok(sunrise.sunOpacity > 0.9);
  assert.ok(noon.sunY < sunrise.sunY);
  assert.equal(noon.daylight, 1);
  assert.equal(midnight.daylight, 0);
  assert.equal(noon.starOpacity, 0);
  assert.ok(midnight.moonOpacity > 0.9);
  assert.ok(midnight.starOpacity > 0.5);
});

test("stars emerge gradually through late afternoon and sunset", () => {
  const afternoon = getCelestialSkyAtMinute(990);
  const goldenHour = getCelestialSkyAtMinute(1110);
  const sunset = getCelestialSkyAtMinute(1200);
  const blueHour = getCelestialSkyAtMinute(1290);

  assert.ok(afternoon.starOpacity > 0);
  assert.ok(goldenHour.starOpacity > afternoon.starOpacity);
  assert.ok(sunset.starOpacity > goldenHour.starOpacity);
  assert.ok(blueHour.starOpacity > sunset.starOpacity);
});

test("celestial sky wraps safely across midnight", () => {
  assert.deepEqual(getCelestialSkyAtMinute(-1), getCelestialSkyAtMinute(1439));
  assert.deepEqual(getCelestialSkyAtMinute(1441), getCelestialSkyAtMinute(1));
});
