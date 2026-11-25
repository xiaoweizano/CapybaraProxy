package com.flowproxy.android.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.ui.graphics.vector.ImageVector
import com.flowproxy.android.i18n.AppStrings

enum class AppPage(
    val label: (AppStrings) -> String,
    val icon: ImageVector,
) {
    OVERVIEW({ it.navOverview }, Icons.Filled.Home),
    PROXIES({ it.navProxies }, Icons.Filled.Place),
    RULES({ it.navRules }, Icons.AutoMirrored.Filled.List),
    CONNECTIONS({ it.navConnections }, Icons.Filled.Share),
    PROFILES({ it.navProfiles }, Icons.Filled.AccountBox),
    LOGS({ it.navLogs }, Icons.Filled.Info),
    SETTINGS({ it.navSettings }, Icons.Filled.Settings),
}

object MobileNavigation {
    val primaryPages = listOf(
        AppPage.OVERVIEW,
        AppPage.PROXIES,
        AppPage.RULES,
        AppPage.CONNECTIONS,
    )

    val morePages = listOf(
        AppPage.PROFILES,
        AppPage.LOGS,
        AppPage.SETTINGS,
    )
}
