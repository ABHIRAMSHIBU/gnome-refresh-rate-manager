/* extension.js - Non-blocking Refresh Profile Extension
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const RefreshProfileIndicator = GObject.registerClass(
class RefreshProfileIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Refresh Profile'));

        // Create icon
        this._icon = new St.Icon({
            icon_name: 'display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // State variables
        this._currentMode = 'unknown';
        this._isOnBattery = true; // Start with battery assumption for safety
        this._powerCheckInterval = null;
        this._isOperating = false;

        // Create menu
        this._createMenuItems();

        // Start lightweight monitoring
        this._startMonitoring();
        
        log('RefreshProfile: Initialized with non-blocking approach');
        
        // Immediate power check for faster feedback
        GLib.timeout_add(GLib.PRIORITY_HIGH, 50, () => {
            this._checkPowerAsync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _createMenuItems() {
        // Status
        this._statusItem = new PopupMenu.PopupMenuItem('Status: Ready', {
            reactive: false,
            style_class: 'popup-menu-item'
        });
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Manual controls
        this._highItem = new PopupMenu.PopupMenuItem('⚡ High Performance Mode');
        this._highItem.connect('activate', () => {
            if (!this._isOperating) {
                this._setMode('high');
            }
        });
        this.menu.addMenuItem(this._highItem);

        this._lowItem = new PopupMenu.PopupMenuItem('🔋 Battery Save Mode');
        this._lowItem.connect('activate', () => {
            if (!this._isOperating) {
                this._setMode('low');
            }
        });
        this.menu.addMenuItem(this._lowItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Power info
        this._powerItem = new PopupMenu.PopupMenuItem('Power: Detecting...', {
            reactive: false
        });
        this.menu.addMenuItem(this._powerItem);

        // Info
        this._infoItem = new PopupMenu.PopupMenuItem('Refresh Profile Manager', {
            reactive: false,
            style_class: 'popup-menu-item'
        });
        this.menu.addMenuItem(this._infoItem);
    }

    _startMonitoring() {
        // Use simple timer-based monitoring to avoid blocking D-Bus calls
        this._powerCheckInterval = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
            this._checkPowerAsync();
            return GLib.SOURCE_CONTINUE;
        });

        // Initial check
        GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
            this._checkPowerAsync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _checkPowerAsync() {
        try {
            // Use direct file reading instead of subprocess for better reliability
            let acOnline = 0;
            let batStatus = 'Unknown';
            
            // Check AC power supply
            try {
                let acFile = Gio.File.new_for_path('/sys/class/power_supply/AC/online');
                let [success, contents] = acFile.load_contents(null);
                if (success) {
                    acOnline = parseInt(new TextDecoder().decode(contents).trim());
                }
            } catch (e) {
                log(`RefreshProfile: AC check error: ${e.message}`);
            }
            
            // Check battery status
            try {
                let batFile = Gio.File.new_for_path('/sys/class/power_supply/BAT0/status');
                let [success, contents] = batFile.load_contents(null);
                if (success) {
                    batStatus = new TextDecoder().decode(contents).trim();
                }
            } catch (e) {
                log(`RefreshProfile: Battery check error: ${e.message}`);
            }
            
            // Determine power state
            let isPlugged = acOnline === 1 || batStatus === 'Charging' || batStatus === 'Full';
            let wasOnBattery = this._isOnBattery;
            this._isOnBattery = !isPlugged;
            
            // Log for debugging
            log(`RefreshProfile: AC=${acOnline}, Battery=${batStatus}, OnBattery=${this._isOnBattery}`);
            
            // Update UI
            this._updatePowerDisplay();
            
            // Auto-switch mode if power state changed
            if (wasOnBattery !== this._isOnBattery) {
                log(`RefreshProfile: Power changed - Battery: ${this._isOnBattery}`);
                this._autoSwitchMode();
            }
            
        } catch (e) {
            log(`RefreshProfile: Power monitoring error: ${e.message}`);
            this._fallbackPowerCheck();
        }
    }

    _fallbackPowerCheck() {
        // Fallback: try simple file read approach
        try {
            let acFile = Gio.File.new_for_path('/sys/class/power_supply/AC/online');
            let [success, contents] = acFile.load_contents(null);
            if (success) {
                let acOnline = parseInt(new TextDecoder().decode(contents).trim());
                this._isOnBattery = acOnline !== 1;
                log(`RefreshProfile: Fallback check - AC: ${acOnline}, OnBattery: ${this._isOnBattery}`);
            } else {
                // If we really can't detect, assume battery for safety
                this._isOnBattery = true;
                log('RefreshProfile: Cannot detect power, assuming battery mode for safety');
            }
        } catch (e) {
            // Default to battery mode for safety
            this._isOnBattery = true;
            log(`RefreshProfile: Fallback error: ${e.message}, assuming battery mode`);
        }
        this._updatePowerDisplay();
    }

    _autoSwitchMode() {
        if (this._isOnBattery && this._currentMode !== 'low') {
            this._setMode('low');
        } else if (!this._isOnBattery && this._currentMode !== 'high') {
            this._setMode('high');
        }
    }

    _setMode(mode) {
        if (this._isOperating) return;
        
        this._isOperating = true;
        this._currentMode = mode;

        // Update UI immediately
        if (mode === 'high') {
            this._updateStatus('⚡ High Performance', 'view-fullscreen-symbolic');
        } else {
            this._updateStatus('🔋 Power Save', 'battery-level-20-symbolic');
        }

        // Execute refresh rate change asynchronously
        this._executeRefreshCommand(mode);

        // Reset operating flag
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._isOperating = false;
            return GLib.SOURCE_REMOVE;
        });

        log(`RefreshProfile: Mode set to ${mode}`);
    }

    _executeRefreshCommand(mode) {
        try {
            // Create script to handle refresh rate changes
            let script = this._createRefreshScript(mode);
            
            // Execute asynchronously without blocking
            let proc = Gio.Subprocess.new(
                ['bash', '-c', script],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );

            proc.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    log(`RefreshProfile: Refresh command completed for ${mode} mode`);
                } catch (e) {
                    log(`RefreshProfile: Refresh command error: ${e.message}`);
                }
            });

        } catch (e) {
            log(`RefreshProfile: Execute command error: ${e.message}`);
        }
    }

    _createRefreshScript(mode) {
        // Create a script that tries multiple approaches for refresh rate changes
        return `
#!/bin/bash

# Log the attempt
echo "$(date): Setting ${mode} refresh rate mode" >> /tmp/refresh-profile.log

# Function to get available refresh rates
get_refresh_rates() {
    if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
        # Wayland: Try to parse available modes from system info
        if command -v gnome-randr >/dev/null 2>&1; then
            gnome-randr query 2>/dev/null | grep -E "^ *[0-9]+x[0-9]+@[0-9.]+" || true
        fi
    else
        # X11: Use xrandr to get modes
        if command -v xrandr >/dev/null 2>&1; then
            xrandr | grep -E "^ *[0-9]+x[0-9]+" | head -5
        fi
    fi
}

# Try different approaches based on session type
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "Wayland session detected" >> /tmp/refresh-profile.log
    
    # Method 1: Try gnome-randr if available
    if command -v gnome-randr >/dev/null 2>&1; then
        if [ "${mode}" = "high" ]; then
            echo "Attempting to set high refresh rate with gnome-randr" >> /tmp/refresh-profile.log
            gnome-randr modify --output eDP-1 --mode 1920x1080@60.010 2>/dev/null || gnome-randr modify --output eDP-1 --mode 1920x1080@60 2>/dev/null || true
        else
            echo "Attempting to set low refresh rate with gnome-randr" >> /tmp/refresh-profile.log
            gnome-randr modify --output eDP-1 --mode 1920x1080@59.934 2>/dev/null || gnome-randr modify --output eDP-1 --mode 1920x1080@59 2>/dev/null || true
        fi
    fi
    
    # Method 2: Try D-Bus calls to mutter (safer approach)
    if command -v dbus-send >/dev/null 2>&1; then
        echo "Attempting D-Bus refresh rate change" >> /tmp/refresh-profile.log
        # This would be a complex D-Bus call, for now just log
        echo "D-Bus method not implemented yet - would set ${mode} mode" >> /tmp/refresh-profile.log
    fi
    
else
    echo "X11 session detected" >> /tmp/refresh-profile.log
    
    # X11 approach - use xrandr
    if command -v xrandr >/dev/null 2>&1; then
        DISPLAY_OUTPUT=$(xrandr | grep " connected" | head -1 | cut -d' ' -f1)
        if [ -n "$DISPLAY_OUTPUT" ]; then
            if [ "${mode}" = "high" ]; then
                echo "Setting high refresh rate on $DISPLAY_OUTPUT (X11)" >> /tmp/refresh-profile.log
                # Try highest available rate
                xrandr --output "$DISPLAY_OUTPUT" --mode 1920x1080 --rate 60.01 2>/dev/null || \\
                xrandr --output "$DISPLAY_OUTPUT" --mode 1920x1080 --rate 60 2>/dev/null || true
            else
                echo "Setting low refresh rate on $DISPLAY_OUTPUT (X11)" >> /tmp/refresh-profile.log
                # Try lowest available rate
                xrandr --output "$DISPLAY_OUTPUT" --mode 1920x1080 --rate 59.93 2>/dev/null || \\
                xrandr --output "$DISPLAY_OUTPUT" --mode 1920x1080 --rate 59 2>/dev/null || true
            fi
        fi
    fi
fi

# Also set CPU governor for power management
if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
    if [ "${mode}" = "high" ]; then
        echo "Setting performance CPU governor" >> /tmp/refresh-profile.log
        echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null || true
    else
        echo "Setting powersave CPU governor" >> /tmp/refresh-profile.log
        echo powersave | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null || true
    fi
fi

echo "$(date): Refresh rate command completed for ${mode} mode" >> /tmp/refresh-profile.log
        `;
    }

    _updateStatus(text, iconName) {
        this._statusItem.label.text = `Status: ${text}`;
        this._icon.icon_name = iconName || 'display-symbolic';
    }

    _updatePowerDisplay() {
        const powerText = this._isOnBattery ? 'On Battery' : 'On AC Power';
        const modeText = this._currentMode === 'high' ? 'High Performance' : 
                        this._currentMode === 'low' ? 'Power Save' : 'Auto';
        
        this._powerItem.label.text = `Power: ${powerText}`;
        this._infoItem.label.text = `Mode: ${modeText}`;
    }

    destroy() {
        if (this._powerCheckInterval) {
            GLib.source_remove(this._powerCheckInterval);
            this._powerCheckInterval = null;
        }
        
        super.destroy();
    }
});

export default class RefreshProfileExtension extends Extension {
    enable() {
        log('RefreshProfile: Enabling non-blocking extension');
        this._indicator = new RefreshProfileIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        log('RefreshProfile: Disabling extension');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
} 