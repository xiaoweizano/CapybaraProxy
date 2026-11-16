package com.flowproxy.core.model

enum class VpnPermissionState {
    UNKNOWN,
    REQUIRED,
    GRANTED,
    DENIED,
}

enum class VpnServiceState {
    STOPPED,
    STARTING,
    RUNNING,
    STOPPING,
    ERROR,
}

enum class CoreState {
    UNAVAILABLE,
    PROBING,
    READY,
    STARTING,
    RUNNING,
    ERROR,
}

enum class ConnectionStatus {
    STOPPED,
    STARTING,
    RUNNING_DISCONNECTED,
    CONNECTED,
    STOPPING,
    ERROR,
    PERMISSION_REQUIRED,
}

data class ProxyStatus(
    val permission: VpnPermissionState = VpnPermissionState.UNKNOWN,
    val vpnService: VpnServiceState = VpnServiceState.STOPPED,
    val core: CoreState = CoreState.UNAVAILABLE,
)

fun deriveConnectionStatus(status: ProxyStatus): ConnectionStatus {
    if (status.permission != VpnPermissionState.GRANTED) {
        return ConnectionStatus.PERMISSION_REQUIRED
    }

    if (
        status.vpnService == VpnServiceState.ERROR ||
        status.core == CoreState.ERROR
    ) {
        return ConnectionStatus.ERROR
    }

    if (status.vpnService == VpnServiceState.STOPPING) {
        return ConnectionStatus.STOPPING
    }

    if (
        status.vpnService == VpnServiceState.STARTING ||
        status.core == CoreState.STARTING ||
        status.core == CoreState.PROBING
    ) {
        return ConnectionStatus.STARTING
    }

    if (
        status.vpnService == VpnServiceState.RUNNING &&
        status.core == CoreState.RUNNING
    ) {
        return ConnectionStatus.CONNECTED
    }

    if (status.vpnService == VpnServiceState.RUNNING) {
        return ConnectionStatus.RUNNING_DISCONNECTED
    }

    return ConnectionStatus.STOPPED
}
