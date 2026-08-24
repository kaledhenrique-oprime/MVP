const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

function businessDate(input = new Date()) {
  const value = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function businessClockMinutes(input = new Date()) {
  const value = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(byType.hour) * 60 + Number(byType.minute);
}

function isShiftCurrent(shift, startTime, input = new Date()) {
  if (!shift || shift.endedAt) return false;
  const value = input instanceof Date ? input : new Date(input);
  const today = businessDate(value);
  if (shift.date === today) return true;
  const previousDay = businessDate(new Date(value.getTime() - 24 * 60 * 60 * 1000));
  const [hour, minute] = String(startTime || "00:00").split(":").map(Number);
  const endMinutes = hour * 60 + minute + 6 * 60;
  return endMinutes > 24 * 60 && shift.date === previousDay && businessClockMinutes(value) < endMinutes - 24 * 60;
}

module.exports = { BUSINESS_TIME_ZONE, businessDate, businessClockMinutes, isShiftCurrent };
