// Component smoke harness — Lot 0 of the UI refactor (2026-08-03).
// Every pure-render component extracted from a big screen gets a smoke
// test THE DAY it is extracted: renders with real-shaped props, shows
// its key texts, fires its callbacks. react-test-renderer only — no
// native views involved.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {makeStyles} from './panelStyles';
import {OffGateDialog, AgentGapsDialog, EstimateDialog} from './PanelDialogs';
import {flatText as texts, pressByText as press} from './src/ui/componentTestUtils';
import type {Agent} from './src/core/agents/agents';

const styles = makeStyles(1, 1);

describe('OffGateDialog', () => {
  it('renders nothing without an ask, renders the consent with one', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <OffGateDialog
          styles={styles}
          ask={null}
          onCancel={() => {}}
          onOk={() => {}}
        />,
      );
    });
    expect(r.toJSON()).toBeNull();
    const onOk = jest.fn();
    act(() => {
      r = create(
        <OffGateDialog
          styles={styles}
          ask={{doc: 'Journal.note', path: '/n/j.note'}}
          onCancel={() => {}}
          onOk={onOk}
        />,
      );
    });
    expect(texts(r)).toContain('Journal.note');
    expect(texts(r)).toContain('NOT saved');
    press(r, "Read once, don't save");
    expect(onOk).toHaveBeenCalled();
  });
});

describe('AgentGapsDialog', () => {
  it('shows the gap count and price, offers the three choices', () => {
    const agent = {id: 'a', name: 'Thèse', icon: '📚', docs: []} as unknown as Agent;
    const onReadNow = jest.fn();
    const onChatAnyway = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <AgentGapsDialog
          styles={styles}
          ask={{agent, unread: 42, euros: '0.17'}}
          onCancel={() => {}}
          onChatAnyway={onChatAnyway}
          onReadNow={onReadNow}
        />,
      );
    });
    expect(texts(r)).toContain('Thèse');
    expect(texts(r)).toContain('42');
    expect(texts(r)).toContain('0.17');
    press(r, "Chat with what's read");
    expect(onChatAnyway).toHaveBeenCalled();
    press(r, 'Read now');
    expect(onReadNow).toHaveBeenCalled();
  });
});

describe('EstimateDialog', () => {
  it('states the page count and cost; Cancel and Read both wired', () => {
    const onCancel = jest.fn();
    const onRead = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <EstimateDialog
          styles={styles}
          ask={{count: 250, euros: '1.05'}}
          onCancel={onCancel}
          onRead={onRead}
        />,
      );
    });
    expect(texts(r)).toContain('250');
    expect(texts(r)).toContain('1.05');
    press(r, 'Cancel');
    expect(onCancel).toHaveBeenCalled();
    press(r, 'Read');
    expect(onRead).toHaveBeenCalled();
  });
});
