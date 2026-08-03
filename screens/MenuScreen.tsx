// v0.85 (user): the plugin HUB. One toolbar entry ("SmartNote AI") lands here
// instead of two crowded entries; from this menu you reach every surface —
// the assistant, the Library, the current note/page transcript, sync,
// configuration and the user manual. App owns the actions; this screen just
// renders them as a clean, scalable list.
import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const APP_ICON = require('../assets/icon.png');

export type MenuItem = {
  label: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
};

export default function MenuScreen({
  scale,
  btnScale,
  items,
  headerRight,
  headerHandlers,
}: {
  scale: number;
  btnScale: number;
  items: MenuItem[];
  headerRight: () => React.JSX.Element;
  // When present, the header acts as a drag handle (overlay menu).
  headerHandlers?: object;
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.header} {...(headerHandlers ?? {})}>
        <View style={styles.titleRow}>
          <Image source={APP_ICON} style={styles.titleIcon} resizeMode="contain" />
          <Text style={[styles.title, {fontSize: 20 * scale}]}>SmartNote AI · Menu</Text>
        </View>
        {headerRight()}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {items.map((it, i) => (
          <TouchableOpacity
            key={i}
            onPress={it.onPress}
            disabled={it.disabled === true}
            style={[
              styles.item,
              {paddingVertical: 14 * btnScale},
              it.disabled === true && styles.itemOff,
            ]}>
            <Text style={[styles.itemLabel, {fontSize: 15 * scale}]}>
              {it.label}
            </Text>
            {it.sub !== undefined ? (
              <Text style={[styles.itemSub, {fontSize: 12 * scale}]}>{it.sub}</Text>
            ) : null}
          </TouchableOpacity>
        ))}
        <View style={{height: 24}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: '#000000',
  },
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  titleIcon: {width: 26, height: 26},
  title: {fontWeight: '800', color: '#000000'},
  body: {padding: 16, gap: 12},
  item: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 10,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
  itemOff: {borderColor: '#aaaaaa'},
  itemLabel: {fontWeight: '700', color: '#000000'},
  itemSub: {color: '#555555', marginTop: 3},
});
