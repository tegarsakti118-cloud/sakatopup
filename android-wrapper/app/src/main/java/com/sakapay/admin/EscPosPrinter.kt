package com.sakapay.admin

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.UUID

class EscPosPrinter(private val context: Context) {

    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private const val PREFS_NAME = "sakapay_printer_prefs"
        private const val KEY_MAC = "printer_mac"
        private const val KEY_NAME = "printer_name"
    }

    private val lock = Any()
    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    private var connectedMac: String = ""
    private var connectedName: String = ""

    private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun getAdapter(): BluetoothAdapter? {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter
    }

    fun hasConnectPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    @SuppressLint("MissingPermission")
    fun getStatusJson(): JSONObject {
        synchronized(lock) {
            val isConn = socket?.isConnected == true && outputStream != null
            val savedMac = prefs().getString(KEY_MAC, "") ?: ""
            val savedName = prefs().getString(KEY_NAME, "") ?: ""
            return JSONObject().apply {
                put("connected", isConn)
                put("macAddress", if (isConn) connectedMac else savedMac)
                put("printerName", if (isConn) connectedName else savedName)
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun listPairedPrinters(): JSONObject {
        if (!hasConnectPermission()) {
            return JSONObject().apply {
                put("ok", false)
                put("needsPermission", true)
                put("error", "Izin Bluetooth belum diberikan. Silakan izinkan lalu tekan Scan lagi.")
            }
        }
        val adapter = getAdapter() ?: return JSONObject().apply {
            put("ok", false)
            put("error", "Perangkat ini tidak mendukung Bluetooth.")
        }
        if (!adapter.isEnabled) {
            return JSONObject().apply {
                put("ok", false)
                put("error", "Bluetooth HP belum aktif. Nyalakan Bluetooth terlebih dahulu.")
            }
        }

        val arr = JSONArray()
        val bonded: Set<BluetoothDevice> = adapter.bondedDevices ?: emptySet()
        for (dev in bonded) {
            arr.put(JSONObject().apply {
                put("name", dev.name ?: "Bluetooth Device")
                put("address", dev.address ?: "")
            })
        }

        return JSONObject().apply {
            put("ok", true)
            put("devices", arr)
        }
    }

    @SuppressLint("MissingPermission")
    fun connect(macAddress: String): JSONObject {
        synchronized(lock) {
            if (!hasConnectPermission()) {
                return JSONObject().apply {
                    put("ok", false)
                    put("error", "Izin Bluetooth belum diberikan.")
                }
            }
            val adapter = getAdapter() ?: return JSONObject().apply {
                put("ok", false)
                put("error", "Bluetooth tidak tersedia.")
            }
            if (!adapter.isEnabled) {
                return JSONObject().apply {
                    put("ok", false)
                    put("error", "Nyalakan Bluetooth HP terlebih dahulu.")
                }
            }

            closeSocketInternal()

            return try {
                val device = adapter.getRemoteDevice(macAddress)
                if (adapter.isDiscovering) adapter.cancelDiscovery()

                var sock: BluetoothSocket? = null
                try {
                    sock = device.createRfcommSocketToServiceRecord(SPP_UUID)
                    sock.connect()
                } catch (primaryErr: Exception) {
                    try { sock?.close() } catch (_: Exception) {}
                    // Fallback untuk printer thermal 58mm tertentu
                    val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                    sock = m.invoke(device, 1) as BluetoothSocket
                    sock.connect()
                }

                socket = sock
                outputStream = sock?.outputStream
                connectedMac = macAddress
                connectedName = device.name ?: "Printer 58mm"

                prefs().edit()
                    .putString(KEY_MAC, connectedMac)
                    .putString(KEY_NAME, connectedName)
                    .apply()

                JSONObject().apply {
                    put("ok", true)
                    put("printerName", connectedName)
                    put("macAddress", connectedMac)
                }
            } catch (e: Exception) {
                closeSocketInternal()
                JSONObject().apply {
                    put("ok", false)
                    put("error", "Gagal terhubung ke printer: ${e.message ?: "Pastikan printer menyala"}")
                }
            }
        }
    }

    fun printReceipt(payloadJson: String): JSONObject {
        synchronized(lock) {
            return try {
                val data = JSONObject(payloadJson)
                val text = data.optString("text", "")
                val fontSize = data.optString("fontSize", "normal")
                val feedLines = data.optInt("feedLines", 3).coerceIn(1, 8)
                val printLogo = data.optBoolean("printLogo", true)
                val autoCut = data.optBoolean("autoCut", false)

                if (socket?.isConnected != true || outputStream == null) {
                    val savedMac = prefs().getString(KEY_MAC, "") ?: ""
                    if (savedMac.isBlank()) {
                        return JSONObject().apply {
                            put("ok", false)
                            put("error", "Printer belum terhubung. Pilih printer di Pengaturan.")
                        }
                    }
                    val reconn = connect(savedMac)
                    if (!reconn.optBoolean("ok", false)) {
                        return reconn
                    }
                }

                val out = outputStream ?: return JSONObject().apply {
                    put("ok", false)
                    put("error", "Stream output printer tidak tersedia.")
                }

                val buf = ByteArrayOutputStream()
                // ESC @ (Reset printer)
                buf.write(byteArrayOf(0x1B, 0x40))

                // Logo monokrom SakaPay (GS v 0)
                if (printLogo) {
                    buf.write(byteArrayOf(0x1B, 0x61, 0x01)) // Center
                    buf.write(buildSakaPayLogoEscPos())
                    buf.write(byteArrayOf(0x0A))
                }

                // Alignment kiri + Pilih Font A (32 col) / Font B (42 col)
                buf.write(byteArrayOf(0x1B, 0x61, 0x00))
                if (fontSize == "small") {
                    buf.write(byteArrayOf(0x1B, 0x4D, 0x01))
                } else {
                    buf.write(byteArrayOf(0x1B, 0x4D, 0x00))
                }

                val lines = text.split("\n")
                for (rawLine in lines) {
                    val cleanLine = sanitizeAscii(rawLine)
                    val trimmed = cleanLine.trim()
                    val isHighlight = trimmed.startsWith("TOTAL") ||
                        trimmed.startsWith("HARGA JUAL") ||
                        trimmed.startsWith("STATUS")

                    if (isHighlight) {
                        buf.write(byteArrayOf(0x1B, 0x45, 0x01)) // Bold ON
                    }
                    buf.write(cleanLine.toByteArray(Charsets.US_ASCII))
                    buf.write(0x0A)
                    if (isHighlight) {
                        buf.write(byteArrayOf(0x1B, 0x45, 0x00)) // Bold OFF
                    }
                }

                // Spasi kertas bawah
                repeat(feedLines) { buf.write(0x0A) }

                // Potong kertas otomatis (bila printer mendukung)
                if (autoCut) {
                    buf.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00))
                }

                out.write(buf.toByteArray())
                out.flush()

                JSONObject().apply { put("ok", true) }
            } catch (e: Exception) {
                closeSocketInternal()
                JSONObject().apply {
                    put("ok", false)
                    put("error", "Gagal mencetak: ${e.message ?: "Koneksi printer terputus"}")
                }
            }
        }
    }

    private fun sanitizeAscii(input: String): String {
        return input
            .replace("•", "-")
            .replace("—", "-")
            .replace("–", "-")
            .replace("→", "->")
            .replace("“", "\"")
            .replace("”", "\"")
            .replace("’", "'")
            .replace(Regex("[^\\x20-\\x7E]"), " ")
    }

    private fun buildSakaPayLogoEscPos(): ByteArray {
        val width = 256
        val height = 52
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.BLACK
        paint.style = Paint.Style.FILL
        canvas.drawRoundRect(RectF(28f, 4f, 228f, 48f), 12f, 12f, paint)

        // Ikon petir putih di kiri badge
        paint.color = Color.WHITE
        val bolt = Path().apply {
            moveTo(60f, 11f)
            lineTo(47f, 28f)
            lineTo(56f, 28f)
            lineTo(53f, 41f)
            lineTo(68f, 23f)
            lineTo(58f, 23f)
            close()
        }
        canvas.drawPath(bolt, paint)

        // Teks SAKAPAY putih tebal
        paint.textSize = 26f
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        canvas.drawText("SAKAPAY", 78f, 35f, paint)

        val bytesPerRow = width / 8
        val out = ByteArrayOutputStream()
        out.write(
            byteArrayOf(
                0x1D, 0x76, 0x30, 0x00,
                (bytesPerRow and 0xFF).toByte(),
                ((bytesPerRow shr 8) and 0xFF).toByte(),
                (height and 0xFF).toByte(),
                ((height shr 8) and 0xFF).toByte()
            )
        )

        for (y in 0 until height) {
            for (bx in 0 until bytesPerRow) {
                var b = 0
                for (bit in 0 until 8) {
                    val px = bmp.getPixel(bx * 8 + bit, y)
                    val lum = (Color.red(px) + Color.green(px) + Color.blue(px)) / 3
                    if (lum < 160) {
                        b = b or (1 shl (7 - bit))
                    }
                }
                out.write(b)
            }
        }
        bmp.recycle()
        return out.toByteArray()
    }

    private fun closeSocketInternal() {
        try { outputStream?.close() } catch (_: Exception) {}
        try { socket?.close() } catch (_: Exception) {}
        outputStream = null
        socket = null
    }

    fun close() {
        synchronized(lock) {
            closeSocketInternal()
        }
    }
}
