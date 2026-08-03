package com.smartnoteai

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * SmartNoteAiOverlayPackage — registers SmartNoteAiOverlayModule with React
 * Native so JS can call NativeModules.CopilotOverlay.{open,move,close}.
 *
 * Discovered automatically by buildPlugin.sh's
 * find_manual_react_packages_from_application parser, which scans
 * MainApplication.kt for `add(SmartNoteAiOverlayPackage())` and triggers
 * the gradle native build whenever a custom ReactPackage is found.
 */
class SmartNoteAiOverlayPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(SmartNoteAiOverlayModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
