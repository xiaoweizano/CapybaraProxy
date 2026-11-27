package com.capybara.android

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.capybara.android.platform.VpnAction
import com.capybara.android.platform.VpnPermissionProbe
import com.capybara.android.platform.decideVpnAction
import com.capybara.android.platform.permissionAfterConsent
import com.capybara.android.i18n.AppLanguage
import com.capybara.android.i18n.AppStrings
import com.capybara.android.i18n.stringsFor
import com.capybara.android.ui.CapybaraProxyApp
import com.capybara.core.model.ProxyStatus
import com.capybara.core.model.VpnPermissionState
import com.capybara.core.theme.CapybaraProxyTheme
import com.capybara.vpn.service.CapybaraProxyVpnService
import com.capybara.vpn.service.ProxyRuntimeState

class MainActivity : ComponentActivity() {
    private sealed interface VpnConsentProbe {
        val outcome: VpnPermissionProbe

        data object Prepared : VpnConsentProbe {
            override val outcome = VpnPermissionProbe.PREPARED
        }

        data class ConsentRequired(
            val intent: Intent,
        ) : VpnConsentProbe {
            override val outcome = VpnPermissionProbe.CONSENT_REQUIRED
        }

        data object CheckFailed : VpnConsentProbe {
            override val outcome = VpnPermissionProbe.CHECK_FAILED
        }
    }

    private val viewModel: MainViewModel by viewModels()
    private var notificationsEnabled by mutableStateOf(false)

    /** Current interface strings, resolved from the persisted preference. */
    private val strings: AppStrings
        get() = stringsFor(
            AppLanguage.parse(viewModel.preferences.value.languageId),
        )

    private val vpnConsentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val consented = result.resultCode == Activity.RESULT_OK
        viewModel.setVpnPermission(permissionAfterConsent(consented))
        if (consented) {
            startVpnService()
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notificationsEnabled = granted
        if (!granted) {
            showMessage(strings.notificationsDisabledNotice)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        refreshPlatformPermissions()

        setContent {
            val preferences by viewModel.preferences.collectAsStateWithLifecycle()
            val status by viewModel.status.collectAsStateWithLifecycle()
            val capability by viewModel.capability.collectAsStateWithLifecycle()
            val networkAvailable by viewModel.networkAvailable.collectAsStateWithLifecycle()

            CapybaraProxyTheme(themeId = preferences.themeId) {
                CapybaraProxyApp(
                    themeId = preferences.themeId,
                    reducedMotion = preferences.reducedMotion,
                    status = status,
                    capability = capability,
                    networkAvailable = networkAvailable,
                    notificationsEnabled = notificationsEnabled,
                    onThemeChange = viewModel::setTheme,
                    onReducedMotionChange = viewModel::setReducedMotion,
                    onRequestNotifications = ::requestNotificationPermission,
                    onOpenBatterySettings = ::openBatteryOptimizationSettings,
                    onVpnAction = { handleVpnAction(status) },
                    language = AppLanguage.parse(preferences.languageId),
                    onLanguageChange = viewModel::setLanguage,
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshPlatformPermissions()
    }

    private fun refreshPlatformPermissions() {
        notificationsEnabled = hasNotificationPermission()
        viewModel.reconcileVpnPermission(probeVpnConsent().outcome)
    }

    private fun handleVpnAction(status: ProxyStatus) {
        val probe = probeVpnConsent()
        viewModel.reconcileVpnPermission(probe.outcome)

        when (
            decideVpnAction(
                serviceState = status.vpnService,
                permissionProbe = probe.outcome,
            )
        ) {
            VpnAction.STOP -> stopVpnService()
            VpnAction.WAIT -> Unit
            VpnAction.REPORT_ERROR -> Unit
            VpnAction.START -> {
                viewModel.setVpnPermission(VpnPermissionState.GRANTED)
                startVpnService()
            }

            VpnAction.REQUEST_CONSENT -> {
                when (probe) {
                    is VpnConsentProbe.ConsentRequired -> {
                        viewModel.setVpnPermission(VpnPermissionState.REQUIRED)
                        vpnConsentLauncher.launch(probe.intent)
                    }

                    else -> {
                        showMessage(strings.vpnConsentUnavailable)
                    }
                }
            }
        }
    }

    private fun probeVpnConsent(): VpnConsentProbe =
        try {
            val intent = VpnService.prepare(this)
            if (intent == null) {
                VpnConsentProbe.Prepared
            } else {
                VpnConsentProbe.ConsentRequired(intent)
            }
        } catch (error: SecurityException) {
            showMessage(error.message ?: strings.vpnPermissionCheckFailed)
            VpnConsentProbe.CheckFailed
        } catch (error: IllegalStateException) {
            showMessage(error.message ?: strings.vpnPermissionPrepareFailed)
            VpnConsentProbe.CheckFailed
        }

    private fun startVpnService() {
        try {
            CapybaraProxyVpnService.start(this)
        } catch (error: SecurityException) {
            ProxyRuntimeState.reportServiceStartFailure()
            showMessage(error.message ?: strings.vpnStartDenied)
        } catch (error: IllegalStateException) {
            ProxyRuntimeState.reportServiceStartFailure()
            showMessage(error.message ?: strings.vpnCannotStart)
        }
    }

    private fun stopVpnService() {
        try {
            CapybaraProxyVpnService.stop(this)
        } catch (error: SecurityException) {
            showMessage(error.message ?: strings.vpnStopDenied)
        } catch (error: IllegalStateException) {
            showMessage(error.message ?: strings.vpnNotRunning)
        }
    }

    private fun requestNotificationPermission() {
        if (hasNotificationPermission()) {
            notificationsEnabled = true
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            openAppNotificationSettings()
        }
    }

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED

    private fun openAppNotificationSettings() {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        runSettingsIntent(intent)
    }

    private fun openBatteryOptimizationSettings() {
        runSettingsIntent(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    private fun runSettingsIntent(intent: Intent) {
        try {
            startActivity(intent)
        } catch (error: ActivityNotFoundException) {
            showMessage(strings.settingsScreenUnavailable)
        } catch (error: SecurityException) {
            showMessage(error.message ?: strings.settingsAccessDenied)
        }
    }

    private fun showMessage(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
