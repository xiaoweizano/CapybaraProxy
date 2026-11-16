package com.flowproxy.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class ProxyStatusTest {
    @Test
    fun `both services running with permission is connected`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.RUNNING,
            core = CoreState.RUNNING,
        )

        assertEquals(ConnectionStatus.CONNECTED, deriveConnectionStatus(status))
    }

    @Test
    fun `running vpn without running core is not connected`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.RUNNING,
            core = CoreState.UNAVAILABLE,
        )

        assertEquals(
            ConnectionStatus.RUNNING_DISCONNECTED,
            deriveConnectionStatus(status),
        )
    }

    @Test
    fun `stopped vpn never reports connected even if core claims running`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.STOPPED,
            core = CoreState.RUNNING,
        )

        assertEquals(ConnectionStatus.STOPPED, deriveConnectionStatus(status))
    }

    @Test
    fun `denied permission takes priority over background service state`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.DENIED,
            vpnService = VpnServiceState.ERROR,
            core = CoreState.ERROR,
        )

        assertEquals(
            ConnectionStatus.PERMISSION_REQUIRED,
            deriveConnectionStatus(status),
        )
    }

    @Test
    fun `core error is recoverable error state`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.RUNNING,
            core = CoreState.ERROR,
        )

        assertEquals(ConnectionStatus.ERROR, deriveConnectionStatus(status))
    }

    @Test
    fun `starting states map to starting`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.STARTING,
            core = CoreState.READY,
        )

        assertEquals(ConnectionStatus.STARTING, deriveConnectionStatus(status))
    }

    @Test
    fun `stopping state maps to stopping`() {
        val status = ProxyStatus(
            permission = VpnPermissionState.GRANTED,
            vpnService = VpnServiceState.STOPPING,
            core = CoreState.RUNNING,
        )

        assertEquals(ConnectionStatus.STOPPING, deriveConnectionStatus(status))
    }
}
