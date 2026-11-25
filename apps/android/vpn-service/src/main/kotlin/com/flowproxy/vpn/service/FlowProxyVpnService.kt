package com.flowproxy.vpn.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import androidx.core.content.getSystemService
import com.flowproxy.core.model.VpnServiceState
import java.io.IOException

class FlowProxyVpnService : VpnService() {
    private var tunnel: ParcelFileDescriptor? = null
    private var lastFailure: String? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (vpnServiceCommandFor(intent?.action)) {
            VpnServiceCommand.STOP -> {
                stopTunnel()
            }

            VpnServiceCommand.START -> startTunnel()
            VpnServiceCommand.IGNORE -> stopIfUnused(startId)
        }

        return START_NOT_STICKY
    }

    override fun onRevoke() {
        lastFailure = null
        stopTunnel()
    }

    override fun onDestroy() {
        closeTunnel()
        if (ProxyRuntimeState.status.value.vpnService != VpnServiceState.ERROR) {
            ProxyRuntimeState.setVpnService(VpnServiceState.STOPPED)
        }
        super.onDestroy()
    }

    private fun startTunnel() {
        if (tunnel != null) {
            ProxyRuntimeState.setVpnService(VpnServiceState.RUNNING)
            updateNotification(getString(com.flowproxy.vpn.service.R.string.notification_ready))
            return
        }

        ProxyRuntimeState.setVpnService(VpnServiceState.STARTING)
        try {
            startForeground(NOTIFICATION_ID, buildNotification(getString(com.flowproxy.vpn.service.R.string.notification_preparing)))
            val descriptor = Builder()
                .setSession(getString(com.flowproxy.vpn.service.R.string.vpn_session_name))
                .setMtu(MTU)
                .addAddress(TUN_ADDRESS, TUN_PREFIX)
                .setBlocking(false)
                .also { builder ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        builder.setMetered(false)
                    }
                }
                .establish()
                ?: error(getString(com.flowproxy.vpn.service.R.string.vpn_interface_rejected))

            tunnel = descriptor
            lastFailure = null
            ProxyRuntimeState.setVpnService(VpnServiceState.RUNNING)
            updateNotification(
                getString(com.flowproxy.vpn.service.R.string.notification_ready_no_core),
            )
        } catch (error: SecurityException) {
            failStart(error)
        } catch (error: IllegalArgumentException) {
            failStart(error)
        } catch (error: IllegalStateException) {
            failStart(error)
        } catch (error: IOException) {
            failStart(error)
        }
    }

    private fun stopTunnel() {
        ProxyRuntimeState.setVpnService(VpnServiceState.STOPPING)
        closeTunnel()
        ProxyRuntimeState.setVpnService(VpnServiceState.STOPPED)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopIfUnused(startId: Int) {
        if (tunnel != null) return
        ProxyRuntimeState.setVpnService(VpnServiceState.STOPPED)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    private fun failStart(error: Exception) {
        lastFailure = error.message ?: error::class.java.simpleName
        closeTunnel()
        ProxyRuntimeState.setVpnService(VpnServiceState.ERROR)
        updateNotification("VPN failed: $lastFailure")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun closeTunnel() {
        val descriptor = tunnel ?: return
        tunnel = null
        try {
            descriptor.close()
        } catch (_: IOException) {
            // The descriptor is already unusable; no recovery is possible here.
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService<NotificationManager>() ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "FlowProxy VPN",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "VPN session and proxy core status"
                setShowBadge(false)
            },
        )
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService<NotificationManager>() ?: return
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, FlowProxyVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(com.flowproxy.vpn.service.R.drawable.ic_flowproxy_notification)
            .setContentTitle(getString(com.flowproxy.vpn.service.R.string.notification_title))
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, getString(com.flowproxy.vpn.service.R.string.notification_stop), stopIntent)
            .build()
    }

    companion object {
        const val ACTION_START = VPN_SERVICE_ACTION_START
        const val ACTION_STOP = VPN_SERVICE_ACTION_STOP

        private const val CHANNEL_ID = "flowproxy_vpn"
        private const val NOTIFICATION_ID = 4105
        private const val MTU = 1500
        private const val TUN_ADDRESS = "10.111.0.2"
        private const val TUN_PREFIX = 32

        fun start(context: Context) {
            val intent = Intent(context, FlowProxyVpnService::class.java)
                .setAction(ACTION_START)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, FlowProxyVpnService::class.java)
                .setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
