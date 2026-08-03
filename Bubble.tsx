/**
 * SmartNote AI floating shell — rendered by the native overlay module
 * inside a WindowManager window (note visible behind). Owns the window
 * geometry via the native primitives:
 *   • drag   — header PanResponder → move(x, y)
 *   • resize — bottom grip        → resize(w, h)
 *   • snap   — top / bottom / right / full presets (move + resize); the
 *              window stays in normal mode, so it's still draggable and
 *              resizable after snapping.
 *   • collapse — a light bubble (the plugin logo); tap to restore.
 *
 * ChatPanel stays MOUNTED across collapse (it just renders nothing heavy)
 * so the conversation survives collapse/restore.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Image,
  NativeModules,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import ChatPanel, {type SnapKind} from './ChatPanel';
import MenuScreen, {type MenuItem} from './screens/MenuScreen';
import {
  PANEL,
  applyScreenSize,
  menuSizeFor,
  menuOrigin,
} from './src/ui/panelConfig';
import {readSettings, type Settings} from './src/native/settings';
import {subscribeLassoSeed} from './src/native/lassoSeed';
import {consumeOverlayView, type OverlayView} from './src/native/overlayView';
import {setNavIntent} from './src/native/navIntent';
import {setLibTargetIntent} from './src/native/libTargetIntent';
import {captureBridge} from './src/native/captureBridge';
import {captureCurrent} from './src/native/capture';
import {openUserGuide} from './src/native/guideSeed';

const {SmartNoteAiOverlay} = NativeModules;
const THROTTLE_MS = 66;
const COLLAPSED = 132;
const FALLBACK_W = 1920;
const FALLBACK_H = 2560;
// Strip left for the Supernote note toolbar on the user-chosen side, so
// snaps don't cover it. (Approximate; the SDK can't read the host UI.)
const TOOLBAR_SIZE = 110;

type Mode = 'normal' | 'collapsed';

export default function SmartNoteAiBubble(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('normal');
  const modeRef = useRef<Mode>('normal');
  modeRef.current = mode;

  const lastMove = useRef(0);
  const lastResize = useRef(0);
  const toolbarSide = useRef<Settings['toolbarSide']>('left');
  const screen = useRef({w: FALLBACK_W, h: FALLBACK_H});

  const ov = SmartNoteAiOverlay;
  const close = () => ov && ov.close && ov.close();

  // v0.85: the overlay opens on the MENU (hub) or the CHAT (assistant). One
  // window, two formats — switching resizes/moves it.
  const [view, setView] = useState<OverlayView>(() => consumeOverlayView());

  // Geometry refs seeded for the view the window OPENED on (glitch fix
  // 2026-08-03: they were always seeded with the CHAT geometry, and the
  // mount run of the mode effect below yanked a fresh menu window to the
  // chat spot before goMenu moved it back — a visible two-step jump).
  const openGeo = (() => {
    if (view === 'menu') {
      const m = menuSizeFor(FALLBACK_W, FALLBACK_H, 6);
      const o = menuOrigin(FALLBACK_W, FALLBACK_H, 'left', m.width, m.height);
      return {x: o.x, y: o.y, w: m.width, h: m.height};
    }
    return {x: PANEL.x, y: PANEL.y, w: PANEL.width, h: PANEL.height};
  })();
  const pos = useRef({x: openGeo.x, y: openGeo.y});
  const size = useRef({w: openGeo.w, h: openGeo.h});

  const goChat = useCallback(() => {
    pos.current = {x: PANEL.x, y: PANEL.y};
    size.current = {w: PANEL.width, h: PANEL.height};
    ov && ov.move && ov.move(PANEL.x, PANEL.y);
    ov && ov.resize && ov.resize(PANEL.width, PANEL.height);
    setView('chat');
  }, [ov]);

  const goMenu = useCallback(async () => {
    let sw = screen.current.w;
    let sh = screen.current.h;
    try {
      const s = await (ov && ov.getScreenSize && ov.getScreenSize());
      if (s && s.success && s.width && s.height) {
        sw = s.width;
        sh = s.height;
      }
    } catch {
      // fallback dims
    }
    const m = menuSizeFor(sw, sh, 6); // 6 items since the v0.88.1 merge
    const o = menuOrigin(sw, sh, toolbarSide.current, m.width, m.height);
    pos.current = {x: o.x, y: o.y};
    size.current = {w: m.width, h: m.height};
    ov && ov.move && ov.move(o.x, o.y);
    ov && ov.resize && ov.resize(m.width, m.height);
    setView('menu');
  }, [ov]);

  // Open a hosted view (Library / config) from the menu overlay, optionally
  // deep-linking a doc/page, then close the overlay. The hosted view is a
  // separate React root, reached via the nav-intent + libTarget bridges.
  const openHosted = useCallback(
    (intent: string, target: {doc: string; page: number | null} | null) => {
      if (target !== null) {
        setLibTargetIntent(target);
      }
      setNavIntent(intent);
      (
        PluginManager as {showPluginView?: () => Promise<unknown>}
      ).showPluginView?.().catch(() => {});
      close();
    },
    // close is a stable closure over ov; no deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openCurrent = useCallback(
    (pageLevel: boolean) => {
      captureCurrent(captureBridge())
        .then(cap => {
          if (cap === null) {
            return;
          }
          openHosted('library', {
            doc: cap.notePath,
            page: pageLevel ? cap.page : null,
          });
        })
        .catch(() => {});
    },
    [openHosted],
  );

  // Sync the geometry refs when the overlay opened straight on the menu (so a
  // later drag/resize clamps against the small window, not the chat panel).
  const didInitMenu = useRef(false);
  useEffect(() => {
    if (didInitMenu.current || view !== 'menu') {
      return;
    }
    didInitMenu.current = true;
    goMenu();
  }, [view, goMenu]);

  // Read the real panel size once — drag-release clamping needs it so an
  // energetic swipe can never park the window fully off-screen (with
  // FLAG_LAYOUT_NO_LIMITS an off-screen window is invisible AND alive).
  useEffect(() => {
    if (!ov || !ov.getScreenSize) {
      return;
    }
    ov.getScreenSize()
      .then((s: {success?: boolean; width?: number; height?: number}) => {
        if (s && s.success && s.width && s.height) {
          screen.current = {w: s.width, h: s.height};
          // Keep the shared defaults on the 80%-width rule so the
          // "default" snap matches the open size (device feedback).
          applyScreenSize(s.width, s.height);
        }
      })
      .catch(() => {
        // keep fallback
      });
  }, [ov]);

  // Clamp a window origin so the window stays fully on-screen. Reads only
  // refs, so the PanResponders (created once) can capture it safely.
  const clampPos = (x: number, y: number, w: number, h: number) => ({
    x: Math.max(0, Math.min(x, screen.current.w - w)),
    y: Math.max(0, Math.min(y, screen.current.h - h)),
  });
  const clampRef = useRef(clampPos);
  clampRef.current = clampPos;

  // Clamp a resize so the window (whose top-left stays put) cannot grow
  // past the screen edges — the resize handle sits on the bottom-right
  // corner, and an unbounded grow pushed it (and the input row) off-screen
  // with only the snap buttons left to recover (audit 2026-07-18).
  const clampSize = (w: number, h: number) => ({
    w: Math.max(
      PANEL.minWidth,
      Math.min(w, screen.current.w - pos.current.x),
    ),
    h: Math.max(
      PANEL.minHeight,
      Math.min(h, screen.current.h - pos.current.y),
    ),
  });
  const clampSizeRef = useRef(clampSize);
  clampSizeRef.current = clampSize;

  // Read the toolbar side once (settings changes require reopening the
  // panel, which remounts this component and re-reads).
  useEffect(() => {
    let alive = true;
    readSettings().then(s => {
      if (alive && s.toolbarSide) {
        toolbarSide.current = s.toolbarSide;
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Apply window geometry for the current mode. Snaps update the refs and
  // call move/resize directly (mode stays 'normal'), so this effect only
  // handles collapse ↔ restore.
  const modeApplied = useRef(false);
  useEffect(() => {
    if (!ov) {
      return;
    }
    if (!modeApplied.current) {
      // Mount run: the native window ALREADY has its open geometry (set by
      // index.js). Re-applying the refs here is what caused the menu glitch.
      modeApplied.current = true;
      return;
    }
    if (mode === 'collapsed') {
      ov.resize && ov.resize(COLLAPSED, COLLAPSED);
      ov.move && ov.move(pos.current.x, pos.current.y);
    } else {
      // Restoring from a bubble parked near an edge: re-clamp for the
      // full panel size so it comes back entirely on-screen.
      pos.current = clampRef.current(
        pos.current.x,
        pos.current.y,
        size.current.w,
        size.current.h,
      );
      ov.move && ov.move(pos.current.x, pos.current.y);
      ov.resize && ov.resize(size.current.w, size.current.h);
    }
  }, [mode, ov]);

  // A lasso can be fired while the panel is COLLAPSED to a bubble (the
  // window stays open and this component mounted). The seed then reaches
  // ChatPanel's own subscription, which sets the pending image — but the
  // shell must ALSO expand, or the chat stays a bubble and the capture is
  // invisible: the "second lasso → nothing" (and the follow-on "no
  // context", when the user then sends from a bubble that never showed the
  // image). Expand on every seed; a no-op when already 'normal'. We do NOT
  // consume the seed here (ChatPanel owns that) — subscribing only reacts
  // to the notification. The mode-geometry effect resizes the window back
  // to the full panel.
  useEffect(() => subscribeLassoSeed(() => setMode('normal')), []);

  const snap = useCallback(
    async (kind: SnapKind) => {
      if (!ov) {
        return;
      }
      // Restore the initial small floating window (top-left).
      if (kind === 'default') {
        pos.current = {x: PANEL.x, y: PANEL.y};
        size.current = {w: PANEL.width, h: PANEL.height};
        ov.move && ov.move(PANEL.x, PANEL.y);
        ov.resize && ov.resize(PANEL.width, PANEL.height);
        return;
      }
      let w = FALLBACK_W;
      let h = FALLBACK_H;
      try {
        const s = await (ov.getScreenSize && ov.getScreenSize());
        if (s && s.success && s.width && s.height) {
          w = s.width;
          h = s.height;
        }
      } catch {
        // keep fallback
      }
      // Available area = screen minus the toolbar strip on the chosen side.
      const side = toolbarSide.current;
      const inLeft = side === 'left' ? TOOLBAR_SIZE : 0;
      const inRight = side === 'right' ? TOOLBAR_SIZE : 0;
      const inTop = side === 'top' ? TOOLBAR_SIZE : 0;
      const inBottom = side === 'bottom' ? TOOLBAR_SIZE : 0;
      const ax = inLeft;
      const ay = inTop;
      const aw = w - inLeft - inRight;
      const ah = h - inTop - inBottom;
      const third = Math.round(ah / 3);
      // Bottom dock is taller than a third so the chat input clears the
      // on-screen keyboard when it opens.
      const bottomH = Math.round(ah * 0.5);
      let nx = ax;
      let ny = ay;
      let nw = aw;
      let nh = ah;
      if (kind === 'top') {
        nh = third;
      } else if (kind === 'bottom') {
        ny = ay + ah - bottomH;
        nh = bottomH;
      } else if (kind === 'left') {
        nw = Math.round(aw * 0.48);
        nx = ax;
      } else if (kind === 'right') {
        nw = Math.round(aw * 0.48);
        nx = ax + aw - nw;
      }
      // 'full' = the full available area (respecting the toolbar).
      // Clamp so a wrong screen size can never make the window zero-sized
      // or push it off-screen — that looked like it "closed".
      nw = Math.max(PANEL.minWidth, Math.min(nw, w));
      nh = Math.max(PANEL.minHeight, Math.min(nh, h));
      nx = Math.max(0, Math.min(nx, w - nw));
      ny = Math.max(0, Math.min(ny, h - nh));
      pos.current = {x: nx, y: ny};
      size.current = {w: nw, h: nh};
      ov.move && ov.move(nx, ny);
      ov.resize && ov.resize(nw, nh);
    },
    [ov],
  );

  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        modeRef.current === 'normal' &&
        (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
      onPanResponderMove: (_e, g) => {
        const now = Date.now();
        if (now - lastMove.current < THROTTLE_MS) {
          return;
        }
        lastMove.current = now;
        ov && ov.move && ov.move(pos.current.x + g.dx, pos.current.y + g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        pos.current = clampRef.current(
          pos.current.x + g.dx,
          pos.current.y + g.dy,
          size.current.w,
          size.current.h,
        );
        ov && ov.move && ov.move(pos.current.x, pos.current.y);
      },
    }),
  ).current;

  const resizePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const now = Date.now();
        if (now - lastResize.current < THROTTLE_MS) {
          return;
        }
        lastResize.current = now;
        const c = clampSizeRef.current(size.current.w + g.dx, size.current.h + g.dy);
        ov && ov.resize && ov.resize(c.w, c.h);
      },
      onPanResponderRelease: (_e, g) => {
        size.current = clampSizeRef.current(
          size.current.w + g.dx,
          size.current.h + g.dy,
        );
        ov && ov.resize && ov.resize(size.current.w, size.current.h);
      },
    }),
  ).current;

  const collapsedPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const now = Date.now();
        if (now - lastMove.current < THROTTLE_MS) {
          return;
        }
        lastMove.current = now;
        ov && ov.move && ov.move(pos.current.x + g.dx, pos.current.y + g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
          setMode('normal');
        } else {
          pos.current = clampRef.current(
            pos.current.x + g.dx,
            pos.current.y + g.dy,
            COLLAPSED,
            COLLAPSED,
          );
          ov && ov.move && ov.move(pos.current.x, pos.current.y);
        }
      },
    }),
  ).current;

  const collapsed = mode === 'collapsed';

  const menuItems: MenuItem[] = [
    {
      label: '💬 Open the assistant',
      sub: 'Chat / lasso on the current page',
      onPress: goChat,
    },
    {
      label: '📚 Library: Sync, Search & Export',
      sub: 'Sync status · browse, search and export your transcripts',
      onPress: () => openHosted('library', {doc: '', page: null}),
    },
    {
      label: '📄 Current note transcript',
      sub: 'The note / PDF you have open',
      onPress: () => openCurrent(false),
    },
    {
      label: '📃 Current page transcript',
      sub: 'The exact page you are on',
      onPress: () => openCurrent(true),
    },
    {
      label: '⚙ Plugin configuration',
      sub: 'API key · READ · CHAT & agents',
      onPress: () => openHosted('home', null),
    },
    {
      label: '📖 User manual (PDF)',
      sub: 'Open the embedded guide',
      onPress: () => {
        openUserGuide().catch(() => {});
        close();
      },
    },
  ];
  const menuHeaderRight = (): React.JSX.Element => (
    <TouchableOpacity
      onPress={close}
      hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
      <Text style={styles.menuClose}>✕</Text>
    </TouchableOpacity>
  );

  // v0.88.1 (nav schema, user): Menu ↔ Chat is a ROUND TRIP — the menu view
  // used to early-return WITHOUT ChatPanel, unmounting the live conversation
  // (draft lost, convId rotated, Off consent wiped — audit finding). The
  // panel now stays mounted-but-hidden while the menu shows.
  const inMenu = view === 'menu';
  return (
    <View style={styles.fill}>
      {inMenu ? (
        <MenuScreen
          scale={1}
          btnScale={1}
          items={menuItems}
          headerRight={menuHeaderRight}
          headerHandlers={dragPan.panHandlers}
        />
      ) : null}
      <View style={[styles.panelWrap, inMenu ? styles.hiddenKeepMounted : null]}>
        <ChatPanel
          onClose={close}
          onCollapse={() => setMode('collapsed')}
          onSnap={snap}
          onMenu={goMenu}
          collapsed={collapsed || inMenu}
          headerHandlers={dragPan.panHandlers}
        />
      </View>

      {!collapsed && !inMenu ? (
        <View style={styles.resizeHandle} {...resizePan.panHandlers}>
          <Image
            source={require('./assets/ic-resize.png')}
            style={styles.resizeIcon}
          />
        </View>
      ) : null}

      {collapsed && !inMenu ? (
        <View style={styles.collapsedFill} {...collapsedPan.panHandlers}>
          <Image
            source={require('./assets/icon.png')}
            style={styles.collapsedIcon}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#ffffff'},
  // v0.81 (user): a taller bottom bar so the whole bottom edge (and the
  // corner) is grabbable with a FINGER, not just the stylus tip.
  panelWrap: {flex: 1, marginBottom: 30},
  // Kept MOUNTED (conversation state lives there) but invisible and
  // untouchable while the menu view is up.
  hiddenKeepMounted: {display: 'none'},
  resizeHandle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 30,
    backgroundColor: '#000000',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 10,
  },
  resizeIcon: {width: 18, height: 18},
  collapsedFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  collapsedIcon: {width: '100%', height: '100%'},
  menuClose: {fontSize: 16, fontWeight: '700', color: '#000000', paddingHorizontal: 4},
});
