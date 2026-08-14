package pl.szponciciel.aiexecutor

import android.app.Activity
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val input = findViewById<EditText>(R.id.appNameInput)
        val button = findViewById<Button>(R.id.executeButton)
        val status = findViewById<TextView>(R.id.statusText)

        button.setOnClickListener {
            val query = input.text.toString().trim()
            if (query.isBlank()) {
                status.text = "Podaj nazwę aplikacji."
                return@setOnClickListener
            }

            val match = findLaunchableApp(query)
            if (match == null) {
                status.text = "Nie znalazłem aplikacji: $query"
                return@setOnClickListener
            }

            val appLabel = match.loadLabel(packageManager).toString()
            val launchIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                setClassName(match.activityInfo.packageName, match.activityInfo.name)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            status.text = "Uruchamiam: $appLabel"
            startActivity(launchIntent)
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
