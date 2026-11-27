package com.capybara.core.model

enum class ThemeId {
    CYBER_FLOW,
    WARM_FLOW,
}

fun parseThemeId(raw: String?): ThemeId =
    when (raw) {
        "warm_flow" -> ThemeId.WARM_FLOW
        else -> ThemeId.CYBER_FLOW
    }

data class TrafficSample(
    val sequence: Long,
    val capturedAtMs: Long,
    val uploadBps: Long,
    val downloadBps: Long,
    val activeConnections: Int,
    val totalUploadBytes: Long,
    val totalDownloadBytes: Long,
)

class TrafficHistory(
    private val capacity: Int,
) {
    private val samples = ArrayDeque<TrafficSample>(capacity)

    init {
        require(capacity > 0) { "Traffic history capacity must be positive" }
    }

    @Synchronized
    fun add(sample: TrafficSample) {
        if (samples.size == capacity) {
            samples.removeFirst()
        }
        samples.addLast(sample)
    }

    @Synchronized
    fun snapshot(): List<TrafficSample> = samples.toList()
}

enum class MihomoBridgeState {
    UNAVAILABLE,
    PROBE_ONLY,
    AVAILABLE,
}

data class MihomoCapabilityReport(
    val state: MihomoBridgeState,
    val nativeLibraryPresent: Boolean,
    val abi: String,
    val tunFileDescriptorSupported: Boolean,
    val detail: String,
) {
    val canStartCore: Boolean
        get() = state == MihomoBridgeState.AVAILABLE &&
            nativeLibraryPresent &&
            tunFileDescriptorSupported
}

fun evaluateMihomoCapability(
    nativeLibraryPresent: Boolean,
    deviceAbi: String,
    tunFileDescriptorSupported: Boolean,
): MihomoCapabilityReport {
    if (!nativeLibraryPresent) {
        return MihomoCapabilityReport(
            state = MihomoBridgeState.UNAVAILABLE,
            nativeLibraryPresent = false,
            abi = deviceAbi,
            tunFileDescriptorSupported = tunFileDescriptorSupported,
            detail = "No verified Mihomo Android native library is bundled",
        )
    }

    val verifiedAbi = deviceAbi == "arm64-v8a"
    if (!verifiedAbi || !tunFileDescriptorSupported) {
        return MihomoCapabilityReport(
            state = MihomoBridgeState.PROBE_ONLY,
            nativeLibraryPresent = true,
            abi = deviceAbi,
            tunFileDescriptorSupported = tunFileDescriptorSupported,
            detail = "Native bridge exists, but ABI or TUN descriptor handoff is unverified",
        )
    }

    return MihomoCapabilityReport(
        state = MihomoBridgeState.AVAILABLE,
        nativeLibraryPresent = true,
        abi = deviceAbi,
        tunFileDescriptorSupported = true,
        detail = "Verified arm64-v8a bridge with TUN descriptor handoff",
    )
}
