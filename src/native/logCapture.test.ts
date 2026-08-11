// Diagnostic capture: what a user's bug report will actually contain.

const mockWriteTextAtomic = jest.fn();
jest.mock('./fs', () => ({
  CONFIG_DIR: '/MyStyle/Plugins/SmartNoteAI',
  writeTextAtomic: (...a: unknown[]) => mockWriteTextAtomic(...a),
}));

const mockAddEventListener = jest.fn();
jest.mock('react-native', () => ({
  AppState: {addEventListener: (...a: unknown[]) => mockAddEventListener(...a)},
  Platform: {constants: {Brand: 'Supernote', Model: 'A5X2', Release: '11'}},
}));

import {
  record,
  buildHeader,
  writeLogFile,
  installLogCapture,
  LOG_FILE_PATH,
} from './logCapture';
import {snapshotLines, clearBuffer} from '../core/logBuffer';
import {APP_VERSION} from '../core/version';

const AT = new Date(2026, 7, 11, 14, 3, 7, 42).getTime();

beforeEach(() => {
  jest.clearAllMocks();
  clearBuffer();
  mockWriteTextAtomic.mockResolvedValue(true);
});

describe('record', () => {
  it('timestamps the line and joins the arguments, like the console call', () => {
    record('LOG', ['[SmartNoteAI.read]', 'meeting.note: 3 pages'], AT);
    expect(snapshotLines()[0]).toBe(
      '14:03:07.042 LOG [SmartNoteAI.read] meeting.note: 3 pages',
    );
  });

  it('renders an Error with its stack — the one thing a crash report needs', () => {
    const e = new Error('boom');
    record('FATAL', [e], AT);
    expect(snapshotLines()[0]).toContain('Error: boom');
    expect(snapshotLines()[0]).toContain('logCapture.test');
  });

  it("drops the SDK's per-call verifyParams dump — it rotated the evidence out", () => {
    record('LOG', ['verifyParams', {a: 1}, {b: 2}, {c: 3}], AT);
    expect(snapshotLines()).toHaveLength(0);
    // A real line that merely mentions it is kept.
    record('LOG', ['[SmartNoteAI.read] verifyParams looked wrong'], AT);
    expect(snapshotLines()).toHaveLength(1);
  });

  it('survives a value that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => record('LOG', [cyclic], AT)).not.toThrow();
    expect(snapshotLines()).toHaveLength(1);
  });
});

describe('buildHeader', () => {
  it('stamps the version, the device and what the file may contain', () => {
    const h = buildHeader({
      now: AT,
      device: 'Supernote A5X2',
      os: '11',
      extra: {docs: 166},
    });
    expect(h).toContain(`v${APP_VERSION}`);
    expect(h).toContain('Supernote A5X2');
    expect(h).toContain('docs        : 166');
    // The promise made to whoever sends this file.
    expect(h).toContain('page content, questions, answers and the API key never do');
  });
});

describe('writeLogFile', () => {
  it('writes header + buffer to the user-visible path and returns it', async () => {
    record('LOG', ['première ligne'], AT);
    const p = await writeLogFile({docs: 12});
    expect(p).toBe(LOG_FILE_PATH);
    expect(LOG_FILE_PATH).toContain('MyStyle'); // reachable over USB
    const written = mockWriteTextAtomic.mock.calls[0][1] as string;
    expect(written).toContain('SmartNote AI · diagnostic log');
    expect(written).toContain('docs        : 12');
    expect(written).toContain('première ligne');
  });

  it('a failed write reports null instead of pretending', async () => {
    mockWriteTextAtomic.mockResolvedValue(false);
    expect(await writeLogFile()).toBeNull();
  });

  it('never throws when the native write blows up', async () => {
    mockWriteTextAtomic.mockRejectedValue(new Error('no space'));
    await expect(writeLogFile()).resolves.toBeNull();
  });
});

describe('installLogCapture', () => {
  // Installation is once-per-process by design, so grab what it registered
  // here — beforeEach's clearAllMocks would erase the record of the call.
  // Stand in for logcat BEFORE installing, so the wrapper keeps it as the
  // "original" it must still forward to.
  const printed = jest.fn();
  beforeAll(() => {
    (console as unknown as {log: unknown}).log = printed;
    installLogCapture();
  });

  it('captures console output AND still prints it (adb keeps working)', () => {
    console.log('[SmartNoteAI.auto]', 'tick');
    expect(snapshotLines().some(l => l.includes('tick'))).toBe(true);
    expect(printed).toHaveBeenCalledWith('[SmartNoteAI.auto]', 'tick');
  });

  it('NEVER writes on its own: MyStyle is cloud-synced (release audit)', () => {
    record('LOG', ['something happened'], AT);
    // No AppState listener at all any more — the file is written only when
    // the user taps Export, or when the plugin crashes.
    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(mockWriteTextAtomic).not.toHaveBeenCalled();
  });

  it('installs once — a second call registers nothing and re-wraps nothing', () => {
    installLogCapture();
    installLogCapture();
    expect(mockAddEventListener).not.toHaveBeenCalled(); // cleared in beforeEach
    console.log('une seule fois');
    expect(snapshotLines().filter(l => l.includes('une seule fois'))).toHaveLength(1);
  });
});
