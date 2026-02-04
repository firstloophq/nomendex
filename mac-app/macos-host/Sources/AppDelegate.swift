import Cocoa
import WebKit
import Sparkle

class AppDelegate: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    private var windowController: WebViewWindowController?
    private var statusBar: StatusBarController?
    private var hotKey: GlobalHotKey?
    private var quickCaptureHotKey: GlobalHotKey?
    private let sidecar = SidecarLauncher()
    private var localEventMonitor: Any?
    private var updaterController: SPUStandardUpdaterController!
    private var logsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        log("App launching...")

        // Initialize Sparkle for auto-updates
        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )

        // Set up main menu with standard keyboard shortcuts
        setupMainMenu()

        if let devURL = ProcessInfo.processInfo.environment["BUN_DEV_SERVER_URL"], let url = URL(string: devURL) {
            // DEV mode: don’t launch sidecar, just load dev server
            log("DEV mode: using", devURL)
            self.windowController = WebViewWindowController(url: url)
            self.statusBar = StatusBarController(onToggle: { [weak self] in self?.windowController?.toggle() }, onQuit: { NSApp.terminate(nil) })
            self.windowController?.show()
        } else {
            sidecar.start(preferredPort: nil)
            sidecar.waitUntilReady { [weak self] ok in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    let url = self.sidecar.serverURL ?? URL(string: "http://127.0.0.1:17865")!
                    self.windowController = WebViewWindowController(url: url)
                    self.statusBar = StatusBarController(onToggle: { [weak self] in self?.windowController?.toggle() }, onQuit: { NSApp.terminate(nil) })
                    self.windowController?.show()
                }
            }
        }

        // Hyperkey + Space toggles window
        self.hotKey = GlobalHotKey(modifiers: .hyperKey, keyCode: 49 /* Space */, callback: { [weak self] in
            DispatchQueue.main.async { self?.windowController?.show() }
        })

        // Hyperkey + N opens Quick Capture
        self.quickCaptureHotKey = GlobalHotKey(modifiers: .hyperKey, keyCode: 45 /* N */, callback: { [weak self] in
            DispatchQueue.main.async { self?.triggerQuickCapture() }
        })

        // Local event monitor to intercept keyboard events before WebView handles them
        self.localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // Check for Cmd+Enter (keyCode 36 = Return/Enter)
            if event.modifierFlags.contains(.command) && event.keyCode == 36 {
                self?.dispatchKeyToWebView(key: "Enter", code: "Enter", metaKey: true)
                return nil // Consume the event
            }

            // Check for Ctrl+Tab / Ctrl+Shift+Tab (keyCode 48) - tab switching
            if event.modifierFlags.contains(.control) && event.keyCode == 48 {
                let shiftKey = event.modifierFlags.contains(.shift)
                log("Ctrl+Tab detected! shiftKey=\(shiftKey)")
                self?.dispatchKeyToWebView(key: "Tab", code: "Tab", ctrlKey: true, shiftKey: shiftKey)
                return nil // Consume the event
            }

            // Check for plain Tab (keyCode 48) - forward to WebView for focus navigation
            if event.keyCode == 48 && !event.modifierFlags.contains(.control) {
                let shiftKey = event.modifierFlags.contains(.shift)
                self?.dispatchKeyToWebView(key: "Tab", code: "Tab", shiftKey: shiftKey)
                return nil // Consume the event
            }

            return event // Pass through other events
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        windowController?.show()
        return true
    }

    /// Trigger Quick Capture dialog
    private func triggerQuickCapture() {
        // Make sure window is visible first
        windowController?.show()

        // Then trigger quick capture in the web view
        if let webView = windowController?.window?.contentView as? WKWebView {
            let script = "window.__nativeQuickCapture && window.__nativeQuickCapture();"
            webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    log("Error triggering quick capture: \(error)")
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
        }
        sidecar.stop()
    }

    private func dispatchKeyToWebView(key: String, code: String, metaKey: Bool = false, ctrlKey: Bool = false, shiftKey: Bool = false, altKey: Bool = false) {
        guard let windowController = self.windowController,
              let webView = windowController.window?.contentView as? WKWebView else {
            return
        }

        // For Cmd+Enter, dispatch custom nativeSubmit event (handled by ProseMirrorChatInput)
        if key == "Enter" && metaKey {
            let script = "window.dispatchEvent(new CustomEvent('nativeSubmit'));"
            webView.evaluateJavaScript(script) { _, _ in }
            return
        }

        // For Ctrl+Tab / Ctrl+Shift+Tab, use global tab switching helper
        if key == "Tab" && ctrlKey {
            log("dispatchKeyToWebView: Ctrl+Tab, shiftKey=\(shiftKey)")
            let script = shiftKey
                ? "console.log('Swift calling __nativePrevTab'); window.__nativePrevTab && window.__nativePrevTab();"
                : "console.log('Swift calling __nativeNextTab'); window.__nativeNextTab && window.__nativeNextTab();"
            webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    log("Error executing Ctrl+Tab script: \(error)")
                }
            }
            return
        }

        // For plain Tab, use the global focus navigation helper
        if key == "Tab" && !ctrlKey {
            let script = shiftKey ? "window.__nativeFocusPrevious && window.__nativeFocusPrevious();" : "window.__nativeFocusNext && window.__nativeFocusNext();"
            webView.evaluateJavaScript(script) { _, _ in }
            return
        }

        // For other keys, dispatch a standard KeyboardEvent
        let script = """
        (function() {
            var event = new KeyboardEvent('keydown', {
                key: '\(key)',
                code: '\(code)',
                metaKey: \(metaKey),
                ctrlKey: \(ctrlKey),
                shiftKey: \(shiftKey),
                altKey: \(altKey),
                bubbles: true,
                cancelable: true
            });
            document.activeElement.dispatchEvent(event);
        })();
        """
        webView.evaluateJavaScript(script) { _, _ in }
    }
    
    private func setupMainMenu() {
        let mainMenu = NSMenu()
        
        // App menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: "Nomendex")
        appMenuItem.submenu = appMenu

        appMenu.addItem(NSMenuItem(title: "About Nomendex", action: nil, keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())

        // Check for Updates menu item (Sparkle)
        let checkForUpdatesItem = NSMenuItem(
            title: "Check for Updates...",
            action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)),
            keyEquivalent: ""
        )
        checkForUpdatesItem.target = updaterController
        appMenu.addItem(checkForUpdatesItem)

        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "View Startup Logs...", action: #selector(showStartupLogs), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Nomendex", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        
        // Edit menu (for copy/paste)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: Selector(("cut:")), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: Selector(("copy:")), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: Selector(("paste:")), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a"))
        
        // View menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu
        
        viewMenu.addItem(NSMenuItem(title: "Command Palette", action: #selector(openCommandPalette), keyEquivalent: "k"))
        
        // Window menu
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        
        windowMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
        
        NSApplication.shared.mainMenu = mainMenu
    }
    
    @objc private func openCommandPalette() {
        // Send Cmd+K to the active window's web view
        if let windowController = self.windowController {
            let script = "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: false }));"
            if let webView = windowController.window?.contentView as? WKWebView {
                webView.evaluateJavaScript(script) { result, error in
                    if let error = error {
                        print("Error executing Command Palette script: \(error)")
                    }
                }
            }
        }
    }

    @objc private func showStartupLogs() {
        // If window already exists, just bring it to front and refresh content
        if let existingWindow = logsWindow {
            refreshLogsWindow(existingWindow)
            existingWindow.makeKeyAndOrderFront(nil)
            return
        }

        let logPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/com.firstloop.nomendex/logs.txt")

        var logContent = "No startup logs found."
        if FileManager.default.fileExists(atPath: logPath.path) {
            do {
                logContent = try String(contentsOf: logPath, encoding: .utf8)
                if logContent.isEmpty {
                    logContent = "Startup log file is empty."
                }
            } catch {
                logContent = "Error reading logs: \(error.localizedDescription)"
            }
        }

        // Create a simple window to display logs
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 700, height: 500),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Startup Logs"
        window.center()
        window.isReleasedWhenClosed = false

        let scrollView = NSScrollView(frame: window.contentView!.bounds)
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true

        let textView = NSTextView(frame: scrollView.bounds)
        textView.autoresizingMask = [.width, .height]
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.string = logContent
        textView.backgroundColor = NSColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 1.0)
        textView.textColor = NSColor.white

        scrollView.documentView = textView
        window.contentView = scrollView

        logsWindow = window
        window.makeKeyAndOrderFront(nil)
    }

    private func refreshLogsWindow(_ window: NSWindow) {
        let logPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/com.firstloop.nomendex/logs.txt")

        var logContent = "No startup logs found."
        if FileManager.default.fileExists(atPath: logPath.path) {
            do {
                logContent = try String(contentsOf: logPath, encoding: .utf8)
                if logContent.isEmpty {
                    logContent = "Startup log file is empty."
                }
            } catch {
                logContent = "Error reading logs: \(error.localizedDescription)"
            }
        }

        if let scrollView = window.contentView as? NSScrollView,
           let textView = scrollView.documentView as? NSTextView {
            textView.string = logContent
        }
    }

    // MARK: - Sparkle Updates

    /// Trigger the Sparkle update UI (shows dialog) - for manual checks
    func triggerAppUpdate() {
        log("Triggering update check (with UI)...")
        updaterController.checkForUpdates(nil)
    }

    /// Check for updates silently in background - called from web view polling
    func checkForUpdatesInBackground() {
        log("Checking for updates in background...")
        updaterController.updater.checkForUpdatesInBackground()
    }

    // MARK: - SPUUpdaterDelegate

    /// Called when Sparkle finds a valid update (from background check)
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        log("Update found: \(item.displayVersionString) - showing update dialog")
        // Show the Sparkle update UI
        DispatchQueue.main.async { [weak self] in
            self?.updaterController.checkForUpdates(nil)
        }
    }
}
