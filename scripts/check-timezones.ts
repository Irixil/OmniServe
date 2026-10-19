import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  formatTimeZoneDateTime, getTimeZoneDifferenceMinutes, getTimeZoneOffsetMinutes, normalizeTimeZone,
} from '../lib/timezones.ts';

const at = (value: string) => new Date(`${value}T12:00:00.000Z`);
const offset = (zone: string, date: string) => getTimeZoneOffsetMinutes(zone, at(date));

assert.equal(offset('America/New_York', '2026-01-15'), -300);
assert.equal(offset('America/New_York', '2026-07-15'), -240);
assert.equal(offset('Europe/London', '2026-01-15'), 0);
assert.equal(offset('Europe/London', '2026-07-15'), 60);
assert.equal(offset('Australia/Melbourne', '2026-01-15'), 660);
assert.equal(offset('Australia/Melbourne', '2026-07-15'), 600);
assert.equal(offset('Australia/Brisbane', '2026-01-15'), 600);
assert.equal(offset('Australia/Brisbane', '2026-07-15'), 600);
assert.equal(offset('Asia/Dubai', '2026-01-15'), 240);
assert.equal(offset('Asia/Kuala_Lumpur', '2026-01-15'), 480);
assert.equal(offset('Australia/Adelaide', '2026-01-15'), 630);
assert.equal(offset('Australia/Adelaide', '2026-07-15'), 570);
assert.equal(offset('Asia/Kathmandu', '2026-01-15'), 345);
assert.equal(getTimeZoneDifferenceMinutes('Australia/Melbourne', 'Europe/London', at('2026-01-15')), 660);
assert.equal(getTimeZoneDifferenceMinutes('America/New_York', 'Europe/London', at('2026-07-15')), -300);
assert.equal(getTimeZoneDifferenceMinutes('Asia/Dubai', 'Asia/Kuala_Lumpur', new Date('2026-01-01T10:30:00Z')), -240);
assert.match(formatTimeZoneDateTime('America/New_York', new Date('2026-01-01T02:00:00Z'), 'en-US'), /Dec 31, 2025/);
assert.equal(normalizeTimeZone('not/a-time-zone'), '');
assert.equal(normalizeTimeZone(''), '');
assert.equal(getTimeZoneOffsetMinutes('', at('2026-01-15')), null);
assert.equal(formatTimeZoneDateTime('invalid', at('2026-01-15')), '');

// Exercise the same add-if-missing migration shape on a legacy row twice.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
  INSERT INTO conversations VALUES ('legacy', '2026-01-01T00:00:00.000Z');`);
function addTimeZoneColumns() {
  const columns = new Set(sqlite.prepare('PRAGMA table_info(conversations)').all().map((column) => column.name));
  if (!columns.has('client_timezone')) sqlite.exec("ALTER TABLE conversations ADD COLUMN client_timezone TEXT NOT NULL DEFAULT ''");
  if (!columns.has('client_timezone_source')) sqlite.exec("ALTER TABLE conversations ADD COLUMN client_timezone_source TEXT NOT NULL DEFAULT ''");
}
addTimeZoneColumns();
addTimeZoneColumns();
assert.deepEqual({ ...sqlite.prepare("SELECT client_timezone, client_timezone_source FROM conversations WHERE id = 'legacy'").get() }, {
  client_timezone: '', client_timezone_source: '',
}, 'migration is repeatable and leaves legacy timezone values blank');
sqlite.exec("INSERT INTO conversations (id, created_at, client_timezone, client_timezone_source) VALUES ('new', '2026-01-01T00:00:00.000Z', 'America/New_York', 'browser')");
sqlite.exec("UPDATE conversations SET client_timezone = 'Asia/Dubai', client_timezone_source = 'customer' WHERE id = 'new'");
assert.deepEqual({ ...sqlite.prepare("SELECT client_timezone, client_timezone_source FROM conversations WHERE id = 'new'").get() }, {
  client_timezone: 'Asia/Dubai', client_timezone_source: 'customer',
}, 'customer-selected timezone overrides browser detection');
sqlite.close();

console.log('Timezone helper and migration checks passed.');
