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

enum class AppPage(
    val label: String,
    val icon: ImageVector,
) {
    OVERVIEW("Overview", Icons.Filled.Home),
    PROXIES("Proxies", Icons.Filled.Place),
    RULES("Rules", Icons.AutoMirrored.Filled.List),
    CONNECTIONS("Connections", Icons.Filled.Share),
    PROFILES("Profiles", Icons.Filled.AccountBox),
    LOGS("Logs", Icons.Filled.Info),
    SETTINGS("Settings", Icons.Filled.Settings),
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
