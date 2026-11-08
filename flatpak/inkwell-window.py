#!/usr/bin/env python3
"""Inkwell as a desktop app: runs the Inkwell server and shows it in its own window.

Used by the Flatpak build (installed as /app/bin/inkwell). Needs GTK 4 and WebKitGTK 6.
One-off commands are passed straight to the server, for example:
    flatpak run io.github.NightfallAutomotive.Inkwell --set-password
"""
import os
import sys
import threading

HERE = os.environ.get("INKWELL_APP_DIR", "/app/share/inkwell")
sys.path.insert(0, HERE)
import server  # noqa: E402

APP_ID = "io.github.NightfallAutomotive.Inkwell"
CLI_ONLY = {"--set-password", "--remove-password", "--set-vault", "-h", "--help"}


def main():
    args = sys.argv[1:]
    if CLI_ONLY & set(args):
        return server.main(args)

    import gi
    gi.require_version("Gtk", "4.0")
    gi.require_version("WebKit", "6.0")
    from gi.repository import Gio, GLib, Gtk, WebKit

    class InkwellApp(Gtk.Application):
        def __init__(self):
            super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
            self.win = None
            self.url = None
            self.closing = False

        def do_startup(self):
            Gtk.Application.do_startup(self)
            GLib.set_application_name("Inkwell")
            srv, self.url, _ = server.start(["--open", "none"] + args)
            if srv is not None:
                threading.Thread(target=srv.serve_forever, daemon=True).start()

        def open_outside(self, uri):
            """Open a link in the person's normal browser (via the desktop portal)."""
            Gtk.UriLauncher.new(uri).launch(self.win, None, None, None)

        def do_activate(self):
            if self.win:
                self.win.present()
                return
            if not self.url:
                self.quit()
                return
            data = os.path.join(GLib.get_user_data_dir(), "inkwell-webview")
            cache = os.path.join(GLib.get_user_cache_dir(), "inkwell-webview")
            session = WebKit.NetworkSession.new(data, cache)  # keeps sign-in, layout and settings
            view = WebKit.WebView(network_session=session)
            s = view.get_settings()
            s.set_property("javascript-can-access-clipboard", True)
            s.set_property("enable-developer-extras", bool(os.environ.get("INKWELL_DEBUG")))
            view.connect("decide-policy", self.on_policy)
            view.connect("create", self.on_create)

            win = Gtk.ApplicationWindow(application=self, title="Inkwell")
            win.set_default_size(1280, 820)
            win.set_icon_name(APP_ID)
            win.set_child(view)
            win.connect("close-request", self.on_close)
            self.win, self.view = win, view
            view.load_uri(self.url)
            win.present()

        def on_policy(self, view, decision, kind):
            # Links that open a new window (target=_blank, window.open) go to the normal browser.
            if kind == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
                uri = decision.get_navigation_action().get_request().get_uri()
                if uri and not uri.startswith("about:"):
                    self.open_outside(uri)
                decision.ignore()
                return True
            return False

        def on_create(self, view, action):
            uri = action.get_request().get_uri()
            if uri and not uri.startswith("about:"):
                self.open_outside(uri)
            return None

        def on_close(self, win):
            # Save anything still being typed before the window goes away.
            if self.closing:
                return False
            self.closing = True

            def done(*_):
                win.close()
            try:
                self.view.call_async_javascript_function(
                    "if (typeof saveAll === 'function') await saveAll(); return true;",
                    -1, None, None, None, None, done)
            except Exception:  # noqa: BLE001
                return False
            GLib.timeout_add(3000, lambda: (win.close(), False)[1])  # never hang on close
            return True

    app = InkwellApp()
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    sys.exit(main() or 0)
