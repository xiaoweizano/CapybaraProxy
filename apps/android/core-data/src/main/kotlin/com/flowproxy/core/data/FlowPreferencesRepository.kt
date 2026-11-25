package com.flowproxy.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.flowproxy.core.model.ThemeId
import com.flowproxy.core.model.parseThemeId
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

private val Context.flowPreferencesDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "flowproxy_preferences",
)

data class AppPreferences(
    val themeId: ThemeId = ThemeId.CYBER_FLOW,
    val reducedMotion: Boolean = false,
    /** Raw language id; parsed by the app layer, which owns the enum. */
    val languageId: String = "english",
)

class FlowPreferencesRepository(
    context: Context,
) {
    private val dataStore = context.applicationContext.flowPreferencesDataStore

    val preferences: Flow<AppPreferences> = dataStore.data
        .catch { error ->
            if (error is IOException) {
                emit(emptyPreferences())
            } else {
                throw error
            }
        }
        .map { preferences ->
            AppPreferences(
                themeId = parseThemeId(preferences[THEME_ID]),
                reducedMotion = preferences[REDUCED_MOTION] ?: false,
                languageId = preferences[LANGUAGE_ID] ?: "english",
            )
        }

    suspend fun setTheme(themeId: ThemeId) {
        dataStore.edit { preferences ->
            preferences[THEME_ID] = when (themeId) {
                ThemeId.CYBER_FLOW -> "cyber_flow"
                ThemeId.WARM_FLOW -> "warm_flow"
            }
        }
    }

    suspend fun setReducedMotion(enabled: Boolean) {
        dataStore.edit { preferences ->
            preferences[REDUCED_MOTION] = enabled
        }
    }

    suspend fun setLanguage(languageId: String) {
        dataStore.edit { preferences ->
            preferences[LANGUAGE_ID] = languageId
        }
    }

    private companion object {
        val THEME_ID = stringPreferencesKey("theme_id")
        val REDUCED_MOTION = booleanPreferencesKey("reduced_motion")
        val LANGUAGE_ID = stringPreferencesKey("language_id")
    }
}
