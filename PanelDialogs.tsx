// The floating panel's DECISION dialogs, extracted from ChatPanel in Lot 2
// (structure split). Pure render: every state and handler stays in the
// panel and arrives as an explicit prop — these components decide nothing.
import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import type {PanelStyles} from './panelStyles';
import type {Agent} from './src/core/agents/agents';

// ---- OFF privacy gate (read an excluded file once, discarded) ----------
export function OffGateDialog(props: {
  styles: PanelStyles;
  ask: {doc: string; path: string} | null;
  onCancel: () => void;
  onOk: () => void;
}): React.JSX.Element | null {
  const {styles, ask} = props;
  if (ask === null) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      <View style={styles.dialog}>
        <Text style={styles.dialogText}>
          "{ask.doc}" is set to Off (excluded from the AI). Read it once to
          answer this question? It is sent to Mistral (EU) and the transcript
          is NOT saved.
        </Text>
        <View style={styles.sheetBtns}>
          <TouchableOpacity onPress={props.onCancel} style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onOk}
            style={[styles.actBtn2, styles.actBtnDark]}>
            <Text style={[styles.actBtn2Text, {color: '#ffffff'}]}>
              Read once, don't save
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---- Agent gaps (v0.55): unread docs at selection ----------------------
export function AgentGapsDialog(props: {
  styles: PanelStyles;
  ask: {agent: Agent; unread: number; euros: string} | null;
  onCancel: () => void;
  onChatAnyway: () => void;
  onReadNow: () => void;
}): React.JSX.Element | null {
  const {styles, ask} = props;
  if (ask === null) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      <View style={styles.dialog}>
        <Text style={styles.dialogText}>
          {ask.agent.icon} {ask.agent.name}: {ask.unread} page(s) of its
          documents are not read yet.{'\n'}Read them now ≈ {ask.euros}€ — or
          chat with what is already in the library.
        </Text>
        <View style={styles.sheetBtns}>
          <TouchableOpacity onPress={props.onCancel} style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={props.onChatAnyway} style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>Chat with what's read</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onReadNow}
            style={[styles.actBtn2, styles.actBtnDark]}>
            <Text style={[styles.actBtn2Text, {color: '#ffffff'}]}>
              Read now
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---- Big-read estimate (> 100 pages, decision U2) -----------------------
export function EstimateDialog(props: {
  styles: PanelStyles;
  ask: {
    count: number;
    euros: string;
    // Present when the real page count cannot be known (an unread PDF): the
    // dialog then states a RANGE rather than a number it cannot back up.
    upTo?: number;
    eurosUpTo?: string;
  } | null;
  onCancel: () => void;
  onRead: () => void;
}): React.JSX.Element | null {
  const {styles, ask} = props;
  if (ask === null) {
    return null;
  }
  const ranged = ask.upTo !== undefined && ask.eurosUpTo !== undefined;
  return (
    <View style={styles.sheetWrap}>
      <View style={styles.dialog}>
        <Text style={styles.dialogText}>
          {ranged
            ? `Read this whole document?\nIts length is not known before reading it — roughly ${ask.count}–${ask.upTo} pages, ${ask.euros}–${ask.eurosUpTo}€.`
            : `Read ${ask.count} pages?\nCost ≈ ${ask.euros}€ · takes a few minutes.`}
        </Text>
        <View style={styles.sheetBtns}>
          <TouchableOpacity onPress={props.onCancel} style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onRead}
            style={[styles.actBtn2, styles.actBtnDark]}>
            <Text style={[styles.actBtn2Text, {color: '#ffffff'}]}>Read</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
