package com.capybara.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.capybara.core.data.AppPreferences
import com.capybara.core.model.CoreState
import com.capybara.core.model.MihomoBridgeState
import com.capybara.core.model.MihomoCapabilityReport
import com.capybara.core.model.ThemeId
import com.capybara.core.model.VpnPermissionState
import com.capybara.mihomo.bridge.AndroidMihomoBridge
import com.capybara.android.platform.VpnPermissionProbe
import com.capybara.android.platform.permissionAfterProbe
import com.capybara.android.i18n.AppLanguage
import com.capybara.vpn.service.ProxyRuntimeState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val capybaraProxyApplication = application as CapybaraProxyApplication
    private val preferencesRepository =
        capybaraProxyApplication.preferencesRepository

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
    val networkAvailable = capybaraProxyApplication.networkMonitor.available

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
