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

                // Logo monokrom (GS v 0): logo kustom dari web bila ada, jika tidak pakai logo bawaan SakaPay
                if (printLogo) {
                    buf.write(byteArrayOf(0x1B, 0x61, 0x01)) // Center
                    val customLogo = decodeCustomLogo(data.optString("logoImageBase64", ""))
                    if (customLogo != null) {
                        buf.write(bitmapToEscPosRaster(customLogo))
                        customLogo.recycle()
                    } else {
                        buf.write(buildSakaPayLogoEscPos())
                    }
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

    // Logo bawaan: koin + petir + teks SAKAPAY (monokrom)
    private fun buildSakaPayLogoEscPos(): ByteArray {
        val width = 256
        val height = 56
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.BLACK

        // Koin: cincin tebal
        val cx = 54f
        val cy = 28f
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 5f
        canvas.drawCircle(cx, cy, 23f, paint)

        // Petir di dalam koin
        paint.style = Paint.Style.FILL
        val s = 0.8f
        val pts = arrayOf(58f to 34f, 42f to 57f, 52f to 57f, 48f to 75f, 67f to 50f, 57f to 50f)
        val bolt = Path()
        pts.forEachIndexed { i, (px, py) ->
            val x = cx + (px - 54.5f) * s
            val y = cy + (py - 54.5f) * s
            if (i == 0) bolt.moveTo(x, y) else bolt.lineTo(x, y)
        }
        bolt.close()
        canvas.drawPath(bolt, paint)

        // Teks SAKAPAY
        paint.textSize = 30f
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        canvas.drawText("SAKAPAY", 90f, 39f, paint)

        val out = bitmapToEscPosRaster(bmp)
        bmp.recycle()
        return out
    }

    // Decode logo kustom (data URL PNG dari web). null bila kosong / tidak valid.
    private fun decodeCustomLogo(dataUrl: String): Bitmap? {
        if (dataUrl.isBlank()) return null
        return try {
            val b64 = dataUrl.substringAfter("base64,", dataUrl)
            val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            val raw = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            val scale = minOf(1f, 384f / raw.width, 200f / raw.height)
            if (scale < 1f) {
                val scaled = Bitmap.createScaledBitmap(
                    raw,
                    (raw.width * scale).toInt().coerceAtLeast(1),
                    (raw.height * scale).toInt().coerceAtLeast(1),
                    true
                )
                raw.recycle()
                scaled
            } else {
                raw
            }
        } catch (_: Exception) {
            null
        }
    }

    // Bitmap -> perintah raster ESC/POS (GS v 0). Piksel gelap = titik tercetak.
    private fun bitmapToEscPosRaster(src: Bitmap): ByteArray {
        val width = ((src.width + 7) / 8) * 8
        val height = src.height
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
                    val x = bx * 8 + bit
                    if (x < src.width) {
                        val px = src.getPixel(x, y)
                        if (Color.alpha(px) >= 128) {
                            val lum = (Color.red(px) + Color.green(px) + Color.blue(px)) / 3
                            if (lum < 160) {
                                b = b or (1 shl (7 - bit))
                            }
                        }
                    }
                }
                out.write(b)
            }
        }
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
