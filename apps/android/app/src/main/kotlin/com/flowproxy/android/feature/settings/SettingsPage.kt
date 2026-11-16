package com.flowproxy.android.feature.settings

import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flowproxy.android.ui.DemoBadge
import com.flowproxy.android.ui.DividerLine
import com.flowproxy.android.ui.FlowButton
import com.flowproxy.android.ui.FlowCard
import com.flowproxy.android.ui.Metric
import com.flowproxy.android.ui.PageIntro
import com.flowproxy.android.ui.ThemeChoice
import com.flowproxy.core.model.ConnectionStatus
import com.flowproxy.core.model.MihomoBridgeState
import com.flowproxy.core.model.MihomoCapabilityReport
import com.flowproxy.core.model.ProxyStatus
import com.flowproxy.core.model.ThemeId
import com.flowproxy.core.model.VpnServiceState
import com.flowproxy.core.theme.LocalFlowPalette

@Composable
fun SettingsPage(
    themeId: ThemeId,
    status: ProxyStatus,
    connectionStatus: ConnectionStatus,
    capability: MihomoCapabilityReport,
    reducedMotion: Boolean,
    notificationsEnabled: Boolean,
    onThemeChange: (ThemeId) -> Unit,
    onReducedMotionChange: (Boolean) -> Unit,
    onRequestNotifications: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onStartStopVpn: () -> Unit,
) {
    val palette = LocalFlowPalette.current
    val appVersion = rememberAppVersion()
    val vpnSessionActive = status.vpnService == VpnServiceState.RUNNING ||
        status.vpnService == VpnServiceState.STARTING
    val padding = androidx.compose.foundation.layout.PaddingValues(
        start = 16.dp,
        end = 16.dp,
        top = 16.dp,
        bottom = 24.dp,
    )

    LazyColumn(
        contentPadding = padding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageIntro(
                eyebrow = "Preferences",
                title = "Settings",
                description = "Theme and lifecycle settings are persisted on device. Runtime controls remain capability-gated.",
            )
        }
        item {
            FlowCard {
                Text(
                    text = "Appearance",
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "A is the default dark theme. C switches to the warm blue-white theme.",
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(14.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(palette.surfaceSoft, RoundedCornerShape(12.dp))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    ThemeChoice(
                        themeLabel = "A · Cyber Flow",
                        selected = themeId == ThemeId.CYBER_FLOW,
                        onClick = { onThemeChange(ThemeId.CYBER_FLOW) },
                        modifier = Modifier.weight(1f),
                    )
                    ThemeChoice(
                        themeLabel = "C · Warm Flow",
                        selected = themeId == ThemeId.WARM_FLOW,
                        onClick = { onThemeChange(ThemeId.WARM_FLOW) },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                SettingToggle(
                    title = "Reduce motion",
                    description = "Pauses Orb and companion idle animation when enabled.",
                    checked = reducedMotion,
                    onCheckedChange = onReducedMotionChange,
                )
            }
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Android VPN",
                        color = palette.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = connectionStatus.name.replace('_', ' '),
                        color = when (connectionStatus) {
                            ConnectionStatus.ERROR,
                            ConnectionStatus.PERMISSION_REQUIRED,
                            -> palette.danger
                            ConnectionStatus.CONNECTED -> palette.success
                            else -> palette.warning
                        },
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "The service uses an Android foreground notification. No routes are installed until a verified Mihomo bridge can consume the TUN descriptor.",
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Metric(
                        label = "PERMISSION",
                        value = status.permission.name,
                        modifier = Modifier.weight(1f),
                    )
                    Metric(
                        label = "SERVICE",
                        value = status.vpnService.name,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(16.dp))
                FlowButton(
                    text = if (vpnSessionActive) {
                        "Stop VPN session"
                    } else {
                        "Start VPN session"
                    },
                    onClick = onStartStopVpn,
                    secondary = vpnSessionActive,
                )
            }
        }
        item {
            FlowCard {
                Text(
                    text = "Notifications & battery",
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(8.dp))
                SettingActionRow(
                    title = "Foreground notification",
                    description = if (notificationsEnabled) {
                        "Allowed. VPN lifecycle status is visible in the notification shade."
                    } else {
                        "Not allowed. Android can hide notification content, but the foreground-service requirement still applies."
                    },
                    action = if (notificationsEnabled) null else "Allow",
                    onAction = onRequestNotifications,
                )
                Spacer(Modifier.height(12.dp))
                DividerLine()
                Spacer(Modifier.height(12.dp))
                SettingActionRow(
                    title = "Battery optimization",
                    description = "Keep the VPN session active while the screen is off. Exact behavior depends on the device vendor.",
                    action = "Open",
                    onAction = onOpenBatterySettings,
                )
            }
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Mihomo native bridge",
                        color = palette.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    DemoBadge(
                        text = when (capability.state) {
                            MihomoBridgeState.AVAILABLE -> "VERIFIED"
                            MihomoBridgeState.PROBE_ONLY -> "PROBE ONLY"
                            MihomoBridgeState.UNAVAILABLE -> "UNAVAILABLE"
                        },
                    )
                }
                Spacer(Modifier.height(12.dp))
                CapabilityRow("ABI", capability.abi)
                CapabilityRow(
                    "Library",
                    if (capability.nativeLibraryPresent) "Present" else "Not bundled",
                )
                CapabilityRow(
                    "TUN FD handoff",
                    if (capability.tunFileDescriptorSupported) "Verified" else "Unverified",
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = capability.detail,
                    color = palette.warning,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        item {
            FlowCard {
                Text(
                    text = "Stage boundary",
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Proxy groups, nodes, rules, connections, profiles and logs are isolated demo catalogs. They never report as live Mihomo data.",
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "FlowProxy $appVersion",
                    color = palette.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun rememberAppVersion(): String {
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(0),
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            packageInfo.versionName
        }.getOrNull().orEmpty().ifBlank { "unknown" }
    }
}

@Composable
private fun SettingToggle(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val palette = LocalFlowPalette.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = palette.textPrimary,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = description,
                color = palette.textMuted,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
        )
    }
}

@Composable
private fun SettingActionRow(
    title: String,
    description: String,
    action: String?,
    onAction: () -> Unit,
) {
    val palette = LocalFlowPalette.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = palette.textPrimary,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = description,
                color = palette.textMuted,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        if (action != null) {
            Text(
                text = action,
                modifier = Modifier
                    .background(
                        palette.accent.copy(alpha = 0.12f),
                        RoundedCornerShape(8.dp),
                    )
                    .clickable(onClick = onAction)
                    .padding(horizontal = 11.dp, vertical = 8.dp),
                color = palette.accent,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun CapabilityRow(label: String, value: String) {
    val palette = LocalFlowPalette.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            color = palette.textMuted,
            style = MaterialTheme.typography.labelMedium,
        )
        Text(
            text = value,
            color = palette.textSecondary,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
