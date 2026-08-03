// sleepHybrid (audit 2026-07-30 C2): the wait must resolve through the
// native heartbeat when JS timers are frozen, and through the plain timer
// in the foreground. Frozen timers are simulated with fake timers that are
// never advanced.
import {DeviceEventEmitter} from 'react-native';
import {sleepHybrid} from './nativeSleep';

afterEach(() => {
  jest.useRealTimers();
});

it('resolves on a heartbeat even when timers never fire (frozen state)', async () => {
  jest.useFakeTimers();
  let resolved = false;
  sleepHybrid(0).then(() => {
    resolved = true;
  });
  DeviceEventEmitter.emit('SmartNoteAiHeartbeat');
  await Promise.resolve();
  await Promise.resolve();
  expect(resolved).toBe(true);
});

it('does not resolve on a heartbeat BEFORE the deadline', async () => {
  jest.useFakeTimers({doNotFake: ['Date']});
  let resolved = false;
  sleepHybrid(60_000).then(() => {
    resolved = true;
  });
  DeviceEventEmitter.emit('SmartNoteAiHeartbeat'); // far too early
  await Promise.resolve();
  await Promise.resolve();
  expect(resolved).toBe(false); // still honouring the requested wait
});

it('resolves through the plain timer in the foreground', async () => {
  jest.useFakeTimers();
  let resolved = false;
  sleepHybrid(500).then(() => {
    resolved = true;
  });
  await jest.advanceTimersByTimeAsync(500);
  expect(resolved).toBe(true);
});
