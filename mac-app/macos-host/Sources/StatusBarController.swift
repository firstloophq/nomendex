import Cocoa

class StatusBarController {
    private var statusItem: NSStatusItem!
    private let onToggle: () -> Void
    private let onQuit: () -> Void

    init(onToggle: @escaping () -> Void, onQuit: @escaping () -> Void) {
        self.onToggle = onToggle
        self.onQuit = onQuit
        log("StatusBarController: initializing...")
        setup()
    }

    private func setup() {
        log("StatusBarController: setting up status item...")
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem.button {
            // Use simple dot icon
            button.title = "●"
            button.font = NSFont.systemFont(ofSize: 14, weight: .medium)
            button.action = #selector(toggleWindow)
            button.target = self
            log("StatusBarController: status item button configured with dot")
        } else {
            log("StatusBarController: ERROR - could not get status item button!")
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "M - Open Nomendex", action: #selector(toggleWindow), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Nomendex", action: #selector(quitApp), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }

    @objc private func toggleWindow() { onToggle() }
    @objc private func quitApp() { onQuit() }
}

