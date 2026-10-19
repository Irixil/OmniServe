export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 100) return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
    return timeZone;
  } catch {
    return '';
  }
}

export function getTimeZoneOffsetMinutes(timeZone: unknown, at: Date): number | null {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized || Number.isNaN(at.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalized, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(at);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    return (localAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
  } catch {
    return null;
  }
}

export function getTimeZoneDifferenceMinutes(customerTimeZone: unknown, staffTimeZone: unknown, at: Date): number | null {
  const customerOffset = getTimeZoneOffsetMinutes(customerTimeZone, at);
  const staffOffset = getTimeZoneOffsetMinutes(staffTimeZone, at);
  return customerOffset === null || staffOffset === null ? null : customerOffset - staffOffset;
}

export function formatTimeZoneDateTime(timeZone: unknown, at: Date, locale = 'en'): string {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized || Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: normalized, dateStyle: 'medium', timeStyle: 'short',
    }).format(at);
  } catch {
    return '';
  }
}
