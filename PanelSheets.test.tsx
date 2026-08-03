// Smoke tests for the panel's BROWSE sheets (Lot 0 of the UI refactor).
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
import {
  ContextSheet,
  AddedPagesPopup,
  AddedTranscriptSheet,
  HistorySheet,
} from './PanelSheets';
import {
  flatText as texts,
  instanceText,
  pressByText as press,
} from './src/ui/componentTestUtils';

const styles = makeStyles(1, 1);

describe('ContextSheet', () => {
  it('renders the note name, the three scopes and the page-off toggle', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ContextSheet
          styles={styles}
          btnScale={1}
          open={true}
          noteName="Réunion.note"
          ctxMode="page"
          setCtxMode={() => {}}
          rangeStart=""
          setRangeStart={() => {}}
          rangeEnd=""
          setRangeEnd={() => {}}
          setPanelFocusable={() => {}}
          bornOn=""
          ctxPageOff={false}
          contextSent={true}
          onClose={() => {}}
          onSeeTranscript={() => {}}
          onTogglePageOff={() => {}}
        />,
      );
    });
    const t = texts(r);
    expect(t).toContain('Réunion.note');
    expect(t).toContain('This page');
    expect(t).toContain('Whole note');
    expect(t).toContain('in context');
    expect(t).toContain('Remove the current page');
  });

  it('renders nothing when closed', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ContextSheet
          styles={styles}
          btnScale={1}
          open={false}
          noteName={null}
          ctxMode="page"
          setCtxMode={() => {}}
          rangeStart=""
          setRangeStart={() => {}}
          rangeEnd=""
          setRangeEnd={() => {}}
          setPanelFocusable={() => {}}
          bornOn=""
          ctxPageOff={false}
          contextSent={false}
          onClose={() => {}}
          onSeeTranscript={() => {}}
          onTogglePageOff={() => {}}
        />,
      );
    });
    expect(r.toJSON()).toBeNull();
  });
});

describe('AddedPagesPopup', () => {
  it('lists the refs; sent ones say "in CHAT" instead of a remove button', () => {
    const onRemove = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <AddedPagesPopup
          styles={styles}
          open={true}
          refs={[
            {path: '/n/a.note', page: 2},
            {path: '/n/b.note', page: 0, sent: true},
          ]}
          keyOf={(p, g) => `${p} ${g}`}
          nameOf={p => p.split('/').pop() ?? p}
          onClose={() => {}}
          onRemove={onRemove}
          onSeeTranscript={() => {}}
        />,
      );
    });
    const t = texts(r);
    expect(t).toContain('a.note · p.3'); // 1-based display
    expect(t).toContain('in CHAT');
    // The unsent row's ✕ fires onRemove with its ref. The sheet header
    // close is ALSO a ✕ and comes first in the tree — take the last one.
    const removeBtn = r.root
      .findAll(n => typeof n.props.onPress === 'function')
      .filter(n => instanceText(n) === '✕')
      .pop();
    act(() => {
      removeBtn!.props.onPress();
    });
    expect(onRemove).toHaveBeenCalledWith({path: '/n/a.note', page: 2});
  });
});

describe('AddedTranscriptSheet', () => {
  it('shows the volet title and its markdown text', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <AddedTranscriptSheet
          styles={styles}
          volet={{title: 'Pages ajoutées', text: 'Contenu **transcrit**'}}
          scale={1}
          onClose={() => {}}
        />,
      );
    });
    expect(texts(r)).toContain('Pages ajoutées');
    expect(texts(r)).toContain('Contenu **transcrit**');
  });
});

describe('HistorySheet', () => {
  const meta = (id: string, title: string, agentId?: string) =>
    ({id, title, agentId, updatedAt: new Date(2026, 7, 3, 10, 0).getTime()} as never);

  it('closed: renders nothing', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <HistorySheet
          styles={styles}
          open={false}
          histList={[]}
          currentConvId="c1"
          agents={[]}
          confirmDelId={null}
          fmtDay={() => '3/08'}
          onResume={() => {}}
          onDeleteConv={() => {}}
          onNewChat={() => {}}
          onClose={() => {}}
        />,
      );
    });
    expect(r.toJSON()).toBeNull();
  });

  it('lists conversations: current marker, agent icon, armed delete', () => {
    const onResume = jest.fn();
    const onDeleteConv = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <HistorySheet
          styles={styles}
          open={true}
          histList={[meta('c1', 'Budget mars'), meta('c2', 'Thèse', 'ag1')]}
          currentConvId="c1"
          agents={[{id: 'ag1', icon: '📚'}]}
          confirmDelId="c2"
          fmtDay={() => '3/08'}
          onResume={onResume}
          onDeleteConv={onDeleteConv}
          onNewChat={() => {}}
          onClose={() => {}}
        />,
      );
    });
    const t = texts(r);
    expect(t).toContain('(current) Budget mars');
    expect(t).toContain('📚 Thèse');
    expect(t).toContain('Delete?'); // c2 is armed
    press(r, 'Budget mars');
    expect(onResume).toHaveBeenCalled();
    press(r, 'Delete?');
    expect(onDeleteConv).toHaveBeenCalledWith('c2');
  });

  it('empty: says so and ＋ New starts a chat then closes', () => {
    const onNewChat = jest.fn();
    const onClose = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <HistorySheet
          styles={styles}
          open={true}
          histList={[]}
          currentConvId="c1"
          agents={[]}
          confirmDelId={null}
          fmtDay={() => '3/08'}
          onResume={() => {}}
          onDeleteConv={() => {}}
          onNewChat={onNewChat}
          onClose={onClose}
        />,
      );
    });
    expect(texts(r)).toContain('No saved conversations yet.');
    press(r, '＋ New');
    expect(onNewChat).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
