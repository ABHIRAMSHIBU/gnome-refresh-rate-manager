/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// D-Bus interface for display configuration
const DisplayConfigInterface = `
<node>
  <interface name="org.gnome.Mutter.DisplayConfig">
    <method name="GetCurrentState">
      <arg type="u" direction="out" name="serial"/>
      <arg type="a(uxiausauaxtua(qm))" direction="out" name="monitors"/>
      <arg type="a(uxuaustsa(sss))" direction="out" name="logical_monitors"/>
      <arg type="a{sv}" direction="out" name="properties"/>
    </method>
    <method name="ApplyMonitorsConfig">
      <arg type="u" direction="in" name="serial"/>
      <arg type="u" direction="in" name="method"/>
      <arg type="a(uxuauu)" direction="in" name="logical_monitors"/>
      <arg type="a{sv}" direction="in" name="properties"/>
    </method>
  </interface>
</node>`;

// D-Bus interface for power monitoring
const PowerInterface = `
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
    <signal name="PropertiesChanged">
      <arg type="s" name="interface_name"/>
      <arg type="a{sv}" name="changed_properties"/>
      <arg type="as" name="invalidated_properties"/>
    </signal>
  </interface>
</node>`;

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
        this._currentState = 'unknown';
        this._isOnBattery = false;
        this._displayProxy = null;
        this._powerProxy = null;
        this._currentConfig = null;
        this._availableRefreshRates = new Map();
        this._initializationDelay = null;

        // Create menu items first
        this._createMenuItems();

        // Delay initialization to avoid startup timeout
        this._initializationDelay = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._initDBus();
            this._initializationDelay = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _initDBus() {
        try {
            // Display configuration proxy with longer timeout
            this._displayProxy = Gio.DBusProxy.new_sync(
                Gio.bus_get_sync(Gio.BusType.SESSION, null),
                Gio.DBusProxyFlags.NONE,
                Gio.DBusNodeInfo.new_for_xml(DisplayConfigInterface).interfaces[0],
                'org.gnome.Mutter.DisplayConfig',
                '/org/gnome/Mutter/DisplayConfig',
                'org.gnome.Mutter.DisplayConfig',
                null
            );

            // Power monitoring proxy
            this._powerProxy = Gio.DBusProxy.new_sync(
                Gio.bus_get_sync(Gio.BusType.SYSTEM, null),
                Gio.DBusProxyFlags.NONE,
                Gio.DBusNodeInfo.new_for_xml(PowerInterface).interfaces[0],
                'org.freedesktop.UPower',
                '/org/freedesktop/UPower',
                'org.freedesktop.UPower',
                null
            );

            // Listen for power state changes
            this._powerProxy.connect('g-properties-changed', () => {
                this._checkPowerState();
            });

            // Initial state check
            this._checkPowerState();
            
            log('RefreshProfile: D-Bus initialization completed');

        } catch (e) {
            log(`RefreshProfile: Error initializing D-Bus: ${e.message}`);
            this._updateStatus('Init Error', 'dialog-error-symbolic');
        }
    }

    _createMenuItems() {
        // Status item
        this._statusItem = new PopupMenu.PopupMenuItem(_('Status: Initializing...'), {
            reactive: false,
            style_class: 'refresh-profile-status'
        });
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Manual refresh rate items
        this._highRefreshItem = new PopupMenu.PopupMenuItem(_('Set High Refresh Rate'));
        this._highRefreshItem.connect('activate', () => {
            this._setRefreshRateMode('high');
        });
        this.menu.addMenuItem(this._highRefreshItem);

        this._lowRefreshItem = new PopupMenu.PopupMenuItem(_('Set Low Refresh Rate'));
        this._lowRefreshItem.connect('activate', () => {
            this._setRefreshRateMode('low');
        });
        this.menu.addMenuItem(this._lowRefreshItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh rates info
        this._ratesItem = new PopupMenu.PopupMenuItem(_('Available rates: Detecting...'), {
            reactive: false
        });
        this.menu.addMenuItem(this._ratesItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Info item
        this._infoItem = new PopupMenu.PopupMenuItem(_('Power: Detecting... | Mode: Init'), {
            reactive: false
        });
        this.menu.addMenuItem(this._infoItem);
    }

    _checkPowerState() {
        if (!this._powerProxy) return;

        try {
            const onBattery = this._powerProxy.get_cached_property('OnBattery');
            if (onBattery) {
                const wasOnBattery = this._isOnBattery;
                this._isOnBattery = onBattery.get_boolean();
                
                if (wasOnBattery !== this._isOnBattery) {
                    log(`RefreshProfile: Power state changed - Battery: ${this._isOnBattery}`);
                    this._updateDisplayForPowerState();
                } else {
                    // First time check - just update display
                    this._updateDisplayForPowerState();
                }
            }
        } catch (e) {
            log(`RefreshProfile: Error checking power state: ${e.message}`);
        }
    }

    _updateDisplayForPowerState() {
        if (this._isOnBattery) {
            this._setRefreshRateMode('low');
        } else {
            this._setRefreshRateMode('high');
        }
    }

    _setRefreshRateMode(mode) {
        if (!this._displayProxy) {
            log('RefreshProfile: Display proxy not available');
            this._updateStatus('No Display Service', 'dialog-error-symbolic');
            return;
        }

        try {
            // Get current display configuration with timeout
            const [serial, monitors, logicalMonitors, properties] = this._displayProxy.call_sync(
                'GetCurrentState',
                null,
                Gio.DBusCallFlags.NONE,
                10000, // 10 second timeout
                null
            );

            if (!monitors || monitors.length === 0) {
                log('RefreshProfile: No monitors found');
                this._updateStatus('No Monitors', 'dialog-error-symbolic');
                return;
            }

            // Parse monitor information correctly
            const primaryMonitor = monitors[0];
            const monitorConnector = primaryMonitor[0]; // connector info
            const modes = primaryMonitor[1]; // modes array
            
            if (!modes || modes.length === 0) {
                log('RefreshProfile: No modes found for primary monitor');
                this._updateStatus('No Modes', 'dialog-error-symbolic');
                return;
            }

            // Parse modes correctly - each mode is a struct with id, width, height, refresh_rate, etc.
            const parsedModes = modes.map((mode, index) => ({
                id: mode[0], // mode ID string
                width: mode[1],
                height: mode[2], 
                refreshRate: mode[3],
                scale: mode[4],
                supportedScales: mode[5],
                properties: mode[6]
            }));

            // Sort modes by refresh rate
            const sortedModes = parsedModes.sort((a, b) => a.refreshRate - b.refreshRate);

            let targetMode;
            if (mode === 'high') {
                // Get highest refresh rate mode with same resolution as current
                const currentMode = sortedModes.find(m => 
                    m.properties && m.properties['is-current'] && m.properties['is-current'].get_boolean()
                );
                
                if (currentMode) {
                    targetMode = sortedModes
                        .filter(m => m.width === currentMode.width && m.height === currentMode.height)
                        .pop(); // highest refresh rate for this resolution
                } else {
                    targetMode = sortedModes[sortedModes.length - 1];
                }
            } else {
                // Get lowest refresh rate mode, but prefer 60Hz if available
                const mode60Hz = sortedModes.find(m => Math.abs(m.refreshRate - 60) < 1);
                targetMode = mode60Hz || sortedModes[0];
            }

            // Update rates display
            const rates = [...new Set(sortedModes.map(m => Math.round(m.refreshRate)))].sort((a, b) => a - b);
            this._ratesItem.label.text = `Available rates: ${rates.join(', ')}Hz`;

            if (!targetMode) {
                this._updateStatus('No Target Mode', 'dialog-error-symbolic');
                return;
            }

            // Apply the new configuration
            this._applyDisplayMode(serial, monitors, logicalMonitors, targetMode, mode);

        } catch (e) {
            log(`RefreshProfile: Error setting refresh rate: ${e.message}`);
            this._updateStatus('D-Bus Error', 'dialog-error-symbolic');
        }
    }

    _applyDisplayMode(serial, monitors, logicalMonitors, targetMode, mode) {
        try {
            // Create new logical monitors configuration
            // The format is: array of (x, y, scale, transform, primary, monitors_array)
            const newLogicalMonitors = logicalMonitors.map((lm, index) => {
                if (index === 0) { // Primary monitor
                    return [
                        lm[0], // x
                        lm[1], // y  
                        lm[2], // scale
                        lm[3], // transform
                        lm[4], // primary
                        [[monitors[0][0], targetMode.id]] // connector and mode id
                    ];
                }
                return lm;
            });

            // Apply the configuration
            this._displayProxy.call_sync(
                'ApplyMonitorsConfig',
                new GLib.Variant('(uua(uxuauu)a{sv})', [
                    serial,
                    1, // temporary method
                    newLogicalMonitors,
                    {}
                ]),
                Gio.DBusCallFlags.NONE,
                10000, // 10 second timeout
                null
            );

            // Update UI
            const refreshRate = Math.round(targetMode.refreshRate);
            const statusText = mode === 'high' ? 'Hi' : 'Lo';
            const iconName = mode === 'high' ? 'view-fullscreen-symbolic' : 'view-restore-symbolic';
            
            this._updateStatus(`${statusText} (${refreshRate}Hz)`, iconName);
            this._currentState = mode;

            log(`RefreshProfile: Applied ${mode} refresh rate: ${refreshRate}Hz`);

        } catch (e) {
            log(`RefreshProfile: Error applying display mode: ${e.message}`);
            this._updateStatus('Apply Error', 'dialog-error-symbolic');
        }
    }

    _updateStatus(text, iconName) {
        this._statusItem.label.text = `Status: ${text}`;
        this._icon.icon_name = iconName || 'display-symbolic';
        
        // Update power state indicator
        const powerText = this._isOnBattery ? 'Battery' : 'AC Power';
        this._infoItem.label.text = `Power: ${powerText} | Mode: ${text}`;
    }

    destroy() {
        if (this._initializationDelay) {
            GLib.source_remove(this._initializationDelay);
            this._initializationDelay = null;
        }
        
        if (this._powerProxy) {
            this._powerProxy = null;
        }
        if (this._displayProxy) {
            this._displayProxy = null;
        }
        super.destroy();
    }
});

export default class RefreshProfileExtension extends Extension {
    enable() {
        log('RefreshProfile: Enabling extension');
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
