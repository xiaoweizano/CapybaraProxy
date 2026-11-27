package com.capybara.android

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.util.Collections
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runner.RunWith
import org.junit.runners.model.Statement

@RunWith(AndroidJUnit4::class)
class NetworkAvailabilityInstrumentedTest {
    private val composeRule = createAndroidComposeRule<MainActivity>()

    private val waitForAndroidNetworkRule = TestRule { base, _: Description ->
        object : Statement() {
            override fun evaluate() {
                val context = InstrumentationRegistry.getInstrumentation().targetContext
                val connectivityManager =
                    context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                waitUntil(
                    description = "Android default network before Activity launch",
                    timeoutMillis = NETWORK_RECOVERY_TIMEOUT_MS,
                ) {
                    connectivityManager.activeNetwork != null
                }
                base.evaluate()
            }
        }
    }

    @get:Rule
    val ruleChain: RuleChain =
        RuleChain.outerRule(waitForAndroidNetworkRule).around(composeRule)

    @Test
    fun coldStartShowsOnlineWhenAndroidHasActiveNetwork() {
        val application = InstrumentationRegistry.getInstrumentation()
            .targetContext
            .applicationContext as CapybaraProxyApplication
        waitUntil(
            description = "CapybaraProxy network state after startup",
            timeoutMillis = NETWORK_RECOVERY_TIMEOUT_MS,
        ) {
            application.networkMonitor.available.value
        }
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("Online")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    @Test
    fun airplaneModeMovesUiOfflineAndRestoredNetworkMovesItOnline() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("Online")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }

        val callbackEvents = Collections.synchronizedList(mutableListOf<String>())
        val diagnosticCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                callbackEvents += "available=$network active=${connectivityManager.activeNetwork}"
            }

            override fun onLost(network: Network) {
                callbackEvents += "lost=$network active=${connectivityManager.activeNetwork}"
            }

            override fun onUnavailable() {
                callbackEvents += "unavailable active=${connectivityManager.activeNetwork}"
            }
        }
        connectivityManager.registerDefaultNetworkCallback(diagnosticCallback)

        val device = UiDevice.getInstance(instrumentation)
        try {
            setAirplaneMode(device, context, enabled = true)
            waitUntil(
                description = "Android default network to disappear",
                events = callbackEvents,
            ) {
                connectivityManager.activeNetwork == null
            }
            waitUntil(
                description = "CapybaraProxy network state to become offline",
                events = callbackEvents,
            ) {
                !(context.applicationContext as CapybaraProxyApplication)
                    .networkMonitor
                    .available
                    .value
            }
            openCapybaraProxy(context)
            composeRule.waitUntil(timeoutMillis = 10_000) {
                composeRule.onAllNodesWithText("Offline")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
        } finally {
            runCatching { setAirplaneMode(device, context, enabled = false) }
            runCatching { openCapybaraProxy(context) }
            connectivityManager.unregisterNetworkCallback(diagnosticCallback)
        }

        waitUntil(
            description = "Android default network to recover",
            events = callbackEvents,
            timeoutMillis = NETWORK_RECOVERY_TIMEOUT_MS,
        ) {
            connectivityManager.activeNetwork != null
        }
        waitUntil(
            description = "CapybaraProxy network state to recover online",
            events = callbackEvents,
            timeoutMillis = NETWORK_RECOVERY_TIMEOUT_MS,
        ) {
            (context.applicationContext as CapybaraProxyApplication)
                .networkMonitor
                .available
                .value
        }
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.onAllNodesWithText("Online")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    private fun setAirplaneMode(
        device: UiDevice,
        context: Context,
        enabled: Boolean,
    ) {
        context.startActivity(
            Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        val label = checkNotNull(
            device.wait(Until.findObject(By.text("Airplane mode")), UI_TIMEOUT_MS),
        ) {
            "Airplane mode setting is unavailable"
        }
        if (airplaneModeEnabled(context) != enabled) {
            device.click(
                AIRPLANE_MODE_ROW_X,
                label.visibleBounds.centerY(),
            )
        }
        waitUntil(description = "airplane mode to change to $enabled") {
            airplaneModeEnabled(context) == enabled
        }
    }

    private fun airplaneModeEnabled(context: Context): Boolean =
        Settings.Global.getInt(
            context.contentResolver,
            Settings.Global.AIRPLANE_MODE_ON,
            0,
        ) != 0

    private fun openCapybaraProxy(context: Context) {
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        )
    }

    private fun waitUntil(
        description: String,
        events: List<String> = emptyList(),
        timeoutMillis: Long = UI_TIMEOUT_MS,
        condition: () -> Boolean,
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        throw AssertionError(
            "Timed out waiting for $description; callbackEvents=${events.toList()}",
        )
    }

    private companion object {
        const val UI_TIMEOUT_MS = 20_000L
        const val NETWORK_RECOVERY_TIMEOUT_MS = 60_000L
        const val POLL_INTERVAL_MS = 250L
        const val AIRPLANE_MODE_ROW_X = 48
    }
}
