package com.capybara.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RuntimeSupportTest {
    @Test
    fun `traffic history keeps only the newest samples`() {
        val history = TrafficHistory(capacity = 3)

        repeat(5) { index ->
            history.add(sample(index.toLong()))
        }

        assertEquals(listOf(2L, 3L, 4L), history.snapshot().map { it.sequence })
    }

    @Test
    fun `empty history has no synthetic traffic`() {
        val history = TrafficHistory(capacity = 30)

        assertTrue(history.snapshot().isEmpty())
    }

    @Test
    fun `theme parser defaults to cyber flow`() {
        assertEquals(ThemeId.CYBER_FLOW, parseThemeId(null))
        assertEquals(ThemeId.CYBER_FLOW, parseThemeId("unknown"))
        assertEquals(ThemeId.WARM_FLOW, parseThemeId("warm_flow"))
    }

    @Test
    fun `probe only bridge cannot start the core`() {
        val report = MihomoCapabilityReport(
            state = MihomoBridgeState.PROBE_ONLY,
            nativeLibraryPresent = true,
            abi = "arm64-v8a",
            tunFileDescriptorSupported = true,
            detail = "Native ABI is not verified",
        )

        assertFalse(report.canStartCore)
    }

    @Test
    fun `verified bridge can start the core`() {
        val report = MihomoCapabilityReport(
            state = MihomoBridgeState.AVAILABLE,
            nativeLibraryPresent = true,
            abi = "arm64-v8a",
            tunFileDescriptorSupported = true,
            detail = "Verified arm64 bridge",
        )

        assertTrue(report.canStartCore)
    }

    private fun sample(sequence: Long): TrafficSample =
        TrafficSample(
            sequence = sequence,
            capturedAtMs = sequence * 1_000,
            uploadBps = sequence * 10,
            downloadBps = sequence * 20,
            activeConnections = sequence.toInt(),
            totalUploadBytes = sequence * 100,
            totalDownloadBytes = sequence * 200,
        )
}
