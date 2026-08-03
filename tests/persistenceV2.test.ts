import { describe, it, expect } from 'vitest';
import { checksumOf, makeEnvelope, envelopeValid, SCHEMA_VERSION } from '../src/persistence/persistenceV2.ts';
import { defaultSave } from '../src/persistence/save.ts';
import { RULES_VERSION } from '../src/core/constants.ts';

describe('persistence v2 envelopes', () => {
  it('stamps schema, rules version, revision, and a checksum that verifies', () => {
    const env = makeEnvelope(defaultSave(), 3, '1.0.0');
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.rulesVersion).toBe(RULES_VERSION);
    expect(env.revision).toBe(3);
    expect(envelopeValid(env)).toBe(true);
  });

  it('rejects a tampered or truncated payload — that is the whole point of the checksum', () => {
    const env = makeEnvelope(defaultSave(), 1);
    (env.payload as { records: { wins: number } }).records.wins = 999;   // corrupt after sealing
    expect(envelopeValid(env)).toBe(false);
    expect(envelopeValid(null)).toBe(false);
    expect(envelopeValid({ revision: 2 })).toBe(false);
    expect(envelopeValid({ ...makeEnvelope(defaultSave(), 2), checksum: 'deadbeef' })).toBe(false);
  });

  it('checksums are stable for identical payloads and differ for different ones', () => {
    const a = defaultSave();
    const b = defaultSave();
    expect(checksumOf(a)).toBe(checksumOf(b));
    b.records.wins = 1;
    expect(checksumOf(a)).not.toBe(checksumOf(b));
  });
});
