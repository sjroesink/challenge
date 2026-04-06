import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentDay, START_DATE } from '../src/day.js';

describe('getCurrentDay', () => {
  it('returns 1 on April 1 2026', () => {
    const april1 = new Date('2026-04-01T12:00:00+02:00');
    assert.equal(getCurrentDay(april1), 1);
  });

  it('returns 6 on April 6 2026', () => {
    const april6 = new Date('2026-04-06T15:00:00+02:00');
    assert.equal(getCurrentDay(april6), 6);
  });

  it('returns 1 on April 1 at midnight Amsterdam time', () => {
    const midnight = new Date('2026-04-01T00:00:00+02:00');
    assert.equal(getCurrentDay(midnight), 1);
  });

  it('returns 2 on April 2 at 00:01 Amsterdam time', () => {
    const justAfterMidnight = new Date('2026-04-02T00:01:00+02:00');
    assert.equal(getCurrentDay(justAfterMidnight), 2);
  });

  it('handles late night UTC that is next day in Amsterdam (CEST)', () => {
    // April 5 at 23:00 UTC = April 6 at 01:00 CEST
    const lateUtc = new Date('2026-04-05T23:00:00Z');
    assert.equal(getCurrentDay(lateUtc), 6);
  });
});
