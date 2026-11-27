package com.capybara.android.feature.settings

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
import com.capybara.android.ui.DemoBadge
import com.capybara.android.ui.DividerLine
import com.capybara.android.ui.FlowButton
import com.capybara.android.ui.FlowCard
import com.capybara.android.ui.Metric
import com.capybara.android.ui.PageIntro
import com.capybara.android.ui.ThemeChoice
import com.capybara.core.model.ConnectionStatus
import com.capybara.core.model.MihomoBridgeState
import com.capybara.core.model.MihomoCapabilityReport
import com.capybara.core.model.ProxyStatus
import com.capybara.core.model.ThemeId
import com.capybara.core.model.VpnServiceState
import com.capybara.core.theme.LocalFlowPalette
import com.capybara.android.i18n.AppLanguage
import com.capybara.android.i18n.LocalAppStrings

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
    language: AppLanguage,
    onLanguageChange: (AppLanguage) -> Unit,
) {
    val strings = LocalAppStrings.current
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
                eyebrow = strings.settingsEyebrow,
                title = strings.settingsTitle,
                description = strings.settingsDescription,
            )
        }
        item {
            FlowCard {
                Text(
                    text = strings.appearance,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = strings.appearanceDescription,
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
                        themeLabel = strings.themeACyberFlow,
                        selected = themeId == ThemeId.CYBER_FLOW,
                        onClick = { onThemeChange(ThemeId.CYBER_FLOW) },
                        modifier = Modifier.weight(1f),
                    )
                    ThemeChoice(
                        themeLabel = strings.themeCWarmFlow,
                        selected = themeId == ThemeId.WARM_FLOW,
                        onClick = { onThemeChange(ThemeId.WARM_FLOW) },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                SettingToggle(
                    title = strings.reduceMotion,
                    description = strings.reduceMotionDescription,
                    checked = reducedMotion,
                    onCheckedChange = onReducedMotionChange,
                )
            }
        }
        item {
            FlowCard {
                Text(
                    text = strings.languageTitle,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = strings.languageDescription,
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
                        themeLabel = strings.languageEnglish,
                        selected = language == AppLanguage.ENGLISH,
                        onClick = { onLanguageChange(AppLanguage.ENGLISH) },
                        modifier = Modifier.weight(1f),
                    )
                    ThemeChoice(
                        themeLabel = strings.languageChinese,
                        selected = language == AppLanguage.SIMPLIFIED_CHINESE,
                        onClick = { onLanguageChange(AppLanguage.SIMPLIFIED_CHINESE) },
                        modifier = Modifier.weight(1f),
                    )
                }
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
                        text = strings.androidVpn,
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
                    text = strings.androidVpnDescription,
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Metric(
                        label = strings.permissionLabel,
                        value = status.permission.name,
                        modifier = Modifier.weight(1f),
                    )
                    Metric(
                        label = strings.serviceLabel,
                        value = status.vpnService.name,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(16.dp))
                FlowButton(
                    text = if (vpnSessionActive) {
                        strings.actionStopVpn
                    } else {
                        strings.actionStartVpn
                    },
                    onClick = onStartStopVpn,
                    secondary = vpnSessionActive,
                )
            }
        }
        item {
            FlowCard {
                Text(
                    text = strings.notificationsBattery,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(8.dp))
                SettingActionRow(
                    title = strings.foregroundNotification,
                    description = if (notificationsEnabled) {
                        strings.notificationAllowed
                    } else {
                        strings.notificationBlocked
                    },
                    action = if (notificationsEnabled) null else strings.allow,
                    onAction = onRequestNotifications,
                )
                Spacer(Modifier.height(12.dp))
                DividerLine()
                Spacer(Modifier.height(12.dp))
                SettingActionRow(
                    title = strings.batteryOptimization,
                    description = strings.batteryDescription,
                    action = strings.open,
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
                        text = strings.mihomoBridge,
                        color = palette.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    DemoBadge(
                        text = when (capability.state) {
                            MihomoBridgeState.AVAILABLE -> strings.verifiedBadge
                            MihomoBridgeState.PROBE_ONLY -> strings.probeOnlyBadge
                            MihomoBridgeState.UNAVAILABLE -> strings.unavailableBadge
                        },
                    )
                }
                Spacer(Modifier.height(12.dp))
                CapabilityRow(strings.abiLabel, capability.abi)
                CapabilityRow(
                    strings.libraryLabel,
                    if (capability.nativeLibraryPresent) strings.present else strings.notBundled,
                )
                CapabilityRow(
                    strings.tunHandoffLabel,
                    if (capability.tunFileDescriptorSupported) strings.verifiedValue else strings.unverifiedValue,
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
                    text = strings.stageBoundary,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = strings.stageBoundaryDescription,
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "CapybaraProxy $appVersion",
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
