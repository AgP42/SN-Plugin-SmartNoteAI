// v0.81 (user): a multi-line text field with a small toolbar — Paste, Clear
// and (when a default is given) Reset to default. Native Android selection
// works fine (select a word, then drag the handle to extend), so there is
// NO "select all" button. Paste pulls the system clipboard; Reset restores
// the shipped default; Clear empties the field.
import React from 'react';
import {
  NativeModules,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';

export function BigTextInput({
  value,
  onChangeText,
  style,
  placeholder,
  scale = 1,
  btnScale = 1,
  onFocus,
  defaultValue,
}: {
  value: string;
  onChangeText: (v: string) => void;
  style?: TextStyle | TextStyle[];
  placeholder?: string;
  scale?: number;
  btnScale?: number;
  onFocus?: (evt?: unknown) => void;
  // When provided, a "Reset to default" button appears (hidden when the
  // value already equals the default).
  defaultValue?: string;
}): React.JSX.Element {
  const bp = {
    paddingHorizontal: 10 * btnScale,
    paddingVertical: 5 * btnScale,
    minHeight: 30 * btnScale,
  };
  const bt = {fontSize: 12 * scale};
  const paste = async (): Promise<void> => {
    try {
      const r = (await (
        NativeModules.SmartNoteAiOverlay as {
          getClipboardText?: () => Promise<{text?: string}>;
        }
      )?.getClipboardText?.()) ?? {};
      const t = typeof r.text === 'string' ? r.text : '';
      if (t.length > 0) {
        onChangeText(value.length > 0 ? `${value}${t}` : t);
      }
    } catch {
      // clipboard best-effort
    }
  };
  return (
    <View>
      <TextInput
        style={style}
        value={value}
        onChangeText={onChangeText}
        multiline
        placeholder={placeholder}
        onFocus={onFocus}
      />
      <View style={styles.row}>
        <TouchableOpacity onPress={paste} style={[styles.btn, bp]}>
          <Text style={[styles.btnText, bt]}>Paste</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onChangeText('')}
          disabled={value.length === 0}
          style={[styles.btn, bp, value.length === 0 && styles.off]}>
          <Text style={[styles.btnText, bt]}>Clear</Text>
        </TouchableOpacity>
        {defaultValue !== undefined && value !== defaultValue ? (
          <TouchableOpacity
            onPress={() => onChangeText(defaultValue)}
            style={[styles.btn, bp]}>
            <Text style={[styles.btnText, bt]}>Reset to default</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6},
  btn: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 7,
    justifyContent: 'center',
  },
  off: {borderColor: '#999999'},
  btnText: {fontWeight: '700', color: '#000000'},
});
