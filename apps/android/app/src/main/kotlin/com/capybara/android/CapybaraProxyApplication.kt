package com.capybara.android

import android.app.Application
import com.capybara.android.platform.AndroidNetworkMonitor
import com.capybara.core.data.FlowPreferencesRepository

class CapybaraProxyApplication : Application() {
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
