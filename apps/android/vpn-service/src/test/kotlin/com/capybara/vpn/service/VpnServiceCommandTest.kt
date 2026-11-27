package com.capybara.vpn.service

import kotlin.test.Test
import kotlin.test.assertEquals

class VpnServiceCommandTest {
    @Test
    fun `explicit start action starts the service`() {
        assertEquals(
            VpnServiceCommand.START,
            vpnServiceCommandFor(VPN_SERVICE_ACTION_START),
        )
    }

    @Test
    fun `explicit stop action stops the service`() {
        assertEquals(
            VpnServiceCommand.STOP,
            vpnServiceCommandFor(VPN_SERVICE_ACTION_STOP),
        )
    }

    @Test
    fun `missing action never starts the service`() {
        assertEquals(
            VpnServiceCommand.IGNORE,
            vpnServiceCommandFor(null),
        )
    }

    @Test
    fun `unknown action never starts the service`() {
        assertEquals(
            VpnServiceCommand.IGNORE,
            vpnServiceCommandFor("com.capybara.vpn.action.UNKNOWN"),
        )
    }
}
