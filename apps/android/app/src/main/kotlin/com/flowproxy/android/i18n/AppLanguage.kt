package com.flowproxy.android.i18n

/**
 * Interface languages FlowProxy ships on Android.
 *
 * Kept as a plain enum (not an Android resource qualifier) so the choice can be
 * switched at runtime on every supported API level. Android's resource-based
 * locale switching needs `AppCompatDelegate` or API 33 `LocaleManager`; a
 * dictionary keeps behaviour identical on API 26 through 35.
 */
enum class AppLanguage(val id: String) {
    ENGLISH("english"),
    SIMPLIFIED_CHINESE("simplified_chinese"),
    ;

    companion object {
        val DEFAULT = ENGLISH

        fun parse(value: String?): AppLanguage =
            entries.firstOrNull { it.id == value } ?: DEFAULT

        /** Picks a language from a raw BCP-47 tag list, e.g. `LocaleList`. */
        fun fromLanguageTags(tags: List<String>): AppLanguage =
            if (tags.any { it.lowercase().startsWith("zh") }) {
                SIMPLIFIED_CHINESE
            } else {
                DEFAULT
            }
    }
}