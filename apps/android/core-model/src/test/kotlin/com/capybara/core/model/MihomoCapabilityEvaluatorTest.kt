package com.capybara.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MihomoCapabilityEvaluatorTest {
    @Test
    fun `missing native library is unavailable`() {
        val report = evaluateMihomoCapability(
            nativeLibraryPresent = false,
            deviceAbi = "arm64-v8a",
            tunFileDescriptorSupported = true,
        )

        assertEquals(MihomoBridgeState.UNAVAILABLE, report.state)
        assertFalse(report.canStartCore)
    }

    @Test
    fun `unverified ABI is probe only`() {
        val report = evaluateMihomoCapability(
            nativeLibraryPresent = true,
            deviceAbi = "x86_64",
            tunFileDescriptorSupported = true,
        )

        assertEquals(MihomoBridgeState.PROBE_ONLY, report.state)
        assertFalse(report.canStartCore)
    }

    @Test
    fun `verified arm64 bridge can start`() {
        val report = evaluateMihomoCapability(
            nativeLibraryPresent = true,
            deviceAbi = "arm64-v8a",
            tunFileDescriptorSupported = true,
        )

        assertEquals(MihomoBridgeState.AVAILABLE, report.state)
        assertTrue(report.canStartCore)
    }
}
