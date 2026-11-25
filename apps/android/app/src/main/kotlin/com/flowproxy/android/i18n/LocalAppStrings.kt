package com.flowproxy.android.i18n

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Current interface strings. Provided once near the app root; every Composable
 * reads it instead of hardcoding text.
 */
val LocalAppStrings = staticCompositionLocalOf<AppStrings> { EnglishStrings }