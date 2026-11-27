package com.capybara.vpn.service

internal const val VPN_SERVICE_ACTION_START = "com.capybara.vpn.action.START"
internal const val VPN_SERVICE_ACTION_STOP = "com.capybara.vpn.action.STOP"

internal enum class VpnServiceCommand {
    START,
    STOP,
    IGNORE,
}

internal fun vpnServiceCommandFor(action: String?): VpnServiceCommand =
    when (action) {
        VPN_SERVICE_ACTION_START -> VpnServiceCommand.START
        VPN_SERVICE_ACTION_STOP -> VpnServiceCommand.STOP
        else -> VpnServiceCommand.IGNORE
    }
