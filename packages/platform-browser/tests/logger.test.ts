import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserLogger } from '../src/logger';

afterEach(() => vi.restoreAllMocks());

function spyConsole() {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

function logAll(logger: BrowserLogger) {
  logger.debug('d');
  logger.info('i', { n: 1 });
  logger.warn('w');
  logger.error('e');
}

describe('BrowserLogger', () => {
  it('prints only warn and error by default and keeps everything in the ring buffer', () => {
    const spies = spyConsole();
    const logger = new BrowserLogger('debug');
    logAll(logger);
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledWith('[studio] w');
    expect(spies.error).toHaveBeenCalledWith('[studio] e');
    expect(logger.recent().map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('prints info and debug when consoleLevel is lowered (dev builds)', () => {
    const spies = spyConsole();
    logAll(new BrowserLogger('debug', 500, 'debug'));
    expect(spies.debug).toHaveBeenCalledWith('[studio] d');
    expect(spies.info).toHaveBeenCalledWith('[studio] i', { n: 1 });
  });

  it('still honours minLevel', () => {
    const spies = spyConsole();
    logAll(new BrowserLogger('info', 500, 'debug'));
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledOnce();
  });
});
