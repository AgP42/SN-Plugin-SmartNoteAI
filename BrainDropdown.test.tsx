// Smoke test — UI refactor Lot 3 (2026-08-03). The brain dropdown:
// model + knowledge header, one row per brain with model label and
// knowledge, pick wiring, last-usage line.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {makeStyles} from './panelStyles';
import {BrainDropdown, type BrainEntry} from './BrainDropdown';
import type {Agent} from './src/core/agents/agents';
import {
  flatText as texts,
  pressByText as press,
} from './src/ui/componentTestUtils';

const styles = makeStyles(1, 1);

const agent = {id: 'ag1', name: 'Thèse', icon: '📚', model: 'mistral-large-latest'} as unknown as Agent;
const entries: BrainEntry[] = [
  {key: 'chat', icon: '💬', name: 'Chat', id: null, agent: null},
  {key: 'ag1', icon: '📚', name: 'Thèse', id: 'ag1', agent},
];

const baseProps = (over: Partial<React.ComponentProps<typeof BrainDropdown>> = {}) =>
  ({
    styles,
    open: true,
    effectiveModel: 'mistral-medium-latest',
    entries,
    agentId: null,
    busy: false,
    pendingCtxCount: 2,
    activeStats: null,
    statsFor: (id: string) =>
      id === 'ag1' ? {docs: 3, read: 120} : undefined,
    modelLabelFor: (a: Agent | null) => (a !== null ? 'large' : 'medium'),
    lastUsage: {inputTokens: 900, cachedTokens: 800, outputTokens: 150},
    onNewChat: jest.fn(),
    onOpenHistory: jest.fn(),
    onPickAgent: jest.fn(),
    onClose: jest.fn(),
    ...over,
  } as React.ComponentProps<typeof BrainDropdown>);

const render = (p: React.ComponentProps<typeof BrainDropdown>): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<BrainDropdown {...p} />);
  });
  return r;
};

describe('BrainDropdown smoke', () => {
  it('closed: renders nothing', () => {
    const r = render(baseProps({open: false}));
    expect(r.toJSON()).toBeNull();
  });

  it('shows the model, the context count, each brain with model + knowledge, and usage', () => {
    const r = render(baseProps());
    const t = texts(r);
    expect(t).toContain('mistral-medium-latest');
    expect(t).toContain('2 context page(s)');
    expect(t).toContain('● 💬 Chat · medium'); // CHAT active
    expect(t).toContain('○ 📚 Thèse · large · 3 docs · 120 p');
    expect(t).toContain('800 cached −90%');
  });

  it('picking an agent forwards it and closes; New chat / History wired', () => {
    const p = baseProps();
    const r = render(p);
    press(r, 'Thèse');
    expect(p.onPickAgent).toHaveBeenCalledWith(agent);
    expect(p.onClose).toHaveBeenCalled();
    press(r, '＋ New chat');
    expect(p.onNewChat).toHaveBeenCalled();
    press(r, '🕘 History');
    expect(p.onOpenHistory).toHaveBeenCalled();
  });

  it('the active agent spells out its knowledge in the header', () => {
    const r = render(
      baseProps({agentId: 'ag1', activeStats: {docs: 3, read: 120}}),
    );
    expect(texts(r)).toContain('knows 3 doc(s) · 120 page(s) read');
    expect(texts(r)).toContain('● 📚 Thèse');
  });
});
