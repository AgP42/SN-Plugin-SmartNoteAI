// The background-activity banner (v0.67): shows whatever pipeline is
// running (auto check, wave renders, Mistral job checks) with progress
// and a Stop button, then REMOVES ITSELF when the producer clears the
// activity — no user action needed. Mounted in both the Library and the
// floating panel. No timers on purpose (frozen while overlay-only):
// updates ride the producers' own notifications, lightly throttled for
// e-ink.
import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {
  getActivity,
  requestStop,
  stopRequested,
  subscribeActivity,
  type Activity,
} from '../native/activity';

const BLACK = '#000000';

export default function ActivityBanner({
  scale = 1,
}: {
  scale?: number;
}): React.JSX.Element | null {
  const [act, setAct] = React.useState<Activity | null>(getActivity());
  const [, force] = React.useState(0);
  const last = React.useRef(0);
  React.useEffect(
    () =>
      subscribeActivity(() => {
        const now = Date.now();
        // ≤ ~2 repaints/s on e-ink; a null (work finished) always lands
        // immediately so the banner never lingers.
        if (getActivity() === null || now - last.current > 400) {
          last.current = now;
          setAct(getActivity());
          force(f => f + 1); // reflect stopRequested() flips too
        }
      }),
    [],
  );
  if (act === null) {
    return null;
  }
  const fs = 12 * scale;
  const progress =
    act.total !== undefined && act.total > 0
      ? ` ${act.done ?? 0}/${act.total}`
      : '';
  const stopping = stopRequested();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: BLACK,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginVertical: 4,
        gap: 8,
      }}>
      <Text
        numberOfLines={1}
        style={{flex: 1, fontSize: fs, lineHeight: fs * 1.4, color: BLACK}}>
        {`⚙ ${act.label}${progress}`}
      </Text>
      <TouchableOpacity
        onPress={requestStop}
        disabled={stopping}
        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
        <Text
          style={{
            fontSize: fs,
            fontWeight: '700',
            color: BLACK,
            opacity: stopping ? 0.4 : 1,
          }}>
          {stopping ? 'stopping…' : '✕ Stop'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
