// The brain dropdown (v0.79.6) — opened from the header agent name.
// Top row = model + context on the left, New chat / History on the right;
// then the agent list (each row shows its model and knowledge); then the
// last token usage. Extracted VERBATIM from ChatPanel (UI refactor Lot 3,
// 2026-08-03). Pure render: state and model resolution stay in the panel.
import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import type {PanelStyles} from './panelStyles';
import type {Agent} from './src/core/agents/agents';

export type BrainEntry = {
  key: string;
  icon: string;
  name: string;
  id: string | null;
  agent: Agent | null;
};

export function BrainDropdown(props: {
  styles: PanelStyles;
  open: boolean;
  effectiveModel: string;
  entries: BrainEntry[];
  agentId: string | null;
  busy: boolean;
  pendingCtxCount: number;
  // Knowledge of the ACTIVE agent (null when CHAT or no stats yet).
  activeStats: {docs: number; read: number} | null;
  statsFor: (id: string) => {docs: number; read: number} | undefined;
  // The panel resolves each row's model label (agent's own or CHAT's).
  modelLabelFor: (agent: Agent | null) => string;
  lastUsage: {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
  } | null;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onPickAgent: (a: Agent | null) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const {styles} = props;
  if (!props.open) {
    return null;
  }
  return (
    <View style={styles.dropdown}>
      <View style={styles.brainTop}>
        <View style={{flex: 1}}>
          <Text style={styles.brainMeta} numberOfLines={1}>
            {props.effectiveModel}
          </Text>
          {/* v0.80.1 (user): the active agent's knowledge, spelled out. */}
          {props.activeStats !== null ? (
            <Text style={styles.brainMeta} numberOfLines={1}>
              {`knows ${props.activeStats.docs} doc(s) · ${props.activeStats.read} page(s) read`}
            </Text>
          ) : null}
          {props.pendingCtxCount > 0 ? (
            <Text style={styles.brainMeta} numberOfLines={1}>
              {props.pendingCtxCount} context page(s)
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => {
            props.onClose();
            props.onNewChat();
          }}
          disabled={props.busy}
          style={styles.brainTopBtn}>
          <Text style={styles.brainTopBtnText}>＋ New chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            props.onClose();
            props.onOpenHistory();
          }}
          disabled={props.busy}
          style={styles.brainTopBtn}>
          <Text style={styles.brainTopBtnText}>🕘 History</Text>
        </TouchableOpacity>
      </View>
      {props.entries.map(b => {
        const on =
          (b.id === null && props.agentId === null) || b.id === props.agentId;
        return (
          <TouchableOpacity
            key={b.key}
            onPress={() => {
              props.onPickAgent(b.agent);
              props.onClose();
            }}
            style={styles.dropItem}>
            <Text
              style={[styles.dropItemText, on && styles.dropItemTextOn]}
              numberOfLines={1}>
              {on ? '● ' : '○ '}
              {b.icon} {b.name}
              {/* v0.81 (user): each row shows the MODEL it runs on (the
                  agent's own, or the CHAT model when unset). */}
              {` · ${props.modelLabelFor(b.agent)}`}
              {/* v0.80.1 (user): an agent row SHOWS its knowledge — how
                  many docs / transcribed pages ride with every question
                  (it looked empty even with folders attached). */}
              {b.id !== null && props.statsFor(b.id) !== undefined
                ? ` · ${props.statsFor(b.id)!.docs} docs · ${
                    props.statsFor(b.id)!.read
                  } p`
                : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
      {props.lastUsage ? (
        <Text style={styles.dropUsage} numberOfLines={1}>
          last: {props.lastUsage.inputTokens} in
          {props.lastUsage.cachedTokens > 0
            ? ` (${props.lastUsage.cachedTokens} cached −90%)`
            : ''}{' '}
          · {props.lastUsage.outputTokens} out
        </Text>
      ) : null}
    </View>
  );
}
