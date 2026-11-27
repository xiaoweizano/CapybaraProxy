package com.capybara.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.capybara.core.model.ConnectionStatus
import com.capybara.core.theme.LocalFlowPalette
import com.capybara.android.i18n.LocalAppStrings
import com.capybara.android.i18n.statusLabel

@Composable
fun FlowCard(
    modifier: Modifier = Modifier,
    padding: Dp = 18.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalFlowPalette.current
    val shape = RoundedCornerShape(18.dp)
    val decoration = if (palette.isDark) {
        Modifier.border(1.dp, palette.border, shape)
    } else {
        Modifier.shadow(10.dp, shape, ambientColor = palette.glow)
    }
    Surface(
        modifier = modifier
            .then(decoration)
            .fillMaxWidth(),
        shape = shape,
        color = palette.surface,
    ) {
        Column(
            modifier = Modifier.padding(padding),
            content = { content() },
        )
    }
}

@Composable
fun PageIntro(
    eyebrow: String,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = eyebrow.uppercase(),
            color = LocalFlowPalette.current.accent,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = title,
            color = LocalFlowPalette.current.textPrimary,
            style = MaterialTheme.typography.headlineMedium,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = description,
            color = LocalFlowPalette.current.textSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
fun DemoBadge(text: String = LocalAppStrings.current.demoBadge) {
    val palette = LocalFlowPalette.current
    Surface(
        color = palette.accentOrange.copy(alpha = if (palette.isDark) 0.18f else 0.14f),
        contentColor = palette.accentOrange,
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
fun StatusPill(
    status: ConnectionStatus,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFlowPalette.current
    val color = when (status) {
        ConnectionStatus.CONNECTED -> palette.success
        ConnectionStatus.STARTING,
        ConnectionStatus.STOPPING,
        ConnectionStatus.RUNNING_DISCONNECTED,
        -> palette.warning
        ConnectionStatus.ERROR,
        ConnectionStatus.PERMISSION_REQUIRED,
        -> palette.danger
        ConnectionStatus.STOPPED -> palette.textSecondary
    }
    val label = LocalAppStrings.current.statusLabel(status)

    Row(
        modifier = modifier
            .background(color.copy(alpha = 0.12f), CircleShape)
            .border(1.dp, color.copy(alpha = 0.35f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier
                .size(7.dp)
                .background(color, CircleShape),
        )
        Text(
            text = label,
            color = color,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
fun FlowButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    secondary: Boolean = false,
) {
    val palette = LocalFlowPalette.current
    val colors = if (secondary) {
        ButtonDefaults.buttonColors(
            containerColor = palette.surfaceSoft,
            contentColor = palette.textPrimary,
            disabledContainerColor = palette.surfaceSoft.copy(alpha = 0.5f),
            disabledContentColor = palette.textMuted,
        )
    } else {
        ButtonDefaults.buttonColors(
            containerColor = palette.accent,
            contentColor = Color.White,
            disabledContainerColor = palette.accent.copy(alpha = 0.35f),
            disabledContentColor = Color.White.copy(alpha = 0.65f),
        )
    }

    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        colors = colors,
        contentPadding = ButtonDefaults.ContentPadding,
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
fun Metric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = LocalFlowPalette.current.textPrimary,
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            color = LocalFlowPalette.current.textMuted,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(5.dp))
        Text(
            text = value,
            color = valueColor,
            style = MaterialTheme.typography.titleLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    size: Dp = 34.dp,
) {
    val palette = LocalFlowPalette.current
    Canvas(modifier.size(size)) {
        val width = this.size.width
        val height = this.size.height
        val stroke = this.size.minDimension * 0.11f
        val first = Path().apply {
            moveTo(width * 0.08f, height * 0.42f)
            cubicTo(
                width * 0.3f,
                height * 0.18f,
                width * 0.48f,
                height * 0.65f,
                width * 0.92f,
                height * 0.32f,
            )
        }
        val second = Path().apply {
            moveTo(width * 0.08f, height * 0.64f)
            cubicTo(
                width * 0.33f,
                height * 0.4f,
                width * 0.52f,
                height * 0.9f,
                width * 0.92f,
                height * 0.58f,
            )
        }
        drawPath(
            path = first,
            color = palette.accentCyan,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
        drawPath(
            path = second,
            color = palette.accentViolet,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
        drawCircle(
            color = palette.accentCyan.copy(alpha = 0.24f),
            radius = this.size.minDimension * 0.22f,
            center = Offset(this.size.width * 0.2f, this.size.height * 0.7f),
        )
    }
}

@Composable
fun DividerLine(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(LocalFlowPalette.current.border),
    )
}

@Composable
fun ThemeChoice(
    themeLabel: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFlowPalette.current
    Box(
        modifier = modifier
            .background(
                if (selected) palette.accent else Color.Transparent,
                RoundedCornerShape(9.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = themeLabel,
            color = if (selected) Color.White else palette.textSecondary,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
fun GradientPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val palette = LocalFlowPalette.current
    val background = if (palette.isDark) {
        Brush.linearGradient(
            listOf(
                palette.surfaceElevated,
                palette.accentViolet.copy(alpha = 0.26f),
                palette.surface,
            ),
        )
    } else {
        Brush.linearGradient(
            listOf(
                palette.surface,
                palette.accentOrange.copy(alpha = 0.12f),
                palette.accentCyan.copy(alpha = 0.18f),
            ),
        )
    }
    Box(
        modifier = modifier
            .background(background, RoundedCornerShape(18.dp))
            .border(1.dp, palette.border, RoundedCornerShape(18.dp)),
    ) {
        content()
    }
}
