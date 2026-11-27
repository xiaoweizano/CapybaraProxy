package com.capybara.android.platform

import com.capybara.core.model.VpnPermissionState
import com.capybara.core.model.VpnServiceState
import kotlin.test.Test
import kotlin.test.assertEquals

class VpnActionPolicyTest {
    @Test
    fun `running session stops before requesting consent`() {
        assertEquals(
            VpnAction.STOP,
            decideVpnAction(
                serviceState = VpnServiceState.RUNNING,
                permissionProbe = VpnPermissionProbe.CONSENT_REQUIRED,
            ),
        )
    }

    @Test
    fun `starting session can be cancelled`() {
        assertEquals(
            VpnAction.STOP,
            decideVpnAction(
                serviceState = VpnServiceState.STARTING,
                permissionProbe = VpnPermissionProbe.PREPARED,
            ),
        )
    }

    @Test
    fun `stopping session ignores repeated taps`() {
        assertEquals(
            VpnAction.WAIT,
            decideVpnAction(
                serviceState = VpnServiceState.STOPPING,
                permissionProbe = VpnPermissionProbe.PREPARED,
            ),
        )
    }

    @Test
    fun `stopped session without consent requests permission`() {
        assertEquals(
            VpnAction.REQUEST_CONSENT,
            decideVpnAction(
                serviceState = VpnServiceState.STOPPED,
                permissionProbe = VpnPermissionProbe.CONSENT_REQUIRED,
            ),
        )
    }

    @Test
    fun `prepared session starts without another consent dialog`() {
        assertEquals(
            VpnAction.START,
            decideVpnAction(
                serviceState = VpnServiceState.ERROR,
                permissionProbe = VpnPermissionProbe.PREPARED,
            ),
        )
    }

    @Test
    fun `permission check failure never starts the service`() {
        assertEquals(
            VpnAction.REPORT_ERROR,
            decideVpnAction(
                serviceState = VpnServiceState.STOPPED,
                permissionProbe = VpnPermissionProbe.CHECK_FAILED,
            ),
        )
    }

    @Test
    fun `running session remains stoppable when permission check fails`() {
        assertEquals(
            VpnAction.STOP,
            decideVpnAction(
                serviceState = VpnServiceState.RUNNING,
                permissionProbe = VpnPermissionProbe.CHECK_FAILED,
            ),
        )
    }

    @Test
    fun `consent result maps to explicit permission state`() {
        assertEquals(
            VpnPermissionState.GRANTED,
            permissionAfterConsent(consented = true),
        )
        assertEquals(
            VpnPermissionState.DENIED,
            permissionAfterConsent(consented = false),
        )
    }

    @Test
    fun `prepared VPN reconciles to granted permission`() {
        assertEquals(
            VpnPermissionState.GRANTED,
            permissionAfterProbe(
                probe = VpnPermissionProbe.PREPARED,
                current = VpnPermissionState.REQUIRED,
            ),
        )
    }

    @Test
    fun `denied permission is preserved until a new consent result`() {
        assertEquals(
            VpnPermissionState.DENIED,
            permissionAfterProbe(
                probe = VpnPermissionProbe.CONSENT_REQUIRED,
                current = VpnPermissionState.DENIED,
            ),
        )
    }

    @Test
    fun `unprepared permission reconciles to required`() {
        assertEquals(
            VpnPermissionState.REQUIRED,
            permissionAfterProbe(
                probe = VpnPermissionProbe.CONSENT_REQUIRED,
                current = VpnPermissionState.UNKNOWN,
            ),
        )
    }

    @Test
    fun `permission check failure preserves existing permission state`() {
        listOf(
            VpnPermissionState.UNKNOWN,
            VpnPermissionState.REQUIRED,
            VpnPermissionState.GRANTED,
            VpnPermissionState.DENIED,
        ).forEach { current ->
            assertEquals(
                current,
                permissionAfterProbe(
                    probe = VpnPermissionProbe.CHECK_FAILED,
                    current = current,
                ),
            )
        }
    }
}
