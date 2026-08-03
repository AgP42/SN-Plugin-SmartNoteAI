// Smoke test — UI refactor Lot 3 (2026-08-03). One conversation turn:
// user text is stripped of context blocks and carries the lasso marker;
// assistant turns render markdown with the Copy .md/.txt row.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('./MarkdownView', () => {
  const {Text} = jest.requireActual('react-native');
  const React2 = jest.requireActual('react');
  return function MarkdownView({text}: {text: string}) {
    return React2.createElement(Text, null, text);
  };
});

import {makeStyles} from './panelStyles';
import {TurnBubble} from './TurnBubble';
import type {ChatTurn} from './src/core/model/types';
import {
  flatText as texts,
  pressByText as press,
} from './src/ui/componentTestUtils';

const styles = makeStyles(1, 1);
const msgText = {fontSize: 14, lineHeight: 20};

const render = (turn: ChatTurn, over: {copied?: string | null; onCopy?: jest.Mock} = {}): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <TurnBubble
        styles={styles}
        turn={turn}
        index={0}
        scale={1}
        msgText={msgText}
        copied={over.copied ?? null}
        onCopy={over.onCopy ?? jest.fn()}
        onLayout={() => {}}
      />,
    );
  });
  return r;
};

describe('TurnBubble smoke', () => {
  it('a user turn with a lasso image shows the 🖼 marker and the bare question', () => {
    const r = render({role: 'user', text: 'Explique ce schéma', hadImage: true} as ChatTurn);
    const t = texts(r);
    expect(t).toContain('🖼 ');
    expect(t).toContain('Explique ce schéma');
    expect(t).not.toContain('Copy .md'); // user turns have no copy row
  });

  it('an assistant turn renders the text and both Copy exits, .txt is de-markdowned', () => {
    const onCopy = jest.fn();
    const r = render({role: 'assistant', text: '**Gras** simple'} as ChatTurn, {onCopy});
    press(r, 'Copy .md');
    expect(onCopy).toHaveBeenCalledWith('**Gras** simple', '0:md');
    press(r, 'Copy .txt');
    expect(onCopy).toHaveBeenCalledWith('Gras simple', '0:txt');
  });

  it('the copied key shows the ✓ on its own button only', () => {
    const r = render({role: 'assistant', text: 'ok'} as ChatTurn, {copied: '0:md'});
    const t = texts(r);
    expect(t).toContain('✓');
    expect(t).toContain('Copy .txt'); // the other exit keeps its label
    expect(t).not.toContain('Copy .md');
  });
});
