// Following a rename through the path-keyed state (2026-08-10 device
// report: the transcript survived a rename but everything attached to the
// note did not).
import {
  migrateAutoTargets,
  migrateAgentPaths,
  migrateWantedPaths,
  orphanedModeFor,
} from './renamePath';
import type {Agent} from '../agents/agents';

const OLD = '/Note/Work/Réunion.note';
const NEW = '/Note/Work/Réunion 2026.note';

const agent = (over: Partial<Agent> = {}): Agent =>
  ({id: 'a1', name: 'A', icon: '📚', docs: [], ...over} as Agent);

describe('migrateAutoTargets', () => {
  it('moves the explicit mode to the new path — an Off is never revoked', () => {
    const out = migrateAutoTargets({[OLD]: {mode: 'off'}}, OLD, NEW)!;
    expect(out[NEW]).toEqual({mode: 'off'});
    expect(out[OLD]).toBeUndefined();
  });

  it('leaves a folder key and any other path untouched', () => {
    const targets = {'/Note/Work': {mode: 'auto' as const}, [OLD]: {mode: 'off' as const}};
    const out = migrateAutoTargets(targets, OLD, NEW)!;
    expect(out['/Note/Work']).toEqual({mode: 'auto'});
    expect(Object.keys(out).sort()).toEqual(['/Note/Work', NEW].sort());
  });

  it('an existing decision about the NEW path wins', () => {
    const out = migrateAutoTargets(
      {[OLD]: {mode: 'off'}, [NEW]: {mode: 'auto'}},
      OLD,
      NEW,
    )!;
    expect(out[NEW]).toEqual({mode: 'auto'});
  });

  it('nothing attached → null (no write at all)', () => {
    expect(migrateAutoTargets({'/Note/Work': {mode: 'auto'}}, OLD, NEW)).toBeNull();
  });
});

describe('migrateAgentPaths', () => {
  it('rewrites an exact doc ref, leaving folder refs alone', () => {
    const out = migrateAgentPaths(
      [agent({docs: ['/Note/Work', OLD]})],
      OLD,
      NEW,
    )!;
    expect(out[0].docs).toEqual(['/Note/Work', NEW]);
  });

  it('moves a page set, merging with any the agent already had for the new path', () => {
    const out = migrateAgentPaths(
      [agent({docs: [], docPages: {[OLD]: [3, 1], [NEW]: [1, 7]}})],
      OLD,
      NEW,
    )!;
    expect(out[0].docPages).toEqual({[NEW]: [1, 3, 7]});
  });

  it('never duplicates when the agent already knew the destination', () => {
    const out = migrateAgentPaths([agent({docs: [OLD, NEW]})], OLD, NEW)!;
    expect(out[0].docs).toEqual([NEW]);
  });

  it('agents that do not know the file are returned untouched, and null when none do', () => {
    const other = agent({id: 'a2', docs: ['/Note/Perso/x.note']});
    expect(migrateAgentPaths([other], OLD, NEW)).toBeNull();
    const out = migrateAgentPaths([other, agent({docs: [OLD]})], OLD, NEW)!;
    expect(out[0]).toBe(other); // same object: nothing rewritten
  });
});

describe('orphanedModeFor (an Off that survives a rename)', () => {
  const GONE = '/Note/Journal/Therapy.note';
  const NEW = '/Note/Journal/Therapy 2026.note';

  it('adopts the orphaned Off instead of inheriting the folder Auto', () => {
    const out = orphanedModeFor(
      {'/Note/Journal': {mode: 'auto'}, [GONE]: {mode: 'off'}},
      NEW,
      [GONE],
      'auto',
      [NEW],
    );
    expect(out).toEqual({from: GONE, mode: 'off'});
  });

  it('NEVER loosens: an orphaned Auto is not adopted over an inherited Off', () => {
    expect(
      orphanedModeFor({[GONE]: {mode: 'auto'}}, NEW, [GONE], 'off', [NEW]),
    ).toBeNull();
  });

  it('refuses when two explicit entries in the folder are gone', () => {
    const other = '/Note/Journal/Autre.note';
    expect(
      orphanedModeFor(
        {[GONE]: {mode: 'off'}, [other]: {mode: 'off'}},
        NEW,
        [GONE, other],
        'auto',
        [NEW],
      ),
    ).toBeNull();
  });

  it('a path with its own decision is never overridden', () => {
    expect(
      orphanedModeFor(
        {[GONE]: {mode: 'off'}, [NEW]: {mode: 'auto'}},
        NEW,
        [GONE],
        'auto',
        [NEW],
      ),
    ).toBeNull();
  });

  it('refuses when SEVERAL untracked files could be the renamed one', () => {
    // Verification pass 2026-08-12: the first version fanned out to every
    // sibling, so a bystander could inherit the Off and stop syncing.
    const sibling = '/Note/Journal/Notes.note';
    expect(
      orphanedModeFor(
        {'/Note/Journal': {mode: 'auto'}, [GONE]: {mode: 'off'}},
        NEW,
        [GONE],
        'auto',
        [NEW, sibling],
      ),
    ).toBeNull();
  });

  it('a gone path with no explicit entry is not a candidate', () => {
    expect(orphanedModeFor({}, NEW, [GONE], 'auto', [NEW])).toBeNull();
  });
});

describe('migrateWantedPaths', () => {
  it('moves a standing Sync order to the new path, deduped', () => {
    expect(migrateWantedPaths([OLD, NEW, '/other.note'], OLD, NEW)).toEqual([
      NEW,
      '/other.note',
    ]);
  });

  it('no order for this file → null', () => {
    expect(migrateWantedPaths(['/other.note'], OLD, NEW)).toBeNull();
  });
});
