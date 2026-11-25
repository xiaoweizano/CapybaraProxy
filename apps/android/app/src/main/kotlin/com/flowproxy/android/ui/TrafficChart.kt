package com.flowproxy.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.flowproxy.android.data.DemoCatalog
import com.flowproxy.core.model.TrafficHistory
import com.flowproxy.core.model.TrafficSample
import com.flowproxy.core.theme.LocalFlowPalette
import com.flowproxy.android.i18n.LocalAppStrings
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun DemoTrafficChart(
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val history = remember {
        TrafficHistory(capacity = 28).also { history ->
            DemoCatalog.initialTrafficSamples().forEach(history::add)
        }
    }
    var samples by remember { mutableStateOf(history.snapshot()) }
    var sequence by remember { mutableLongStateOf(24L) }

    LaunchedEffect(lifecycleOwner, reducedMotion) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch {
                while (isActive) {
                    delay(if (reducedMotion) 5_000 else 2_000)
                    val index = (sequence % DemoCatalog.trafficUpload.size).toInt()
                    history.add(
                        TrafficSample(
                            sequence = sequence,
                            capturedAtMs = sequence * 2_000,
                            uploadBps = (
                                DemoCatalog.trafficUpload[index] +
                                    sequence % 4 * 0.08
                                ).times(1_000_000).toLong(),
                            downloadBps = (
                                DemoCatalog.trafficDownload[index] +
                                    sequence % 5 * 0.1
                                ).times(1_000_000).toLong(),
                            activeConnections = 0,
                            totalUploadBytes = 0,
                            totalDownloadBytes = 0,
                        ),
                    )
                    sequence += 1
                    samples = history.snapshot()
                }
            }
        }
    }

    val upload = samples.lastOrNull()?.uploadBps ?: 0L
    val download = samples.lastOrNull()?.downloadBps ?: 0L
    val palette = LocalFlowPalette.current

    Column(modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(
                    text = LocalAppStrings.current.traffic,
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = LocalAppStrings.current.trafficSyntheticNote,
                    color = palette.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            DemoBadge()
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            TrafficValue(
                label = LocalAppStrings.current.upload,
                value = formatRate(upload),
                color = palette.accentCyan,
            )
            TrafficValue(
                label = LocalAppStrings.current.download,
                value = formatRate(download),
                color = palette.accent,
            )
        }
        Spacer(Modifier.height(12.dp))
        TrafficLineChart(
            samples = samples,
            modifier = Modifier
                .fillMaxWidth()
                .height(116.dp),
        )
    }
}

@Composable
private fun TrafficValue(
    label: String,
    value: String,
    color: Color,
) {
    Column {
        Text(
            text = label,
            color = LocalFlowPalette.current.textMuted,
            style = MaterialTheme.typography.labelMedium,
        )
        Text(
            text = value,
            color = color,
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

@Composable
private fun TrafficLineChart(
    samples: List<TrafficSample>,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFlowPalette.current
    Canvas(
        modifier
            .padding(vertical = 4.dp),
    ) {
        if (samples.isEmpty()) return@Canvas
        val topPadding = 8.dp.toPx()
        val bottomPadding = 8.dp.toPx()
        val chartHeight = size.height - topPadding - bottomPadding
        val maxValue = maxOf(
            samples.maxOf { it.uploadBps },
            samples.maxOf { it.downloadBps },
            1L,
        ).toFloat()

        repeat(3) { index ->
            val y = topPadding + chartHeight * index / 2f
            drawLine(
                color = palette.border.copy(alpha = 0.55f),
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = 1f,
            )
        }

        fun pathFor(series: List<Float>): Path {
            val step = if (series.size <= 1) 0f else size.width / (series.size - 1)
            return Path().apply {
                series.forEachIndexed { index, value ->
                    val x = index * step
                    val y = topPadding + chartHeight * (1f - value / maxValue)
                    if (index == 0) moveTo(x, y) else lineTo(x, y)
                }
            }
        }

        val downloadValues = samples.map { it.downloadBps.toFloat() }
        val uploadValues = samples.map { it.uploadBps.toFloat() }
        val downloadPath = pathFor(downloadValues)
        val uploadPath = pathFor(uploadValues)

        val fillPath = Path().apply {
            addPath(downloadPath)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(
            fillPath,
            brush = Brush.verticalGradient(
                listOf(
                    palette.accent.copy(alpha = 0.3f),
                    palette.accent.copy(alpha = 0.01f),
                ),
                startY = topPadding,
                endY = size.height,
            ),
        )
        drawPath(
            downloadPath,
            color = palette.accent,
            style = Stroke(width = 2.dp.toPx()),
        )
        drawPath(
            uploadPath,
            color = palette.accentCyan,
            style = Stroke(width = 1.6.dp.toPx()),
        )
    }
}

private fun formatRate(bytesPerSecond: Long): String {
    val value = bytesPerSecond / 1_000_000.0
    return if (value >= 10) {
        "${value.toInt()} MB/s"
    } else {
        String.format(java.util.Locale.US, "%.1f MB/s", value)
    }
}
