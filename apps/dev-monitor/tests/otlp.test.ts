import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodeLogsBody,
  decodeLogsProtobuf,
  encodingFor,
  flattenLogsRequest,
  OtlpBodyTooLargeError,
} from '../src/otlp';

// ---------- a tiny protobuf writer (test only) ----------
function varint(value: bigint | number): number[] {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}
const tag = (no: number, wire: number) => varint((no << 3) | wire);
const len = (no: number, bytes: number[]) => [...tag(no, 2), ...varint(bytes.length), ...bytes];
const str = (no: number, s: string) => len(no, [...Buffer.from(s, 'utf8')]);
const vint = (no: number, v: bigint | number) => [...tag(no, 0), ...varint(v)];
const fixed64 = (no: number, v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return [...tag(no, 1), ...b];
};
const double = (no: number, v: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v);
  return [...tag(no, 1), ...b];
};
const kv = (key: string, anyValue: number[]) => [...str(1, key), ...len(2, anyValue)];

function protobufRequest(): Uint8Array {
  const record = [
    ...fixed64(1, 1_793_405_920_261_000_000n),
    ...vint(2, 17),
    ...str(3, 'ERROR'),
    ...len(5, str(1, 'boom')),
    ...len(6, kv('n', vint(3, -3))),
    ...len(6, kv('ok', vint(2, 1))),
    ...len(6, kv('ratio', double(4, 0.5))),
    ...len(6, kv('list', len(5, [...len(1, str(1, 'a')), ...len(1, vint(3, 2))]))),
    ...len(6, kv('map', len(6, len(1, kv('inner', str(1, 'x')))))),
    ...len(9, [...Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex')]),
    ...str(12, 'studio.crash'),
  ];
  const scopeLogs = [...len(1, [...str(1, 'studio.dev'), ...str(2, '0.1.0')]), ...len(2, record)];
  const resource = len(1, len(1, kv('service.name', str(1, 'studio-electron-main'))));
  return new Uint8Array(len(1, [...resource, ...len(2, scopeLogs)]));
}

const jsonRequest = {
  resourceLogs: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'studio-next' } }],
      },
      scopeLogs: [
        {
          scope: { name: 'studio.next', version: '1' },
          logRecords: [
            {
              timeUnixNano: '1793405920261000000',
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: 'hello' },
              attributes: [
                { key: 'n', value: { intValue: 3 } },
                { key: 's', value: { intValue: '4' } },
                { key: 'b', value: { boolValue: false } },
              ],
            },
            {
              observedTimeUnixNano: '2000000',
              body: { kvlistValue: { values: [{ key: 'a', value: { intValue: 1 } }] } },
            },
          ],
        },
      ],
    },
  ],
};

describe('OTLP/JSON', () => {
  it('flattens records with resource, scope, attributes and times', () => {
    const [first, second] = flattenLogsRequest(jsonRequest, 42);
    expect(first).toMatchObject({
      service: 'studio-next',
      scope: 'studio.next',
      timeMs: 1_793_405_920_261,
      severityNumber: 9,
      severityText: 'INFO',
      body: 'hello',
      attributes: { n: 3, s: 4, b: false },
    });
    expect(second).toMatchObject({ timeMs: 2, severityNumber: 0, body: '{"a":1}' });
  });

  it('falls back to now and unknown_service', () => {
    const [record] = flattenLogsRequest(
      { resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }] },
      7,
    );
    expect(record).toMatchObject({ service: 'unknown_service', timeMs: 7, body: '' });
  });

  it('rejects gzip bodies that inflate past the cap', () => {
    const bomb = gzipSync(new Uint8Array(4096));
    expect(() => decodeLogsBody(bomb, 'json', 'gzip', 0, 1024)).toThrow(OtlpBodyTooLargeError);
  });

  it('decodes plain and gzip bodies', () => {
    const raw = Buffer.from(JSON.stringify(jsonRequest));
    expect(decodeLogsBody(raw, 'json', undefined)).toHaveLength(2);
    expect(decodeLogsBody(gzipSync(raw), 'json', 'gzip')).toHaveLength(2);
  });

  it('throws on malformed JSON', () => {
    expect(() => decodeLogsBody(Buffer.from('{'), 'json', undefined)).toThrow();
  });
});

describe('OTLP/protobuf', () => {
  it('decodes an ExportLogsServiceRequest like the JSON exporter would send it', () => {
    const request = decodeLogsProtobuf(protobufRequest());
    const [record] = flattenLogsRequest(request);
    expect(record).toEqual({
      service: 'studio-electron-main',
      scope: 'studio.dev',
      timeMs: 1_793_405_920_261,
      severityNumber: 17,
      severityText: 'ERROR',
      body: 'boom',
      attributes: {
        n: -3,
        ok: true,
        ratio: 0.5,
        list: ['a', 2],
        map: { inner: 'x' },
        'event.name': 'studio.crash',
        trace_id: '0102030405060708090a0b0c0d0e0f10',
      },
      resource: { 'service.name': 'studio-electron-main' },
    });
  });

  it('decodes gzip-compressed protobuf', () => {
    expect(decodeLogsBody(gzipSync(protobufRequest()), 'protobuf', 'gzip')).toHaveLength(1);
  });

  it('rejects truncated input', () => {
    expect(() => decodeLogsProtobuf(protobufRequest().subarray(0, 20))).toThrow();
  });
});

describe('encodingFor', () => {
  it('maps content types', () => {
    expect(encodingFor('application/json; charset=utf-8')).toBe('json');
    expect(encodingFor('application/x-protobuf')).toBe('protobuf');
    expect(encodingFor('application/protobuf')).toBe('protobuf');
    expect(encodingFor('text/plain')).toBeNull();
    expect(encodingFor(undefined)).toBeNull();
  });
});
