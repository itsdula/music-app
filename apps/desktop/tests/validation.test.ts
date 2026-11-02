import { describe, expect, it } from 'vitest';
import {
  MAX_ACCEPT_ENTRIES,
  MAX_FILE_BYTES,
  MAX_PREFERENCE_VALUE_BYTES,
} from '../src/shared/host-api';
import {
  extensionOf,
  extensionsForAccept,
  hasPathSeparator,
  isAcceptedFile,
  mimeTypeForName,
  sanitizeFileName,
  utf8ByteLength,
  validateOpenFilesArgs,
  validatePreferenceDeleteArgs,
  validatePreferenceKey,
  validatePreferenceSetArgs,
  validatePreferencesLoadArgs,
  validateSaveFileArgs,
} from '../src/main/validation';

const bytes = new Uint8Array([1, 2, 3]);

describe('validateSaveFileArgs', () => {
  it('accepts a well-formed call', () => {
    const result = validateSaveFileArgs([bytes, 'Mix Down.wav', 'audio/wav']);
    expect(result).toEqual({
      ok: true,
      value: { bytes, suggestedName: 'Mix Down.wav', mimeType: 'audio/wav' },
    });
  });

  it('accepts Buffers (Uint8Array subclass) and empty files', () => {
    expect(validateSaveFileArgs([Buffer.from('x'), 'a.json', 'application/json']).ok).toBe(true);
    expect(validateSaveFileArgs([new Uint8Array(0), 'a.json', 'application/json']).ok).toBe(true);
  });

  it.each([
    ['wrong arity', [bytes, 'a.wav']],
    ['extra argument', [bytes, 'a.wav', 'audio/wav', 'x']],
    ['string bytes', ['abc', 'a.wav', 'audio/wav']],
    ['ArrayBuffer bytes', [new ArrayBuffer(3), 'a.wav', 'audio/wav']],
    ['number[] bytes', [[1, 2, 3], 'a.wav', 'audio/wav']],
    ['Float32Array bytes', [new Float32Array(3), 'a.wav', 'audio/wav']],
    ['non-string name', [bytes, 42, 'audio/wav']],
    ['empty name', [bytes, '', 'audio/wav']],
    ['too-long name', [bytes, `${'a'.repeat(300)}.wav`, 'audio/wav']],
    ['posix path', [bytes, 'dir/a.wav', 'audio/wav']],
    ['parent traversal', [bytes, '../a.wav', 'audio/wav']],
    ['windows path', [bytes, 'C:\\Users\\a.wav', 'audio/wav']],
    ['dot-dot name', [bytes, '..', 'audio/wav']],
    ['control characters', [bytes, 'a\u0000.wav', 'audio/wav']],
    ['newline', [bytes, 'a\n.wav', 'audio/wav']],
    ['missing mime', [bytes, 'a.wav', undefined]],
    ['bad mime', [bytes, 'a.wav', 'not a mime']],
    ['mime with params', [bytes, 'a.wav', 'audio/wav; codecs=1']],
  ])('rejects %s', (_label, args) => {
    const result = validateSaveFileArgs(args);
    expect(result.ok).toBe(false);
  });

  it('rejects payloads larger than 2 GiB without allocating them', () => {
    const huge = Object.create(Uint8Array.prototype, {
      byteLength: { value: MAX_FILE_BYTES + 1 },
    }) as Uint8Array;
    const result = validateSaveFileArgs([huge, 'a.wav', 'audio/wav']);
    expect(result).toEqual({ ok: false, error: 'bytes exceed the 2 GiB limit' });
  });

  it('sanitises reserved characters in the suggested name', () => {
    const result = validateSaveFileArgs([bytes, 'mix: "final"?.wav', 'audio/wav']);
    expect(result.ok && result.value.suggestedName).toBe('mix_ _final__.wav');
  });
});

describe('validateOpenFilesArgs', () => {
  it('accepts MIME types, wildcards and extensions', () => {
    const result = validateOpenFilesArgs([['audio/*', '.wav', 'application/json'], true]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.multiple).toBe(true);
    expect(result.value.extensions).toEqual(
      expect.arrayContaining(['wav', 'mp3', 'flac', 'ogg', 'json']),
    );
    expect(result.value.extensions).not.toContain('zip');
  });

  it('treats an empty list and */* as "any file"', () => {
    const empty = validateOpenFilesArgs([[], false]);
    expect(empty.ok && empty.value.extensions).toBeNull();
    const any = validateOpenFilesArgs([['*/*'], false]);
    expect(any.ok && any.value.extensions).toBeNull();
  });

  it.each([
    ['wrong arity', [['.wav']]],
    ['accept not an array', ['.wav', false]],
    ['non-string entry', [[42], false]],
    ['path-like entry', [['../*'], false]],
    ['glob entry', [['*.wav'], false]],
    ['entry with separator', [['.w/av'], false]],
    ['overlong extension', [[`.${'a'.repeat(40)}`], false]],
    ['multiple not boolean', [['.wav'], 'yes']],
    ['too many entries', [Array.from({ length: MAX_ACCEPT_ENTRIES + 1 }, () => '.wav'), false]],
    ['unknown MIME only', [['image/png'], false]],
  ])('rejects %s', (_label, args) => {
    expect(validateOpenFilesArgs(args).ok).toBe(false);
  });
});

describe('extensionsForAccept / isAcceptedFile', () => {
  it('maps specific MIME types to all their extensions', () => {
    expect(extensionsForAccept(['audio/wav'])).toEqual(['wav', 'wave']);
    expect(extensionsForAccept(['audio/ogg'])).toEqual(['oga', 'ogg', 'opus']);
  });

  it('keeps unknown extensions given explicitly', () => {
    expect(extensionsForAccept(['.SFZ'])).toEqual(['sfz']);
  });

  it('checks chosen paths case-insensitively', () => {
    expect(isAcceptedFile('/music/Take 1.WAV', ['wav'])).toBe(true);
    expect(isAcceptedFile('C:\\music\\take.mp3', ['wav'])).toBe(false);
    expect(isAcceptedFile('/music/noext', ['wav'])).toBe(false);
    expect(isAcceptedFile('/music/.wav', ['wav'])).toBe(false);
    expect(isAcceptedFile('/anything.bin', null)).toBe(true);
  });
});

describe('file names', () => {
  it('detects path separators and relative components', () => {
    expect(hasPathSeparator('a/b')).toBe(true);
    expect(hasPathSeparator('a\\b')).toBe(true);
    expect(hasPathSeparator('..')).toBe(true);
    expect(hasPathSeparator('.')).toBe(true);
    expect(hasPathSeparator('a..b.wav')).toBe(false);
  });

  it('extracts extensions and MIME types', () => {
    expect(extensionOf('/x/y/Take.FLAC')).toBe('flac');
    expect(extensionOf('.bashrc')).toBe('');
    expect(mimeTypeForName('song.mp3')).toBe('audio/mpeg');
    expect(mimeTypeForName('project.studio')).toBe('application/x-studio-bundle');
    expect(mimeTypeForName('unknown.xyz')).toBe('application/octet-stream');
  });

  it.each([
    ['plain.wav', 'plain.wav'],
    ['../../etc/passwd', '_.._etc_passwd'],
    ['a\\b/c.wav', 'a_b_c.wav'],
    ['  .hidden.  ', 'hidden'],
    ['tab\tand\u0007bell.wav', 'tabandbell.wav'],
    ['what?<>|*.wav', 'what_____.wav'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['', 'untitled'],
    ['...', 'untitled'],
  ])('sanitizeFileName(%j) → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('truncates long names to 255 characters, keeping the extension', () => {
    const result = sanitizeFileName(`${'x'.repeat(400)}.wav`);
    expect(result).toHaveLength(255);
    expect(result.endsWith('.wav')).toBe(true);
  });

  it('never returns a name with separators', () => {
    for (const input of ['/', '\\', 'a/../../b', 'C:\\Windows\\x', '..\\..']) {
      const out = sanitizeFileName(input);
      expect(hasPathSeparator(out)).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe('utf8ByteLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['音', 3],
    ['🎛', 4],
    ['a\u{1F39B}b', 6],
    ['\uD800', 3], // lone high surrogate encodes as U+FFFD
    ['\uDC00x', 4], // lone low surrogate
  ])('%j is %i bytes', (value, bytes) => {
    expect(utf8ByteLength(value)).toBe(bytes);
    expect(utf8ByteLength(value)).toBe(Buffer.byteLength(value, 'utf8'));
  });
});

describe('preference validators', () => {
  it('accepts dotted keys of letters, digits, _ . -', () => {
    for (const key of [
      'a',
      'theme.config',
      'ui.pianoRoll.velocityLane.editor',
      'k_1-x',
      `k${'.'.repeat(127)}`,
    ]) {
      expect(validatePreferenceKey(key)).toEqual({ ok: true, value: key });
    }
  });

  it.each([
    ['non-string', 42],
    ['empty', ''],
    ['leading dot', '.a'],
    ['path', '../a'],
    ['space', 'a b'],
    ['colon', 'a:b'],
    ['proto', '__proto__'],
    ['non-ASCII', 'thème'],
    ['too long', `k${'x'.repeat(128)}`],
  ])('rejects a key that is %s', (_label, key) => {
    expect(validatePreferenceKey(key).ok).toBe(false);
  });

  it('validates set arguments', () => {
    expect(validatePreferenceSetArgs(['ui.a', '1'])).toEqual({
      ok: true,
      value: { key: 'ui.a', value: '1' },
    });
    expect(validatePreferenceSetArgs(['ui.a', '']).ok).toBe(true);
    expect(validatePreferenceSetArgs(['ui.a', 'x'.repeat(MAX_PREFERENCE_VALUE_BYTES)]).ok).toBe(
      true,
    );
  });

  it.each([
    ['no arguments', []],
    ['one argument', ['ui.a']],
    ['extra argument', ['ui.a', '1', '2']],
    ['bad key', ['a b', '1']],
    ['number value', ['ui.a', 1]],
    ['object value', ['ui.a', { toString: () => '1' }]],
    ['null value', ['ui.a', null]],
    ['oversized value', ['ui.a', 'x'.repeat(MAX_PREFERENCE_VALUE_BYTES + 1)]],
    ['oversized in UTF-8', ['ui.a', '音'.repeat(MAX_PREFERENCE_VALUE_BYTES / 2)]],
  ])('rejects set with %s', (_label, args) => {
    expect(validatePreferenceSetArgs(args).ok).toBe(false);
  });

  it('rejects huge strings without measuring them', () => {
    const result = validatePreferenceSetArgs(['ui.a', 'x'.repeat(50 * 1024 * 1024)]);
    expect(result).toEqual({ ok: false, error: 'value exceeds the 64 KiB limit' });
  });

  it('validates load and delete arguments', () => {
    expect(validatePreferencesLoadArgs([])).toEqual({ ok: true, value: null });
    expect(validatePreferencesLoadArgs(['x']).ok).toBe(false);
    expect(validatePreferenceDeleteArgs(['ui.a'])).toEqual({ ok: true, value: 'ui.a' });
    expect(validatePreferenceDeleteArgs([]).ok).toBe(false);
    expect(validatePreferenceDeleteArgs(['ui.a', 'x']).ok).toBe(false);
    expect(validatePreferenceDeleteArgs(['../a']).ok).toBe(false);
  });
});
