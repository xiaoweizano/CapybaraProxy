package com.flowproxy.android.feature.overview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flowproxy.android.data.DemoCatalog
import com.flowproxy.android.ui.DemoBadge
import com.flowproxy.android.ui.DemoTrafficChart
import com.flowproxy.android.ui.FlowBuddyMascot
import com.flowproxy.android.ui.FlowButton
import com.flowproxy.android.ui.FlowCard
import com.flowproxy.android.ui.GradientPanel
import com.flowproxy.android.ui.LatencyGauge
import com.flowproxy.android.ui.Metric
import com.flowproxy.android.ui.NetworkOrb
import com.flowproxy.android.ui.NodeMapPlaceholder
import com.flowproxy.android.ui.StatusPill
import com.flowproxy.android.ui.rememberLifecycleActive
import com.flowproxy.core.model.ConnectionStatus
import com.flowproxy.core.model.CoreState
import com.flowproxy.core.model.MihomoCapabilityReport
import com.flowproxy.core.model.ProxyStatus
import com.flowproxy.core.model.ThemeId
import com.flowproxy.core.model.VpnPermissionState
import com.flowproxy.core.model.VpnServiceState
import com.flowproxy.core.model.deriveConnectionStatus
import com.flowproxy.core.theme.LocalFlowPalette
import com.flowproxy.android.i18n.LocalAppStrings
import com.flowproxy.android.i18n.AppStrings
import com.flowproxy.android.i18n.coreStateLabel
import com.flowproxy.android.i18n.vpnStateLabel

@Composable
fun OverviewPage(
    themeId: ThemeId,
    status: ProxyStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
    reducedMotion: Boolean,
    onStartStop: () -> Unit,
) {
    val strings = LocalAppStrings.current
    val connectionStatus = deriveConnectionStatus(status)
    val lifecycleActive = rememberLifecycleActive()

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 16.dp,
            bottom = 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            ConnectionHero(
                themeId = themeId,
                status = status,
                connectionStatus = connectionStatus,
                capability = capability,
                networkAvailable = networkAvailable,
                reducedMotion = reducedMotion,
                visualActive = lifecycleActive &&
                    connectionStatus != ConnectionStatus.STOPPED &&
                    connectionStatus != ConnectionStatus.PERMISSION_REQUIRED,
                onStartStop = onStartStop,
            )
        }
        item {
            FlowCard {
                DemoTrafficChart(reducedMotion = reducedMotion)
            }
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = strings.route,
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    DemoBadge()
                }
                Spacer(Modifier.height(14.dp))
                Metric(label = strings.proxyGroupLabel, value = DemoCatalog.groups.first().name)
                Spacer(Modifier.height(14.dp))
                Metric(
                    label = strings.currentNodeLabel,
                    value = DemoCatalog.groups.first().selectedNode,
                    valueColor = LocalFlowPalette.current.accentCyan,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = strings.catalogPreviewNote,
                    color = LocalFlowPalette.current.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                FlowCard(modifier = Modifier.weight(1f)) {
                    Text(
                        text = strings.latency,
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(112.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        LatencyGauge(
                            latencyMs = null,
                            modifier = Modifier.size(104.dp),
                        )
                    }
                    Text(
                        text = strings.runtimeNotConnected,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                        color = LocalFlowPalette.current.textMuted,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                FlowCard(modifier = Modifier.weight(1f)) {
                    Text(
                        text = strings.connections,
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(18.dp))
                    Text(
                        text = "0",
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.displaySmall,
                    )
                    Text(
                        text = strings.active,
                        color = LocalFlowPalette.current.textMuted,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Spacer(Modifier.height(24.dp))
                    Text(
                        text = strings.noCoreTelemetry,
                        color = LocalFlowPalette.current.warning,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = strings.nodeMap,
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = strings.unavailableLabel,
                        color = LocalFlowPalette.current.warning,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.height(12.dp))
                NodeMapPlaceholder(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(148.dp),
                    label = strings.noTrustedCoordinates,
                )
            }
        }
    }
}

@Composable
private fun ConnectionHero(
    themeId: ThemeId,
    status: ProxyStatus,
    connectionStatus: ConnectionStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
    reducedMotion: Boolean,
    visualActive: Boolean,
    onStartStop: () -> Unit,
) {
    val strings = LocalAppStrings.current
    val palette = LocalFlowPalette.current
    val running = status.vpnService == VpnServiceState.RUNNING ||
        status.vpnService == VpnServiceState.STARTING
    val actionLabel = when {
        running -> strings.actionStopVpn
        status.permission == VpnPermissionState.DENIED -> strings.actionReviewPermission
        else -> strings.actionStartVpn
    }

    GradientPanel(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = if (themeId == ThemeId.CYBER_FLOW) {
                        strings.themeA
                    } else {
                        strings.themeC
                    },
                    color = palette.textSecondary,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
                StatusPill(status = connectionStatus)
            }
            Spacer(Modifier.height(6.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(202.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (themeId == ThemeId.CYBER_FLOW) {
                    NetworkOrb(
                        modifier = Modifier.size(210.dp),
                        active = visualActive,
                        reducedMotion = reducedMotion,
                    )
                } else {
                    FlowBuddyMascot(
                        modifier = Modifier.size(210.dp),
                        active = visualActive,
                        reducedMotion = reducedMotion,
                    )
                }
            }
            Text(
                text = connectionHeadline(connectionStatus, strings),
                modifier = Modifier.fillMaxWidth(),
                color = palette.textPrimary,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = connectionDetail(status, capability, networkAvailable, strings),
                color = palette.textSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (capability.state != com.flowproxy.core.model.MihomoBridgeState.AVAILABLE) {
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        modifier = Modifier.size(17.dp),
                        tint = palette.warning,
                    )
                    Text(
                        text = strings.bridgePrefix + capability.state.name.lowercase(),
                        color = palette.warning,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Metric(
                    label = strings.networkLabel,
                    value = if (networkAvailable) strings.online else strings.offline,
                    modifier = Modifier.weight(1f),
                )
                Metric(
                    label = strings.vpnLabel,
                    value = strings.vpnStateLabel(status.vpnService),
                    modifier = Modifier.weight(1f),
                )
                Metric(
                    label = strings.coreLabel,
                    value = strings.coreStateLabel(status.core),
                    modifier = Modifier.weight(1f),
                    valueColor = if (status.core == CoreState.UNAVAILABLE) {
                        palette.warning
                    } else {
                        palette.textPrimary
                    },
                )
            }
            Spacer(Modifier.height(18.dp))
            FlowButton(
                text = actionLabel,
                icon = Icons.Filled.PlayArrow,
                onClick = onStartStop,
            )
        }
    }
}

private fun connectionHeadline(status: ConnectionStatus, strings: AppStrings): String =
    when (status) {
        ConnectionStatus.CONNECTED -> strings.headlineConnected
        ConnectionStatus.STARTING -> strings.headlineStarting
        ConnectionStatus.RUNNING_DISCONNECTED -> strings.headlineRunningDisconnected
        ConnectionStatus.STOPPING -> strings.headlineStopping
        ConnectionStatus.ERROR -> strings.headlineError
        ConnectionStatus.PERMISSION_REQUIRED -> strings.headlinePermission
        ConnectionStatus.STOPPED -> strings.headlineStopped
    }

private fun connectionDetail(
    status: ProxyStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
    strings: AppStrings,
): String {
    if (!networkAvailable) {
        return strings.detailNoNetwork
    }
    if (status.permission == VpnPermissionState.DENIED) {
        return strings.detailPermissionDenied
    }
    if (status.vpnService == VpnServiceState.RUNNING && capability.state !=
        com.flowproxy.core.model.MihomoBridgeState.AVAILABLE
    ) {
        return strings.detailShellWithoutCore
    }
    return strings.detailDefault
}

