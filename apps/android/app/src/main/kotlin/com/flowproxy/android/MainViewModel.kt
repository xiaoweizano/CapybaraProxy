package com.flowproxy.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.flowproxy.core.data.AppPreferences
import com.flowproxy.core.model.CoreState
import com.flowproxy.core.model.MihomoBridgeState
import com.flowproxy.core.model.MihomoCapabilityReport
import com.flowproxy.core.model.ThemeId
import com.flowproxy.core.model.VpnPermissionState
import com.flowproxy.mihomo.bridge.AndroidMihomoBridge
import com.flowproxy.android.platform.VpnPermissionProbe
import com.flowproxy.android.platform.permissionAfterProbe
import com.flowproxy.android.i18n.AppLanguage
import com.flowproxy.vpn.service.ProxyRuntimeState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val flowProxyApplication = application as FlowProxyApplication
    private val preferencesRepository =
        flowProxyApplication.preferencesRepository

    val preferences: StateFlow<AppPreferences> = preferencesRepository.preferences
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = AppPreferences(),
        )

    val capability: StateFlow<MihomoCapabilityReport> = MutableStateFlow(
        AndroidMihomoBridge(application).probe(),
    ).also { reportFlow ->
        ProxyRuntimeState.setCore(
            when (reportFlow.value.state) {
                MihomoBridgeState.AVAILABLE -> CoreState.READY
                MihomoBridgeState.PROBE_ONLY,
                MihomoBridgeState.UNAVAILABLE,
                -> CoreState.UNAVAILABLE
            },
        )
    }

    val status = ProxyRuntimeState.status
    val networkAvailable = flowProxyApplication.networkMonitor.available

    fun setTheme(themeId: ThemeId) {
        viewModelScope.launch {
            preferencesRepository.setTheme(themeId)
        }
    }

    fun setReducedMotion(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.setReducedMotion(enabled)
        }
    }

    fun setLanguage(language: AppLanguage) {
        viewModelScope.launch {
            preferencesRepository.setLanguage(language.id)
        }
    }

    fun setVpnPermission(permission: VpnPermissionState) {
        ProxyRuntimeState.setPermission(permission)
    }

    fun reconcileVpnPermission(probe: VpnPermissionProbe) {
        val current = ProxyRuntimeState.status.value.permission
        val reconciled = permissionAfterProbe(
            probe = probe,
            current = current,
        )
        if (reconciled != current) {
            ProxyRuntimeState.setPermission(reconciled)
        }
    }
}
