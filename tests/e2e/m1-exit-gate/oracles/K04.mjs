function berlinParts(iso) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(iso))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function nextCutoffInstant(date, options) {
  const cutoff = options?.cutoff ?? "10:45";
  const zone = options?.timeZone ?? "Europe/Berlin";
  if (zone !== "Europe/Berlin") throw new Error("unsupported zone");
  const minute = cutoff.slice(3);
  for (const utcHour of ["08", "09"]) {
    const iso = `${date}T${utcHour}:${minute}:00.000Z`;
    const parts = berlinParts(iso);
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    if (ymd === date && parts.hour === 10 && parts.minute === 45 && parts.second === 0) return iso;
  }
  throw new Error("cutoff not found");
}
