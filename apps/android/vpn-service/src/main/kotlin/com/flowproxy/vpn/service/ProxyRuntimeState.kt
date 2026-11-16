package com.flowproxy.vpn.service

import com.flowproxy.core.model.CoreState
import com.flowproxy.core.model.ProxyStatus
import com.flowproxy.core.model.VpnPermissionState
import com.flowproxy.core.model.VpnServiceState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

object ProxyRuntimeState {
    private val mutableStatus = MutableStateFlow(
        ProxyStatus(
            permission = VpnPermissionState.REQUIRED,
            vpnService = VpnServiceState.STOPPED,
            core = CoreState.UNAVAILABLE,
        ),
    )

    val status: StateFlow<ProxyStatus> = mutableStatus.asStateFlow()

    fun setPermission(permission: VpnPermissionState) {
        mutableStatus.update { it.copy(permission = permission) }
    }

    fun setCore(core: CoreState) {
        mutableStatus.update { it.copy(core = core) }
    }

    fun reportServiceStartFailure() {
        mutableStatus.update { it.copy(vpnService = VpnServiceState.ERROR) }
    }

    internal fun setVpnService(state: VpnServiceState) {
        mutableStatus.update { it.copy(vpnService = state) }
    }
}
