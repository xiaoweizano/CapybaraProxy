package com.capybara.android.i18n

import com.capybara.core.model.ConnectionStatus
import com.capybara.core.model.CoreState
import com.capybara.core.model.VpnServiceState

/**
 * Every user-facing string on the Android client.
 *
 * English values are unchanged from the pre-i18n build, so screenshots and
 * tests that assert English text keep working.
 */
interface AppStrings {
    val language: AppLanguage

    // Shared chrome
    val localControl: String
    val demoBadge: String
    val more: String
    val backToMore: String
    val workspaceEyebrow: String
    val select: String

    // Navigation
    val navOverview: String
    val navProxies: String
    val navRules: String
    val navConnections: String
    val navProfiles: String
    val navLogs: String
    val navSettings: String
    val moreDescription: String

    // Page descriptions used by the More list
    val describeProfiles: String
    val describeLogs: String
    val describeSettings: String

    // Overview
    val route: String
    val proxyGroupLabel: String
    val currentNodeLabel: String
    val catalogPreviewNote: String
    val latency: String
    val runtimeNotConnected: String
    val connections: String
    val active: String
    val noCoreTelemetry: String
    val nodeMap: String
    val unavailableLabel: String
    val noTrustedCoordinates: String
    val themeA: String
    val themeC: String
    val actionStopVpn: String
    val actionReviewPermission: String
    val actionStartVpn: String
    val networkLabel: String
    val vpnLabel: String
    val coreLabel: String
    val online: String
    val offline: String
    val bridgePrefix: String

    val headlineConnected: String
    val headlineStarting: String
    val headlineRunningDisconnected: String
    val headlineStopping: String
    val headlineError: String
    val headlinePermission: String
    val headlineStopped: String

    val detailNoNetwork: String
    val detailPermissionDenied: String
    val detailShellWithoutCore: String
    val detailDefault: String

    val statusConnected: String
    val statusStarting: String
    val statusStopping: String
    val statusVpnReady: String
    val statusError: String
    val statusPermissionNeeded: String
    val statusStopped: String

    val vpnStopped: String
    val vpnStarting: String
    val vpnReady: String
    val vpnStopping: String
    val vpnError: String

    val coreMissing: String
    val coreProbing: String
    val coreReady: String
    val coreStarting: String
    val coreRunning: String
    val coreError: String

    // Settings
    val settingsEyebrow: String
    val settingsTitle: String
    val settingsDescription: String
    val appearance: String
    val appearanceDescription: String
    val themeACyberFlow: String
    val themeCWarmFlow: String
    val reduceMotion: String
    val reduceMotionDescription: String
    val languageTitle: String
    val languageDescription: String
    val languageEnglish: String
    val languageChinese: String
    val androidVpn: String
    val androidVpnDescription: String
    val permissionLabel: String
    val serviceLabel: String
    val notificationsBattery: String
    val foregroundNotification: String
    val notificationAllowed: String
    val notificationBlocked: String
    val allow: String
    val batteryOptimization: String
    val batteryDescription: String
    val open: String
    val mihomoBridge: String
    val verifiedBadge: String
    val probeOnlyBadge: String
    val unavailableBadge: String
    val abiLabel: String
    val libraryLabel: String
    val present: String
    val notBundled: String
    val tunHandoffLabel: String
    val verifiedValue: String
    val unverifiedValue: String
    val stageBoundary: String
    val stageBoundaryDescription: String

    // Workspace pages
    val proxiesEyebrow: String
    val proxiesTitle: String
    val proxiesDescription: String
    val selectedNodePrefix: String
    val nodeSelectionPreviewNote: String
    val selectedDemoNodeDescription: String
    val rulesEyebrow: String
    val rulesTitle: String
    val rulesDescription: String
    val policyPrefix: String
    val connectionsEyebrow: String
    val connectionsTitle: String
    val connectionsDescription: String
    val liveMonitoringAvailable: String
    val vpnReadyCoreUnavailable: String
    val vpnPermissionRequired: String
    val connectionMonitorPaused: String
    val noActiveProxySession: String
    val liveActiveConnectionsZero: String
    val sampleList: String
    val profilesEyebrow: String
    val profilesTitle: String
    val profilesDescription: String
    val demoProfileSelected: String
    val selectDemoProfile: String
    val logsEyebrow: String
    val logsTitle: String
    val logsDescription: String
    val secretRedactionNote: String

    // Traffic chart
    val traffic: String
    val trafficSyntheticNote: String
    val upload: String
    val download: String

    // MainActivity messages
    val vpnConsentUnavailable: String
    val vpnPermissionCheckFailed: String
    val vpnPermissionPrepareFailed: String
    val vpnStartDenied: String
    val vpnCannotStart: String
    val vpnStopDenied: String
    val vpnNotRunning: String
    val settingsScreenUnavailable: String
    val settingsAccessDenied: String
    val notificationsDisabledNotice: String
}

/** Resolves the label shown on a status pill. */
fun AppStrings.statusLabel(status: ConnectionStatus): String = when (status) {
    ConnectionStatus.CONNECTED -> statusConnected
    ConnectionStatus.STARTING -> statusStarting
    ConnectionStatus.STOPPING -> statusStopping
    ConnectionStatus.RUNNING_DISCONNECTED -> statusVpnReady
    ConnectionStatus.ERROR -> statusError
    ConnectionStatus.PERMISSION_REQUIRED -> statusPermissionNeeded
    ConnectionStatus.STOPPED -> statusStopped
}

/** Resolves the compact VPN state label used in metrics. */
fun AppStrings.vpnStateLabel(state: VpnServiceState): String = when (state) {
    VpnServiceState.STOPPED -> vpnStopped
    VpnServiceState.STARTING -> vpnStarting
    VpnServiceState.RUNNING -> vpnReady
    VpnServiceState.STOPPING -> vpnStopping
    VpnServiceState.ERROR -> vpnError
}

/** Resolves the compact core state label used in metrics. */
fun AppStrings.coreStateLabel(state: CoreState): String = when (state) {
    CoreState.UNAVAILABLE -> coreMissing
    CoreState.PROBING -> coreProbing
    CoreState.READY -> coreReady
    CoreState.STARTING -> coreStarting
    CoreState.RUNNING -> coreRunning
    CoreState.ERROR -> coreError
}

fun stringsFor(language: AppLanguage): AppStrings = when (language) {
    AppLanguage.ENGLISH -> EnglishStrings
    AppLanguage.SIMPLIFIED_CHINESE -> ChineseStrings
}