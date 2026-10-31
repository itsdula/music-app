/**
 * OTLP/HTTP logs decoding (JSON and protobuf, optionally gzip-compressed) into flat
 * `LogRecordInput`s. Hand-written so the receiver needs no protobuf runtime: field numbers
 * follow opentelemetry-proto `collector/logs/v1`, `logs/v1`, `common/v1` and `resource/v1`.
 */
import { gunzipSync } from 'node:zlib';
import type { LogRecordInput } from './shared/types';

/** OTLP/JSON `AnyValue` (also the shape the protobuf decoder produces). */
export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: number | string;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
}

export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

interface OtlpLogRecord {
  timeUnixNano?: string | number;
  observedTimeUnixNano?: string | number;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  eventName?: string;
  traceId?: string;
  spanId?: string;
}

interface OtlpScopeLogs {
  scope?: { name?: string; version?: string };
  logRecords?: OtlpLogRecord[];
}

interface OtlpResourceLogs {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeLogs?: OtlpScopeLogs[];
}

export interface OtlpExportLogsRequest {
  resourceLogs?: OtlpResourceLogs[];
}

export function anyValue(value: OtlpAnyValue | undefined): unknown {
  if (value == null) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  // The JS exporter sends int64 as a JSON number; the spec (and other SDKs) as a string.
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(anyValue);
  if (value.kvlistValue !== undefined) return keyValues(value.kvlistValue.values);
  return null;
}

export function keyValues(list: readonly OtlpKeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of list ?? []) out[key] = anyValue(value);
  return out;
}

function bodyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function timeMs(record: OtlpLogRecord, fallbackMs: number): number {
  const raw = record.timeUnixNano || record.observedTimeUnixNano;
  if (raw === undefined || raw === '' || raw === 0 || raw === '0') return fallbackMs;
  try {
    return Number(BigInt(raw) / 1_000_000n);
  } catch {
    return fallbackMs;
  }
}

/** Flattens an export request into one record per log record. */
export function flattenLogsRequest(
  request: OtlpExportLogsRequest,
  nowMs = Date.now(),
): LogRecordInput[] {
  const out: LogRecordInput[] = [];
  for (const resourceLogs of request.resourceLogs ?? []) {
    const resource = keyValues(resourceLogs.resource?.attributes);
    const service =
      typeof resource['service.name'] === 'string' ? resource['service.name'] : 'unknown_service';
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        const attributes = keyValues(record.attributes);
        if (record.eventName) attributes['event.name'] = record.eventName;
        if (record.traceId) attributes['trace_id'] = record.traceId;
        if (record.spanId) attributes['span_id'] = record.spanId;
        out.push({
          service,
          timeMs: timeMs(record, nowMs),
          severityNumber: record.severityNumber ?? 0,
          severityText: record.severityText ?? '',
          body: bodyText(anyValue(record.body)),
          ...(scopeLogs.scope?.name ? { scope: scopeLogs.scope.name } : {}),
          attributes,
          resource,
        });
      }
    }
  }
  return out;
}

// ---------- protobuf ----------

type Field = readonly [fieldNumber: number, wireType: number, value: bigint | Uint8Array];

function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated varint');
      const byte = buf[i++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  const take = (n: number): Uint8Array => {
    if (i + n > buf.length) throw new Error('truncated field');
    const out = buf.subarray(i, i + n);
    i += n;
    return out;
  };
  while (i < buf.length) {
    const tag = Number(varint());
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) yield [fieldNumber, wireType, varint()];
    else if (wireType === 1) yield [fieldNumber, wireType, take(8)];
    else if (wireType === 2) yield [fieldNumber, wireType, take(Number(varint()))];
    else if (wireType === 5) yield [fieldNumber, wireType, take(4)];
    else throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}

const utf8 = new TextDecoder();
const bytes = (v: bigint | Uint8Array): Uint8Array =>
  v instanceof Uint8Array ? v : new Uint8Array();
const text = (v: bigint | Uint8Array): string => utf8.decode(bytes(v));
const view = (v: bigint | Uint8Array): DataView => {
  const b = bytes(v);
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
};
const hex = (v: bigint | Uint8Array): string => Buffer.from(bytes(v)).toString('hex');
const fixed64 = (v: bigint | Uint8Array): string => view(v).getBigUint64(0, true).toString();
const num = (v: bigint | Uint8Array): bigint => (typeof v === 'bigint' ? v : 0n);

function decodeAnyValue(buf: Uint8Array): OtlpAnyValue {
  for (const [no, , v] of fields(buf)) {
    switch (no) {
      case 1:
        return { stringValue: text(v) };
      case 2:
        return { boolValue: num(v) !== 0n };
      case 3:
        return { intValue: BigInt.asIntN(64, num(v)).toString() };
      case 4:
        return { doubleValue: view(v).getFloat64(0, true) };
      case 5:
        return {
          arrayValue: {
            values: [...fields(bytes(v))]
              .filter(([n]) => n === 1)
              .map(([, , x]) => decodeAnyValue(bytes(x))),
          },
        };
      case 6:
        return {
          kvlistValue: {
            values: [...fields(bytes(v))]
              .filter(([n]) => n === 1)
              .map(([, , x]) => decodeKeyValue(bytes(x))),
          },
        };
      case 7:
        return { bytesValue: Buffer.from(bytes(v)).toString('base64') };
    }
  }
  return {};
}

function decodeKeyValue(buf: Uint8Array): OtlpKeyValue {
  const kv: OtlpKeyValue = { key: '' };
  for (const [no, , v] of fields(buf)) {
    if (no === 1) kv.key = text(v);
    else if (no === 2) kv.value = decodeAnyValue(bytes(v));
  }
  return kv;
}

function decodeLogRecord(buf: Uint8Array): OtlpLogRecord {
  const record: OtlpLogRecord = { attributes: [] };
  for (const [no, , v] of fields(buf)) {
    switch (no) {
      case 1:
        record.timeUnixNano = fixed64(v);
        break;
      case 2:
        record.severityNumber = Number(num(v));
        break;
      case 3:
        record.severityText = text(v);
        break;
      case 5:
        record.body = decodeAnyValue(bytes(v));
        break;
      case 6:
        record.attributes!.push(decodeKeyValue(bytes(v)));
        break;
      case 9:
        record.traceId = hex(v);
        break;
      case 10:
        record.spanId = hex(v);
        break;
      case 11:
        record.observedTimeUnixNano = fixed64(v);
        break;
      case 12:
        record.eventName = text(v);
        break;
    }
  }
  return record;
}

function decodeScopeLogs(buf: Uint8Array): OtlpScopeLogs {
  const scopeLogs: OtlpScopeLogs = { scope: {}, logRecords: [] };
  for (const [no, , v] of fields(buf)) {
    if (no === 1) {
      for (const [n, , x] of fields(bytes(v))) {
        if (n === 1) scopeLogs.scope!.name = text(x);
        else if (n === 2) scopeLogs.scope!.version = text(x);
      }
    } else if (no === 2) scopeLogs.logRecords!.push(decodeLogRecord(bytes(v)));
  }
  return scopeLogs;
}

function decodeResourceLogs(buf: Uint8Array): OtlpResourceLogs {
  const resourceLogs: OtlpResourceLogs = { resource: { attributes: [] }, scopeLogs: [] };
  for (const [no, , v] of fields(buf)) {
    if (no === 1) {
      for (const [n, , x] of fields(bytes(v))) {
        if (n === 1) resourceLogs.resource!.attributes!.push(decodeKeyValue(bytes(x)));
      }
    } else if (no === 2) resourceLogs.scopeLogs!.push(decodeScopeLogs(bytes(v)));
  }
  return resourceLogs;
}

/** Decodes a protobuf `ExportLogsServiceRequest` into the OTLP/JSON shape. */
export function decodeLogsProtobuf(buf: Uint8Array): OtlpExportLogsRequest {
  const request: OtlpExportLogsRequest = { resourceLogs: [] };
  for (const [no, , v] of fields(buf)) {
    if (no === 1) request.resourceLogs!.push(decodeResourceLogs(bytes(v)));
  }
  return request;
}

export type OtlpEncoding = 'json' | 'protobuf';

export function encodingFor(contentType: string | undefined): OtlpEncoding | null {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'application/x-protobuf' || type === 'application/protobuf') return 'protobuf';
  return null;
}

/** Cap on a decompressed gzip body, so a small bomb cannot exhaust the orchestrator's memory. */
export const MAX_OTLP_INFLATED_BYTES = 32 * 1024 * 1024;

/** Thrown when a gzip body inflates past `MAX_OTLP_INFLATED_BYTES` (the server replies 413). */
export class OtlpBodyTooLargeError extends Error {}

function gunzipCapped(body: Uint8Array, maxOutputLength: number): Uint8Array {
  try {
    return gunzipSync(body, { maxOutputLength });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new OtlpBodyTooLargeError(`gzip body inflates past ${maxOutputLength} bytes`);
    }
    throw error;
  }
}

/** Decodes a POST /v1/logs body. Throws on malformed input (the server replies 400). */
export function decodeLogsBody(
  body: Uint8Array,
  encoding: OtlpEncoding,
  contentEncoding: string | undefined,
  nowMs = Date.now(),
  maxInflatedBytes = MAX_OTLP_INFLATED_BYTES,
): LogRecordInput[] {
  const raw =
    contentEncoding?.trim().toLowerCase() === 'gzip' ? gunzipCapped(body, maxInflatedBytes) : body;
  const request =
    encoding === 'protobuf'
      ? decodeLogsProtobuf(raw)
      : (JSON.parse(utf8.decode(raw)) as OtlpExportLogsRequest);
  return flattenLogsRequest(request, nowMs);
}
