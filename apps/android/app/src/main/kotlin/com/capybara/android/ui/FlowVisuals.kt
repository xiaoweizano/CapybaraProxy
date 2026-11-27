package com.capybara.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.capybara.core.theme.LocalFlowPalette
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun rememberLifecycleActive(): Boolean {
    val lifecycleOwner = LocalLifecycleOwner.current
    var active by remember(lifecycleOwner) {
        mutableStateOf(
            lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED),
        )
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, _ ->
            active = lifecycleOwner.lifecycle.currentState
                .isAtLeast(Lifecycle.State.STARTED)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }
    return active
}

@Composable
fun NetworkOrb(
    modifier: Modifier = Modifier,
    active: Boolean,
    reducedMotion: Boolean,
) {
    if (active && !reducedMotion) {
        AnimatedNetworkOrb(modifier)
    } else {
        StaticNetworkOrb(modifier)
    }
}

@Composable
private fun AnimatedNetworkOrb(modifier: Modifier) {
    val transition = rememberInfiniteTransition(label = "network-orb")
    val rotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(12_000, easing = LinearEasing),
        ),
        label = "orb-rotation",
    )
    val pulse by transition.animateFloat(
        initialValue = 0.82f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2_800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "orb-pulse",
    )
    OrbCanvas(modifier, rotation, pulse)
}

@Composable
private fun StaticNetworkOrb(modifier: Modifier) {
    OrbCanvas(modifier, rotation = 18f, pulse = 0.88f)
}

@Composable
private fun OrbCanvas(
    modifier: Modifier,
    rotation: Float,
    pulse: Float,
) {
    val palette = LocalFlowPalette.current
    Canvas(modifier) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val radius = size.minDimension * 0.36f

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    palette.accentCyan.copy(alpha = 0.32f * pulse),
                    palette.accent.copy(alpha = 0.12f * pulse),
                    Color.Transparent,
                ),
                center = center,
                radius = radius * 1.65f,
            ),
            radius = radius * 1.65f,
            center = center,
        )
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    palette.accentCyan.copy(alpha = 0.75f),
                    palette.accent,
                    palette.accentViolet.copy(alpha = 0.9f),
                    palette.canvas,
                ),
                center = center - Offset(radius * 0.22f, radius * 0.2f),
                radius = radius * 1.22f,
            ),
            radius = radius,
            center = center,
        )
        drawCircle(
            color = palette.accentCyan.copy(alpha = 0.45f),
            radius = radius,
            center = center,
            style = Stroke(width = 1.4.dp.toPx()),
        )

        withTransform({ rotate(rotation, center) }) {
            drawArc(
                brush = Brush.sweepGradient(
                    listOf(
                        Color.Transparent,
                        palette.accentViolet.copy(alpha = 0.9f),
                        palette.accentCyan,
                        Color.Transparent,
                    ),
                    center,
                ),
                startAngle = 15f,
                sweepAngle = 190f,
                useCenter = false,
                topLeft = Offset(center.x - radius * 1.16f, center.y - radius * 0.42f),
                size = Size(radius * 2.32f, radius * 0.84f),
                style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round),
            )
        }

        repeat(3) { index ->
            val angle = rotation * (PI / 180.0) + index * 2.0
            val dotRadius = radius * (0.42f + index * 0.2f)
            val dot = Offset(
                center.x + cos(angle).toFloat() * dotRadius,
                center.y + sin(angle).toFloat() * dotRadius,
            )
            drawCircle(
                color = if (index % 2 == 0) palette.accentCyan else palette.accentViolet,
                radius = (2f + index) * density,
                center = dot,
            )
        }
    }
}

@Composable
fun FlowBuddyMascot(
    modifier: Modifier = Modifier,
    active: Boolean,
    reducedMotion: Boolean,
) {
    if (active && !reducedMotion) {
        AnimatedBuddy(modifier)
    } else {
        BuddyCanvas(modifier, floatOffset = 0f, ringRotation = 12f)
    }
}

@Composable
private fun AnimatedBuddy(modifier: Modifier) {
    val transition = rememberInfiniteTransition(label = "warm-buddy")
    val floating by transition.animateFloat(
        initialValue = -3f,
        targetValue = 3f,
        animationSpec = infiniteRepeatable(
            animation = tween(3_400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "buddy-float",
    )
    val ring by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(18_000, easing = LinearEasing),
        ),
        label = "buddy-ring",
    )
    BuddyCanvas(modifier, floating, ring)
}

@Composable
private fun BuddyCanvas(
    modifier: Modifier,
    floatOffset: Float,
    ringRotation: Float,
) {
    val palette = LocalFlowPalette.current
    Canvas(modifier) {
        val center = Offset(size.width / 2f, size.height / 2f + floatOffset * density)
        val bodyWidth = size.minDimension * 0.48f
        val bodyHeight = size.minDimension * 0.42f

        drawOval(
            brush = Brush.radialGradient(
                colors = listOf(
                    palette.accentCyan.copy(alpha = 0.35f),
                    palette.accent.copy(alpha = 0.1f),
                    Color.Transparent,
                ),
                center = center,
                radius = size.minDimension * 0.48f,
            ),
            topLeft = Offset(
                center.x - size.minDimension * 0.48f,
                center.y - size.minDimension * 0.32f,
            ),
            size = Size(size.minDimension * 0.96f, size.minDimension * 0.64f),
        )

        val bodyTopLeft = Offset(center.x - bodyWidth / 2f, center.y - bodyHeight / 2f)
        val bodySize = Size(bodyWidth, bodyHeight)
        drawOval(
            brush = Brush.verticalGradient(
                listOf(Color.White, Color(0xFFDCEEFF)),
                startY = bodyTopLeft.y,
                endY = bodyTopLeft.y + bodyHeight,
            ),
            topLeft = bodyTopLeft,
            size = bodySize,
        )

        val earOffset = bodyWidth * 0.33f
        listOf(-1f, 1f).forEach { side ->
            val ear = Path().apply {
                moveTo(center.x + side * earOffset, center.y - bodyHeight * 0.37f)
                lineTo(center.x + side * earOffset * 0.78f, center.y - bodyHeight * 0.75f)
                lineTo(center.x + side * earOffset * 1.25f, center.y - bodyHeight * 0.46f)
                close()
            }
            drawPath(ear, Color.White)
            drawPath(
                ear,
                Color(0xFFDCEEFF),
                style = Stroke(width = 1.dp.toPx()),
            )
        }

        val faceTopLeft = Offset(
            center.x - bodyWidth * 0.31f,
            center.y - bodyHeight * 0.18f,
        )
        val faceSize = Size(bodyWidth * 0.62f, bodyHeight * 0.48f)
        drawRoundRect(
            brush = Brush.verticalGradient(
                listOf(Color(0xFF243A76), Color(0xFF101D47)),
                startY = faceTopLeft.y,
                endY = faceTopLeft.y + faceSize.height,
            ),
            topLeft = faceTopLeft,
            size = faceSize,
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(faceSize.height / 2f),
        )
        listOf(-1f, 1f).forEach { side ->
            drawCircle(
                color = Color(0xFF67E7FF),
                radius = bodyWidth * 0.045f,
                center = Offset(
                    center.x + side * bodyWidth * 0.12f,
                    center.y - bodyHeight * 0.01f,
                ),
            )
        }
        drawArc(
            color = Color(0xFF67E7FF),
            startAngle = 18f,
            sweepAngle = 144f,
            useCenter = false,
            topLeft = Offset(
                center.x - bodyWidth * 0.08f,
                center.y + bodyHeight * 0.03f,
            ),
            size = Size(bodyWidth * 0.16f, bodyHeight * 0.1f),
            style = Stroke(width = 1.4.dp.toPx(), cap = StrokeCap.Round),
        )

        withTransform({ rotate(ringRotation, center) }) {
            drawArc(
                brush = Brush.sweepGradient(
                    listOf(
                        palette.accentOrange,
                        palette.accent,
                        palette.accentCyan,
                        palette.accentOrange,
                    ),
                    center,
                ),
                startAngle = 10f,
                sweepAngle = 280f,
                useCenter = false,
                topLeft = Offset(center.x - bodyWidth * 0.8f, center.y - bodyHeight * 0.38f),
                size = Size(bodyWidth * 1.6f, bodyHeight * 0.76f),
                style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
fun LatencyGauge(
    latencyMs: Int?,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFlowPalette.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 7.dp.toPx()
            drawArc(
                color = palette.surfaceSoft,
                startAngle = 140f,
                sweepAngle = 260f,
                useCenter = false,
                topLeft = Offset(stroke, stroke),
                size = Size(size.width - stroke * 2, size.height - stroke * 2),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            if (latencyMs != null) {
                drawArc(
                    brush = Brush.sweepGradient(
                        listOf(palette.success, palette.warning, palette.accentOrange),
                    ),
                    startAngle = 140f,
                    sweepAngle = 260f * (latencyMs.coerceIn(0, 300) / 300f),
                    useCenter = false,
                    topLeft = Offset(stroke, stroke),
                    size = Size(size.width - stroke * 2, size.height - stroke * 2),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        androidx.compose.foundation.layout.Column(
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = latencyMs?.toString() ?: "—",
                color = palette.textPrimary,
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(
                text = if (latencyMs == null) "not tested" else "ms",
                color = palette.textMuted,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
fun NodeMapPlaceholder(
    modifier: Modifier = Modifier,
    label: String,
) {
    val palette = LocalFlowPalette.current
    Box(
        modifier = modifier
            .background(palette.surfaceSoft, RoundedCornerShape(14.dp)),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = Stroke(
                width = 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 8f)),
            )
            repeat(4) { index ->
                val y = size.height * (index + 1) / 5f
                drawLine(
                    color = palette.border,
                    start = Offset(0f, y),
                    end = Offset(size.width, y),
                    strokeWidth = 1f,
                )
            }
            repeat(6) { index ->
                val x = size.width * (index + 1) / 7f
                drawLine(
                    color = palette.border.copy(alpha = 0.5f),
                    start = Offset(x, 0f),
                    end = Offset(x, size.height),
                    strokeWidth = 1f,
                )
            }

            val route = Path().apply {
                moveTo(size.width * 0.05f, size.height * 0.68f)
                cubicTo(
                    size.width * 0.26f,
                    size.height * 0.2f,
                    size.width * 0.53f,
                    size.height * 0.82f,
                    size.width * 0.95f,
                    size.height * 0.3f,
                )
            }
            drawPath(
                route,
                palette.accent.copy(alpha = 0.55f),
                style = stroke,
            )
            drawCircle(
                color = palette.accentCyan.copy(alpha = 0.12f),
                radius = size.minDimension * 0.24f,
                center = Offset(size.width * 0.68f, size.height * 0.5f),
            )
            drawCircle(
                color = palette.accentCyan.copy(alpha = 0.6f),
                radius = 3.dp.toPx(),
                center = Offset(size.width * 0.68f, size.height * 0.5f),
            )
        }
        Text(
            text = label,
            modifier = Modifier
                .align(Alignment.TopStart)
                .background(
                    palette.surface.copy(alpha = 0.78f),
                    RoundedCornerShape(7.dp),
                )
                .padding(horizontal = 8.dp, vertical = 5.dp),
            color = palette.textSecondary,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
fun EmptyVisualRing(size: Dp) {
    val palette = LocalFlowPalette.current
    Canvas(Modifier.size(size)) {
        drawCircle(
            color = palette.border,
            style = Stroke(width = 1.dp.toPx()),
        )
        drawCircle(
            brush = Brush.radialGradient(
                listOf(
                    palette.accent.copy(alpha = 0.24f),
                    Color.Transparent,
                ),
            ),
            radius = this.size.minDimension * 0.35f,
        )
    }
}
