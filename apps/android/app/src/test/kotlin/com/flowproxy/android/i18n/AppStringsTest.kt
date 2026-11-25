package com.flowproxy.android.i18n

import androidx.compose.runtime.staticCompositionLocalOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Guards the two dictionaries against drift.
 *
 * `AppStrings` is an interface, so `ChineseStrings` will not compile if a
 * property is missing. These tests catch the cases the compiler cannot: an
 * untranslated copy-paste and a broken placeholder.
 */
class AppStringsTest {
    private fun propertiesOf(instance: AppStrings): Map<String, String> =
        AppStrings::class.java.methods
            .filter { it.name.startsWith("get") && it.parameterCount == 0 }
            .filter { it.returnType == String::class.java }
            .associate { it.name.removePrefix("get").replaceFirstChar(Char::lowercase) to
                (it.invoke(instance) as String) }

    @Test
    fun chineseDictionaryTranslatesEveryEnglishString() {
        val english = propertiesOf(EnglishStrings)
        val chinese = propertiesOf(ChineseStrings)

        assertEquals(english.keys, chinese.keys)
        assertTrue(english.isNotEmpty())

        val untranslated = english.keys.filter { key ->
            // Proper nouns and short codes are intentionally identical.
            key !in ALLOW_LISTED_IDENTICAL &&
                english.getValue(key) == chinese.getValue(key)
        }

        assertTrue(
            untranslated.isEmpty(),
            "These keys still show English: $untranslated",
        )
    }

    @Test
    fun languageIdentifierMatchesTheRequestedLanguage() {
        assertEquals(AppLanguage.ENGLISH, EnglishStrings.language)
        assertEquals(AppLanguage.SIMPLIFIED_CHINESE, ChineseStrings.language)
    }

    @Test
    fun resolveLanguagesAndFallBackToEnglish() {
        assertEquals(EnglishStrings, stringsFor(AppLanguage.ENGLISH))
        assertEquals(ChineseStrings, stringsFor(AppLanguage.SIMPLIFIED_CHINESE))

        assertEquals(AppLanguage.ENGLISH, AppLanguage.parse(null))
        assertEquals(AppLanguage.ENGLISH, AppLanguage.parse("klingon"))
        assertEquals(AppLanguage.SIMPLIFIED_CHINESE, AppLanguage.parse("simplified_chinese"))
    }

    @Test
    fun detectChineseFromLanguageTags() {
        assertEquals(AppLanguage.SIMPLIFIED_CHINESE, AppLanguage.fromLanguageTags(listOf("zh-CN")))
        assertEquals(AppLanguage.ENGLISH, AppLanguage.fromLanguageTags(listOf("en-US")))
        assertEquals(AppLanguage.ENGLISH, AppLanguage.fromLanguageTags(emptyList()))
    }

    @Test
    fun compositionLocalIsAvailable() {
        assertNotNull(LocalAppStrings)
    }

    private companion object {
        /** Values that are legitimately identical across languages. */
        val ALLOW_LISTED_IDENTICAL = setOf(
            // Proper nouns and product names
            "themeA",
            "themeC",
            "themeACyberFlow",
            "themeCWarmFlow",
            // Language names are shown in their own script on both sides.
            "languageEnglish",
            "languageChinese",
            // Technical identifiers
            "abiLabel",
            "vpnLabel",
            "androidVpn",
            "mihomoBridge",
        )
    }
}