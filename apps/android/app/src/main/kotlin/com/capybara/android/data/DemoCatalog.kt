package com.capybara.android.data

import com.capybara.core.model.TrafficSample

data class DemoProxyGroup(
    val name: String,
    val selectedNode: String,
)

data class DemoNode(
    val name: String,
    val region: String,
    val latencyLabel: String,
)

data class DemoRule(
    val type: String,
    val value: String,
    val policy: String,
)

data class DemoConnection(
    val host: String,
    val network: String,
    val chain: String,
    val upload: String,
    val download: String,
)

data class DemoProfile(
    val name: String,
    val source: String,
    val updated: String,
    val selected: Boolean,
)

data class DemoLog(
    val time: String,
    val level: String,
    val message: String,
)

object DemoCatalog {
    val groups = listOf(
        DemoProxyGroup("Auto Select", "Japan Tokyo 01"),
        DemoProxyGroup("Manual Select", "Singapore Edge 02"),
        DemoProxyGroup("Streaming", "United States West 03"),
    )

    val nodes = listOf(
        DemoNode("Japan Tokyo 01", "JP", "Not measured"),
        DemoNode("Singapore Edge 02", "SG", "Not measured"),
        DemoNode("Germany Frankfurt 01", "DE", "Not measured"),
        DemoNode("United States West 03", "US", "Not measured"),
    )

    val rules = listOf(
        DemoRule("DOMAIN-SUFFIX", "example.com", "Proxy"),
        DemoRule("PROCESS-NAME", "browser", "Auto Select"),
        DemoRule("GEOIP", "LAN", "DIRECT"),
        DemoRule("MATCH", "*", "Auto Select"),
    )

    val connections = listOf(
        DemoConnection("api.example.com", "HTTPS", "Auto Select > Tokyo 01", "18 KB", "84 KB"),
        DemoConnection("cdn.example.net", "HTTPS", "Auto Select > Singapore 02", "4 KB", "212 KB"),
        DemoConnection("metrics.example.org", "TCP", "DIRECT", "2 KB", "3 KB"),
    )

    val profiles = listOf(
        DemoProfile("Daily Flow", "Remote profile", "Not updated", true),
        DemoProfile("Travel Lite", "Local file", "Not updated", false),
    )

    val logs = listOf(
        DemoLog("08:00:01", "INFO", "Stage 5 sample: Android UI initialized"),
        DemoLog("08:00:02", "INFO", "Stage 5 sample: VPN permission state is owned by the device"),
        DemoLog("08:00:03", "WARN", "Stage 5 sample: Mihomo Android native build is unavailable"),
    )

    val trafficUpload = listOf(
        0.2, 0.35, 0.3, 0.5, 0.75, 0.6, 0.9, 1.1, 0.85, 1.2,
        1.35, 1.1, 1.45, 1.7, 1.5, 1.85, 1.6, 1.95, 1.7, 2.1,
        1.9, 2.2, 2.05, 2.3,
    )

    val trafficDownload = listOf(
        0.6, 0.9, 1.2, 0.85, 1.1, 1.45, 1.3, 1.75, 1.55, 1.9,
        2.25, 2.05, 2.4, 2.1, 2.55, 2.8, 2.6, 3.1, 2.85, 3.35,
        3.05, 3.5, 3.25, 3.7,
    )

    fun initialTrafficSamples(): List<TrafficSample> =
        trafficDownload.indices.map { index ->
            TrafficSample(
                sequence = index.toLong(),
                capturedAtMs = index * 2_000L,
                uploadBps = (trafficUpload[index] * 1_000_000).toLong(),
                downloadBps = (trafficDownload[index] * 1_000_000).toLong(),
                activeConnections = 0,
                totalUploadBytes = 0,
                totalDownloadBytes = 0,
            )
        }
}
