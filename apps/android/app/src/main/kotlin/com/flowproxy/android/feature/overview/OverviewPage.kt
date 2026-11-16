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

@Composable
fun OverviewPage(
    themeId: ThemeId,
    status: ProxyStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
    reducedMotion: Boolean,
    onStartStop: () -> Unit,
) {
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
                        text = "Route",
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    DemoBadge()
                }
                Spacer(Modifier.height(14.dp))
                Metric(label = "PROXY GROUP", value = DemoCatalog.groups.first().name)
                Spacer(Modifier.height(14.dp))
                Metric(
                    label = "CURRENT NODE",
                    value = DemoCatalog.groups.first().selectedNode,
                    valueColor = LocalFlowPalette.current.accentCyan,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "Catalog preview only. No node switch is sent to a proxy core.",
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
                        text = "Latency",
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
                        text = "Runtime not connected",
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                        color = LocalFlowPalette.current.textMuted,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                FlowCard(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Connections",
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
                        text = "active",
                        color = LocalFlowPalette.current.textMuted,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Spacer(Modifier.height(24.dp))
                    Text(
                        text = "No core telemetry",
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
                        text = "Node map",
                        color = LocalFlowPalette.current.textPrimary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "UNAVAILABLE",
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
                    label = "No trusted node coordinates",
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
    val palette = LocalFlowPalette.current
    val running = status.vpnService == VpnServiceState.RUNNING ||
        status.vpnService == VpnServiceState.STARTING
    val actionLabel = when {
        running -> "Stop VPN session"
        status.permission == VpnPermissionState.DENIED -> "Review VPN permission"
        else -> "Start VPN session"
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
                        "A · CYBER FLOW"
                    } else {
                        "C · WARM FLOW"
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
                text = connectionHeadline(connectionStatus),
                modifier = Modifier.fillMaxWidth(),
                color = palette.textPrimary,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = connectionDetail(status, capability, networkAvailable),
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
                        text = "Mihomo native bridge: ${capability.state.name.lowercase()}",
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
                    label = "NETWORK",
                    value = if (networkAvailable) "Online" else "Offline",
                    modifier = Modifier.weight(1f),
                )
                Metric(
                    label = "VPN",
                    value = status.vpnService.shortLabel(),
                    modifier = Modifier.weight(1f),
                )
                Metric(
                    label = "CORE",
                    value = status.core.shortLabel(),
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

private fun connectionHeadline(status: ConnectionStatus): String =
    when (status) {
        ConnectionStatus.CONNECTED -> "Network flow is protected"
        ConnectionStatus.STARTING -> "Bringing the session online"
        ConnectionStatus.RUNNING_DISCONNECTED -> "VPN shell is ready"
        ConnectionStatus.STOPPING -> "Stopping the VPN session"
        ConnectionStatus.ERROR -> "VPN session needs attention"
        ConnectionStatus.PERMISSION_REQUIRED -> "VPN permission is required"
        ConnectionStatus.STOPPED -> "Your network flow is paused"
    }

private fun connectionDetail(
    status: ProxyStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
): String {
    if (!networkAvailable) {
        return "No active Android network. The app remains responsive and will update after connectivity returns."
    }
    if (status.permission == VpnPermissionState.DENIED) {
        return "Android did not grant VPN consent. Tap the action to request it again."
    }
    if (status.vpnService == VpnServiceState.RUNNING && capability.state !=
        com.flowproxy.core.model.MihomoBridgeState.AVAILABLE
    ) {
        return "Android accepted a no-route VPN shell. No traffic is proxied because the core is unavailable."
    }
    return "Connect starts only the Android VPN lifecycle. A verified Mihomo native bridge is still required for proxying."
}

private fun VpnServiceState.shortLabel(): String =
    when (this) {
        VpnServiceState.STOPPED -> "Stopped"
        VpnServiceState.STARTING -> "Starting"
        VpnServiceState.RUNNING -> "Ready"
        VpnServiceState.STOPPING -> "Stopping"
        VpnServiceState.ERROR -> "Error"
    }

private fun CoreState.shortLabel(): String =
    when (this) {
        CoreState.UNAVAILABLE -> "Missing"
        CoreState.PROBING -> "Probing"
        CoreState.READY -> "Ready"
        CoreState.STARTING -> "Starting"
        CoreState.RUNNING -> "Running"
        CoreState.ERROR -> "Error"
    }
