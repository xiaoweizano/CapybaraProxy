package com.flowproxy.android

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
import com.flowproxy.android.platform.VpnAction
import com.flowproxy.android.platform.VpnPermissionProbe
import com.flowproxy.android.platform.decideVpnAction
import com.flowproxy.android.platform.permissionAfterConsent
import com.flowproxy.android.ui.FlowProxyApp
import com.flowproxy.core.model.ProxyStatus
import com.flowproxy.core.model.VpnPermissionState
import com.flowproxy.core.theme.FlowProxyTheme
import com.flowproxy.vpn.service.FlowProxyVpnService
import com.flowproxy.vpn.service.ProxyRuntimeState

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
            showMessage("Notifications remain disabled in Android settings.")
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

            FlowProxyTheme(themeId = preferences.themeId) {
                FlowProxyApp(
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
                        showMessage("Android VPN consent is unavailable.")
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
            showMessage(error.message ?: "Unable to check Android VPN permission.")
            VpnConsentProbe.CheckFailed
        } catch (error: IllegalStateException) {
            showMessage(error.message ?: "Unable to prepare Android VPN permission.")
            VpnConsentProbe.CheckFailed
        }

    private fun startVpnService() {
        try {
            FlowProxyVpnService.start(this)
        } catch (error: SecurityException) {
            ProxyRuntimeState.reportServiceStartFailure()
            showMessage(error.message ?: "Android denied the VPN service start.")
        } catch (error: IllegalStateException) {
            ProxyRuntimeState.reportServiceStartFailure()
            showMessage(error.message ?: "The VPN service cannot start right now.")
        }
    }

    private fun stopVpnService() {
        try {
            FlowProxyVpnService.stop(this)
        } catch (error: SecurityException) {
            showMessage(error.message ?: "Android denied the VPN service stop.")
        } catch (error: IllegalStateException) {
            showMessage(error.message ?: "The VPN service is not running.")
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
            showMessage("This Android device does not expose that settings screen.")
        } catch (error: SecurityException) {
            showMessage(error.message ?: "Android denied access to that settings screen.")
        }
    }

    private fun showMessage(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
