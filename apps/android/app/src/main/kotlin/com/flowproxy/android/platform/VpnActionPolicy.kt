package com.flowproxy.android.platform

import com.flowproxy.core.model.VpnPermissionState
import com.flowproxy.core.model.VpnServiceState

enum class VpnAction {
    STOP,
    START,
    REQUEST_CONSENT,
    WAIT,
    REPORT_ERROR,
}

enum class VpnPermissionProbe {
    PREPARED,
    CONSENT_REQUIRED,
    CHECK_FAILED,
}

fun decideVpnAction(
    serviceState: VpnServiceState,
    permissionProbe: VpnPermissionProbe,
): VpnAction =
    when {
        serviceState == VpnServiceState.RUNNING ||
            serviceState == VpnServiceState.STARTING -> VpnAction.STOP

        serviceState == VpnServiceState.STOPPING -> VpnAction.WAIT
        else ->
            when (permissionProbe) {
                VpnPermissionProbe.CHECK_FAILED -> VpnAction.REPORT_ERROR
                VpnPermissionProbe.CONSENT_REQUIRED -> VpnAction.REQUEST_CONSENT
                VpnPermissionProbe.PREPARED -> VpnAction.START
            }
    }

fun permissionAfterConsent(consented: Boolean): VpnPermissionState =
    if (consented) {
        VpnPermissionState.GRANTED
    } else {
        VpnPermissionState.DENIED
    }

fun permissionAfterProbe(
    probe: VpnPermissionProbe,
    current: VpnPermissionState,
): VpnPermissionState =
    when (probe) {
        VpnPermissionProbe.PREPARED -> VpnPermissionState.GRANTED
        VpnPermissionProbe.CHECK_FAILED -> current
        VpnPermissionProbe.CONSENT_REQUIRED ->
            if (current == VpnPermissionState.DENIED) {
                VpnPermissionState.DENIED
            } else {
                VpnPermissionState.REQUIRED
            }
    }
