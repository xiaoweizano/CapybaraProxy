package com.flowproxy.android

import android.app.Application
import com.flowproxy.android.platform.AndroidNetworkMonitor
import com.flowproxy.core.data.FlowPreferencesRepository

class FlowProxyApplication : Application() {
    lateinit var preferencesRepository: FlowPreferencesRepository
        private set

    lateinit var networkMonitor: AndroidNetworkMonitor
        private set

    override fun onCreate() {
        super.onCreate()
        preferencesRepository = FlowPreferencesRepository(this)
        networkMonitor = AndroidNetworkMonitor(this).also { it.start() }
    }

    override fun onTerminate() {
        networkMonitor.stop()
        super.onTerminate()
    }
}
