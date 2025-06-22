# Gnome Shell Extension to set refresh rate depending on charging status.

The idea of this extension is to reduce the refresh rate of the display when the system is on battery and increase it when the system is on AC. It will also feature an icon to show the current status.


## Flow diagram

Battery Charging Event -> Set refresh rate to highest possible value -> Change icon to "Hi"
Battery Discharging Event -> Set refresh rate to lowest possible value -> Change icon to "Lo"

## How to install

1. Clone the repository
2. Run `make install`
3. Restart Gnome Shell
4. Enable the extension in the Gnome Shell Extensions app

## How to test

1. dbus-run-session -- gnome-shell --nested --wayland
2. Enable the extension in the Gnome Shell Extensions app
3. Test the extension

## How to uninstall

1. Run `make uninstall`
2. Restart Gnome Shell
3. Disable the extension in the Gnome Shell Extensions app