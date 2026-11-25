package com.flowproxy.android.feature.workspace

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flowproxy.android.data.DemoCatalog
import com.flowproxy.android.data.DemoNode
import com.flowproxy.android.ui.DemoBadge
import com.flowproxy.android.ui.DividerLine
import com.flowproxy.android.ui.FlowButton
import com.flowproxy.android.ui.FlowCard
import com.flowproxy.android.ui.Metric
import com.flowproxy.android.ui.PageIntro
import com.flowproxy.core.model.ConnectionStatus
import com.flowproxy.core.theme.LocalFlowPalette
import com.flowproxy.android.i18n.LocalAppStrings

private val PagePadding = androidx.compose.foundation.layout.PaddingValues(
    start = 16.dp,
    end = 16.dp,
    top = 16.dp,
    bottom = 24.dp,
)

@Composable
fun ProxiesPage() {
    val strings = LocalAppStrings.current
    var selectedGroup by remember { mutableIntStateOf(0) }
    var selectedNode by remember { mutableStateOf(DemoCatalog.nodes.first().name) }
    val palette = LocalFlowPalette.current

    LazyColumn(
        contentPadding = PagePadding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.proxiesEyebrow,
                title = strings.proxiesTitle,
                description = strings.proxiesDescription,
            )
        }
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DemoCatalog.groups.forEachIndexed { index, group ->
                    Box(
                        modifier = Modifier
                            .background(
                                if (selectedGroup == index) {
                                    palette.accent
                                } else {
                                    palette.surface
                                },
                                RoundedCornerShape(10.dp),
                            )
                            .clickable { selectedGroup = index }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Text(
                            text = group.name,
                            color = if (selectedGroup == index) {
                                Color.White
                            } else {
                                palette.textSecondary
                            },
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
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
                    Column {
                        Text(
                            text = DemoCatalog.groups[selectedGroup].name,
                            color = palette.textPrimary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = strings.selectedNodePrefix + selectedNode,
                            color = palette.textSecondary,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    DemoBadge()
                }
                Spacer(Modifier.height(14.dp))
                DividerLine()
                Spacer(Modifier.height(14.dp))
                Text(
                    text = strings.nodeSelectionPreviewNote,
                    color = palette.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        items(DemoCatalog.nodes) { node ->
            NodePreview(
                node = node,
                selected = node.name == selectedNode,
                onSelect = { selectedNode = node.name },
            )
        }
    }
}

@Composable
private fun NodePreview(
    node: DemoNode,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    val strings = LocalAppStrings.current
    val palette = LocalFlowPalette.current
    FlowCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .background(
                        if (selected) palette.accent.copy(alpha = 0.18f) else palette.surfaceSoft,
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = node.region,
                    color = if (selected) palette.accent else palette.textSecondary,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = node.name,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = "${node.latencyLabel} · demo catalog",
                    color = palette.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            if (selected) {
                Icon(
                    Icons.Filled.Check,
                    contentDescription = strings.selectedDemoNodeDescription,
                    tint = palette.success,
                )
            } else {
                Text(
                    text = strings.select,
                    modifier = Modifier
                        .clickable(onClick = onSelect)
                        .padding(8.dp),
                    color = palette.accent,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Composable
fun RulesPage() {
    val strings = LocalAppStrings.current
    val palette = LocalFlowPalette.current
    LazyColumn(
        contentPadding = PagePadding,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.rulesEyebrow,
                title = strings.rulesTitle,
                description = strings.rulesDescription,
            )
        }
        items(DemoCatalog.rules) { rule ->
            FlowCard(padding = 14.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = rule.type,
                        modifier = Modifier
                            .background(
                                palette.accent.copy(alpha = 0.12f),
                                RoundedCornerShape(6.dp),
                            )
                            .padding(horizontal = 7.dp, vertical = 4.dp),
                        color = palette.accent,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = rule.value,
                            color = palette.textPrimary,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            text = strings.policyPrefix + rule.policy,
                            color = palette.textMuted,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    DemoBadge()
                }
            }
        }
    }
}

@Composable
fun ConnectionsPage(
    connectionStatus: ConnectionStatus,
) {
    val strings = LocalAppStrings.current
    val palette = LocalFlowPalette.current
    LazyColumn(
        contentPadding = PagePadding,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.connectionsEyebrow,
                title = strings.connectionsTitle,
                description = strings.connectionsDescription,
            )
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            text = when (connectionStatus) {
                                ConnectionStatus.CONNECTED -> strings.liveMonitoringAvailable
                                ConnectionStatus.RUNNING_DISCONNECTED -> strings.vpnReadyCoreUnavailable
                                ConnectionStatus.PERMISSION_REQUIRED -> strings.vpnPermissionRequired
                                ConnectionStatus.ERROR -> strings.connectionMonitorPaused
                                else -> strings.noActiveProxySession
                            },
                            color = palette.textPrimary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = strings.liveActiveConnectionsZero,
                            color = palette.textMuted,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    DemoBadge(strings.sampleList)
                }
            }
        }
        items(DemoCatalog.connections) { connection ->
            FlowCard(padding = 14.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = connection.host,
                            color = palette.textPrimary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = "${connection.network} · ${connection.chain}",
                            color = palette.textSecondary,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = "↑ ${connection.upload}",
                            color = palette.accentCyan,
                            style = MaterialTheme.typography.labelMedium,
                        )
                        Text(
                            text = "↓ ${connection.download}",
                            color = palette.accent,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ProfilesPage() {
    val strings = LocalAppStrings.current
    var selected by remember { mutableStateOf("Daily Flow") }
    val palette = LocalFlowPalette.current
    LazyColumn(
        contentPadding = PagePadding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.profilesEyebrow,
                title = strings.profilesTitle,
                description = strings.profilesDescription,
            )
        }
        items(DemoCatalog.profiles) { profile ->
            val isSelected = profile.name == selected
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text(
                            text = profile.name,
                            color = palette.textPrimary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = "${profile.source} · ${profile.updated}",
                            color = palette.textSecondary,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    DemoBadge()
                }
                Spacer(Modifier.height(14.dp))
                Column {
                    if (isSelected) {
                        Text(
                            text = strings.demoProfileSelected,
                            color = palette.success,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    } else {
                        FlowButton(
                            text = strings.selectDemoProfile,
                            onClick = { selected = profile.name },
                            secondary = true,
                        )
                    }
                }
            }
        }
        item {
            FlowCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        Icons.Filled.Info,
                        contentDescription = null,
                        tint = palette.warning,
                    )
                    Text(
                        text = "Profile import is intentionally unavailable in this phase. No URL is fetched and no file is persisted.",
                        color = palette.textSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
fun LogsPage() {
    val strings = LocalAppStrings.current
    val palette = LocalFlowPalette.current
    LazyColumn(
        contentPadding = PagePadding,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.logsEyebrow,
                title = strings.logsTitle,
                description = strings.logsDescription,
            )
        }
        items(DemoCatalog.logs) { log ->
            FlowCard(padding = 14.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = log.time,
                        color = palette.textMuted,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(
                        text = log.level,
                        color = when (log.level) {
                            "WARN" -> palette.warning
                            "ERROR" -> palette.danger
                            else -> palette.accentCyan
                        },
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.height(5.dp))
                Text(
                    text = log.message,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        item {
            Text(
                text = strings.secretRedactionNote,
                modifier = Modifier.padding(horizontal = 4.dp),
                color = palette.warning,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
