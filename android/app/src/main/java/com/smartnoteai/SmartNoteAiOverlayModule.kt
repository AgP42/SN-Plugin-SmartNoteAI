package com.smartnoteai

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import com.facebook.react.ReactInstanceManager
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactRootView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.UiThreadUtil
import com.ratta.supernote.pluginlib.modules.PluginModule

/**
 * SmartNoteAiOverlayModule — Phase 1 Path B native overlay skeleton.
 *
 * History
 * -------
 *
 * 2026-05-08 (logcat.txt:1554, kbpguk1qf26zp9ui): the first iteration
 * tried only Activity-attached window types (TYPE_APPLICATION_PANEL
 * etc.) and bailed on `getCurrentActivity() returned null` because
 * `showType: 0` runs the JS bundle headless inside the plugin host
 * process, with no foreground Activity in our process. So `addView`
 * was never even attempted — the popup never opened.
 *
 * What the same logcat proved positively
 * --------------------------------------
 *
 * After the button tap (13:03:07.x), zero `RattaSnNoteLib:
 * HandWriteClient: sendFullScreenDisableArea` lines were emitted —
 * compare ~16 such lines per plugin open in the previous showType:1
 * run. So `showType: 0` is honoured: the firmware does NOT lock the
 * page when our button fires. That validates the headless approach.
 *
 * Current strategy (this iteration)
 * ---------------------------------
 *
 * Without an Activity, we have to use a SYSTEM-level window type and
 * the Application context's WindowManager. That requires
 * SYSTEM_ALERT_WINDOW permission on Android 8+. The plugin host
 * (com.ratta.supernote.pluginhost) may or may not have declared SAW;
 * we check `Settings.canDrawOverlays()` at runtime and log the
 * result, then attempt the system window types in this order:
 *
 *   1. TYPE_APPLICATION_OVERLAY (2038)  — sanctioned post-Android 8.
 *   2. TYPE_PHONE (2002)                — pre-Oreo path; deprecated
 *      but still permitted on some firmware builds.
 *   3. TYPE_SYSTEM_ALERT (2003)         — same vintage as TYPE_PHONE.
 *   4. TYPE_TOAST (2005)                — historically permission-
 *      free, restricted on newer Android, kept as last-resort
 *      diagnostic.
 *
 * If `currentActivity` IS available (some future flow may foreground
 * one), we still prefer Activity-attached sub-window types first —
 * those don't need SAW.
 *
 * Each attempt is logged; the Promise resolves with a structured
 * `{success, code, message}` result so the JS side can branch
 * deterministically and so a logcat dump tells the full story
 * without needing the JS log.
 */
class SmartNoteAiOverlayModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "SmartNoteAiOverlay"
    private const val MODULE_NAME = "SmartNoteAiOverlay"

    // Sub-window types (need an Activity token).
    private const val FIRST_SUB_WINDOW = 1000
    private const val TYPE_APPLICATION_PANEL = FIRST_SUB_WINDOW + 2
    private const val TYPE_APPLICATION_ATTACHED_DIALOG = FIRST_SUB_WINDOW + 4

    // System-level window types (need SAW permission on Android 8+).
    // Surfaced as constants so the Kotlin compiler is happy without
    // pulling in the framework's @hide flags.
    private const val TYPE_PHONE = 2002
    private const val TYPE_SYSTEM_ALERT = 2003
    private const val TYPE_TOAST = 2005
    private const val TYPE_APPLICATION_OVERLAY = 2038

    // Visual chrome — kept in pixels (not dp) because the e-ink panel
    // pixel density is fixed per device and the overlay is sized in
    // raw pixels via WindowManager.LayoutParams (no Configuration
    // scaling). Tuned for visibility on the Carta-class panels every
    // Supernote uses.
    private const val BORDER_WIDTH_PX = 4
    private const val CORNER_RADIUS_PX = 12f
    private const val INNER_PADDING_PX = 12

    // JS-side AppRegistry key for the React component mounted inside
    // the overlay. Registered in index.js via
    // AppRegistry.registerComponent("SmartNoteAiBubble", () => …).
    // Keep this string in sync with the JS registration.
    private const val REACT_OVERLAY_COMPONENT = "SmartNoteAiBubble"

    // sn-plugin-lib registers PluginModule under this name (defined as
    // NativePluginManagerSpec.NAME in the SDK's codegen at
    // build/generated/.../NativePluginManagerSpec.java:27). We use it
    // for the string-based getNativeModule lookup in step 1 of the
    // reflection chain — class-based lookup throws because the SDK
    // doesn't carry a @ReactModule annotation on PluginModule.
    private const val MODULE_NAME_NATIVE_PLUGIN_MANAGER = "NativePluginManager"

    // Overlay window state is STATIC (process-wide), not per-instance.
    // PluginHost can recreate this module across a closePluginView /
    // re-open cycle; a per-instance reference would leave the previous
    // instance's window orphaned in the WindowManager — a ghost window
    // that keeps capturing input and can only be cleared by a device
    // restart (and re-adding on top of it crashes the window manager).
    // Keeping it static means any instance can find and remove the one
    // live overlay before opening again.
    private var overlayView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var hostWindowManager: WindowManager? = null

    // Heartbeat state is STATIC for the same reason as the window above
    // (audit 2026-07-19 D1): PluginHost recreates the module across
    // close/re-open cycles, and a per-instance Runnable kept re-posting
    // itself every 2.5 s FOREVER (each recreation orphaned one more —
    // doubled events, log spam, no way to stop them). Static state lets
    // any instance cancel the one live runnable before starting its own.
    private var heartbeat: Runnable? = null
    private val heartbeatHandler =
        android.os.Handler(android.os.Looper.getMainLooper())

    // v0.79.14 "Sync on-going" bubble — a SEPARATE, lightweight native
    // window (no React) whose only job is to hold FLAG_KEEP_SCREEN_ON so a
    // long Auto drain keeps running instead of the device sleeping mid-way.
    // Tapping it emits SmartNoteAiSyncStop (JS stops the keep-awake drain).
    // Static for the same close/re-open reason as the overlay above.
    private var syncView: View? = null
    private var syncWm: WindowManager? = null
    private var syncLabel: TextView? = null
    // Backstop: if JS dies without calling stopSyncAwake, the screen would
    // stay on forever. A watchdog removes the window on its own; every
    // start/update renews it.
    private var syncWatchdog: Runnable? = null
    private const val SYNC_STOP_EVENT = "SmartNoteAiSyncStop"
    private const val SYNC_WATCHDOG_MS = 10L * 60_000L
  }

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun open(width: Double, height: Double, x: Double, y: Double, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] open requested width=$width height=$height x=$x y=$y")
    // open() is invoked on the React Native bridge thread
    // (mqt_native_modules), not the UI thread. Everything below
    // creates/touches Android Views and calls WindowManager.addView,
    // both of which must run on the main thread — otherwise the
    // resulting ViewRootImpl claims the bridge thread as the
    // "owning" thread and the next time RN's UIManager (on main
    // thread) tries to populate our ReactRootView's children it
    // throws CalledFromWrongThreadException. The 2026-05-08 16:42
    // device run hit exactly that exception (logcat ViewRootImpl
    // checkThread → ViewGroup.addView → ReactViewGroupManager).
    //
    // UiThreadUtil.runOnUiThread posts to the main looper if not
    // already on it, so reflection helpers below run on the main
    // thread for the rest of the open() flow.
    UiThreadUtil.runOnUiThread { openOnUiThread(width, height, x, y, promise) }
  }

  private fun openOnUiThread(
      width: Double,
      height: Double,
      x: Double,
      y: Double,
      promise: Promise,
  ) {
    val appContext = reactApplicationContext.applicationContext
    val canDrawOverlays = canDrawOverlays(appContext)
    Log.i(TAG, "[SMARTPAPER_OVERLAY] open: canDrawOverlays=$canDrawOverlays " +
        "sdkInt=${Build.VERSION.SDK_INT}")

    if (overlayView != null) {
      // Already open: KEEP it — do NOT tear down and recreate. A teardown
      // unmounts the React panel and remounts it fresh, which races with the
      // lasso seed's one-shot consume: the seed set on the live panel is lost
      // when it remounts, so a lasso fired while the chat is already open
      // showed nothing (device 2026-07-21). It would also reset a window the
      // user has moved/resized. The live panel is already visible and a fresh
      // seed reaches it through its subscription; nothing to recreate.
      Log.i(TAG, "[SMARTPAPER_OVERLAY] open: overlay already exists; keeping it")
      // v0.88 (audit): PluginHost may have recreated this MODULE (fresh React
      // context) while the window survived — the live heartbeat runnable then
      // still emits into the DEAD context and the new JS never hears a beat
      // (context poll and pokes silently stop). Rebind it to THIS instance.
      startHeartbeat()
      promise.resolve(buildResult(true, "ALREADY_OPEN", "Overlay already open"))
      return
    }

    val activity = currentActivity
    val attempts = mutableListOf<AttemptResult>()

    // 1. Activity-attached sub-windows — preferred when available
    //    because they don't need SAW.
    if (activity != null) {
      Log.i(TAG, "[SMARTPAPER_OVERLAY] open: foreground activity=" +
          "${activity.javaClass.name}; trying sub-window types first")
      val subWindowTypes = listOf(
          "TYPE_APPLICATION_PANEL" to TYPE_APPLICATION_PANEL,
          "TYPE_APPLICATION_ATTACHED_DIALOG" to TYPE_APPLICATION_ATTACHED_DIALOG,
      )
      for ((typeName, typeValue) in subWindowTypes) {
        val r = tryAddView(
            label = typeName,
            type = typeValue,
            wm = activity.windowManager,
            context = activity,
            width = width, height = height, x = x, y = y,
            tokenSource = activity,
        )
        attempts.add(r)
        if (r.success) {
          succeed(promise, attempts, r)
          return
        }
      }
    } else {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] open: getCurrentActivity() returned null; " +
          "skipping sub-window types and falling through to system windows")
    }

    // 2. System window types — work without an Activity, but most
    //    require SAW permission on Android 8+.
    val systemWindowTypes = mutableListOf<Pair<String, Int>>()
    systemWindowTypes.add("TYPE_APPLICATION_OVERLAY" to TYPE_APPLICATION_OVERLAY)
    systemWindowTypes.add("TYPE_PHONE" to TYPE_PHONE)
    systemWindowTypes.add("TYPE_SYSTEM_ALERT" to TYPE_SYSTEM_ALERT)
    systemWindowTypes.add("TYPE_TOAST" to TYPE_TOAST)

    val systemWm = appContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    if (systemWm == null) {
      val msg = "Application context has no WINDOW_SERVICE — cannot fall back."
      Log.e(TAG, "[SMARTPAPER_OVERLAY] open: $msg")
      attempts.add(AttemptResult("APP_CONTEXT_WM", false, msg))
      fail(promise, attempts, "NO_WINDOW_MANAGER", msg, canDrawOverlays)
      return
    }

    for ((typeName, typeValue) in systemWindowTypes) {
      val r = tryAddView(
          label = typeName,
          type = typeValue,
          wm = systemWm,
          context = appContext,
          width = width, height = height, x = x, y = y,
          tokenSource = null,
      )
      attempts.add(r)
      if (r.success) {
        succeed(promise, attempts, r)
        return
      }
    }

    Log.e(TAG, "[SMARTPAPER_OVERLAY] open: ALL window types failed")
    fail(
        promise = promise,
        attempts = attempts,
        code = if (canDrawOverlays) "ADD_VIEW_FAILED" else "NO_OVERLAY_PERMISSION",
        message = "addView failed for every window type. canDrawOverlays=" +
            "$canDrawOverlays. " +
            (if (!canDrawOverlays)
              "The plugin host process does not hold SYSTEM_ALERT_WINDOW; " +
              "system window types require it on Android 8+. " +
              "Resolution requires either: (a) the firmware vendor adds " +
              "SAW to com.ratta.supernote.pluginhost's manifest, or (b) " +
              "the plugin framework exposes a sanctioned overlay API. " +
              "See playbook/log/2026-05-08-phase1-derisk-popup.md."
            else
              "SAW is granted but every type still failed; check the " +
              "per-type messages in the attempts list."),
        canDrawOverlays = canDrawOverlays,
    )
  }

  /**
   * Copy plain text to the Android system clipboard via
   * ClipboardManager.setPrimaryClip(...).
   *
   * Note: this puts text on the OS clipboard so it can be pasted in
   * other Android apps (browser, email, etc.). It does NOT populate
   * the firmware's element clipboard that the Supernote lasso-Paste
   * menu reads from — Dunn confirmed in the 2026-05-01 message that
   * `pushElementsToClipboard` is planned for the next SDK version
   * but not yet exposed (requirements §3.3 / §10.6). When the SDK
   * gains it, we'll wire a separate "insert as page element" path.
   */
  @ReactMethod
  fun copyToClipboard(text: String, label: String?, promise: Promise) {
    Log.i(TAG,
        "[SMARTPAPER_OVERLAY] copyToClipboard requested " +
        "label=${label ?: "(default)"} length=${text.length}")
    UiThreadUtil.runOnUiThread { copyToClipboardOnUiThread(text, label, promise) }
  }

  private fun copyToClipboardOnUiThread(
      text: String,
      label: String?,
      promise: Promise,
  ) {
    val ctx = reactApplicationContext.applicationContext
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    if (cm == null) {
      Log.e(TAG, "[SMARTPAPER_OVERLAY] copyToClipboard: CLIPBOARD_SERVICE unavailable")
      promise.resolve(buildResult(success = false, code = "NO_CLIPBOARD_SERVICE",
          message = "Application context has no CLIPBOARD_SERVICE"))
      return
    }
    try {
      val clip = ClipData.newPlainText(label ?: "Copilot", text)
      cm.setPrimaryClip(clip)
      Log.i(TAG, "[SMARTPAPER_OVERLAY] copyToClipboard: SUCCESS")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Copied ${text.length} chars to system clipboard"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] copyToClipboard threw: $msg", e)
      promise.resolve(buildResult(success = false, code = "CLIPBOARD_THREW",
          message = msg))
    }
  }

  /**
   * Returns the actual screen dimensions of the underlying Android
   * Display via `Display.getRealSize()` — this is the panel's real
   * pixel size for whatever device we're on, in the current
   * orientation, regardless of system bars.
   *
   * Works on every Supernote device the SDK supports (A5, A6, A6X,
   * A5X, A6X2/Nomad, A5X2/Manta) without us having to ship a
   * device-type → dimensions table. Same callsite handles 7.8" and
   * 10.3" panels and portrait/landscape rotations.
   *
   * Returns `{success, width, height, message}` — same convention as
   * the other methods, so the JS side branches on `success`.
   */
  @ReactMethod
  fun getScreenSize(promise: Promise) {
    val ctx = reactApplicationContext.applicationContext
    val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    if (wm == null) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] getScreenSize: WINDOW_SERVICE unavailable")
      promise.resolve(buildScreenSizeResult(false, 0, 0,
          "WINDOW_SERVICE unavailable on application context"))
      return
    }
    return try {
      val display = wm.defaultDisplay
      val size = Point()
      display.getRealSize(size)
      Log.i(TAG, "[SMARTPAPER_OVERLAY] getScreenSize: width=${size.x} height=${size.y}")
      promise.resolve(buildScreenSizeResult(true, size.x, size.y, "OK"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] getScreenSize: $msg", e)
      promise.resolve(buildScreenSizeResult(false, 0, 0, msg))
    }
  }

  @ReactMethod
  fun move(x: Double, y: Double, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] move requested x=$x y=$y")
    // Same UI-thread requirement as open() — wm.updateViewLayout
    // touches the view hierarchy and must run on the thread that
    // owns the ViewRootImpl (which is the main thread because we
    // open() on the main thread).
    UiThreadUtil.runOnUiThread { moveOnUiThread(x, y, promise) }
  }

  private fun moveOnUiThread(x: Double, y: Double, promise: Promise) {
    val view = overlayView
    val viewParams = layoutParams
    val wm = hostWindowManager
    if (view == null || viewParams == null || wm == null) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] move: no overlay open")
      promise.resolve(buildResult(success = false, code = "NOT_OPEN",
          message = "move() called before open()"))
      return
    }
    viewParams.x = x.toInt()
    viewParams.y = y.toInt()
    try {
      wm.updateViewLayout(view, viewParams)
      Log.i(TAG, "[SMARTPAPER_OVERLAY] move: SUCCESS x=${viewParams.x} y=${viewParams.y}")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Overlay moved to x=${viewParams.x} y=${viewParams.y}"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] move: $msg", e)
      promise.resolve(buildResult(success = false, code = "UPDATE_FAILED",
          message = msg))
    }
  }

  /**
   * Resize the overlay window in place. Same primitive as move() but
   * updates width/height instead of x/y — crucially it reuses the
   * existing view + ReactRootView (no remount), so the chat's React
   * state (messages, input, scroll) survives a resize. Callers clamp
   * to sane bounds on the JS side (min size, screen size).
   */
  @ReactMethod
  fun resize(width: Double, height: Double, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] resize requested width=$width height=$height")
    UiThreadUtil.runOnUiThread { resizeOnUiThread(width, height, promise) }
  }

  private fun resizeOnUiThread(width: Double, height: Double, promise: Promise) {
    val view = overlayView
    val viewParams = layoutParams
    val wm = hostWindowManager
    if (view == null || viewParams == null || wm == null) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] resize: no overlay open")
      promise.resolve(buildResult(success = false, code = "NOT_OPEN",
          message = "resize() called before open()"))
      return
    }
    viewParams.width = width.toInt()
    viewParams.height = height.toInt()
    try {
      wm.updateViewLayout(view, viewParams)
      Log.i(TAG, "[SMARTPAPER_OVERLAY] resize: SUCCESS " +
          "width=${viewParams.width} height=${viewParams.height}")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Overlay resized to ${viewParams.width}x${viewParams.height}"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] resize: $msg", e)
      promise.resolve(buildResult(success = false, code = "UPDATE_FAILED",
          message = msg))
    }
  }

  /**
   * Toggle the overlay's focusability at runtime (v0.70, gesture-bug fix).
   * The window opens NON-FOCUSABLE so it can never hold the system input
   * focus (which broke the note app's 2-finger lasso). But the chat
   * TextInput needs the keyboard, which requires a focusable window — so
   * JS calls this with `true` the instant the input is about to focus and
   * `false` when it blurs. Between those, the window is back to
   * non-focusable and cannot steal focus. Uses updateViewLayout like
   * resize/move. FLAG_NOT_TOUCH_MODAL / LAYOUT_NO_LIMITS are preserved.
   */
  @ReactMethod
  fun setPanelFocusable(focusable: Boolean, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val view = overlayView
      val viewParams = layoutParams
      val wm = hostWindowManager
      if (view == null || viewParams == null || wm == null) {
        promise.resolve(buildResult(success = false, code = "NOT_OPEN",
            message = "setPanelFocusable() called before open()"))
        return@runOnUiThread
      }
      viewParams.flags = if (focusable) {
        viewParams.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
      } else {
        viewParams.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
      }
      try {
        wm.updateViewLayout(view, viewParams)
        promise.resolve(buildResult(success = true, code = "OK",
            message = "focusable=$focusable"))
      } catch (e: Throwable) {
        val msg = "${e.javaClass.simpleName}: ${e.message}"
        Log.e(TAG, "[SMARTPAPER_OVERLAY] setPanelFocusable: $msg", e)
        promise.resolve(buildResult(success = false, code = "UPDATE_FAILED",
            message = msg))
      }
    }
  }

  /**
   * Jump the host app to a specific page of a note (or PDF). Fires the same
   * ACTION_VIEW intent the Dashboard plugin uses: the note editor
   * (NoteInsidePagesActivity) for .note, the Document viewer for .pdf, with
   * `file_path` + a 1-based `page` extra. The action is REQUIRED or the
   * file_path extra is ignored; NEW_TASK is required to start an Activity
   * from the (activity-less) plugin host process. The floating overlay is a
   * system window and stays on top, so the user keeps SmartNote AI while the
   * page they searched for opens underneath.
   */
  @ReactMethod
  fun openNoteAt(path: String, page: Double, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] openNoteAt path=$path page=$page")
    try {
      val isPdf = path.endsWith(".pdf", ignoreCase = true)
      val intent = Intent()
      intent.component =
          if (isPdf) {
            ComponentName(
                "com.supernote.document",
                "com.supernote.document.MainActivity",
            )
          } else {
            ComponentName(
                "com.ratta.supernote.note",
                "com.ratta.supernote.note.view.NoteInsidePagesActivity",
            )
          }
      intent.putExtra("file_path", path)
      // Callers pass a 1-based page. The NOTE app wants exactly that; the
      // DOCUMENT app counts from 0, so the same number landed one page too
      // far on PDFs (device report 2026-08-01: "Go to this page" opened the
      // next page). Convert per host.
      val p = page.toInt()
      val target = if (isPdf) (p - 1).coerceAtLeast(0) else p
      if (p > 0) {
        intent.putExtra("page", target)
      }
      intent.action = Intent.ACTION_VIEW
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(buildResult(true, "OK", "Opened $path p$p (extra=$target)"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] openNoteAt: $msg", e)
      promise.resolve(buildResult(false, "OPEN_FAILED", msg))
    }
  }

  @ReactMethod
  fun close(promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] close requested")
    // wm.removeView() and ReactRootView.unmountReactApplication()
    // both touch the view hierarchy and must run on the main thread.
    UiThreadUtil.runOnUiThread { closeOnUiThread(promise) }
  }

  // -------------------------------------------------------------------
  // "Sync on-going" keep-awake bubble (v0.79.14, user request)
  // -------------------------------------------------------------------

  @ReactMethod
  fun startSyncAwake(label: String, promise: Promise) {
    UiThreadUtil.runOnUiThread { startSyncAwakeOnUiThread(label, promise) }
  }

  @ReactMethod
  fun updateSyncAwake(label: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val tv = syncLabel
      if (tv != null) {
        tv.text = label
        renewSyncWatchdog()
        promise.resolve(buildResult(true, "OK", "updated"))
      } else {
        promise.resolve(buildResult(false, "NOT_OPEN", "no sync bubble"))
      }
    }
  }

  @ReactMethod
  fun stopSyncAwake(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val removed = removeSyncBubble()
      promise.resolve(
          buildResult(true, if (removed) "REMOVED" else "NONE", "stopped"))
    }
  }

  private fun startSyncAwakeOnUiThread(label: String, promise: Promise) {
    // Already up: just update the text (one window, renew watchdog).
    val existing = syncLabel
    if (syncView != null && existing != null) {
      existing.text = label
      renewSyncWatchdog()
      promise.resolve(buildResult(true, "ALREADY_OPEN", "sync bubble already up"))
      return
    }
    val appContext = reactApplicationContext.applicationContext
    val view = buildSyncBubbleView(appContext, label)

    // Reuse the same window-type fallback ladder as the main overlay.
    val activity = currentActivity
    if (activity != null) {
      for (type in listOf(TYPE_APPLICATION_PANEL, TYPE_APPLICATION_ATTACHED_DIALOG)) {
        if (addSyncView(view, type, activity.windowManager, activity)) {
          promise.resolve(buildResult(true, "OK", "sync bubble up (sub-window)"))
          return
        }
      }
    }
    val systemWm = appContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    if (systemWm != null) {
      for (type in listOf(
          TYPE_APPLICATION_OVERLAY, TYPE_PHONE, TYPE_SYSTEM_ALERT, TYPE_TOAST)) {
        if (addSyncView(view, type, systemWm, null)) {
          promise.resolve(buildResult(true, "OK", "sync bubble up (system)"))
          return
        }
      }
    }
    promise.resolve(buildResult(false, "ADD_VIEW_FAILED", "could not show the sync bubble"))
  }

  private fun addSyncView(
      view: View, type: Int, wm: WindowManager, tokenSource: Activity?,
  ): Boolean {
    val flags = (
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
    )
    val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        type, flags, PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
    params.y = dp(12)
    if (tokenSource != null) {
      params.token = tokenSource.window.decorView.windowToken
    }
    return try {
      wm.addView(view, params)
      syncView = view
      syncWm = wm
      renewSyncWatchdog()
      Log.i(TAG, "[SMARTPAPER_OVERLAY] sync bubble added ($type)")
      true
    } catch (e: Throwable) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] sync bubble $type failed: ${e.message}")
      false
    }
  }

  private fun buildSyncBubbleView(context: Context, label: String): View {
    val bg = GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      setColor(Color.WHITE)
      setStroke(dp(2), Color.BLACK)
      cornerRadius = dp(18).toFloat()
    }
    val tv = TextView(context).apply {
      tag = "syncLabel" // v0.88: findable again after a failed removeView
      text = label
      textSize = 14f
      setTextColor(Color.BLACK)
      setPadding(dp(16), dp(9), dp(16), dp(9))
      background = bg
    }
    tv.setOnClickListener {
      // Ask JS to stop the keep-awake drain; JS then calls stopSyncAwake.
      try {
        reactApplicationContext
            .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(SYNC_STOP_EVENT, null)
      } catch (e: Throwable) {
        Log.w(TAG, "[SMARTPAPER_OVERLAY] sync stop emit: ${e.message}")
      }
      // Remove now for responsiveness (the JS stop is idempotent).
      removeSyncBubble()
    }
    syncLabel = tv
    return tv
  }

  private fun renewSyncWatchdog() {
    syncWatchdog?.let { heartbeatHandler.removeCallbacks(it) }
    val r = Runnable {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] sync bubble watchdog fired — removing")
      removeSyncBubble()
    }
    syncWatchdog = r
    heartbeatHandler.postDelayed(r, SYNC_WATCHDOG_MS)
  }

  private fun removeSyncBubble(): Boolean {
    syncWatchdog?.let { heartbeatHandler.removeCallbacks(it) }
    syncWatchdog = null
    val view = syncView ?: return false
    val wm = syncWm
    syncView = null
    syncWm = null
    syncLabel = null
    if (wm == null) return false
    return try {
      wm.removeView(view)
      true
    } catch (e: Throwable) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] removeSyncBubble: ${e.message}")
      if (view.isAttachedToWindow) {
        syncView = view
        syncWm = wm
        // v0.88 (audit): syncLabel must come back too — without it the next
        // startSyncAwake missed the reuse path, added a SECOND bubble and
        // orphaned this one with FLAG_KEEP_SCREEN_ON (device never sleeps).
        syncLabel = view.findViewWithTag("syncLabel") as? android.widget.TextView
      }
      false
    }
  }

  // Open a file in the SYSTEM reader so its app is running and can host the
  // renderer (PDF page rendering via generateDocImage is host-bound; the SDK's
  // FileUtils.openFilePath only opens the file manager). Same intent the
  // Dashboard plugin uses. The reader launches BEHIND our plugin view, so the
  // plugin keeps running and its Vision loop continues — the newly-running
  // document app is what generateDocImage then resolves against.
  // (v0.84.5, host-switch for PDF Vision.)
  @ReactMethod
  fun openInReader(path: String, promise: Promise) {
    try {
      val comp = if (path.lowercase().endsWith(".pdf")) {
        ComponentName(
            "com.supernote.document", "com.supernote.document.MainActivity")
      } else {
        ComponentName(
            "com.ratta.supernote.note",
            "com.ratta.supernote.note.view.NoteInsidePagesActivity")
      }
      val intent = Intent().apply {
        component = comp
        putExtra("file_path", path)
        action = Intent.ACTION_VIEW // required or the file_path extra is ignored
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(buildResult(true, "OK", "opened in reader"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.w(TAG, "[SMARTPAPER_OVERLAY] openInReader: $msg")
      promise.resolve(buildResult(false, "OPEN_FAILED", msg))
    }
  }

  private fun dp(v: Int): Int =
      (v * reactApplicationContext.resources.displayMetrics.density).toInt()

  /**
   * Write `base64Content` (a standard base64 string) to `path` as raw
   * bytes. Used by the encrypted-vault store: sn-plugin-lib's
   * NativeFileUtils only exposes copy/rename/delete/list — there's no
   * `writeFile`. Reading is handled by `fetch('file://…')` already.
   *
   * Intent-private write semantics:
   *  - Caller passes the FINAL destination path.
   *  - The write is ATOMIC (write .tmp sibling, then rename over the
   *    target). It used to truncate-then-write, and every JS caller used
   *    it bare: a kill mid-write truncated pretranscript.json (paid batch
   *    jobs lost + their pending guards gone), the conversations index,
   *    settings or the key file (audit 2026-07-18). Only store.json had a
   *    .bak. rename() within one directory replaces the target in place.
   *  - Parent directory must already exist; FileUtils.makeDir / mkdirs is
   *    the other primitive callers use to set that up.
   */
  @ReactMethod
  fun writeFileBase64(path: String, base64Content: String, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] writeFileBase64 path=$path bytes(b64)=${base64Content.length}")
    try {
      val bytes = android.util.Base64.decode(base64Content, android.util.Base64.DEFAULT)
      val target = java.io.File(path)
      val parent = target.parentFile
      if (parent != null && !parent.exists()) {
        promise.resolve(buildResult(success = false, code = "PARENT_MISSING",
            message = "Parent directory does not exist: ${parent.absolutePath}"))
        return
      }
      val tmp = java.io.File(target.absolutePath + ".tmp-write")
      java.io.FileOutputStream(tmp).use { it.write(bytes) }
      var renamed = tmp.renameTo(target)
      if (!renamed) {
        // Some emulated filesystems refuse rename-over-existing: fall back
        // to delete-then-rename (a crash between the two loses only this
        // write's target, and the .tmp survives for diagnosis).
        target.delete()
        renamed = tmp.renameTo(target)
      }
      if (!renamed) {
        tmp.delete()
        promise.resolve(buildResult(success = false, code = "RENAME_FAILED",
            message = "Could not move temp file onto $path"))
        return
      }
      Log.i(TAG, "[SMARTPAPER_OVERLAY] writeFileBase64: SUCCESS bytes=${bytes.size}")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Wrote ${bytes.size} bytes to $path"))
    } catch (e: IllegalArgumentException) {
      val msg = "Invalid base64 input: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] writeFileBase64: $msg", e)
      promise.resolve(buildResult(success = false, code = "BAD_BASE64", message = msg))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] writeFileBase64: $msg", e)
      promise.resolve(buildResult(success = false, code = "WRITE_FAILED", message = msg))
    }
  }

  /**
   * Copy a bundled APK asset to a filesystem path (v0.60, embedded User
   * Guide). No-op when the destination already exists (code EXISTS) so
   * callers can fire it on every launch. Atomic like writeFileBase64:
   * stream to a .tmp sibling, then rename.
   */
  @ReactMethod
  fun copyAssetToFile(assetName: String, destPath: String, promise: Promise) {
    try {
      val target = java.io.File(destPath)
      if (target.exists() && target.length() > 0) {
        promise.resolve(buildResult(success = true, code = "EXISTS",
            message = "Already present: $destPath"))
        return
      }
      target.parentFile?.mkdirs()
      val tmp = java.io.File(target.absolutePath + ".tmp-write")
      reactApplicationContext.assets.open(assetName).use { input ->
        java.io.FileOutputStream(tmp).use { output -> input.copyTo(output) }
      }
      var renamed = tmp.renameTo(target)
      if (!renamed) {
        target.delete()
        renamed = tmp.renameTo(target)
      }
      if (!renamed) {
        tmp.delete()
        promise.resolve(buildResult(success = false, code = "RENAME_FAILED",
            message = "Could not move asset copy onto $destPath"))
        return
      }
      Log.i(TAG, "[SMARTPAPER_OVERLAY] copyAssetToFile: $assetName -> $destPath (${target.length()} bytes)")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Copied $assetName to $destPath"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] copyAssetToFile: $msg", e)
      promise.resolve(buildResult(success = false, code = "COPY_FAILED", message = msg))
    }
  }

  /**
   * Create a directory (and its missing parents). Companion to
   * writeFileBase64, which refuses a missing parent on purpose — the
   * EXPORT module mirrors folder trees under /EXPORT and sets them up
   * with this before writing.
   */
  @ReactMethod
  fun mkdirs(path: String, promise: Promise) {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] mkdirs path=$path")
    try {
      val dir = java.io.File(path)
      val ok = dir.exists() || dir.mkdirs()
      promise.resolve(buildResult(success = ok,
          code = if (ok) "OK" else "MKDIR_FAILED", message = path))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] mkdirs: $msg", e)
      promise.resolve(buildResult(success = false, code = "MKDIR_FAILED", message = msg))
    }
  }

  /**
   * PBKDF2-HMAC-SHA256 via the JDK's `SecretKeyFactory`. On Hermes,
   * a pure-JS implementation runs at ~400 iters/sec on this device
   * (logcat 2026-05-10 measured 50k iters in 130s). The JDK path is
   * 100k+ iters/sec — sub-100ms for any realistic count — because it
   * delegates to the device's native crypto provider.
   *
   * Returns {success, code, message} like the other methods plus
   * `derivedKeyB64` on success. Caller passes the password as
   * base64-encoded UTF-8 bytes (avoids string-encoding round-trips
   * on the bridge).
   */
  @ReactMethod
  fun cryptoPbkdf2Sha256(
      passwordUtf8B64: String,
      saltB64: String,
      iterations: Int,
      keyLengthBytes: Int,
      promise: Promise,
  ) {
    if (iterations < 1) {
      promise.resolve(buildCryptoResult(false, "BAD_PARAMS",
          "iterations must be >= 1, got $iterations", null))
      return
    }
    if (keyLengthBytes < 1 || keyLengthBytes > 1024) {
      promise.resolve(buildCryptoResult(false, "BAD_PARAMS",
          "keyLengthBytes must be in 1..1024, got $keyLengthBytes", null))
      return
    }
    try {
      val passwordBytes = android.util.Base64.decode(passwordUtf8B64, android.util.Base64.DEFAULT)
      val saltBytes = android.util.Base64.decode(saltB64, android.util.Base64.DEFAULT)
      // SecretKeyFactory expects the password as a char[]. We round-
      // trip through ISO_8859_1 (a 1:1 byte→char mapping) so the
      // bytes pass through unchanged — the underlying PBKDF2 spec
      // operates on bytes anyway.
      val passwordChars = String(passwordBytes, Charsets.ISO_8859_1).toCharArray()
      val spec = javax.crypto.spec.PBEKeySpec(
          passwordChars, saltBytes, iterations, keyLengthBytes * 8,
      )
      val factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
      val derivedBytes = factory.generateSecret(spec).encoded
      // Wipe the char[] copy; the SDK doesn't.
      java.util.Arrays.fill(passwordChars, ' ')
      val b64 = android.util.Base64.encodeToString(derivedBytes,
          android.util.Base64.NO_WRAP)
      promise.resolve(buildCryptoResult(true, "OK",
          "Derived $keyLengthBytes bytes in $iterations iters", b64))
    } catch (e: IllegalArgumentException) {
      promise.resolve(buildCryptoResult(false, "BAD_BASE64",
          "Invalid base64 input: ${e.message}", null))
    } catch (e: java.security.NoSuchAlgorithmException) {
      // Should never happen on Android (PBKDF2WithHmacSHA256 is
      // mandatory since API 26), but surface it cleanly so callers
      // can fall back to the pure-JS path.
      promise.resolve(buildCryptoResult(false, "ALGO_MISSING",
          "PBKDF2WithHmacSHA256 not available: ${e.message}", null))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] cryptoPbkdf2Sha256: $msg", e)
      promise.resolve(buildCryptoResult(false, "PBKDF2_FAILED", msg, null))
    }
  }

  /**
   * Cryptographically secure random bytes via `SecureRandom`. The
   * JS-only fallback in `src/crypto/randomBytes.ts` uses a
   * uniqueness-only generator (Date.now + counter) when WebCrypto is
   * unavailable, which is acceptable for salts/nonces but not for
   * any other security purpose. This method gives us real entropy.
   */
  @ReactMethod
  fun cryptoRandomBytes(length: Int, promise: Promise) {
    if (length < 1 || length > 65_536) {
      promise.resolve(buildCryptoResult(false, "BAD_PARAMS",
          "length must be in 1..65536, got $length", null))
      return
    }
    try {
      val out = ByteArray(length)
      java.security.SecureRandom().nextBytes(out)
      val b64 = android.util.Base64.encodeToString(out, android.util.Base64.NO_WRAP)
      promise.resolve(buildCryptoResult(true, "OK",
          "Generated $length bytes", b64))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] cryptoRandomBytes: $msg", e)
      promise.resolve(buildCryptoResult(false, "RANDOM_FAILED", msg, null))
    }
  }

  /**
   * Random-access file read: `length` bytes from `offset`, base64.
   * length=0 → just the fileSize (stat). The .note metadata walker uses
   * this to read ~20 small blocks instead of fetch(file://)-ing whole
   * multi-MB notes through the JS bridge (measured 16 s for 5.5 MB —
   * the config UI jank of 2026-07-12).
   */
  @ReactMethod
  fun readFileRange(path: String, offset: Double, length: Double, promise: Promise) {
    try {
      val f = java.io.RandomAccessFile(path, "r")
      try {
        val size = f.length()
        val map = Arguments.createMap()
        map.putBoolean("success", true)
        map.putDouble("fileSize", size.toDouble())
        val off = offset.toLong().coerceIn(0L, size)
        val len = length.toLong().coerceAtMost(size - off).toInt()
        if (len > 0) {
          val buf = ByteArray(len)
          f.seek(off)
          f.readFully(buf)
          map.putString("bytesB64",
              android.util.Base64.encodeToString(buf, android.util.Base64.NO_WRAP))
        } else {
          map.putString("bytesB64", "")
        }
        promise.resolve(map)
      } finally {
        f.close()
      }
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] readFileRange: $msg")
      val map = Arguments.createMap()
      map.putBoolean("success", false)
      map.putString("message", msg)
      promise.resolve(map)
    }
  }

  /**
   * Walk a .note file's metadata NATIVELY (v0.67 — the real fix for the
   * "2-7 s per note" JS walks that froze the UI after every reinstall):
   * one bridge call, all parsing on a background native thread. The JS
   * implementation in src/native/noteTranscripts.ts is the ORACLE — this
   * must produce identical data: footer <PAGEn:addr> entries → per-page
   * block → PAGEID / FIVESTAR / ORIENTATION:1090 / RECOGNTEXT (whose
   * block holds latin1 base64 → UTF-8 JSON {elements:[{label}]}), plus
   * footer KEYWORD_ blocks (KEYWORDPAGE + UTF-8 KEYWORD text).
   * Returns {success:true, json:"…"} with pages 0-indexed.
   */
  @ReactMethod
  fun walkNote(path: String, promise: Promise) {
    Thread {
      try {
        val f = java.io.RandomAccessFile(path, "r")
        try {
          val size = f.length()
          fun readAt(off: Long, len: Int): ByteArray? {
            if (off < 0 || len <= 0 || off + len > size) return null
            val buf = ByteArray(len)
            f.seek(off)
            f.readFully(buf)
            return buf
          }
          fun u32le(b: ByteArray, off: Int): Long =
              ((b[off].toLong() and 0xff)) or
              ((b[off + 1].toLong() and 0xff) shl 8) or
              ((b[off + 2].toLong() and 0xff) shl 16) or
              ((b[off + 3].toLong() and 0xff) shl 24)
          fun blockAt(addr: Long): ByteArray? {
            if (addr <= 0 || addr + 4 > size) return null
            val lenB = readAt(addr, 4) ?: return null
            val len = u32le(lenB, 0)
            if (len == 0L || len > 4_000_000L || addr + 4 + len > size) return null
            return readAt(addr + 4, len.toInt())
          }
          fun latin1(b: ByteArray): String = String(b, Charsets.ISO_8859_1)

          val out = org.json.JSONObject()
          val pagesArr = org.json.JSONArray()
          val kwsArr = org.json.JSONArray()
          var count = 0
          val magic = readAt(0, 6)
          if (size < 32 || magic == null || latin1(magic) != "noteSN") {
            out.put("count", 0)
            out.put("pages", pagesArr)
            out.put("kws", kwsArr)
          } else {
            val tail = readAt(size - 4, 4)
            val footerB = if (tail != null) blockAt(u32le(tail, 0)) else null
            if (footerB != null) {
              val footer = latin1(footerB)
              for (m in Regex("<PAGE(\\d+):(\\d+)>").findAll(footer)) {
                try {
                  val pageNum = m.groupValues[1].toInt() - 1
                  if (pageNum < 0) continue
                  if (pageNum + 1 > count) count = pageNum + 1
                  val page = org.json.JSONObject()
                  page.put("p", pageNum)
                  page.put("rev", m.groupValues[2])
                  val pageB = blockAt(m.groupValues[2].toLong())
                  if (pageB != null) {
                    val info = latin1(pageB)
                    Regex("<PAGEID:([^>]+)>").find(info)?.let {
                      if (it.groupValues[1].isNotEmpty()) page.put("id", it.groupValues[1])
                    }
                    if (info.contains("<FIVESTAR:")) page.put("star", true)
                    if (info.contains("<ORIENTATION:1090>")) page.put("landscape", true)
                    val rt = Regex("<RECOGNTEXT:(\\d+)>").find(info)
                    val recognB = if (rt != null) blockAt(rt.groupValues[1].toLong()) else null
                    if (recognB != null) {
                      try {
                        val jsonBytes = android.util.Base64.decode(
                            latin1(recognB), android.util.Base64.DEFAULT)
                        val obj = org.json.JSONObject(String(jsonBytes, Charsets.UTF_8))
                        val els = obj.optJSONArray("elements")
                        val labels = StringBuilder()
                        if (els != null) {
                          for (i in 0 until els.length()) {
                            val label = els.optJSONObject(i)?.optString("label")?.trim() ?: ""
                            if (label.isNotEmpty()) {
                              if (labels.isNotEmpty()) labels.append('\n')
                              labels.append(label)
                            }
                          }
                        }
                        if (labels.isNotEmpty()) page.put("recogn", labels.toString())
                      } catch (e: Throwable) {
                        // malformed transcript JSON — page kept, transcript skipped
                      }
                    }
                  }
                  pagesArr.put(page)
                } catch (e: Throwable) {
                  // skip this page, keep the others
                }
              }
              for (km in Regex("<KEYWORD_[^:>]*:(\\d+)>").findAll(footer)) {
                try {
                  val kb = blockAt(km.groupValues[1].toLong()) ?: continue
                  val meta = latin1(kb)
                  val pg = Regex("<KEYWORDPAGE:(\\d+)>").find(meta) ?: continue
                  val kw = Regex("<KEYWORD:([^>]*)>").find(meta) ?: continue
                  if (kw.groupValues[1].isEmpty()) continue
                  // The keyword text is UTF-8 in the block: latin1 chars map
                  // 1:1 to bytes, so slice the RAW bytes at the match and
                  // decode properly (same trick as the JS oracle).
                  val start = kw.range.first + "<KEYWORD:".length
                  val text = String(
                      kb.copyOfRange(start, start + kw.groupValues[1].length),
                      Charsets.UTF_8)
                  val kwObj = org.json.JSONObject()
                  kwObj.put("p", pg.groupValues[1].toInt() - 1)
                  kwObj.put("t", text)
                  kwsArr.put(kwObj)
                } catch (e: Throwable) {
                  // skip this keyword, keep the others
                }
              }
            }
            out.put("count", count)
            out.put("pages", pagesArr)
            out.put("kws", kwsArr)
          }
          val map = Arguments.createMap()
          map.putBoolean("success", true)
          map.putString("json", out.toString())
          promise.resolve(map)
        } finally {
          f.close()
        }
      } catch (e: Throwable) {
        val msg = "${e.javaClass.simpleName}: ${e.message}"
        Log.e(TAG, "[SMARTPAPER_OVERLAY] walkNote: $msg")
        promise.resolve(buildResult(success = false, code = "WALK_FAILED", message = msg))
      }
    }.start()
  }

  /**
   * POST a JSON body whose __FILE_B64__ placeholder is filled with the
   * base64 of a local file — entirely natively (v0.67, the LIVE-read
   * twin of the batch pipeline's appendBatchLine): the 0.5-1 MB render
   * PNG never crosses the JS thread anymore. The response body (small
   * JSON) is returned as a string. Transport errors resolve
   * success=false; HTTP errors resolve success=true with their status —
   * the JS caller keeps its existing per-status handling.
   */
  @ReactMethod
  fun postJsonWithFile(url: String, bearer: String, template: String,
                       dataFilePath: String, deleteAfter: Boolean,
                       timeoutMs: Double, promise: Promise) {
    Thread {
      var connRef: java.net.HttpURLConnection? = null
      try {
        // STREAM the file's base64 into the request body (2026-07-29 OOM fix):
        // the previous encodeToString(readBytes()) held the whole file (~30 MB)
        // AND its base64 (~40 MB) in the ART heap (192 MB cap) — a big PDF
        // crashed the plugin. base64 (NO_WRAP, padded) length is 4*ceil(n/3),
        // known from the file size, so we POST with an exact Content-Length and
        // stream chunks straight through Base64OutputStream — nothing whole is
        // ever held in memory.
        val marker = "__FILE_B64__"
        val idx = template.indexOf(marker)
        val prefix = (if (idx >= 0) template.substring(0, idx) else template)
            .toByteArray(Charsets.UTF_8)
        val suffix = (if (idx >= 0) template.substring(idx + marker.length) else "")
            .toByteArray(Charsets.UTF_8)
        val file = java.io.File(dataFilePath)
        val fileLen = file.length()
        val b64Len = 4L * ((fileLen + 2L) / 3L)
        val contentLength = prefix.size.toLong() + b64Len + suffix.size.toLong()
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        connRef = conn
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $bearer")
        conn.connectTimeout = 30_000
        conn.readTimeout = timeoutMs.toInt().coerceAtLeast(30_000)
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(contentLength)
        conn.outputStream.use { os ->
          os.write(prefix)
          // Base64OutputStream.close() flushes its final (padded) group; wrap
          // `os` so that close() does NOT close the underlying connection stream.
          val noClose = object : java.io.FilterOutputStream(os) {
            override fun write(b: ByteArray, off: Int, len: Int) { out.write(b, off, len) }
            override fun close() { flush() }
          }
          val b64Out = android.util.Base64OutputStream(
              noClose, android.util.Base64.NO_WRAP)
          file.inputStream().use { ins ->
            val buf = ByteArray(48 * 1024) // multiple of 3 keeps base64 aligned
            while (true) {
              val n = ins.read(buf)
              if (n < 0) break
              b64Out.write(buf, 0, n)
            }
          }
          b64Out.close() // emit the final base64 group; `os` stays open
          os.write(suffix)
          os.flush()
        }
        val status = conn.responseCode
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        val map = Arguments.createMap()
        map.putBoolean("success", true)
        map.putInt("status", status)
        map.putString("body", text)
        promise.resolve(map)
      } catch (e: Throwable) {
        val msg = "${e.javaClass.simpleName}: ${e.message}"
        Log.e(TAG, "[SMARTPAPER_OVERLAY] postJsonWithFile: $msg")
        promise.resolve(buildResult(success = false, code = "POST_FAILED", message = msg))
      } finally {
        // v0.88 (audit): disconnect on EVERY path — repeated transport errors
        // during a long drain used to leak sockets/FDs (success-only before).
        try { connRef?.disconnect() } catch (e: Throwable) { /* best-effort */ }
        if (deleteAfter) {
          try { java.io.File(dataFilePath).delete() } catch (e: Throwable) { /* best-effort */ }
        }
      }
    }.start()
  }

  /**
   * List a directory: name / isDir / size per entry. RN has no
   * filesystem listing of its own; the Pre-transcript folder browser
   * (v0.22) needs to walk /storage/emulated/0/Note.
   */
  /**
   * Read a file and return it base64-encoded — NATIVELY (v0.63.2). The
   * pure-JS encode of a 0.5-1 MB render PNG blocked the JS thread for
   * hundreds of ms per page and buried the UI during wave-2 catch-ups
   * (device report 2026-07-19 evening). ReactMethods run on the
   * NativeModules thread: off both the UI and JS threads.
   */
  /**
   * NATIVE batch-file builder (v0.65 "pipeline"): append one JSONL line
   * to `filePath`, embedding `dataFilePath`'s bytes base64-encoded in
   * place of the __FILE_B64__ placeholder of `template`. The JS thread
   * used to base64 each 0.5-1 MB render, join a ~20 MB JSONL, base64
   * THAT (~27 MB, pure JS loop) and push it through the bridge — the
   * "UI buried during background jobs" root. Now only ~1 KB templates
   * and file paths cross the bridge. deleteAfter removes the data file
   * (render scratch) once embedded.
   */
  @ReactMethod
  fun appendBatchLine(filePath: String, template: String, dataFilePath: String?,
                      deleteAfter: Boolean, promise: Promise) {
    try {
      val line = if (dataFilePath != null) {
        val data = java.io.File(dataFilePath)
        if (!data.exists()) {
          promise.resolve(buildResult(success = false, code = "DATA_NOT_FOUND",
              message = "No file at $dataFilePath"))
          return
        }
        val b64 = android.util.Base64.encodeToString(data.readBytes(), android.util.Base64.NO_WRAP)
        val out = template.replace("__FILE_B64__", b64)
        if (deleteAfter) data.delete()
        out
      } else template
      java.io.FileOutputStream(java.io.File(filePath), true).use {
        it.write(line.toByteArray(Charsets.UTF_8))
        it.write('\n'.code)
      }
      promise.resolve(buildResult(success = true, code = "OK", message = "appended"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] appendBatchLine: $msg", e)
      promise.resolve(buildResult(success = false, code = "APPEND_FAILED", message = msg))
    }
  }

  /** System clipboard text (v0.64) — the chat input's Paste button. */
  @ReactMethod
  fun getClipboardText(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val cm = reactApplicationContext.getSystemService(
            android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = cm.primaryClip
        val text = if (clip != null && clip.itemCount > 0)
            clip.getItemAt(0).coerceToText(reactApplicationContext)?.toString() ?: ""
          else ""
        val map = Arguments.createMap()
        map.putBoolean("success", true)
        map.putString("text", text)
        promise.resolve(map)
      } catch (e: Throwable) {
        promise.resolve(buildResult(success = false, code = "CLIPBOARD_FAILED",
            message = "${e.javaClass.simpleName}: ${e.message}"))
      }
    }
  }

  @ReactMethod
  fun readFileBase64(path: String, promise: Promise) {
    try {
      val f = java.io.File(path)
      if (!f.exists() || !f.isFile) {
        promise.resolve(buildResult(success = false, code = "NOT_FOUND",
            message = "No file at $path"))
        return
      }
      val b64 = android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)
      val map = Arguments.createMap()
      map.putBoolean("success", true)
      map.putString("data", b64)
      promise.resolve(map)
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] readFileBase64: $msg", e)
      promise.resolve(buildResult(success = false, code = "READ_FAILED", message = msg))
    }
  }

  /**
   * UTF-8 text read/write without the JS-side codec (perf audit
   * 2026-07-20): the bridge marshals Java strings natively, so these
   * replace the per-character utf8FromBytes/utf8ToBase64 loops that
   * every shard, settings and jobs file paid on the JS thread (all
   * shards at startup!). Same atomic tmp+rename contract as
   * writeFileBase64.
   */
  @ReactMethod
  fun readFileUtf8(path: String, promise: Promise) {
    try {
      val f = java.io.File(path)
      if (!f.exists() || !f.isFile) {
        promise.resolve(buildResult(success = false, code = "NOT_FOUND",
            message = "No file at $path"))
        return
      }
      val map = Arguments.createMap()
      map.putBoolean("success", true)
      map.putString("data", f.readText(Charsets.UTF_8))
      promise.resolve(map)
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] readFileUtf8: $msg", e)
      promise.resolve(buildResult(success = false, code = "READ_FAILED", message = msg))
    }
  }

  @ReactMethod
  fun writeFileUtf8(path: String, content: String, promise: Promise) {
    try {
      val target = java.io.File(path)
      val parent = target.parentFile
      if (parent != null && !parent.exists()) {
        promise.resolve(buildResult(success = false, code = "PARENT_MISSING",
            message = "Parent directory does not exist: ${parent.absolutePath}"))
        return
      }
      val tmp = java.io.File(target.absolutePath + ".tmp-write")
      tmp.writeText(content, Charsets.UTF_8)
      var renamed = tmp.renameTo(target)
      if (!renamed) {
        target.delete()
        renamed = tmp.renameTo(target)
      }
      if (!renamed) {
        tmp.delete()
        promise.resolve(buildResult(success = false, code = "RENAME_FAILED",
            message = "Could not move temp file onto $path"))
        return
      }
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Wrote ${content.length} chars to $path"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] writeFileUtf8: $msg", e)
      promise.resolve(buildResult(success = false, code = "WRITE_FAILED", message = msg))
    }
  }

  @ReactMethod
  fun listDir(dirPath: String, promise: Promise) {
    try {
      val dir = java.io.File(dirPath)
      val arr = Arguments.createArray()
      val files = dir.listFiles()
      if (files != null) {
        for (f in files) {
          val m = Arguments.createMap()
          m.putString("name", f.name)
          m.putBoolean("isDir", f.isDirectory)
          m.putDouble("size", f.length().toDouble())
          arr.pushMap(m)
        }
      }
      val map = Arguments.createMap()
      map.putBoolean("success", true)
      map.putArray("entries", arr)
      promise.resolve(map)
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] listDir: $msg", e)
      val map = Arguments.createMap()
      map.putBoolean("success", false)
      map.putString("message", msg)
      promise.resolve(map)
    }
  }

  /**
   * Rotate a PNG file in place (v0.52, rotated-page reading): the OCR and
   * vision models read horizontally, so a landscape page rendered on a
   * portrait canvas must be straightened BEFORE upload. `degrees` is
   * clockwise (90 for the common rotate-left writing).
   */
  @ReactMethod
  fun rotatePng(path: String, degrees: Int, promise: Promise) {
    try {
      val src = android.graphics.BitmapFactory.decodeFile(path)
      if (src == null) {
        promise.resolve(buildResult(success = false, code = "DECODE_FAILED",
            message = "Not a decodable image: $path"))
        return
      }
      val mtx = android.graphics.Matrix()
      mtx.postRotate(degrees.toFloat())
      val out = android.graphics.Bitmap.createBitmap(
          src, 0, 0, src.width, src.height, mtx, true)
      // ATOMIC rewrite (audit 2026-07-19 D2): compress into a .tmp
      // sibling, then rename over the source — the in-place truncate
      // used to leave a corrupt PNG on a mid-compress kill, and the
      // caller then paid an OCR run on the garbage. Same pattern as
      // writeFileBase64 above.
      val target = java.io.File(path)
      val tmp = java.io.File(target.absolutePath + ".tmp-write")
      java.io.FileOutputStream(tmp).use {
        out.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
      }
      if (out !== src) {
        src.recycle()
      }
      out.recycle()
      var renamed = tmp.renameTo(target)
      if (!renamed) {
        target.delete()
        renamed = tmp.renameTo(target)
      }
      if (!renamed) {
        tmp.delete()
        promise.resolve(buildResult(success = false, code = "RENAME_FAILED",
            message = "Could not move rotated PNG onto $path"))
        return
      }
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Rotated $degrees deg: $path"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] rotatePng: $msg", e)
      promise.resolve(buildResult(success = false, code = "ROTATE_FAILED", message = msg))
    }
  }

  /**
   * v0.82 (user): composite the Supernote annotation layer (a .mark
   * thumbnail — black ink on a TRANSPARENT background) OVER a PDF page
   * render, so the vision model sees the printed page + handwritten
   * annotations together. SRC_OVER (normal alpha draw): the ink lands on
   * top, the base shows through the transparent areas. (v0.82.2: MULTIPLY
   * was wrong — Android's PorterDuff MULTIPLY zeroes the base wherever the
   * overlay is transparent, blacking out the whole page.) The overlay is
   * scaled to the base size if they differ. Atomic write to `outPath`.
   */
  @ReactMethod
  fun compositePng(
      basePath: String,
      overlayPath: String,
      outPath: String,
      promise: Promise,
  ) {
    try {
      val base = android.graphics.BitmapFactory.decodeFile(basePath)
      if (base == null) {
        promise.resolve(buildResult(false, "DECODE_BASE", "bad base: $basePath"))
        return
      }
      val overlay = android.graphics.BitmapFactory.decodeFile(overlayPath)
      if (overlay == null) {
        base.recycle()
        promise.resolve(buildResult(false, "DECODE_OVERLAY", "bad overlay: $overlayPath"))
        return
      }
      val out = base.copy(android.graphics.Bitmap.Config.ARGB_8888, true)
      base.recycle()
      val canvas = android.graphics.Canvas(out)
      // Default paint = SRC_OVER: draw the ink over the page, keep the page
      // where the overlay is transparent.
      val paint = android.graphics.Paint().apply { isFilterBitmap = true }
      val dst = android.graphics.Rect(0, 0, out.width, out.height)
      canvas.drawBitmap(overlay, null, dst, paint)
      overlay.recycle()
      val target = java.io.File(outPath)
      val tmp = java.io.File(target.absolutePath + ".tmp-write")
      java.io.FileOutputStream(tmp).use {
        out.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
      }
      out.recycle()
      var renamed = tmp.renameTo(target)
      if (!renamed) {
        target.delete()
        renamed = tmp.renameTo(target)
      }
      if (!renamed) {
        tmp.delete()
        promise.resolve(buildResult(false, "RENAME_FAILED", "could not write $outPath"))
        return
      }
      promise.resolve(buildResult(true, "OK", "composited → $outPath"))
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] compositePng: $msg", e)
      promise.resolve(buildResult(false, "COMPOSITE_FAILED", msg))
    }
  }

  /**
   * Crop a rendered page PNG to a rectangle and return it base64 (v0.73,
   * lasso→chat): the lasso rect (page coordinates) is cropped out of the
   * page render so the chat's vision model receives ONLY the selection.
   * Coordinates are clamped to the bitmap so an out-of-bounds rect can't
   * throw. Returns {success, data} with the base64 PNG.
   */
  @ReactMethod
  fun cropPngToBase64(path: String, x: Double, y: Double,
                      w: Double, h: Double, promise: Promise) {
    Thread {
      try {
        val src = android.graphics.BitmapFactory.decodeFile(path)
        if (src == null) {
          promise.resolve(buildResult(success = false, code = "DECODE_FAILED",
              message = "Not a decodable image: $path"))
          return@Thread
        }
        val cx = x.toInt().coerceIn(0, src.width - 1)
        val cy = y.toInt().coerceIn(0, src.height - 1)
        val cw = w.toInt().coerceIn(1, src.width - cx)
        val ch = h.toInt().coerceIn(1, src.height - cy)
        val crop = android.graphics.Bitmap.createBitmap(src, cx, cy, cw, ch)
        val baos = java.io.ByteArrayOutputStream()
        crop.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
        val b64 = android.util.Base64.encodeToString(
            baos.toByteArray(), android.util.Base64.NO_WRAP)
        if (crop !== src) {
          crop.recycle()
        }
        src.recycle()
        val map = Arguments.createMap()
        map.putBoolean("success", true)
        map.putString("data", b64)
        promise.resolve(map)
      } catch (e: Throwable) {
        val msg = "${e.javaClass.simpleName}: ${e.message}"
        Log.e(TAG, "[SMARTPAPER_OVERLAY] cropPngToBase64: $msg", e)
        promise.resolve(buildResult(success = false, code = "CROP_FAILED", message = msg))
      }
    }.start()
  }

  /**
   * External storage volumes (v0.52, SD-card discovery plan B): the
   * PluginHost runtime view of /storage does NOT list mounted cards
   * (device-verified 2026-07-18 — listDir("/storage") came back without
   * the mounted public volume), so ask Android properly. Two GENERIC
   * sources, deduplicated, primary (emulated) excluded:
   *  - StorageManager.storageVolumes → volume directory (API 30+);
   *  - getExternalFilesDirs: the app dir on each volume is
   *    /storage/<UUID>/Android/data/<pkg>/files — cut at "/Android/".
   * Nothing hardcoded: any card, any device.
   */
  @ReactMethod
  fun listStorageVolumes(promise: Promise) {
    try {
      val roots = LinkedHashSet<String>()
      val ctx = reactApplicationContext
      try {
        val sm = ctx.getSystemService(android.content.Context.STORAGE_SERVICE)
            as android.os.storage.StorageManager
        for (v in sm.storageVolumes) {
          if (v.isPrimary) {
            continue
          }
          if (android.os.Build.VERSION.SDK_INT >= 30) {
            v.directory?.absolutePath?.let { roots.add(it) }
          }
        }
      } catch (e: Throwable) {
        Log.w(TAG, "[SMARTPAPER_OVERLAY] storageVolumes: ${e.message}")
      }
      try {
        for (f in ctx.getExternalFilesDirs(null)) {
          if (f == null) {
            continue
          }
          val p = f.absolutePath
          if (p.startsWith("/storage/emulated/")) {
            continue
          }
          val i = p.indexOf("/Android/")
          if (i > 0) {
            roots.add(p.substring(0, i))
          }
        }
      } catch (e: Throwable) {
        Log.w(TAG, "[SMARTPAPER_OVERLAY] externalFilesDirs: ${e.message}")
      }
      val arr = Arguments.createArray()
      for (r in roots) {
        arr.pushString(r)
      }
      Log.i(TAG, "[SMARTPAPER_OVERLAY] storage volumes: $roots")
      val map = Arguments.createMap()
      map.putBoolean("success", true)
      map.putArray("roots", arr)
      promise.resolve(map)
    } catch (e: Throwable) {
      val map = Arguments.createMap()
      map.putBoolean("success", false)
      map.putString("message", "${e.javaClass.simpleName}: ${e.message}")
      promise.resolve(map)
    }
  }

  /**
   * Reclaims disk space from old plugin versions. PluginHost keeps
   * every past version's files (app_<ts>.npk / app_<ts>_libs / oat
   * artifacts) in the plugin directory on reinstall, so a plugin's
   * on-device footprint grows by its full size on every update and
   * nothing ever prunes it. We run inside the PluginHost process, so
   * we can delete our own stale versions: keep the newest timestamp
   * (the running one), drop the rest.
   *
   * dirPath = PluginManager.getPluginDirPath(). Resolves with
   * {success, freedBytes, kept} — kept is the timestamp retained, or
   * "none" when no app_<ts>.npk exists (fresh install layout).
   *
   * Cleanup recipe adapted from AgP42's Dashboard plugin janitor.
   */
  @ReactMethod
  fun cleanupOldVersions(dirPath: String, promise: Promise) {
    try {
      val dir = java.io.File(dirPath)
      val files = dir.listFiles()
      val map = Arguments.createMap()
      map.putBoolean("success", true)
      if (files == null) {
        map.putDouble("freedBytes", 0.0)
        map.putString("kept", "none")
        promise.resolve(map)
        return
      }
      var maxTs = -1L
      for (f in files) {
        val n = f.name
        if (n.startsWith("app_") && n.endsWith(".npk")) {
          val ts = leadingTimestamp(n.substring(4))
          if (ts > maxTs) maxTs = ts
        }
      }
      if (maxTs < 0) {
        map.putDouble("freedBytes", 0.0)
        map.putString("kept", "none")
        promise.resolve(map)
        return
      }
      val keep = maxTs.toString()
      var freed = 0L
      // Older app_<ts>.npk files and app_<ts>_libs directories.
      for (f in files) {
        val n = f.name
        if (n.startsWith("app_") && !n.contains(keep)) {
          freed += deleteRecursively(f)
        }
      }
      // Compiled artifacts (odex/vdex/art) for older versions.
      val oat = java.io.File(dir, "oat")
      if (oat.isDirectory) {
        freed += cleanOat(oat, keep)
      }
      Log.i(TAG, "[SMARTPAPER_OVERLAY] cleanupOldVersions freed=$freed kept=$keep")
      map.putDouble("freedBytes", freed.toDouble())
      map.putString("kept", keep)
      promise.resolve(map)
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[SMARTPAPER_OVERLAY] cleanupOldVersions: $msg", e)
      promise.reject("CLEANUP_FAILED", msg, e)
    }
  }

  /** Leading run of digits of a string as a Long (-1 when absent). */
  private fun leadingTimestamp(s: String): Long {
    var i = 0
    while (i < s.length && s[i].isDigit()) i++
    if (i == 0) return -1
    return try {
      s.substring(0, i).toLong()
    } catch (e: NumberFormatException) {
      -1
    }
  }

  /** Deletes a file or directory tree, returning the bytes reclaimed. */
  private fun deleteRecursively(f: java.io.File): Long {
    var sum = 0L
    if (f.isDirectory) {
      f.listFiles()?.forEach { sum += deleteRecursively(it) }
    } else {
      sum += f.length()
    }
    f.delete()
    return sum
  }

  /** In oat/, drop compiled app_<oldts>.* artifacts not matching keep. */
  private fun cleanOat(oat: java.io.File, keep: String): Long {
    var sum = 0L
    oat.listFiles()?.forEach { k ->
      if (k.isDirectory) {
        sum += cleanOat(k, keep)
      } else if (k.name.startsWith("app_") && !k.name.contains(keep)) {
        sum += k.length()
        k.delete()
      }
    }
    return sum
  }

  private fun buildCryptoResult(
      success: Boolean,
      code: String,
      message: String,
      bytesB64: String?,
  ): WritableMap {
    val map = Arguments.createMap()
    map.putBoolean("success", success)
    map.putString("code", code)
    map.putString("message", message)
    if (bytesB64 != null) {
      map.putString("bytesB64", bytesB64)
    }
    return map
  }

  private fun closeOnUiThread(promise: Promise) {
    val removed = removeOverlay()
    if (removed) {
      Log.i(TAG, "[SMARTPAPER_OVERLAY] close: SUCCESS")
      promise.resolve(buildResult(success = true, code = "OK",
          message = "Overlay removed"))
    } else {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] close: nothing to remove")
      promise.resolve(buildResult(success = false, code = "NOT_OPEN",
          message = "close() called with no overlay open"))
    }
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private data class AttemptResult(
      val label: String,
      val success: Boolean,
      val message: String,
  )

  private fun tryAddView(
      label: String,
      type: Int,
      wm: WindowManager,
      context: Context,
      width: Double,
      height: Double,
      x: Double,
      y: Double,
      tokenSource: Activity?,
  ): AttemptResult {
    val params = buildLayoutParams(width, height, x, y, type, tokenSource)
    val view = buildOverlayView(context)
    return try {
      Log.i(TAG, "[SMARTPAPER_OVERLAY] open: trying $label ($type)")
      wm.addView(view, params)
      overlayView = view
      layoutParams = params
      hostWindowManager = wm
      startHeartbeat()
      val msg = "Overlay added with $label at " +
          "x=${params.x} y=${params.y} w=${params.width} h=${params.height}"
      Log.i(TAG, "[SMARTPAPER_OVERLAY] open: SUCCESS using $label")
      AttemptResult(label, true, msg)
    } catch (e: Throwable) {
      // The discarded view already ran startReactApplication (inside
      // buildOverlayView) — unmount it, or each failed window-type attempt
      // leaks a LIVE React root (a full ChatPanel polling forever) that
      // close() can never reach (audit 2026-07-18).
      if (view is ViewGroup) {
        detachReactRootViews(view)
      }
      val msg = "$label failed: ${e.javaClass.simpleName}: ${e.message}"
      Log.w(TAG, "[SMARTPAPER_OVERLAY] open: $msg")
      AttemptResult(label, false, msg)
    }
  }

  // v0.53 heartbeat: RN pauses JS timers while the HOST activity is
  // backgrounded — which is precisely the floating-panel situation (the
  // note app is foreground). setInterval in the panel never ticked, so
  // the context poll missed every page turn (device repro 2026-07-18;
  // same root cause as the v0.25.4 search-debounce bug). A native Handler
  // is not paused: it emits a JS event the bridge delivers regardless.
  // State lives in the companion (D1) — see the declaration there.

  private fun startHeartbeat() {
    stopHeartbeat()
    val r = object : Runnable {
      // v0.88 (audit): a runnable bound to a DEAD React context re-posted
      // itself forever (zombie tick pinning the old context). After a few
      // consecutive emit failures it now stands down; a live open()/
      // ALREADY_OPEN path restarts it from the current instance.
      private var consecFails = 0
      override fun run() {
        var ok = true
        try {
          reactApplicationContext
              .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("SmartNoteAiHeartbeat", null)
        } catch (e: Throwable) {
          ok = false
          Log.w(TAG, "[SMARTPAPER_OVERLAY] heartbeat emit: ${e.message}")
        }
        if (!ok && ++consecFails >= 5) {
          Log.w(TAG, "[SMARTPAPER_OVERLAY] heartbeat self-stopped (dead context)")
          if (heartbeat === this) {
            heartbeat = null
          }
          return
        }
        if (ok) {
          consecFails = 0
        }
        heartbeatHandler.postDelayed(this, 2500)
      }
    }
    heartbeat = r
    heartbeatHandler.postDelayed(r, 2500)
    Log.i(TAG, "[SMARTPAPER_OVERLAY] heartbeat started")
  }

  // v0.88 (audit): when PluginHost destroys this module's React context with
  // the overlay open, the static window used to survive hosting a dead React
  // root (ghost overlay eating touch until force-stop) and the heartbeat kept
  // ticking into the void. Clean up on invalidation.
  override fun invalidate() {
    Log.i(TAG, "[SMARTPAPER_OVERLAY] invalidate: cleaning up windows + heartbeat")
    heartbeatHandler.post {
      try {
        stopHeartbeat()
        removeOverlay()
        removeSyncBubble()
      } catch (e: Throwable) {
        Log.w(TAG, "[SMARTPAPER_OVERLAY] invalidate cleanup: ${e.message}")
      }
    }
    super.invalidate()
  }

  private fun stopHeartbeat() {
    heartbeat?.let { heartbeatHandler.removeCallbacks(it) }
    heartbeat = null
  }

  private fun removeOverlay(): Boolean {
    stopHeartbeat()
    val view = overlayView ?: return false
    val wm = hostWindowManager
    overlayView = null
    layoutParams = null
    hostWindowManager = null

    // If a ReactRootView is mounted inside the overlay, unmount it so
    // the per-plugin React instance doesn't leak the previous root.
    // Without this, a second open() would re-mount on top of a stale
    // tree and the bridge would log "ReactRootView was unmounted but
    // not yet attached" warnings.
    if (view is ViewGroup) {
      detachReactRootViews(view)
    }

    if (wm == null) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] removeOverlay: no WindowManager available")
      return false
    }
    return try {
      wm.removeView(view)
      true
    } catch (e: Throwable) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] removeOverlay: " +
          "${e.javaClass.simpleName}: ${e.message}", e)
      // The statics were nulled optimistically above. If the view is in
      // fact STILL attached (a transient WindowManager failure), restore
      // them — otherwise the window stays on screen with no reference left
      // to ever remove it (ghost window until reboot). Audit 2026-07-18.
      if (view.isAttachedToWindow) {
        overlayView = view
        hostWindowManager = wm
        // v0.88 (audit): layoutParams must come back too — without it every
        // move/resize/setPanelFocusable after a transient removeView failure
        // hit NOT_OPEN (no keyboard until close+reopen).
        layoutParams = view.layoutParams as? WindowManager.LayoutParams
      }
      false
    }
  }

  private fun detachReactRootViews(parent: ViewGroup) {
    for (i in 0 until parent.childCount) {
      val child = parent.getChildAt(i)
      if (child is ReactRootView) {
        try {
          child.unmountReactApplication()
          Log.i(TAG, "[SMARTPAPER_OVERLAY] React root unmounted")
        } catch (e: Throwable) {
          Log.w(TAG,
              "[SMARTPAPER_OVERLAY] unmountReactApplication failed: " +
              "${e.javaClass.simpleName}: ${e.message}", e)
        }
      } else if (child is ViewGroup) {
        detachReactRootViews(child)
      }
    }
  }

  private fun canDrawOverlays(context: Context): Boolean {
    // Pre-Marshmallow had no runtime gate; treat as granted.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    return try {
      Settings.canDrawOverlays(context)
    } catch (e: Throwable) {
      Log.w(TAG, "[SMARTPAPER_OVERLAY] canDrawOverlays threw: ${e.message}")
      false
    }
  }

  private fun buildOverlayView(context: Context): View {
    // Visible border: white fill + 4-px black stroke, slight rounded
    // corners. Without the stroke the overlay reads as a faint
    // rectangle on e-ink — adding a real border makes it obviously a
    // popup rather than a piece of the page (confirmed in the
    // 2026-05-08 device run).
    val borderDrawable = GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      setColor(Color.WHITE)
      setStroke(BORDER_WIDTH_PX, Color.BLACK)
      cornerRadius = CORNER_RADIUS_PX
    }

    val frame = FrameLayout(context).apply {
      background = borderDrawable
      // Inset content from the border so the children don't touch
      // the black stroke.
      setPadding(
          BORDER_WIDTH_PX + INNER_PADDING_PX,
          BORDER_WIDTH_PX + INNER_PADDING_PX,
          BORDER_WIDTH_PX + INNER_PADDING_PX,
          BORDER_WIDTH_PX + INNER_PADDING_PX,
      )
    }

    // Try to mount the React tree via the reflection chain
    // documented in playbook/log/2026-05-08-react-mount-reflection-plan.md.
    // If any step fails, fall back to a native diagnostic TextView so
    // the device shows something AND the logcat tells us which step
    // broke.
    val reactRootView = tryMountReactRootView(context)
    if (reactRootView != null) {
      val lp = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
      )
      frame.addView(reactRootView, lp)
      Log.i(TAG, "[SMARTPAPER_OVERLAY] React root mounted inside overlay")
    } else {
      val body = TextView(context).apply {
        text =
            "Copilot overlay\n\n" +
            "React mount failed — see logcat [SMARTPAPER_OVERLAY] " +
            "for the per-step diagnostic. Tap to close."
        textSize = 16f
        setTextColor(Color.BLACK)
      }
      frame.addView(body)
      // Only the diagnostic fallback closes on tap. When the real React
      // panel is mounted, closing goes through the ✕ button — attaching
      // this to the frame made an arm/palm resting on the border close
      // the whole window (a stray tap on the non-interactive inset).
      frame.setOnTouchListener(TapToCloseListener())
      Log.w(TAG, "[SMARTPAPER_OVERLAY] React root NOT mounted; using native fallback")
    }

    return frame
  }

  /**
   * Reflection chain to mount the per-plugin React tree inside our
   * overlay window. See playbook/log/2026-05-08-react-mount-reflection-plan.md.
   *
   * Step 1: get PluginModule via the public TurboModule API.
   * Step 2: read PluginModule.pluginApp (package-private) via reflection.
   * Step 3: invoke getReactInstanceManager() on the runtime concrete
   *         PluginApp via javaClass.getMethod(...).
   * Step 4: ReactRootView.startReactApplication with the per-plugin RIM.
   *
   * Each step logs precisely on failure so a single device run tells us
   * which symbol changed (and we can adapt by reading the SDK source
   * for the new field/method name).
   */
  private fun tryMountReactRootView(context: Context): ReactRootView? {
    val pluginModule = step1GetPluginModule() ?: return null
    val pluginApp = step2ReadPluginAppField(pluginModule) ?: return null
    val rim = step3InvokeGetReactInstanceManager(pluginApp) ?: return null
    return step4StartReactApplication(rim)
  }

  private fun step1GetPluginModule(): PluginModule? {
    // We deliberately use the string-based lookup with the registered
    // module name ("NativePluginManager"). The class-based overload
    // `getNativeModule(Class)` requires the target class to carry a
    // `@ReactModule(name=...)` annotation — sn-plugin-lib's
    // PluginModule does NOT, and the class-based call throws
    // `IllegalArgumentException: Could not find @ReactModule
    // annotation in com.ratta.supernote.pluginlib.modules.PluginModule`
    // (verified on device, logcat 2026-05-08 16:34 PID 17098).
    //
    // The string-based lookup goes through the same TurboModule /
    // legacy registry but doesn't require the annotation. The
    // "NativePluginManager" name is exposed as
    // NativePluginManagerSpec.NAME in the SDK codegen (sn-plugin-lib
    // 0.1.34 / build/generated/.../NativePluginManagerSpec.java:27)
    // and matches the JS-side getEnforcing<Spec>('NativePluginManager').
    return try {
      val module = reactApplicationContext.getNativeModule(MODULE_NAME_NATIVE_PLUGIN_MANAGER)
      if (module == null) {
        Log.w(TAG,
            "[SMARTPAPER_OVERLAY] reflect step1: native module " +
            "'$MODULE_NAME_NATIVE_PLUGIN_MANAGER' not registered " +
            "in this React context — bailing.")
        return null
      }
      if (module !is PluginModule) {
        Log.e(TAG,
            "[SMARTPAPER_OVERLAY] reflect step1: native module " +
            "'$MODULE_NAME_NATIVE_PLUGIN_MANAGER' is " +
            "${module.javaClass.name}, expected PluginModule. " +
            "SDK packaging changed — bailing.")
        return null
      }
      Log.i(TAG, "[SMARTPAPER_OVERLAY] reflect step1: PluginModule=$module")
      module
    } catch (e: Throwable) {
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step1 threw: " +
          "${e.javaClass.simpleName}: ${e.message}", e)
      null
    }
  }

  private fun step2ReadPluginAppField(pluginModule: PluginModule): Any? {
    return try {
      val field = PluginModule::class.java.getDeclaredField("pluginApp")
      field.isAccessible = true
      val value = field.get(pluginModule)
      if (value == null) {
        Log.w(TAG,
            "[SMARTPAPER_OVERLAY] reflect step2: PluginModule.pluginApp is null. " +
            "Host did not inject pluginApp — bailing.")
      } else {
        Log.i(TAG,
            "[SMARTPAPER_OVERLAY] reflect step2: pluginApp=$value " +
            "(runtime class=${value.javaClass.name})")
      }
      value
    } catch (e: NoSuchFieldException) {
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step2: PluginModule.pluginApp field " +
          "not found — SDK rename? Declared fields: " +
          PluginModule::class.java.declaredFields.joinToString { it.name })
      null
    } catch (e: Throwable) {
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step2 threw: " +
          "${e.javaClass.simpleName}: ${e.message}", e)
      null
    }
  }

  private fun step3InvokeGetReactInstanceManager(pluginApp: Any): ReactInstanceManager? {
    // The 2026-05-08 16:38 PID 17098 device run dumped all available
    // methods on com.ratta.supernote.pluginhost.plugin.PluginApp and
    // confirmed: there is NO `getReactInstanceManager()` method
    // (the SDK's commented-out FileSelector reference at
    // FileSelector.java:44 was for an older shape). The current
    // method is `getReactNativeHost()` which returns a standard
    // ReactNativeHost; we then call `.getReactInstanceManager()` on
    // it (a public method on RN's own class, no reflection).
    //
    // ReactNativeHost is per-plugin in this firmware — confirmed by
    // the earlier logcat hint `PluginManager: getReactNativeHost
    // StubActivity:com.ratta.supernote.pluginhost.StubActivity@…` —
    // so the RIM we get from it is the per-plugin one our index.js
    // bundle was loaded into. That is what the original Phase 2
    // crash (Invariant Violation: SnCopilotPanel has not been
    // registered) needed.
    return try {
      val method = pluginApp.javaClass.getMethod("getReactNativeHost")
      val hostRaw = method.invoke(pluginApp)
      if (hostRaw == null) {
        Log.w(TAG,
            "[SMARTPAPER_OVERLAY] reflect step3: getReactNativeHost() " +
            "returned null — host not yet attached? Bailing.")
        return null
      }
      if (hostRaw !is ReactNativeHost) {
        Log.e(TAG,
            "[SMARTPAPER_OVERLAY] reflect step3: getReactNativeHost() " +
            "returned ${hostRaw.javaClass.name}, expected " +
            "com.facebook.react.ReactNativeHost. SDK shape changed — bailing.")
        return null
      }
      Log.i(TAG,
          "[SMARTPAPER_OVERLAY] reflect step3a: ReactNativeHost=$hostRaw")

      val rim = hostRaw.reactInstanceManager
      if (rim == null) {
        Log.w(TAG,
            "[SMARTPAPER_OVERLAY] reflect step3b: " +
            "ReactNativeHost.reactInstanceManager is null — bailing.")
        return null
      }
      Log.i(TAG,
          "[SMARTPAPER_OVERLAY] reflect step3b: ReactInstanceManager=$rim")
      rim
    } catch (e: NoSuchMethodException) {
      val methods = pluginApp.javaClass.methods
          .map { it.name }
          .distinct()
          .sorted()
          .joinToString()
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step3: getReactNativeHost() " +
          "method not found on ${pluginApp.javaClass.name}. " +
          "Available methods: $methods")
      null
    } catch (e: Throwable) {
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step3 threw: " +
          "${e.javaClass.simpleName}: ${e.message}", e)
      null
    }
  }

  private fun step4StartReactApplication(rim: ReactInstanceManager): ReactRootView? {
    return try {
      val rootView = ReactRootView(reactApplicationContext)
      val initialProps = Bundle()
      // Reserved for Phase 2 — handlers will pass scope info here so
      // the panel knows which entry point fired (sidebar / lasso /
      // doc-select). Empty for the de-risk-mount step.
      rootView.startReactApplication(rim, REACT_OVERLAY_COMPONENT, initialProps)
      Log.i(TAG,
          "[SMARTPAPER_OVERLAY] reflect step4: startReactApplication " +
          "(\"$REACT_OVERLAY_COMPONENT\") succeeded")
      rootView
    } catch (e: Throwable) {
      Log.e(TAG,
          "[SMARTPAPER_OVERLAY] reflect step4: startReactApplication threw: " +
          "${e.javaClass.simpleName}: ${e.message}", e)
      null
    }
  }

  private fun buildLayoutParams(
      width: Double,
      height: Double,
      x: Double,
      y: Double,
      type: Int,
      tokenSource: Activity?,
  ): WindowManager.LayoutParams {
    // Window flag rationale:
    //
    //  FLAG_NOT_TOUCH_MODAL — touches OUTSIDE our overlay still go
    //  to the underlying note canvas (so the user can keep writing
    //  on the page). This is the load-bearing flag for the page-
    //  stays-editable behaviour proven in the 2026-05-08 device
    //  run.
    //
    //  FLAG_LAYOUT_NO_LIMITS — overlay can extend outside the
    //  screen bounds (kept for safety; harmless when we right-dock
    //  on-screen).
    //
    //  FLAG_NOT_FOCUSABLE (v0.70, device bug 2026-07-20): a focusable
    //  APPLICATION_OVERLAY GRABS and HOLDS the system input focus. This
    //  window is the SAME one whether expanded (panel) or shrunk (the
    //  logo bubble) — so even the idle bubble, focusable, held the focus.
    //  While it does, system gestures routed to the note app (the
    //  2-finger side-bar lasso) stop working until a restart — the
    //  InputDispatcher sits "waiting to send key … because there are
    //  unprocessed events" on our window (confirmed via dumpsys). So the
    //  window opens NON-FOCUSABLE and can never steal focus at rest.
    //  The chat TextInput still needs the keyboard, so setPanelFocusable()
    //  DROPS this flag for the moments the user is typing (JS toggles it
    //  on TextInput focus / blur) and restores it after. ALT_FOCUSABLE_IM
    //  alone did NOT deliver keystrokes to the RN TextInput (device-
    //  verified 2026-07-20: "no keyboard"), hence the dynamic toggle.
    val flags = (
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    )
    val params = WindowManager.LayoutParams(
        width.toInt(),
        height.toInt(),
        type,
        flags,
        PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = x.toInt()
    params.y = y.toInt()
    // Sub-window types need an attached token; system types don't.
    if (tokenSource != null) {
      params.token = tokenSource.window.decorView.windowToken
    }
    return params
  }

  private fun buildResult(success: Boolean, code: String, message: String): WritableMap {
    val map = Arguments.createMap()
    map.putBoolean("success", success)
    map.putString("code", code)
    map.putString("message", message)
    return map
  }

  private fun buildScreenSizeResult(
      success: Boolean,
      width: Int,
      height: Int,
      message: String,
  ): WritableMap {
    val map = Arguments.createMap()
    map.putBoolean("success", success)
    map.putInt("width", width)
    map.putInt("height", height)
    map.putString("message", message)
    return map
  }


  private fun succeed(promise: Promise, attempts: List<AttemptResult>, winning: AttemptResult) {
    val msg = winning.message + " (attempted " + attempts.size + " type(s))"
    promise.resolve(buildResult(success = true, code = "OK", message = msg))
  }

  private fun fail(
      promise: Promise,
      attempts: List<AttemptResult>,
      code: String,
      message: String,
      canDrawOverlays: Boolean,
  ) {
    val combined = StringBuilder()
    combined.append(message)
    combined.append(" canDrawOverlays=").append(canDrawOverlays).append(". ")
    combined.append("Attempts: ")
    combined.append(attempts.joinToString("; ") { "${it.label}=${if (it.success) "ok" else "failed"} (${it.message})" })
    promise.resolve(buildResult(success = false, code = code, message = combined.toString()))
  }

  private inner class TapToCloseListener : View.OnTouchListener {
    private var downX = 0f
    private var downY = 0f
    private val tapSlopPx = 12

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
        }
        MotionEvent.ACTION_UP -> {
          val dx = kotlin.math.abs(event.rawX - downX)
          val dy = kotlin.math.abs(event.rawY - downY)
          if (dx <= tapSlopPx && dy <= tapSlopPx) {
            Log.i(TAG, "[SMARTPAPER_OVERLAY] tap detected — closing overlay")
            removeOverlay()
          }
        }
      }
      return true
    }
  }
}
