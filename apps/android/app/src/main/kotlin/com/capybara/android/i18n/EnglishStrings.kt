package com.capybara.android.i18n

/** English strings. Values match the pre-i18n build exactly. */
object EnglishStrings : AppStrings {
    override val language = AppLanguage.ENGLISH

    override val localControl = "LOCAL CONTROL"
    override val demoBadge = "DEMO"
    override val more = "More"
    override val backToMore = "Back to More"
    override val workspaceEyebrow = "Workspace"
    override val select = "Select"

    override val navOverview = "Overview"
    override val navProxies = "Proxies"
    override val navRules = "Rules"
    override val navConnections = "Connections"
    override val navProfiles = "Profiles"
    override val navLogs = "Logs"
    override val navSettings = "Settings"
    override val moreDescription =
        "Configuration, diagnostics and preferences live here on compact screens."

    override val describeProfiles = "Isolated profile catalog"
    override val describeLogs = "Synthetic diagnostic entries"
    override val describeSettings = "Theme, motion and device permissions"

    override val route = "Route"
    override val proxyGroupLabel = "PROXY GROUP"
    override val currentNodeLabel = "CURRENT NODE"
    override val catalogPreviewNote =
        "Catalog preview only. No node switch is sent to a proxy core."
    override val latency = "Latency"
    override val runtimeNotConnected = "Runtime not connected"
    override val connections = "Connections"
    override val active = "active"
    override val noCoreTelemetry = "No core telemetry"
    override val nodeMap = "Node map"
    override val unavailableLabel = "UNAVAILABLE"
    override val noTrustedCoordinates = "No trusted node coordinates"
    override val themeA = "A · CYBER FLOW"
    override val themeC = "C · WARM FLOW"
    override val actionStopVpn = "Stop VPN session"
    override val actionReviewPermission = "Review VPN permission"
    override val actionStartVpn = "Start VPN session"
    override val networkLabel = "NETWORK"
    override val vpnLabel = "VPN"
    override val coreLabel = "CORE"
    override val online = "Online"
    override val offline = "Offline"
    override val bridgePrefix = "Mihomo native bridge: "

    override val headlineConnected = "Network flow is protected"
    override val headlineStarting = "Bringing the session online"
    override val headlineRunningDisconnected = "VPN shell is ready"
    override val headlineStopping = "Stopping the VPN session"
    override val headlineError = "VPN session needs attention"
    override val headlinePermission = "VPN permission is required"
    override val headlineStopped = "Your network flow is paused"

    override val detailNoNetwork =
        "No active Android network. The app remains responsive and will update after connectivity returns."
    override val detailPermissionDenied =
        "Android did not grant VPN consent. Tap the action to request it again."
    override val detailShellWithoutCore =
        "Android accepted a no-route VPN shell. No traffic is proxied because the core is unavailable."
    override val detailDefault =
        "Connect starts only the Android VPN lifecycle. A verified Mihomo native bridge is still required for proxying."

    override val statusConnected = "Connected"
    override val statusStarting = "Starting"
    override val statusStopping = "Stopping"
    override val statusVpnReady = "VPN ready"
    override val statusError = "Error"
    override val statusPermissionNeeded = "Permission needed"
    override val statusStopped = "Stopped"

    override val vpnStopped = "Stopped"
    override val vpnStarting = "Starting"
    override val vpnReady = "Ready"
    override val vpnStopping = "Stopping"
    override val vpnError = "Error"

    override val coreMissing = "Missing"
    override val coreProbing = "Probing"
    override val coreReady = "Ready"
    override val coreStarting = "Starting"
    override val coreRunning = "Running"
    override val coreError = "Error"

    override val settingsEyebrow = "Preferences"
    override val settingsTitle = "Settings"
    override val settingsDescription =
        "Theme and lifecycle settings are persisted on device. Runtime controls remain capability-gated."
    override val appearance = "Appearance"
    override val appearanceDescription =
        "A is the default dark theme. C switches to the warm blue-white theme."
    override val themeACyberFlow = "A · Cyber Flow"
    override val themeCWarmFlow = "C · Warm Flow"
    override val reduceMotion = "Reduce motion"
    override val reduceMotionDescription =
        "Pauses Orb and companion idle animation when enabled."
    override val languageTitle = "Language"
    override val languageDescription = "Interface language for the Android client."
    override val languageEnglish = "English"
    override val languageChinese = "简体中文"
    override val androidVpn = "Android VPN"
    override val androidVpnDescription =
        "The service uses an Android foreground notification. No routes are installed until a verified Mihomo bridge can consume the TUN descriptor."
    override val permissionLabel = "PERMISSION"
    override val serviceLabel = "SERVICE"
    override val notificationsBattery = "Notifications & battery"
    override val foregroundNotification = "Foreground notification"
    override val notificationAllowed =
        "Allowed. VPN lifecycle status is visible in the notification shade."
    override val notificationBlocked =
        "Not allowed. Android can hide notification content, but the foreground-service requirement still applies."
    override val allow = "Allow"
    override val batteryOptimization = "Battery optimization"
    override val batteryDescription =
        "Keep the VPN session active while the screen is off. Exact behavior depends on the device vendor."
    override val open = "Open"
    override val mihomoBridge = "Mihomo native bridge"
    override val verifiedBadge = "VERIFIED"
    override val probeOnlyBadge = "PROBE ONLY"
    override val unavailableBadge = "UNAVAILABLE"
    override val abiLabel = "ABI"
    override val libraryLabel = "Library"
    override val present = "Present"
    override val notBundled = "Not bundled"
    override val tunHandoffLabel = "TUN FD handoff"
    override val verifiedValue = "Verified"
    override val unverifiedValue = "Unverified"
    override val stageBoundary = "Stage boundary"
    override val stageBoundaryDescription =
        "Proxy groups, nodes, rules, connections, profiles and logs are isolated demo catalogs. They never report as live Mihomo data."

    override val proxiesEyebrow = "Routing"
    override val proxiesTitle = "Proxies"
    override val proxiesDescription =
        "Group and node catalog preview. Runtime switching remains disabled until the core is verified."
    override val selectedNodePrefix = "Selected node: "
    override val nodeSelectionPreviewNote =
        "Node selection updates only this preview screen."
    override val selectedDemoNodeDescription = "Selected demo node"
    override val rulesEyebrow = "Policy"
    override val rulesTitle = "Rules"
    override val rulesDescription =
        "Sample routing rules, isolated from Runtime. Live rules require a connected Mihomo API."
    override val policyPrefix = "Policy · "
    override val connectionsEyebrow = "Network activity"
    override val connectionsTitle = "Connections"
    override val connectionsDescription =
        "The live list is empty until VPN and a verified proxy core are both running."
    override val liveMonitoringAvailable = "Live monitoring available"
    override val vpnReadyCoreUnavailable = "VPN ready · core unavailable"
    override val vpnPermissionRequired = "VPN permission required"
    override val connectionMonitorPaused = "Connection monitor paused"
    override val noActiveProxySession = "No active proxy session"
    override val liveActiveConnectionsZero = "Live active connections: 0"
    override val sampleList = "SAMPLE LIST"
    override val profilesEyebrow = "Configuration"
    override val profilesTitle = "Profiles"
    override val profilesDescription =
        "Preview profiles are local demo records. Subscription download and core reload are not enabled."
    override val demoProfileSelected = "Demo profile selected"
    override val selectDemoProfile = "Select demo profile"
    override val logsEyebrow = "Diagnostics"
    override val logsTitle = "Logs"
    override val logsDescription =
        "Synthetic entries demonstrate layout and severity treatment. They are not Runtime logs."
    override val secretRedactionNote =
        "SECRET REDACTION AND LIVE STREAMING NOT CONNECTED"

    override val traffic = "Traffic"
    override val trafficSyntheticNote = "Synthetic preview · no proxy telemetry"
    override val upload = "Upload"
    override val download = "Download"

    override val vpnConsentUnavailable = "Android VPN consent is unavailable."
    override val vpnPermissionCheckFailed = "Unable to check Android VPN permission."
    override val vpnPermissionPrepareFailed = "Unable to prepare Android VPN permission."
    override val vpnStartDenied = "Android denied the VPN service start."
    override val vpnCannotStart = "The VPN service cannot start right now."
    override val vpnStopDenied = "Android denied the VPN service stop."
    override val vpnNotRunning = "The VPN service is not running."
    override val settingsScreenUnavailable =
        "This Android device does not expose that settings screen."
    override val settingsAccessDenied = "Android denied access to that settings screen."
    override val notificationsDisabledNotice =
        "Notifications remain disabled in Android settings."
}