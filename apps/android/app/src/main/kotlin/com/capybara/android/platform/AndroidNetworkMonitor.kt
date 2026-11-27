package com.capybara.android.platform

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.core.content.getSystemService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AndroidNetworkMonitor(
    context: Context,
) {
    private val connectivityManager = context.applicationContext.getSystemService<ConnectivityManager>()
    private val mutableAvailable = MutableStateFlow(false)
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile
    private var currentNetwork: Network? = null

    val available: StateFlow<Boolean> = mutableAvailable.asStateFlow()

    fun start() {
        if (networkCallback != null) return

        val manager = connectivityManager ?: return
        mutableAvailable.value = manager.activeNetwork != null
        currentNetwork = manager.activeNetwork

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                currentNetwork = network
                mutableAvailable.value = true
            }

            override fun onLost(network: Network) {
                if (currentNetwork == network) {
                    currentNetwork = null
                    mutableAvailable.value = false
                }
            }
        }
        runCatching {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        }
    }

    fun stop() {
        val callback = networkCallback ?: return
        networkCallback = null
        currentNetwork = null
        runCatching { connectivityManager?.unregisterNetworkCallback(callback) }
    }
}
