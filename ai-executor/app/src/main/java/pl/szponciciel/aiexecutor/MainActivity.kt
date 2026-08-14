package pl.szponciciel.aiexecutor

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var input: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        input = findViewById(R.id.appNameInput)
        val button = findViewById<Button>(R.id.executeButton)
        status = findViewById(R.id.statusText)

        button.setOnClickListener {
            executeApp(input.text.toString())
        }

        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        if (uri.scheme != "aiexecutor" || uri.host != "open") return

        val appName = uri.getQueryParameter("app").orEmpty().trim()
        if (appName.isBlank()) {
            status.text = "Brak parametru app."
            return
        }

        input.setText(appName)
        executeApp(appName)
    }

    private fun executeApp(rawQuery: String) {
        val query = rawQuery.trim()
        if (query.isBlank()) {
            status.text = "Podaj nazwę aplikacji."
            return
        }

        val match = findLaunchableApp(query)
        if (match == null) {
            status.text = "Nie znalazłem aplikacji: $query"
            return
        }

        val appLabel = match.loadLabel(packageManager).toString()
        val launchIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            setClassName(match.activityInfo.packageName, match.activityInfo.name)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        status.text = "Uruchamiam: $appLabel"
        try {
            startActivity(launchIntent)
        } catch (e: ActivityNotFoundException) {
            status.text = "Nie mogę uruchomić: $appLabel"
        } catch (e: SecurityException) {
            status.text = "Android zablokował uruchomienie: $appLabel"
        }
    }

    private fun findLaunchableApp(query: String): ResolveInfo? {
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }

        val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                launcherIntent,
                PackageManager.ResolveInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(launcherIntent, 0)
        }

        val needle = query.lowercase(Locale.ROOT)
        val labeled = apps.map { app ->
            app to app.loadLabel(packageManager).toString().lowercase(Locale.ROOT)
        }

        return labeled.firstOrNull { (_, label) -> label == needle }?.first
            ?: labeled.firstOrNull { (_, label) -> label.startsWith(needle) }?.first
            ?: labeled.firstOrNull { (_, label) -> label.contains(needle) }?.first
            ?: labeled.firstOrNull { (app, _) ->
                app.activityInfo.packageName.lowercase(Locale.ROOT).contains(needle)
            }?.first
    }
}
