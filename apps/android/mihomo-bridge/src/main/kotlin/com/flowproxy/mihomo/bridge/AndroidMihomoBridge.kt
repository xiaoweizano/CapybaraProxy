package com.flowproxy.mihomo.bridge

import android.content.Context
import android.os.Build
import com.flowproxy.core.model.MihomoBridgeState
import com.flowproxy.core.model.MihomoCapabilityReport
import com.flowproxy.core.model.evaluateMihomoCapability
import java.io.File

class AndroidMihomoBridge(
    private val context: Context,
) {
    fun probe(): MihomoCapabilityReport {
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        val nativeLibrary = File(
            context.applicationInfo.nativeLibraryDir,
            "libmihomo.so",
        )
        val present = nativeLibrary.isFile

        val baseReport = evaluateMihomoCapability(
            nativeLibraryPresent = present,
            deviceAbi = abi,
            tunFileDescriptorSupported = false,
        )

        if (!present) {
            return baseReport
        }

        val contractPresent = runCatching {
            Class.forName("com.flowproxy.mihomo.NativeBridge")
                .getDeclaredMethod(
                    "startWithTun",
                    Int::class.javaPrimitiveType,
                    String::class.java,
                )
        }.isSuccess

        return baseReport.copy(
            state = MihomoBridgeState.PROBE_ONLY,
            detail = if (contractPresent) {
                "Native library and JNI contract found; Android TUN runtime is not yet verified"
            } else {
                "Native library found; verified Mihomo JNI contract is missing"
            },
        )
    }
}
