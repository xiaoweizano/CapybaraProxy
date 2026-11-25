package com.flowproxy.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flowproxy.android.feature.overview.OverviewPage
import com.flowproxy.android.feature.settings.SettingsPage
import com.flowproxy.android.feature.workspace.ConnectionsPage
import com.flowproxy.android.feature.workspace.LogsPage
import com.flowproxy.android.feature.workspace.ProfilesPage
import com.flowproxy.android.feature.workspace.ProxiesPage
import com.flowproxy.android.feature.workspace.RulesPage
import com.flowproxy.core.model.ConnectionStatus
import com.flowproxy.core.model.MihomoCapabilityReport
import com.flowproxy.core.model.ProxyStatus
import com.flowproxy.core.model.ThemeId
import com.flowproxy.core.model.deriveConnectionStatus
import com.flowproxy.core.theme.LocalFlowPalette
import com.flowproxy.android.i18n.AppLanguage
import com.flowproxy.android.i18n.LocalAppStrings
import com.flowproxy.android.i18n.stringsFor

@Composable
fun FlowProxyApp(
    themeId: ThemeId,
    reducedMotion: Boolean,
    status: ProxyStatus,
    capability: MihomoCapabilityReport,
    networkAvailable: Boolean,
    notificationsEnabled: Boolean,
    onThemeChange: (ThemeId) -> Unit,
    onReducedMotionChange: (Boolean) -> Unit,
    onRequestNotifications: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onVpnAction: () -> Unit,
    language: AppLanguage,
    onLanguageChange: (AppLanguage) -> Unit,
) {
    val strings = stringsFor(language)
    var selectedPage by rememberSaveable { mutableStateOf(AppPage.OVERVIEW) }
    var showMore by rememberSaveable { mutableStateOf(false) }
    val palette = LocalFlowPalette.current
    val connectionStatus = deriveConnectionStatus(status)
    val inMoreSection = showMore || selectedPage in MobileNavigation.morePages

    fun openPrimary(page: AppPage) {
        selectedPage = page
        showMore = false
    }

    fun openMorePage(page: AppPage) {
        selectedPage = page
        showMore = false
    }

    BackHandler(enabled = inMoreSection) {
        if (selectedPage in MobileNavigation.morePages && !showMore) {
            showMore = true
        } else {
            showMore = false
            selectedPage = AppPage.OVERVIEW
        }
    }

    CompositionLocalProvider(LocalAppStrings provides strings) {
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = palette.canvas,
        topBar = {
            FlowTopBar(
                title = when {
                    showMore -> strings.more
                    else -> selectedPage.label(strings)
                },
                themeId = themeId,
                showBack = selectedPage in MobileNavigation.morePages && !showMore,
                onBack = { showMore = true },
                onThemeChange = onThemeChange,
            )
        },
        bottomBar = {
            FlowBottomNavigation(
                selectedPage = selectedPage,
                showMore = showMore,
                onPrimarySelected = ::openPrimary,
                onMoreSelected = { showMore = true },
            )
        },
    ) { contentPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
        ) {
            when {
                showMore -> MorePage(onOpen = ::openMorePage)
                selectedPage == AppPage.OVERVIEW -> OverviewPage(
                    themeId = themeId,
                    status = status,
                    capability = capability,
                    networkAvailable = networkAvailable,
                    reducedMotion = reducedMotion,
                    onStartStop = onVpnAction,
                )

                selectedPage == AppPage.PROXIES -> ProxiesPage()
                selectedPage == AppPage.RULES -> RulesPage()
                selectedPage == AppPage.CONNECTIONS -> ConnectionsPage(connectionStatus)
                selectedPage == AppPage.PROFILES -> ProfilesPage()
                selectedPage == AppPage.LOGS -> LogsPage()
                selectedPage == AppPage.SETTINGS -> SettingsPage(
                    themeId = themeId,
                    status = status,
                    connectionStatus = connectionStatus,
                    capability = capability,
                    reducedMotion = reducedMotion,
                    notificationsEnabled = notificationsEnabled,
                    onThemeChange = onThemeChange,
                    onReducedMotionChange = onReducedMotionChange,
                    onRequestNotifications = onRequestNotifications,
                    onOpenBatterySettings = onOpenBatterySettings,
                    onStartStopVpn = onVpnAction,
                    language = language,
                    onLanguageChange = onLanguageChange,
                )
            }
        }
    }
    }
}

@Composable
private fun FlowTopBar(
    title: String,
    themeId: ThemeId,
    showBack: Boolean,
    onBack: () -> Unit,
    onThemeChange: (ThemeId) -> Unit,
) {
    val palette = LocalFlowPalette.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(palette.canvas)
            .statusBarsPadding()
            .height(64.dp)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (showBack) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = LocalAppStrings.current.backToMore,
                    tint = palette.textPrimary,
                )
            }
        } else {
            BrandMark(size = 30.dp)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = palette.textPrimary,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = LocalAppStrings.current.localControl,
                color = palette.textMuted,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        ThemeQuickSwitch(
            themeId = themeId,
            onThemeChange = onThemeChange,
        )
    }
}

@Composable
private fun ThemeQuickSwitch(
    themeId: ThemeId,
    onThemeChange: (ThemeId) -> Unit,
) {
    val palette = LocalFlowPalette.current
    Row(
        modifier = Modifier
            .background(palette.surfaceSoft, RoundedCornerShape(9.dp))
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        listOf(
            ThemeId.CYBER_FLOW to "A",
            ThemeId.WARM_FLOW to "C",
        ).forEach { (candidate, label) ->
            val selected = themeId == candidate
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(
                        if (selected) palette.accent else Color.Transparent,
                        RoundedCornerShape(7.dp),
                    )
                    .clickable { onThemeChange(candidate) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    color = if (selected) Color.White else palette.textSecondary,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun FlowBottomNavigation(
    selectedPage: AppPage,
    showMore: Boolean,
    onPrimarySelected: (AppPage) -> Unit,
    onMoreSelected: () -> Unit,
) {
    val palette = LocalFlowPalette.current
    val itemColors = NavigationBarItemDefaults.colors(
        selectedIconColor = Color.White,
        selectedTextColor = palette.accent,
        indicatorColor = palette.accent,
        unselectedIconColor = palette.textMuted,
        unselectedTextColor = palette.textMuted,
    )

    NavigationBar(
        containerColor = palette.sidebar,
        contentColor = palette.textPrimary,
    ) {
        MobileNavigation.primaryPages.forEach { page ->
            NavigationBarItem(
                selected = !showMore && selectedPage == page,
                onClick = { onPrimarySelected(page) },
                icon = {
                    Icon(
                        imageVector = page.icon,
                        contentDescription = page.label(LocalAppStrings.current),
                    )
                },
                label = { Text(page.label(LocalAppStrings.current)) },
                colors = itemColors,
            )
        }
        NavigationBarItem(
            selected = showMore || selectedPage in MobileNavigation.morePages,
            onClick = onMoreSelected,
            icon = {
                Icon(
                    imageVector = Icons.Filled.MoreVert,
                    contentDescription = LocalAppStrings.current.more,
                )
            },
            label = { Text(LocalAppStrings.current.more) },
            colors = itemColors,
        )
    }
}

@Composable
private fun MorePage(
    onOpen: (AppPage) -> Unit,
) {
    val strings = LocalAppStrings.current
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 16.dp,
            bottom = 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageIntro(
                eyebrow = strings.workspaceEyebrow,
                title = strings.more,
                description = strings.moreDescription,
            )
        }
        MobileNavigation.morePages.forEach { page ->
            item(key = page.name) {
                MoreDestination(
                    page = page,
                    onClick = { onOpen(page) },
                )
            }
        }
    }
}

@Composable
private fun MoreDestination(
    page: AppPage,
    onClick: () -> Unit,
) {
    val palette = LocalFlowPalette.current
    FlowCard(padding = 0.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(
                        palette.accent.copy(alpha = 0.12f),
                        RoundedCornerShape(10.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = page.icon,
                    contentDescription = null,
                    modifier = Modifier.size(21.dp),
                    tint = palette.accent,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = page.label(LocalAppStrings.current),
                    color = palette.textPrimary,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = pageDescription(page, LocalAppStrings.current),
                    color = palette.textMuted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = palette.textMuted,
            )
        }
    }
}

private fun pageDescription(page: AppPage, strings: com.flowproxy.android.i18n.AppStrings): String =
    when (page) {
        AppPage.PROFILES -> strings.describeProfiles
        AppPage.LOGS -> strings.describeLogs
        AppPage.SETTINGS -> strings.describeSettings
        else -> ""
    }
