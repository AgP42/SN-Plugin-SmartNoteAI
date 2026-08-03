/**
 * SmartNote AI — entry point.
 *
 * One toolbar button (id 100, showType:1) opens the config page (App).
 * From there you launch the floating assistant panel. On tap we ALSO
 * capture the current page (before the config covers the note) and
 * stash the promise so the panel can ask about it.
 *
 * On init we (1) clear any overlay window left behind by a previous
 * session (ghost windows capture the note's gestures until a device
 * restart), and (2) reclaim disk from stacked old plugin versions.
 * Both best-effort.
 */
import {AppRegistry, Image, NativeModules, ToastAndroid} from 'react-native';
import App from './App';
import SmartNoteAiBubble from './Bubble';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
import {captureCurrent} from './src/native/capture';
import {captureBridge} from './src/native/captureBridge';
import {setCurrentCapture} from './src/native/currentCapture';
import {startAutoScheduler, pokeAuto} from './src/native/autoTranscript';
import {readSettings} from './src/native/settings';
import {sweepTempFiles} from './src/native/tmpJanitor';
import {installHybridSleep} from './src/native/nativeSleep';

// Every core wait (retry sleep, 429 pacing, request watchdog) becomes
// freeze-proof: resolved by the native heartbeat when RN froze JS timers
// (audit 2026-07-30 C2 — a frozen pacing sleep wedged the chat forever).
installHybridSleep();
import {setNavIntent} from './src/native/navIntent';
import {captureLassoImage} from './src/native/lassoCapture';
import {setLassoSeed} from './src/native/lassoSeed';
import {PANEL, applyScreenSize, menuSizeFor, menuOrigin} from './src/ui/panelConfig';
import {setOverlayView} from './src/native/overlayView';

// Two sidebar entries (v0.79.13, user request — the standalone Library
// toolbar button was removed; open the Library from the config Home door
// instead): id 100 opens the config (home), id 102 the floating Chat.
// Both are type 1 (sidebar) / showType 1 (host opens our UI on press);
// each drops a nav intent App reads on mount (config→home, Chat→open the
// overlay and close the config view).
const BUTTON_ID = 100;
const CHAT_BUTTON_ID = 102;
// Lasso toolbar entry (type 2, v0.73): "Ask SmartNote AI" — captures the
// selection as a cropped PNG and opens the chat with it attached.
const LASSO_BUTTON_ID = 200;

// Open the floating chat overlay directly (no config view) — used by the
// lasso action. Screen size first so the panel docks correctly.
const openChatOverlay = async () => {
  const native = NativeModules.SmartNoteAiOverlay;
  if (!native || typeof native.open !== 'function') {
    return;
  }
  try {
    const s = await native.getScreenSize?.();
    if (s && s.success) {
      applyScreenSize(s.width, s.height);
    }
  } catch (e) {
    // fallback dims
  }
  setOverlayView('chat');
  await native.open(PANEL.width, PANEL.height, PANEL.x, PANEL.y).catch(() => {});
};

// v0.85: the toolbar entry opens the compact MENU overlay, docked to the
// toolbar side (settings). The overlay renders the hub (Bubble in menu mode).
const openMenuOverlay = async () => {
  const native = NativeModules.SmartNoteAiOverlay;
  if (!native || typeof native.open !== 'function') {
    return;
  }
  let sw;
  let sh;
  try {
    const s = await native.getScreenSize?.();
    if (s && s.success) {
      sw = s.width;
      sh = s.height;
      applyScreenSize(s.width, s.height);
    }
  } catch (e) {
    // fallback dims
  }
  let side = 'left';
  try {
    const st = await readSettings();
    if (st && st.toolbarSide) {
      side = st.toolbarSide;
    }
  } catch (e) {
    // default left
  }
  const w = sw || 1920;
  const h = sh || 2560;
  const m = menuSizeFor(sw, sh, 6); // 6 cards since the v0.88.1 merge
  const o = menuOrigin(w, h, side, m.width, m.height);
  setOverlayView('menu');
  await native.open(m.width, m.height, o.x, o.y).catch(() => {});
};

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent('SmartNoteAiBubble', () => SmartNoteAiBubble);

PluginManager.init();

// Clear a ghost overlay window from a previous (possibly crashed)
// session. The native window state is static, so this removes a window
// that would otherwise keep capturing the note app's gestures.
try {
  const native = NativeModules.SmartNoteAiOverlay;
  if (native && typeof native.close === 'function') {
    native.close();
  }
} catch (e) {
  console.warn('[SmartNote AI] startup overlay cleanup skipped', String(e));
}

// Janitor: delete older app_<ts>.npk / _libs so installs don't stack
// forever in the plugin dir. Keeps the newest; no-op if none.
(async () => {
  try {
    const dir = await PluginManager.getPluginDirPath();
    const native = NativeModules.SmartNoteAiOverlay;
    if (dir && native && typeof native.cleanupOldVersions === 'function') {
      // cleanupOldVersions rejects on error — await it inside this try so
      // a failure logs instead of surfacing as an unhandled rejection.
      await native.cleanupOldVersions(dir);
    }
  } catch (e) {
    console.warn('[SmartNote AI] janitor skipped', String(e));
  }
})();

PluginManager.registerButtonListener({
  onButtonPress(event) {
    if (!event) {
      return;
    }
    if (event.id === LASSO_BUTTON_ID) {
      // v0.81: capture the lasso as a PNG and seed it into the chat as a
      // PERSISTENT context image (no dedicated agent, no pre-filled prompt —
      // the image quick actions appear in the panel). Then open the overlay.
      (async () => {
        const cap = await captureLassoImage();
        if (!cap) {
          // Never a silent no-op: tell the user the selection wasn't read.
          try {
            ToastAndroid.show(
              'SmartNote AI: could not read the lasso selection.',
              ToastAndroid.SHORT,
            );
          } catch (e) {
            // toast best-effort
          }
          return;
        }
        setLassoSeed({image: cap.image, note: cap.note});
        await openChatOverlay();
      })();
      return;
    }
    if (event.id === BUTTON_ID) {
      // v0.85: capture the current page BEFORE anything covers the note (the
      // assistant and "current page transcript" use it), then open the compact
      // MENU overlay docked to the toolbar side. showType:0 → the host opens no
      // UI of its own; we own the overlay.
      setCurrentCapture(
        captureCurrent(captureBridge()).catch(e => {
          console.warn('[SmartNote AI] capture failed', String(e));
          return null;
        }),
      );
      openMenuOverlay();
    }
  },
});

const buttonIcon = Image.resolveAssetSource(require('./assets/icon.png')).uri;
// v0.85: ONE toolbar entry → the hub menu (Assistant / Library / transcripts /
// Sync / Config / Manual). The old second "Chat" entry is gone; the assistant
// is one tap from the menu. CHAT_BUTTON_ID is kept as a dead alias so any
// lingering intent still routes to the overlay.
// showType 0: the host opens no UI of its own — we open the compact MENU
// overlay ourselves from onButtonPress (like the lasso entry). CHAT_BUTTON_ID
// is gone; the assistant is one tap inside the menu.
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: BUTTON_ID,
  name: 'SmartNote AI Menu',
  icon: buttonIcon,
  showType: 0,
});
// Lasso toolbar (type 2, NOTE only — lasso doesn't exist on PDFs).
// showType 0: no host UI, we open our own overlay from onButtonPress.
// editDataTypes is REQUIRED for a type-2 button: the note app's
// PluginButtonAdapter does `new HashSet(editDataTypes)` while binding the
// lasso toolbar and CRASHES (NPE) if it is absent — the note then closes
// to the parent folder (device 2026-07-21). We handle any selection (we
// crop the region to an image regardless): 0 strokes, 1 title, 2 image,
// 3 text, 4 link, 5 geometric shapes.
PluginManager.registerButton(2, ['NOTE'], {
  id: LASSO_BUTTON_ID,
  name: 'Ask SmartNote AI',
  icon: buttonIcon,
  editDataTypes: [0, 1, 2, 3, 4, 5],
  showType: 0,
});

// ---------------------------------------------------------------------------
// Background auto-transcription (Phase 1, v0.26). Historically Auto ran only
// inside the floating bubble (a setInterval in ChatPanel), so it needed the
// panel open. These init-level listeners run whenever PluginHost has the
// plugin loaded — i.e. while you USE a note/PDF — even with the bubble
// closed. This is the same mechanism SuperTemplate uses (a listener
// registered at load, fired by the host, no persistent UI). Honest limit:
// with the device asleep or the NOTE app fully closed nothing runs (a plugin
// can't be a true Android background service).
//
// v0.36: ONE scheduler (autoTranscript.startAutoScheduler) owns the
// periodic fallback tick; every event just pokes it (debounced there,
// 20 s floor inside the tick itself).
// v0.55 agent pinning: the background scheduler persists (and thus LRU-
// evicts) the store with NO UI mounted — the pinned refs must be known
// BEFORE its first tick can write (audit 2026-07-19 #8: starting the
// scheduler first left a small window where an early poke could evict a
// pinned doc). The scheduler starts once the refs are in, whatever the
// settings read outcome. UI writers (App load, AgentsScreen) re-push
// them whenever the agents change.
readSettings()
  .catch(() => {})
  .then(() => startAutoScheduler(captureBridge()));

// Sweep OUR stale temp files (orphaned batch-upload jsonl / render PNGs)
// — fire-and-forget, logs what it reclaims (the "29 MB" diagnosis).
sweepTempFiles();

try {
  // registerType 1 = normal listener; onMsg gets the page Element[].
  PluginManager.registerEventListener('event_pen_up', 1, {
    onMsg() {
      pokeAuto('pen-up');
    },
  });
} catch (e) {
  console.warn('[SmartNote AI] pen-up listener skipped', String(e));
}

try {
  PluginManager.addPluginLifeListener({
    onStart() {
      // Catch up pages written while the plugin was unloaded, next time it
      // (re)starts. force bypasses the 20 s floor so a fresh load runs once.
      pokeAuto('plugin-start', {force: true});
    },
  });
} catch (e) {
  console.warn('[SmartNote AI] life listener skipped', String(e));
}
