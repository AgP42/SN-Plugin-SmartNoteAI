// Diagnostic log capture + export (2026-08-11, user need: once the plugin
// is public, users have no adb — they need to be able to SEND a log).
//
// Why wrap `console` instead of migrating 119 call sites: it is one place
// instead of a hundred and nineteen, it cannot miss a site, it survives new
// code written without thinking about it, and it also catches whatever the
// libraries print. The original console methods are still called, so adb
// logcat is exactly as it was.
//
// Names are kept IN CLEAR (user decision 2026-08-11): the log carries note
// and folder names, never page content — no transcript, no question, no
// answer, and no API key ever reaches it.
import {AppState, Platform} from 'react-native';
import {pushLine, snapshotLines, bufferStats} from '../core/logBuffer';
import {APP_VERSION, APP_VERSION_CODE} from '../core/version';
import {CONFIG_DIR, writeTextAtomic} from './fs';

export const LOG_FILE_PATH = `${CONFIG_DIR}/smartnoteai-log.txt`;

let installed = false;
let dirty = false;

// Never throw out of a logger, and never recurse into it.
const safeText = (v: unknown): string => {
  if (typeof v === 'string') {
    return v;
  }
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ''}`;
  }
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const stamp = (at: number): string => {
  const d = new Date(at);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
};

export const record = (level: string, args: unknown[], at: number): void => {
  try {
    pushLine(`${stamp(at)} ${level} ${args.map(safeText).join(' ')}`);
    dirty = true;
  } catch {
    // A failing logger must never take the app down with it.
  }
};

// Everything the plugin knows about itself, so a bug report does not start
// with three rounds of "which version are you on?".
export const buildHeader = (info: {
  now: number;
  device: string;
  os: string;
  extra?: Record<string, string | number>;
}): string => {
  const lines = [
    '=== SmartNote AI · diagnostic log ===',
    `plugin      : v${APP_VERSION} (build ${APP_VERSION_CODE})`,
    `device      : ${info.device}`,
    `android     : ${info.os}`,
    `exported at : ${new Date(info.now).toISOString()}`,
  ];
  for (const [k, v] of Object.entries(info.extra ?? {})) {
    lines.push(`${k.padEnd(12)}: ${v}`);
  }
  lines.push(
    'contents    : plugin activity only — file and folder NAMES appear,',
    '              page content, questions, answers and the API key never do.',
    '=====================================',
    '',
  );
  return lines.join('\n');
};

const deviceInfo = (): {device: string; os: string} => {
  try {
    const c = Platform.constants as unknown as {
      Brand?: string;
      Model?: string;
      Release?: string;
      Fingerprint?: string;
    };
    return {
      device: `${c?.Brand ?? '?'} ${c?.Model ?? '?'}`.trim(),
      os: `${c?.Release ?? '?'}${c?.Fingerprint ? ` · ${c.Fingerprint}` : ''}`,
    };
  } catch {
    return {device: 'unknown', os: 'unknown'};
  }
};

// Write the current buffer to the user-visible file. Returns the path, or
// null when the write failed. `extra` lets the caller stamp a settings
// summary in without this module reaching into settings itself.
export const writeLogFile = async (
  extra?: Record<string, string | number>,
): Promise<string | null> => {
  const {device, os} = deviceInfo();
  const stats = bufferStats();
  const body = [
    buildHeader({
      now: Date.now(),
      device,
      os,
      extra: {...extra, 'log lines': stats.lines},
    }),
    ...snapshotLines(),
    '',
  ].join('\n');
  const ok = await writeTextAtomic(LOG_FILE_PATH, body).catch(() => false);
  if (ok) {
    dirty = false;
  }
  return ok ? LOG_FILE_PATH : null;
};

// Install once, as early as possible (index.js) so the very first lines of
// a session are captured too.
export const installLogCapture = (): void => {
  if (installed) {
    return;
  }
  installed = true;
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = c[level]?.bind(console);
    c[level] = (...args: unknown[]): void => {
      record(level.toUpperCase(), args, Date.now());
      original?.(...args);
    };
  }
  // A crash is exactly when the log matters, and today it leaves no trace.
  // Write the file BEFORE handing back to the default handler, which may
  // tear the runtime down.
  const eu = (
    globalThis as unknown as {
      ErrorUtils?: {
        getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void;
        setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
      };
    }
  ).ErrorUtils;
  const prev = eu?.getGlobalHandler?.();
  eu?.setGlobalHandler?.((e: unknown, fatal?: boolean) => {
    record('FATAL', [fatal === true ? 'fatal' : 'error', e], Date.now());
    writeLogFile().catch(() => undefined);
    prev?.(e, fatal);
  });
  // RN freezes JS timers the moment we go background, so the tail would be
  // lost on a kill: flush when the user leaves, and only if something new
  // was actually logged.
  AppState.addEventListener('change', st => {
    if (st !== 'active' && dirty) {
      writeLogFile().catch(() => undefined);
    }
  });
};
