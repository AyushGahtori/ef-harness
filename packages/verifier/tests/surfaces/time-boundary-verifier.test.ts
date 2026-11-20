import { describe, expect, it } from "vitest";
import { TimeBoundaryVerifier } from "../../src/surfaces/time-boundary-verifier.js";
import {
  formatZoneParts,
  resolveCivilInstants,
  cutoffDecision,
  parseClockTime,
} from "../../src/surfaces/zone-clock.js";
import type { CivilTime } from "../../src/surfaces/zone-clock.js";
import { listen, readBody, sendJson, verifierContext } from "./support.js";

const spec = {
  checkId: "time.cutoff",
  timeZone: "Europe/Berlin",
  cutoffLocalTime: "10:45:00",
  inclusive: true,
  calendarDate: "2026-01-15",
  summerDate: "2026-07-15",
  evaluatePath: "/time/evaluate",
  civilPath: "/time/civil",
  springGap: { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
  fallOverlap: { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
};

type Mode = "pass" | "exclusive" | "fixed-offset" | "dst-broken";

function fixedOffset(instant: Date): CivilTime {
  const shifted = new Date(instant.getTime() + 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

async function startTime(mode: Mode) {
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = JSON.parse((await readBody(request)) || "{}") as {
      timeZone?: string;
      civil?: CivilTime;
    };
    const zone = body.timeZone ?? "Europe/Berlin";
    if (url.pathname === "/time/civil") {
      if (mode === "dst-broken") {
        sendJson(response, 200, { exists: true, instants: ["2026-03-29T01:30:00.000Z"] });
        return;
      }
      const instants = resolveCivilInstants(body.civil as CivilTime, zone);
      sendJson(response, 200, {
        exists: instants.length > 0,
        instants: instants.map((instant) => instant.toISOString()),
      });
      return;
    }
    const header = request.headers["x-test-clock"];
    const clock = Array.isArray(header) ? header[0] : header;
    const instant = new Date(clock ?? "");
    const display = mode === "fixed-offset" ? fixedOffset(instant) : formatZoneParts(instant, zone);
    const cutoff = parseClockTime("10:45:00");
    const inclusive = mode !== "exclusive";
    const accepted =
      mode === "exclusive"
        ? display.hour * 3600 + display.minute * 60 + display.second <
          cutoff.hour * 3600 + cutoff.minute * 60 + cutoff.second
        : cutoffDecision(display, cutoff, inclusive);
    sendJson(response, 200, {
      storedUtc: instant.toISOString(),
      display: { ...display, timeZone: zone },
      accepted,
      exists: true,
    });
  });
}

describe("TimeBoundaryVerifier", () => {
  it("resolves Europe/Berlin cutoff and daylight-saving instants from IANA rules", () => {
    expect(resolveCivilInstants({ year: 2026, month: 1, day: 15, hour: 10, minute: 45, second: 0 }, "Europe/Berlin")[0]?.toISOString()).toBe(
      "2026-01-15T09:45:00.000Z",
    );
    expect(resolveCivilInstants({ year: 2026, month: 7, day: 15, hour: 10, minute: 45, second: 0 }, "Europe/Berlin")[0]?.toISOString()).toBe(
      "2026-07-15T08:45:00.000Z",
    );
    expect(resolveCivilInstants({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 }, "Europe/Berlin")).toEqual([]);
    expect(
      resolveCivilInstants({ year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 }, "Europe/Berlin").map((instant) =>
        instant.toISOString(),
      ),
    ).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
  });

  it("passes one second before, at, and after 10:45:00 Europe/Berlin plus both DST edges", async () => {
    const server = await startTime("pass");
    const started = Date.now();
    try {
      const results = await new TimeBoundaryVerifier().verify(spec, verifierContext(server.url));
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(results.every((result) => result.status === "pass")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("catches an off-by-one < comparison at the inclusive 10:45:00 cutoff", async () => {
    const server = await startTime("exclusive");
    try {
      const results = await new TimeBoundaryVerifier().verify(spec, verifierContext(server.url));
      const at = results.find((result) => result.check_id === "time.cutoff:at");
      expect(at?.status).toBe("fail");
      expect(at?.message).toContain("accepted");
    } finally {
      await server.close();
    }
  });

  it("catches a fixed UTC+1 display during summer time and broken DST transitions", async () => {
    const fixed = await startTime("fixed-offset");
    const broken = await startTime("dst-broken");
    try {
      const fixedResults = await new TimeBoundaryVerifier().verify(spec, verifierContext(fixed.url));
      const brokenResults = await new TimeBoundaryVerifier().verify(spec, verifierContext(broken.url));
      expect(fixedResults.find((result) => result.check_id === "time.cutoff:summer")?.status).toBe("fail");
      expect(brokenResults.find((result) => result.check_id === "time.cutoff:dst-spring")?.status).toBe("fail");
      expect(brokenResults.find((result) => result.check_id === "time.cutoff:dst-fall")?.status).toBe("fail");
    } finally {
      await fixed.close();
      await broken.close();
    }
  });
});
