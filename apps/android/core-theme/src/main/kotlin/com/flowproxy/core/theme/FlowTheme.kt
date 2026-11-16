package com.flowproxy.core.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.flowproxy.core.model.ThemeId

@Immutable
data class FlowPalette(
    val canvas: Color,
    val canvasSecondary: Color,
    val sidebar: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val surfaceSoft: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val accent: Color,
    val accentCyan: Color,
    val accentViolet: Color,
    val accentOrange: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val border: Color,
    val glow: Color,
    val isDark: Boolean,
)

val CyberFlowPalette = FlowPalette(
    canvas = Color(0xFF060B20),
    canvasSecondary = Color(0xFF0A1230),
    sidebar = Color(0xFF0A1435),
    surface = Color(0xFF101D47),
    surfaceElevated = Color(0xFF172858),
    surfaceSoft = Color(0xFF0C173A),
    textPrimary = Color(0xFFF4F7FF),
    textSecondary = Color(0xFFA8B5D8),
    textMuted = Color(0xFF6F7EA8),
    accent = Color(0xFF168CFF),
    accentCyan = Color(0xFF32D9FF),
    accentViolet = Color(0xFF765CFF),
    accentOrange = Color(0xFFFFB02E),
    success = Color(0xFF22DDA2),
    warning = Color(0xFFFFB547),
    danger = Color(0xFFFF5E7D),
    border = Color(0x3382A5FF),
    glow = Color(0x66168CFF),
    isDark = true,
)

val WarmFlowPalette = FlowPalette(
    canvas = Color(0xFFF3EFED),
    canvasSecondary = Color(0xFFE9E3EF),
    sidebar = Color(0xFFFBF8F6),
    surface = Color(0xFFFFFDFC),
    surfaceElevated = Color(0xFFFFFFFF),
    surfaceSoft = Color(0xFFF1EAE6),
    textPrimary = Color(0xFF293149),
    textSecondary = Color(0xFF7B8496),
    textMuted = Color(0xFFA1A6B2),
    accent = Color(0xFF2B96F3),
    accentCyan = Color(0xFF62D6FA),
    accentViolet = Color(0xFF7568E8),
    accentOrange = Color(0xFFFF9B45),
    success = Color(0xFF16B982),
    warning = Color(0xFFEEA23D),
    danger = Color(0xFFE85D70),
    border = Color(0x1F465A82),
    glow = Color(0x332B96F3),
    isDark = false,
)

val LocalFlowPalette = staticCompositionLocalOf { CyberFlowPalette }

private val FlowTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 32.sp,
        lineHeight = 36.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 29.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 19.sp,
        lineHeight = 24.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 15.sp,
    ),
)

private val FlowShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(9.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

fun paletteFor(themeId: ThemeId): FlowPalette =
    when (themeId) {
        ThemeId.CYBER_FLOW -> CyberFlowPalette
        ThemeId.WARM_FLOW -> WarmFlowPalette
    }

@Composable
fun FlowProxyTheme(
    themeId: ThemeId,
    content: @Composable () -> Unit,
) {
    val palette = paletteFor(themeId)
    val colorScheme = if (palette.isDark) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            secondary = palette.accentViolet,
            tertiary = palette.accentCyan,
            background = palette.canvas,
            onBackground = palette.textPrimary,
            surface = palette.surface,
            onSurface = palette.textPrimary,
            error = palette.danger,
        )
    } else {
        lightColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            secondary = palette.accentViolet,
            tertiary = palette.accentOrange,
            background = palette.canvas,
            onBackground = palette.textPrimary,
            surface = palette.surface,
            onSurface = palette.textPrimary,
            error = palette.danger,
        )
    }

    CompositionLocalProvider(LocalFlowPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = FlowTypography,
            shapes = FlowShapes,
            content = content,
        )
    }
}
