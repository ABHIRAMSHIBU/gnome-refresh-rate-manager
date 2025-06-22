UUID = refreshprofile@abhiram.tuxforums.com
EXTENSION_DIR = ~/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js metadata.json stylesheet.css README.md

.PHONY: install uninstall clean test enable disable

# Install the extension
install:
	@echo "Installing Refresh Profile extension..."
	@mkdir -p $(EXTENSION_DIR)
	@cp $(FILES) $(EXTENSION_DIR)/
	@echo "Extension installed to $(EXTENSION_DIR)"
	@echo "Restart GNOME Shell (Alt+F2, then type 'r' and press Enter) or log out and log back in"
	@echo "Then enable the extension in GNOME Extensions app"

# Uninstall the extension
uninstall:
	@echo "Uninstalling Refresh Profile extension..."
	@rm -rf $(EXTENSION_DIR)
	@echo "Extension uninstalled"

# Clean build artifacts (if any)
clean:
	@echo "Cleaning up..."
	@rm -f *.log

# Test the extension in nested GNOME Shell
test:
	@echo "Starting nested GNOME Shell for testing..."
	@echo "This will open a new window - enable the extension in the nested session"
	dbus-run-session -- gnome-shell --nested --wayland

# Enable the extension
enable:
	@echo "Enabling Refresh Profile extension..."
	@gnome-extensions enable $(UUID)
	@echo "Extension enabled"

# Disable the extension
disable:
	@echo "Disabling Refresh Profile extension..."
	@gnome-extensions disable $(UUID)
	@echo "Extension disabled"

# Show extension status
status:
	@echo "Extension status:"
	@gnome-extensions info $(UUID)

# Show logs
logs:
	@echo "Showing GNOME Shell logs (press Ctrl+C to exit):"
	@journalctl -f -o cat /usr/bin/gnome-shell

# Development mode - watch for changes and restart
dev:
	@echo "Development mode - watching for file changes..."
	@echo "Make sure to restart GNOME Shell after changes"
	@while inotifywait -e modify $(FILES); do \
		echo "Files changed, run 'make install' to update"; \
	done 