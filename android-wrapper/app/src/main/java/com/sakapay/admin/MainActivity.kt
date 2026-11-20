package com.sakapay.admin

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var printer: EscPosPrinter
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastBackPressedMs: Long = 0L

    private val allowedHost = "sakatopup.tegarsakti118.workers.dev"

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris: Array<Uri>? = if (result.resultCode == RESULT_OK && result.data != null) {
            val data = result.data!!
            when {
                data.clipData != null -> Array(data.clipData!!.itemCount) { i ->
                    data.clipData!!.getItemAt(i).uri
                }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else null
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    private val bluetoothPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val granted = grants.values.all { it }
        val msg = if (granted) "Izin Bluetooth aktif. Silakan tekan Scan lagi." else "Izin Bluetooth ditolak."
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        printer = EscPosPrinter(applicationContext)
        webView = WebView(this)
        setContentView(webView)

        val ws = webView.settings
        ws.javaScriptEnabled = true
        ws.domStorageEnabled = true
        ws.databaseEnabled = true
        ws.allowContentAccess = true
        ws.allowFileAccess = false
        ws.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        ws.cacheMode = WebSettings.LOAD_DEFAULT
        ws.userAgentString = "${ws.userAgentString} SakaPayAdminAPK/1.0"

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(AndroidBridge(), "SakaPayAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val host = uri.host?.lowercase() ?: ""
                if (host == allowedHost && uri.scheme == "https") {
                    return false
                }
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Tidak dapat membuka tautan.", Toast.LENGTH_SHORT).show()
                    true
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    val html = """
                        <!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:48px 24px;background:#f8fafc;color:#0f172a;">
                        <h2 style="color:#17A897;margin-bottom:8px;">Koneksi Terputus</h2>
                        <p style="font-size:14px;color:#475569;margin-bottom:24px;">Pastikan internet HP aktif untuk memuat SakaPay Admin.</p>
                        <button onclick="location.href='${getString(R.string.app_url)}'" style="background:#17A897;color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:bold;font-size:14px;">Coba Lagi</button>
                        </body></html>
                    """.trimIndent()
                    view?.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }
                return try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Pilih Gambar"))
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    val now = System.currentTimeMillis()
                    if (now - lastBackPressedMs < 2000L) {
                        finish()
                    } else {
                        lastBackPressedMs = now
                        Toast.makeText(this@MainActivity, "Tekan kembali sekali lagi untuk keluar", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })

        webView.loadUrl(getString(R.string.app_url))
    }

    override fun onDestroy() {
        printer.close()
        super.onDestroy()
    }

    private fun requestBluetoothPermissionsIfNeeded() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }
        if (needed.isNotEmpty()) {
            runOnUiThread {
                bluetoothPermLauncher.launch(needed.toTypedArray())
            }
        }
    }

    private fun saveToDownloads(fileName: String, mimeType: String, bytes: ByteArray) {
        val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/SakaPay")
            }
            val resolver = contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Gagal membuat file di Downloads.")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("Gagal menulis file.")
        } else {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "SakaPay"
            )
            if (!dir.exists()) dir.mkdirs()
            FileOutputStream(File(dir, safeName)).use { it.write(bytes) }
        }
    }

    inner class AndroidBridge {

        @JavascriptInterface
        fun getPrinterStatus(): String {
            return printer.getStatusJson().toString()
        }

        @JavascriptInterface
        fun scanBluetoothPrinters(): String {
            val res = printer.listPairedPrinters()
            if (res.optBoolean("needsPermission", false)) {
                requestBluetoothPermissionsIfNeeded()
            }
            return res.toString()
        }

        @JavascriptInterface
        fun connectPrinter(macAddress: String): String {
            return printer.connect(macAddress).toString()
        }

        @JavascriptInterface
        fun printThermal(jsonPayload: String): String {
            return printer.printReceipt(jsonPayload).toString()
        }

        @JavascriptInterface
        fun saveReceiptPdf(jsonPayload: String): String {
            return try {
                val obj = JSONObject(jsonPayload)
                val invoice = obj.optString("invoiceCode", "struk-${System.currentTimeMillis()}")
                val b64 = obj.optString("imageBase64", "").substringAfter("base64,", "")
                val imgBytes = Base64.decode(b64, Base64.DEFAULT)
                val bmp = BitmapFactory.decodeStream(ByteArrayInputStream(imgBytes))
                    ?: throw IllegalArgumentException("Gambar struk tidak valid.")

                val doc = PdfDocument()
                val pad = 24
                val pageInfo = PdfDocument.PageInfo.Builder(bmp.width + pad * 2, bmp.height + pad * 2, 1).create()
                val page = doc.startPage(pageInfo)
                val canvas: Canvas = page.canvas
                canvas.drawColor(Color.WHITE)
                canvas.drawBitmap(bmp, pad.toFloat(), pad.toFloat(), null)
                doc.finishPage(page)

                val pdfOut = java.io.ByteArrayOutputStream()
                doc.writeTo(pdfOut)
                doc.close()
                bmp.recycle()

                saveToDownloads("$invoice.pdf", "application/pdf", pdfOut.toByteArray())
                JSONObject().apply { put("ok", true) }.toString()
            } catch (e: Exception) {
                JSONObject().apply {
                    put("ok", false)
                    put("error", e.message ?: "Gagal menyimpan PDF.")
                }.toString()
            }
        }

        @JavascriptInterface
        fun shareReceiptWhatsApp(jsonPayload: String): String {
            return try {
                val obj = JSONObject(jsonPayload)
                val invoice = obj.optString("invoiceCode", "struk")
                val text = obj.optString("text", "")
                val b64 = obj.optString("imageBase64", "").substringAfter("base64,", "")
                val imgBytes = Base64.decode(b64, Base64.DEFAULT)

                val cacheSubdir = File(cacheDir, "receipts")
                if (!cacheSubdir.exists()) cacheSubdir.mkdirs()
                val outFile = File(cacheSubdir, "${invoice.replace(Regex("[^a-zA-Z0-9._-]"), "_")}.png")
                FileOutputStream(outFile).use { it.write(imgBytes) }

                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", outFile)

                runOnUiThread {
                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "image/png"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_TEXT, text)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    val pm = packageManager
                    val waPkg = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { pkg ->
                        try {
                            pm.getPackageInfo(pkg, 0)
                            true
                        } catch (_: Exception) {
                            false
                        }
                    }
                    if (waPkg != null) {
                        shareIntent.setPackage(waPkg)
                        startActivity(shareIntent)
                    } else {
                        startActivity(Intent.createChooser(shareIntent, "Bagikan Bukti Transaksi"))
                    }
                }

                JSONObject().apply { put("ok", true) }.toString()
            } catch (e: Exception) {
                JSONObject().apply {
                    put("ok", false)
                    put("error", e.message ?: "Gagal membagikan ke WhatsApp.")
                }.toString()
            }
        }

        @JavascriptInterface
        fun saveCsvFile(jsonPayload: String): String {
            return try {
                val obj = JSONObject(jsonPayload)
                val filename = obj.optString("filename", "sakapay-backup.csv")
                val content = obj.optString("content", "")
                saveToDownloads(filename, "text/csv", content.toByteArray(Charsets.UTF_8))
                JSONObject().apply { put("ok", true) }.toString()
            } catch (e: Exception) {
                JSONObject().apply {
                    put("ok", false)
                    put("error", e.message ?: "Gagal menyimpan CSV.")
                }.toString()
            }
        }
    }
}
