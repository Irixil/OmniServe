export type TimeZoneOption = { value: string; label: string };
export type TimeZoneGroup = { label: string; options: TimeZoneOption[] };

export const TIME_ZONE_GROUPS: TimeZoneGroup[] = [
  { label: 'United States', options: [
    { value: 'America/New_York', label: 'Eastern — New York, Boston, Washington, Miami' },
    { value: 'America/Chicago', label: 'Central — Chicago, Dallas, Houston, Austin' },
    { value: 'America/Denver', label: 'Mountain — Denver' },
    { value: 'America/Phoenix', label: 'Arizona — Phoenix' },
    { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles, San Francisco, Seattle' },
    { value: 'America/Anchorage', label: 'Alaska — Anchorage' },
    { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' },
  ] },
  { label: 'United Kingdom', options: [{ value: 'Europe/London', label: 'London, Manchester, Birmingham' }] },
  { label: 'Australia', options: [
    { value: 'Australia/Melbourne', label: 'Melbourne' }, { value: 'Australia/Sydney', label: 'Sydney' },
    { value: 'Australia/Brisbane', label: 'Brisbane' }, { value: 'Australia/Perth', label: 'Perth' },
    { value: 'Australia/Adelaide', label: 'Adelaide' }, { value: 'Australia/Darwin', label: 'Darwin' },
    { value: 'Australia/Hobart', label: 'Hobart' },
  ] },
  { label: 'New Zealand', options: [{ value: 'Pacific/Auckland', label: 'Auckland, Wellington' }] },
  { label: 'United Arab Emirates', options: [{ value: 'Asia/Dubai', label: 'Dubai, Abu Dhabi' }] },
  { label: 'Saudi Arabia', options: [{ value: 'Asia/Riyadh', label: 'Riyadh, Jeddah' }] },
  { label: 'Qatar', options: [{ value: 'Asia/Qatar', label: 'Doha' }] },
  { label: 'Malaysia', options: [
    { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur, Penang, Johor Bahru' },
    { value: 'Asia/Kuching', label: 'Kuching, Kota Kinabalu' },
  ] },
  { label: 'Singapore', options: [{ value: 'Asia/Singapore', label: 'Singapore' }] },
  { label: 'East & Southeast Asia', options: [
    { value: 'Asia/Shanghai', label: 'China — Beijing, Shanghai, Shenzhen' }, { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Taipei', label: 'Taiwan — Taipei' }, { value: 'Asia/Tokyo', label: 'Japan — Tokyo' },
    { value: 'Asia/Seoul', label: 'South Korea — Seoul' }, { value: 'Asia/Bangkok', label: 'Thailand — Bangkok' },
    { value: 'Asia/Jakarta', label: 'Indonesia — Jakarta' }, { value: 'Asia/Manila', label: 'Philippines — Manila' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Vietnam — Hanoi, Ho Chi Minh City' },
  ] },
  { label: 'India', options: [{ value: 'Asia/Kolkata', label: 'Mumbai, Delhi, Bengaluru' }] },
  { label: 'Canada', options: [
    { value: 'America/Toronto', label: 'Toronto' }, { value: 'America/Vancouver', label: 'Vancouver' },
    { value: 'America/Edmonton', label: 'Calgary' },
  ] },
  { label: 'Europe', options: [
    { value: 'Europe/Paris', label: 'France — Paris' }, { value: 'Europe/Berlin', label: 'Germany — Berlin, Munich' },
    { value: 'Europe/Amsterdam', label: 'Netherlands — Amsterdam' }, { value: 'Europe/Copenhagen', label: 'Denmark — Copenhagen' },
    { value: 'Europe/Oslo', label: 'Norway — Oslo' }, { value: 'Europe/Stockholm', label: 'Sweden — Stockholm' },
    { value: 'Europe/Zurich', label: 'Switzerland — Zurich' }, { value: 'Europe/Madrid', label: 'Spain — Madrid, Barcelona' },
    { value: 'Europe/Rome', label: 'Italy — Milan, Rome' }, { value: 'Europe/Lisbon', label: 'Portugal — Lisbon' },
    { value: 'Europe/Istanbul', label: 'Turkey — Istanbul' },
  ] },
  { label: 'Other regions', options: [
    { value: 'Africa/Johannesburg', label: 'South Africa — Johannesburg, Cape Town' },
    { value: 'America/Sao_Paulo', label: 'Brazil — São Paulo' }, { value: 'America/Mexico_City', label: 'Mexico — Mexico City' },
    { value: 'Etc/UTC', label: 'UTC' },
  ] },
];

export const TIME_ZONE_LABELS = new Map(TIME_ZONE_GROUPS.flatMap((group) => group.options.map(({ value, label }) => [value, label] as const)));

