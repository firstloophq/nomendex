import Cocoa
import WebKit

class WebViewWindowController: NSWindowController, WKNavigationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var titleBarDragMonitor: Any?
    private let titleBarHeight: CGFloat = 52
    private let sidebarWidth: CGFloat = 240  // Only allow window drag from sidebar area
    
    override func keyDown(with event: NSEvent) {
        // Handle Cmd+K to open command palette
        // Note: Cmd+Enter is handled via local event monitor in AppDelegate
        if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "k" {
            let script = """
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                ctrlKey: false,
                bubbles: true,
                cancelable: true
            }));
            """
            webView.evaluateJavaScript(script) { _, _ in }
            return
        }

        super.keyDown(with: event)
    }

    init(url: URL) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 740),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.center()
        window.title = "Nomendex"
        window.isReleasedWhenClosed = false

        // Obsidian-style title bar: transparent with content extending behind
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        window.isMovableByWindowBackground = true
        window.titleVisibility = .hidden

        // Set initial dark background to prevent white flash
        window.backgroundColor = NSColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 1.0)

        super.init(window: window)
        
        // Set window delegate to handle keyboard shortcuts
        window.delegate = self

        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(self, name: "chooseDataRoot")
        userContentController.add(self, name: "setNativeTheme")
        userContentController.add(self, name: "triggerAppUpdate")
        userContentController.add(self, name: "checkForUpdatesInBackground")
        config.userContentController = userContentController
        config.preferences.javaScriptEnabled = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        // Enable Web Inspector for debugging (macOS 13.3+)
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        
        // Allow the window to become first responder for keyboard events
        window.makeFirstResponder(nil)
        window.acceptsMouseMovedEvents = true

        self.webView = webView
        self.window?.contentView = webView

        // Set up local event monitor for title bar dragging
        setupTitleBarDragMonitor()

        load(url: url)
    }

    private func setupTitleBarDragMonitor() {
        var mouseDownEvent: NSEvent?
        var mouseDownLocation: NSPoint?

        titleBarDragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] event in
            guard let self = self,
                  let window = self.window,
                  let contentView = window.contentView,
                  window.isKeyWindow else {
                return event
            }

            let locationInWindow = event.locationInWindow
            let windowHeight = contentView.bounds.height
            let isInTitleBar = locationInWindow.y > windowHeight - self.titleBarHeight
            // Only allow window drag from the sidebar area (left side), not the tabs area
            let isInSidebarArea = locationInWindow.x < self.sidebarWidth

            switch event.type {
            case .leftMouseDown:
                if isInTitleBar && isInSidebarArea {
                    mouseDownEvent = event
                    mouseDownLocation = NSEvent.mouseLocation
                }
                return event // Let the click through initially

            case .leftMouseDragged:
                if let downEvent = mouseDownEvent,
                   let startLocation = mouseDownLocation {
                    let currentLocation = NSEvent.mouseLocation
                    let dx = abs(currentLocation.x - startLocation.x)
                    let dy = abs(currentLocation.y - startLocation.y)

                    // Start native drag if moved more than 3 pixels
                    if dx > 3 || dy > 3 {
                        mouseDownEvent = nil
                        mouseDownLocation = nil
                        // Use native window dragging - this blocks until drag completes
                        window.performDrag(with: downEvent)
                        return nil
                    }
                }
                return event

            case .leftMouseUp:
                mouseDownEvent = nil
                mouseDownLocation = nil
                return event

            default:
                return event
            }
        }
    }

    deinit {
        if let monitor = titleBarDragMonitor {
            NSEvent.removeMonitor(monitor)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func load(url: URL) {
        log("Loading URL:", url.absoluteString)
        webView.load(URLRequest(url: url))
    }

    func show() {
        self.window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        
        // Focus the command palette input when showing via hotkey
        let script = """
        setTimeout(() => {
            // Try to open command palette and focus input
            if (window.dispatchEvent) {
                window.dispatchEvent(new KeyboardEvent('keydown', { 
                    key: 'k', 
                    metaKey: true, 
                    ctrlKey: false,
                    bubbles: true,
                    cancelable: true 
                }));
            }
        }, 100);
        """
        webView.evaluateJavaScript(script) { result, error in
            if let error = error {
                log("Error focusing input: \(error)")
            } else {
                log("Successfully triggered command palette focus")
            }
        }
    }

    func toggle() {
        if let window = self.window {
            if window.isVisible { window.orderOut(nil) } else { show() }
        }
    }
    
    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "chooseDataRoot" {
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Choose"
            panel.title = "Select Data Root Folder"
            if panel.runModal() == .OK, let url = panel.url {
                let path = url.path
                let js = "window.__setDataRoot && window.__setDataRoot('" + path.replacingOccurrences(of: "'", with: "\\'") + "')"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        } else if message.name == "setNativeTheme" {
            guard let themeData = message.body as? [String: Any],
                  let backgroundColor = themeData["backgroundColor"] as? String else { return }

            // Parse hex color and apply to window
            if let color = NSColor(hex: backgroundColor) {
                window?.backgroundColor = color

                // Determine if theme is dark based on luminance
                let isDark = color.isDark
                window?.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)

                log("Theme updated: backgroundColor=\(backgroundColor), isDark=\(isDark)")
            }
        } else if message.name == "triggerAppUpdate" {
            // Trigger Sparkle update UI via AppDelegate
            if let appDelegate = NSApplication.shared.delegate as? AppDelegate {
                appDelegate.triggerAppUpdate()
            }
        } else if message.name == "checkForUpdatesInBackground" {
            // Check for updates silently in background
            if let appDelegate = NSApplication.shared.delegate as? AppDelegate {
                appDelegate.checkForUpdatesInBackground()
            }
        }
    }
    
    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Allow navigation to localhost (the app itself)
        if url.host == "localhost" || url.host == "127.0.0.1" {
            decisionHandler(.allow)
            return
        }

        // Open external links in the system browser
        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Allow window to close with Cmd+W
        return true
    }
}

// MARK: - NSColor Extensions for Theme Support
extension NSColor {
    /// Initialize NSColor from a hex string (e.g., "#1a1a1a" or "1a1a1a")
    convenience init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }

        let length = hexSanitized.count
        if length == 6 {
            let r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
            let g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
            let b = CGFloat(rgb & 0x0000FF) / 255.0
            self.init(red: r, green: g, blue: b, alpha: 1.0)
        } else if length == 8 {
            let r = CGFloat((rgb & 0xFF000000) >> 24) / 255.0
            let g = CGFloat((rgb & 0x00FF0000) >> 16) / 255.0
            let b = CGFloat((rgb & 0x0000FF00) >> 8) / 255.0
            let a = CGFloat(rgb & 0x000000FF) / 255.0
            self.init(red: r, green: g, blue: b, alpha: a)
        } else {
            return nil
        }
    }

    /// Returns true if the color is considered "dark" based on relative luminance
    var isDark: Bool {
        guard let rgb = usingColorSpace(.sRGB) else { return true }
        let r = rgb.redComponent
        let g = rgb.greenComponent
        let b = rgb.blueComponent
        // Relative luminance formula (ITU-R BT.709)
        let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return luminance < 0.5
    }
}

