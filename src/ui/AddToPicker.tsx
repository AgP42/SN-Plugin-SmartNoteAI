// "Add to ▾" target picker (v0.75, spec §2a). One control used identically
// on every surface that adds context: Library rows, note overview, page
// view and the floating-window search. It only PICKS a target (CHAT or an
// agent); the caller performs the mutation (contextActions / onToggleAdd),
// which is why it stays surface-agnostic. E-ink note: no colour coding —
// CHAT vs agents read by the 💬 marker and each agent's icon.
import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

export type AddTarget = {kind: 'chat'} | {kind: 'agent'; id: string};

export type PickerAgent = {id: string; icon: string; name: string};

// A minimal generic "label ▾" menu (used for Export .md/.txt, spec §4a).
export function InlineMenu({
  scale,
  btnScale = 1,
  label,
  options,
  disabled = false,
}: {
  scale: number;
  // v0.80.1: the Button-size setting reaches these menus too.
  btnScale?: number;
  label: string;
  options: Array<{key: string; label: string; onPress: () => void}>;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const f = {fontSize: 12 * scale};
  const bp = {
    paddingHorizontal: 10 * btnScale,
    paddingVertical: 6 * btnScale,
    minHeight: 30 * btnScale,
  };
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={[styles.btn, bp, disabled && styles.btnOff]}>
        <Text style={[styles.btnText, f, disabled && styles.btnTextOff]}>
          {label}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.menu}>
          {options.map(o => (
            <TouchableOpacity
              key={o.key}
              onPress={() => {
                o.onPress();
                setOpen(false);
              }}
              style={styles.item}>
              <Text style={[styles.itemText, f]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function AddToPicker({
  scale,
  btnScale = 1,
  label,
  agents,
  showChat = true,
  onPick,
  disabled = false,
}: {
  scale: number;
  // v0.80.1: the Button-size setting reaches these menus too.
  btnScale?: number;
  label: string; // button text, e.g. "+ Add to ▾" or "+ Add 3 p. to ▾"
  agents: PickerAgent[];
  showChat?: boolean;
  onPick: (t: AddTarget) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const f = {fontSize: 12 * scale};
  const bp = {
    paddingHorizontal: 10 * btnScale,
    paddingVertical: 6 * btnScale,
    minHeight: 30 * btnScale,
  };
  const nothing = !showChat && agents.length === 0;
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={() => !disabled && !nothing && setOpen(o => !o)}
        disabled={disabled || nothing}
        style={[styles.btn, bp, (disabled || nothing) && styles.btnOff]}>
        <Text
          style={[styles.btnText, f, (disabled || nothing) && styles.btnTextOff]}>
          {nothing ? 'No agent yet' : label}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.menu}>
          {showChat ? (
            <TouchableOpacity
              onPress={() => {
                onPick({kind: 'chat'});
                setOpen(false);
              }}
              style={styles.item}>
              <Text style={[styles.itemText, f]}>💬 CHAT (this chat)</Text>
            </TouchableOpacity>
          ) : null}
          {agents.map(a => (
            <TouchableOpacity
              key={a.id}
              onPress={() => {
                onPick({kind: 'agent', id: a.id});
                setOpen(false);
              }}
              style={styles.item}>
              <Text style={[styles.itemText, f]} numberOfLines={1}>
                {a.icon} {a.name}
              </Text>
            </TouchableOpacity>
          ))}
          {agents.length === 0 ? (
            <Text style={[styles.empty, f]}>No agents configured</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignSelf: 'flex-start'},
  btn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    // #8 (user 2026-07-25): match the row-end buttons' shared height so the
    // + Add / Export menus line up with the Sync chip and agent badges.
    minHeight: 30,
    justifyContent: 'center',
  },
  btnOff: {borderColor: '#999999'},
  btnText: {color: '#000000', fontWeight: '600'},
  btnTextOff: {color: '#999999'},
  menu: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 8,
    marginTop: 4,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  itemText: {color: '#000000'},
  empty: {color: '#777777', paddingHorizontal: 10, paddingVertical: 8},
});
