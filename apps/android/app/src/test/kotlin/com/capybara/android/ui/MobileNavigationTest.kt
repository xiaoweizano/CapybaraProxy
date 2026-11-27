package com.capybara.android.ui

import kotlin.test.Test
import kotlin.test.assertEquals

class MobileNavigationTest {
    @Test
    fun `every app page appears exactly once in the mobile information architecture`() {
        val navigation = MobileNavigation

        assertEquals(
            AppPage.entries.toSet(),
            (navigation.primaryPages + navigation.morePages).toSet(),
        )
        assertEquals(
            AppPage.entries.size,
            navigation.primaryPages.size + navigation.morePages.size,
        )
    }

    @Test
    fun `mobile primary navigation stays focused on high frequency destinations`() {
        assertEquals(
            listOf(
                AppPage.OVERVIEW,
                AppPage.PROXIES,
                AppPage.RULES,
                AppPage.CONNECTIONS,
            ),
            MobileNavigation.primaryPages,
        )
        assertEquals(
            listOf(
                AppPage.PROFILES,
                AppPage.LOGS,
                AppPage.SETTINGS,
            ),
            MobileNavigation.morePages,
        )
    }
}
